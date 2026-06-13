const STORE_TABLES = {
  shopSettings: { table: "shops_settings", key: "id", ownerHashField: "ownerPasswordHash" },
  bills: { table: "bills", key: "bill_no" },
  billItems: { table: "bill_items", key: "line_id" },
  goldBills: { table: "legacy_gold_bills", key: "bill_no" },
  silverBills: { table: "legacy_silver_bills", key: "bill_no" },
  stockLots: { table: "stock_lots", key: "stock_id" },
  stockMovements: { table: "stock_movements", key: "movement_id" },
  customers: { table: "customers", key: "customer_id" },
  loans: { table: "loans", key: "loan_no" },
  exchangeEntries: { table: "exchange_entries", key: "exchange_id" },
  credits: { table: "credits", key: "credit_id" },
  rates: { table: "rates", key: "rate_date" },
  backupMeta: { table: "backup_meta", key: "backup_id" },
  auditLog: { table: "audit_log", key: "event_id" }
};

const KEY_FIELDS = {
  shopSettings: "id",
  bills: "billNo",
  billItems: "lineId",
  goldBills: "billNo",
  silverBills: "billNo",
  stockLots: "stockId",
  stockMovements: "movementId",
  customers: "customerId",
  loans: "loanNo",
  exchangeEntries: "exchangeId",
  credits: "creditId",
  rates: "rateDate",
  backupMeta: "backupId",
  auditLog: "eventId"
};

const OPEN_WRITE_STORES = new Set(["shopSettings", "rates", "auditLog", "backupMeta"]);
const NO_DELETE_STORES = new Set(["shopSettings", "auditLog", "backupMeta", "goldBills", "silverBills"]);
const rateLimitMap = new Map();
const RATE_LIMIT = 120;
const WINDOW_MS = 60000;
const MAX_BODY_BYTES = 500000;

export default async function handler(req, res) {
  const path = getPathParts(req);
  const resource = path[0] || "";

  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return sendJson(res, 204, null);

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    return sendJson(res, 429, { error: "Too many requests. Please wait a minute." });
  }

  try {
    if (resource === "health") {
      requireEnv();
      return sendJson(res, 200, { ok: true, storage: "supabase", platform: "vercel" });
    }

    if (resource === "config" && req.method === "GET") {
      return sendJson(res, 200, { apiToken: process.env.API_SECRET_TOKEN || "" });
    }

    if (resource === "verify-owner" && req.method === "POST") {
      const { ownerHash } = await readBody(req);
      if (!ownerHash) return sendJson(res, 400, { error: "Missing ownerHash" });
      return sendJson(res, 200, { valid: ownerHash === await getStoredOwnerHash() });
    }

    checkApiToken(req);

    if (resource === "records") {
      return await handleRecordRoute(req, res, path);
    }

    if (STORE_TABLES[resource]) {
      return await handleRecordRoute(req, res, ["records", resource, path[1]]);
    }

    return sendJson(res, 404, { error: "Unknown API route." });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
}

