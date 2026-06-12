const DEFAULT_API_BASE = "/api";

let apiBase = DEFAULT_API_BASE;
let apiAvailable = null;

export function configureApiClient(config = {}) {
  apiBase = config.apiBase || window.JEWELLERY_PORTAL_CONFIG?.apiBase || DEFAULT_API_BASE;
}

export async function isApiAvailable() {
  if (apiAvailable !== null) return apiAvailable;
  try {
    const response = await fetch(`${apiBase}/health`, { headers: { Accept: "application/json" } });
    apiAvailable = response.ok;
  } catch {
    apiAvailable = false;
  }
  return apiAvailable;
}

export function resetApiAvailability() {
  apiAvailable = null;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
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

export function listRecords(storeName) {
  return request(`/records/${encodeURIComponent(storeName)}`).then((payload) => payload.records || []);
}

export function getRecord(storeName, key) {
  return request(`/records/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`).then((payload) => payload.record || null);
}

export function createRecord(storeName, record) {
  return request(`/records/${encodeURIComponent(storeName)}`, {
    method: "POST",
    body: JSON.stringify({ record })
  }).then((payload) => payload.record);
}

export function saveRecord(storeName, record) {
  return request(`/records/${encodeURIComponent(storeName)}`, {
    method: "PUT",
    body: JSON.stringify({ record })
  }).then((payload) => payload.record);
}

export function deleteRecord(storeName, key) {
  return request(`/records/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`, {
    method: "DELETE"
  }).then((payload) => payload.ok);
}

export function clearRecords(storeName) {
  return request(`/records/${encodeURIComponent(storeName)}`, {
    method: "DELETE"
  }).then((payload) => payload.ok);
}
