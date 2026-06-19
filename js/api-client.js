const DEFAULT_API_BASE = "/api";
const SHOP_CONTEXT_KEY = "jewellery_portal_active_shop_id";
const SINGLE_SHOP_ID = "main";

let apiBase = DEFAULT_API_BASE;
let apiAvailable = null;
let apiToken = typeof document !== "undefined"
  ? document.querySelector('meta[name="x-api-token"]')?.content || ""
  : "";
let configPromise = null;

export function configureApiClient(config = {}) {
  apiBase = config.apiBase || window.JEWELLERY_PORTAL_CONFIG?.apiBase || DEFAULT_API_BASE;
  apiAvailable = null;
  configPromise = null;
}

export async function loadApiConfig() {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const response = await fetch(`${apiBase}/config`, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const config = await response.json();
      apiToken = config.apiToken || apiToken || "";
      const meta = document.querySelector('meta[name="x-api-token"]');
      if (meta && apiToken) meta.setAttribute("content", apiToken);
      return config;
    } catch {
      return null;
    }
  })();
  return configPromise;
}

export async function isApiAvailable() {
  if (apiAvailable !== null) return apiAvailable;
  try {
    const response = await fetch(`${apiBase}/health`, { headers: { Accept: "application/json" } });
    apiAvailable = response.ok;
    if (apiAvailable) await loadApiConfig();
  } catch {
    apiAvailable = false;
  }
  return apiAvailable;
}

export function resetApiAvailability() {
  apiAvailable = null;
}

async function request(path, options = {}, ownerHash = "") {
  await loadApiConfig();
  const shopId = getActiveShopId();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-shop-id": shopId,
      ...(apiToken ? { "x-api-token": apiToken } : {}),
      ...(ownerHash ? { "x-owner-hash": ownerHash } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `API request failed: ${response.status}`);
  }
  return payload;
}

export function getActiveShopId() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(SHOP_CONTEXT_KEY);
  return SINGLE_SHOP_ID;
}

export function setActiveShopId() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(SHOP_CONTEXT_KEY);
  return SINGLE_SHOP_ID;
}

export function normalizeShopId(value) {
  return String(value || "main").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "main";
}

export function listRecords(storeName, params = "") {
  const query = recordQuery(storeName, "", params);
  return request(`/records?${query}`).then((payload) => payload.records || []);
}

export function listPaged(storeName, page = 0, pageSize = 50, filters = "") {
  const offset = page * pageSize;
  const params = `limit=${pageSize}&offset=${offset}${filters ? `&${filters}` : ""}`;
  return listRecords(storeName, params);
}

export function getRecord(storeName, key) {
  return request(`/records?${recordQuery(storeName, key)}`).then((payload) => payload.record || null);
}

export function createRecord(storeName, record, ownerHash = "") {
  return request(`/records?${recordQuery(storeName)}`, {
    method: "POST",
    body: JSON.stringify({ record })
  }, ownerHash).then((payload) => payload.record);
}

export function saveRecord(storeName, record, ownerHash = "") {
  return request(`/records?${recordQuery(storeName)}`, {
    method: "PUT",
    body: JSON.stringify({ record })
  }, ownerHash).then((payload) => payload.record);
}

export function updateRecord(storeName, key, record, ownerHash = "") {
  return request(`/records?${recordQuery(storeName, key)}`, {
    method: "PATCH",
    body: JSON.stringify({ record })
  }, ownerHash).then((payload) => payload.record);
}

export function deleteRecord(storeName, key, ownerHash = "") {
  return request(`/records?${recordQuery(storeName, key)}`, {
    method: "DELETE"
  }, ownerHash).then((payload) => payload.ok);
}

export function clearRecords(storeName, ownerHash = "") {
  return request(`/records?${recordQuery(storeName)}`, {
    method: "DELETE"
  }, ownerHash).then((payload) => payload.ok);
}

export function createCloudBackup(snapshot, ownerHash = "") {
  return request("/cloud-backups", {
    method: "POST",
    body: JSON.stringify(snapshot)
  }, ownerHash);
}

export function listCloudBackups() {
  return request("/cloud-backups").then((payload) => payload.backups || []);
}

export function getCloudBackup(backupId) {
  return request(`/cloud-backups?key=${encodeURIComponent(backupId)}`).then((payload) => payload.backup || null);
}

function recordQuery(storeName, key = "", extra = "") {
  const params = new URLSearchParams(extra || "");
  params.set("store", storeName);
  if (key) params.set("key", key);
  return params.toString();
}

export const api = {
  health: () => isApiAvailable(),
  list: (storeName, params) => listRecords(storeName, params),
  get: (storeName, key) => getRecord(storeName, key),
  save: (storeName, record, ownerHash) => saveRecord(storeName, record, ownerHash),
  update: (storeName, key, record, ownerHash) => updateRecord(storeName, key, record, ownerHash),
  remove: (storeName, key, ownerHash) => deleteRecord(storeName, key, ownerHash),
  createCloudBackup,
  listCloudBackups,
  getCloudBackup
};

export default api;