async function handleRecordRoute(req, res, path) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  const storeName = path[1] || url.searchParams.get("store");
  const store = STORE_TABLES[storeName];
  if (!store) return sendJson(res, 400, { error: `Unsupported store: ${storeName}` });
  const key = path[2] ? decodeURIComponent(path[2]) : url.searchParams.get("key") || "";

  if (req.method === "DELETE") {
    if (!key) return sendJson(res, 405, { error: "DELETE without an id is not allowed" });
    if (NO_DELETE_STORES.has(storeName)) return sendJson(res, 405, { error: `${storeName} cannot be deleted via API` });
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    await assertOwnerWriteAllowed(req, storeName);
  }

  if (req.method === "GET" && key) {
    const rows = await supabaseRequest(store.table, `select=payload&${store.key}=eq.${encodeURIComponent(key)}&limit=1`);
    return sendJson(res, 200, { record: rows[0]?.payload || null });
  }

  if (req.method === "GET") {
    const query = listQuery(req);
    const rows = await supabaseRequest(store.table, `select=payload&${query}`);
    return sendJson(res, 200, { records: rows.map((row) => row.payload) });
  }

  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const body = await readBody(req);
    const record = body.record;
    if (!record || typeof record !== "object") return sendJson(res, 400, { error: "record is required." });
    const recordKey = record[KEY_FIELDS[storeName]];
    if (!recordKey) return sendJson(res, 400, { error: `${KEY_FIELDS[storeName]} is required.` });

    const row = { [store.key]: recordKey, payload: sanitizeRecord(record), updated_at: new Date().toISOString() };
    await supabaseRequest(store.table, `on_conflict=${store.key}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row)
    });
    return sendJson(res, 200, { record });
  }

  if (req.method === "DELETE") {
    if (storeName === "customers") {
      const existing = await supabaseRequest(store.table, `select=payload&${store.key}=eq.${encodeURIComponent(key)}&limit=1`);
      const payload = { ...(existing[0]?.payload || {}), deleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await supabaseRequest(store.table, `on_conflict=${store.key}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ [store.key]: key, payload, updated_at: new Date().toISOString() })
      });
      return sendJson(res, 200, { ok: true, softDeleted: true });
    }

    await supabaseRequest(store.table, `${store.key}=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: "Method not allowed." });
}

function getPathParts(req) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  return url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
}

function listQuery(req) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  const params = url.searchParams;
  params.delete("store");
  params.delete("key");
  params.delete("route");
  params.delete("path");
  params.delete("...route");
  params.delete("[...route]");
  if (!params.has("limit")) params.set("limit", "100");
  if (!params.has("order")) params.set("order", "updated_at.desc");
  const limit = Math.min(Math.max(Number(params.get("limit") || 100), 1), 500);
  params.set("limit", String(limit));
  return params.toString();
}

function setCorsHeaders(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://jwellery-shop-nu.vercel.app";
  const origin = req.headers.origin || "";
  const isAllowed = origin === allowedOrigin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-token, x-owner-hash");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Content-Type", "application/json");
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function checkApiToken(req) {
  const secret = process.env.API_SECRET_TOKEN;
  if (!secret) return;
  const incoming = req.headers["x-api-token"] || "";
  if (incoming !== secret) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

async function assertOwnerWriteAllowed(req, storeName) {
  if (OPEN_WRITE_STORES.has(storeName)) return;
  const stored = await getStoredOwnerHash();
  if (!stored) return;
  const incoming = req.headers["x-owner-hash"] || "";
  if (!incoming) {
    const error = new Error("Owner verification required");
    error.statusCode = 403;
    throw error;
  }
  if (incoming !== stored) {
    const error = new Error("Owner verification failed");
    error.statusCode = 403;
    throw error;
  }
}

async function getStoredOwnerHash() {
  const rows = await supabaseRequest("shops_settings", "select=payload&id=eq.main&limit=1");
  const payload = rows[0]?.payload || {};
  return payload.ownerPasswordHash || payload.owner_pw_hash || "";
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    if (req.body.length > MAX_BODY_BYTES) throw new Error("Request body too large");
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sanitizeRecord(record) {
  if (Array.isArray(record) || record === null || typeof record !== "object") return record;
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => key.length <= 80 && typeof value !== "function"));
}

function supabaseBaseUrl() {
  const rawUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!rawUrl) {
    throw new Error("SUPABASE_URL is required.");
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(rawUrl)) {
    throw new Error("SUPABASE_URL must be your Supabase Project URL, like https://xxxx.supabase.co. Do not use the Supabase dashboard URL.");
  }
  return rawUrl;
}

function requireEnv() {
  supabaseBaseUrl();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }
}

async function supabaseRequest(table, query = "", options = {}) {
  requireEnv();
  const url = `${supabaseBaseUrl()}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Supabase request failed: ${response.status}`);
  return text ? JSON.parse(text) : [];
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  if (statusCode === 204) return res.end();
  return res.end(JSON.stringify(payload));
}
