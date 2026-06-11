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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  try {
    const path = event.path.replace(/^\/.netlify\/functions\/api/, "").split("/").filter(Boolean);
    if (path[0] === "health") {
      requireEnv();
      return json(200, { ok: true, storage: "supabase" });
    }
    if (path[0] !== "records") return json(404, { error: "Unknown API route." });
    const storeName = path[1];
    const store = STORE_TABLES[storeName];
    if (!store) return json(400, { error: `Unsupported store: ${storeName}` });
    const key = path[2] ? decodeURIComponent(path[2]) : "";

    if (event.httpMethod === "GET" && key) {
      const rows = await supabaseRequest(store.table, `select=payload&${store.key}=eq.${encodeURIComponent(key)}&limit=1`);
      return json(200, { record: rows[0]?.payload || null });
    }
    if (event.httpMethod === "GET") {
      const rows = await supabaseRequest(store.table, "select=payload");
      return json(200, { records: rows.map((row) => row.payload) });
    }
    if (event.httpMethod === "POST" || event.httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");
      const record = body.record;
      if (!record) return json(400, { error: "record is required." });
      const recordKey = record[KEY_FIELDS[storeName]];
      if (!recordKey) return json(400, { error: `${KEY_FIELDS[storeName]} is required.` });
      const row = { [store.key]: recordKey, payload: record, updated_at: new Date().toISOString() };
      await supabaseRequest(store.table, "on_conflict=" + store.key, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row)
      });
      return json(200, { record });
    }
    if (event.httpMethod === "DELETE" && key) {
      await supabaseRequest(store.table, `${store.key}=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
      return json(200, { ok: true });
    }
    if (event.httpMethod === "DELETE") {
      await supabaseRequest(store.table, "payload=not.is.null", { method: "DELETE" });
      return json(200, { ok: true });
    }
    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

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

function json(statusCode, payload) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(payload)
  };
}
