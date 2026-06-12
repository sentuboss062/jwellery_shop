const STORE_TABLES = {
  shopSettings: { table: "shops_settings", key: "id" },
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Content-Type": "application/json"
};

export default async function handler(req, res) {
  setHeaders(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  try {
    const path = getPathParts(req);
    if (path[0] === "health") {
      requireEnv();
      sendJson(res, 200, { ok: true, storage: "supabase", platform: "vercel" });
      return;
    }

    if (path[0] !== "records") {
      sendJson(res, 404, { error: "Unknown API route." });
      return;
    }

    const storeName = path[1];
    const store = STORE_TABLES[storeName];
    if (!store) {
      sendJson(res, 400, { error: `Unsupported store: ${storeName}` });
      return;
    }

    const key = path[2] ? decodeURIComponent(path[2]) : "";

    if (req.method === "GET" && key) {
      const rows = await supabaseRequest(store.table, `select=payload&${store.key}=eq.${encodeURIComponent(key)}&limit=1`);
      sendJson(res, 200, { record: rows[0]?.payload || null });
      return;
    }

    if (req.method === "GET") {
      const rows = await supabaseRequest(store.table, "select=payload");
      sendJson(res, 200, { records: rows.map((row) => row.payload) });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await readBody(req);
      const record = body.record;
      if (!record) {
        sendJson(res, 400, { error: "record is required." });
        return;
      }

      const recordKey = record[KEY_FIELDS[storeName]];
      if (!recordKey) {
        sendJson(res, 400, { error: `${KEY_FIELDS[storeName]} is required.` });
        return;
      }

      const row = { [store.key]: recordKey, payload: record, updated_at: new Date().toISOString() };
      await supabaseRequest(store.table, `on_conflict=${store.key}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row)
      });
      sendJson(res, 200, { record });
      return;
    }

    if (req.method === "DELETE" && key) {
      await supabaseRequest(store.table, `${store.key}=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "DELETE") {
      await supabaseRequest(store.table, "payload=not.is.null", { method: "DELETE" });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function getPathParts(req) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  return url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function requireEnv() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
}

async function supabaseRequest(table, query = "", options = {}) {
  requireEnv();
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
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
  if (!response.ok) {
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  return text ? JSON.parse(text) : [];
}

function setHeaders(res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}
