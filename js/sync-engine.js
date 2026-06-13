import api from "./api-client.js";

const QUEUE_DB_NAME = "jewellery_sync_queue";
const QUEUE_DB_VER = 1;
const QUEUE_STORE = "sync_queue";

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VER);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function queueTx(db, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, mode);
    const store = tx.objectStore(QUEUE_STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Sync queue transaction aborted."));
  });
}

function queueAdd(db, op) {
  return queueTx(db, "readwrite", (store) => store.add({ ...op, status: "pending", createdAt: Date.now() }));
}

function queueGetPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const request = tx.objectStore(QUEUE_STORE).index("status").getAll("pending");
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

function queueRemove(db, queueId) {
  return queueTx(db, "readwrite", (store) => store.delete(queueId));
}

function queueMarkError(db, queueId, errorMsg) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const getRequest = store.get(queueId);
    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) {
        resolve();
        return;
      }
      record.status = "error";
      record.errorMsg = errorMsg;
      record.errorAt = Date.now();
      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

function queueCountPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const request = tx.objectStore(QUEUE_STORE).index("status").count("pending");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function injectStatusIndicator() {
  if (document.getElementById("sync-status-indicator")) return;
  const el = document.createElement("div");
  el.id = "sync-status-indicator";
  el.style.cssText = "position:fixed;bottom:16px;right:16px;display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;font-family:sans-serif;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.3s ease;cursor:default;user-select:none;";
  document.body.appendChild(el);
}

function setStatus(state, pending = 0, errors = 0) {
  const el = document.getElementById("sync-status-indicator");
  if (!el) return;
  const styles = {
    online: { bg: "#d1fae5", color: "#065f46", dot: "#10b981", text: "Synced" },
    offline: { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b", text: `Offline - ${pending} pending` },
    syncing: { bg: "#dbeafe", color: "#1e40af", dot: "#3b82f6", text: "Syncing..." },
    error: { bg: "#fee2e2", color: "#991b1b", dot: "#ef4444", text: `${errors} sync error(s)` }
  };
  const s = styles[state] || styles.online;
  el.style.background = s.bg;
  el.style.color = s.color;
  el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${s.dot};display:inline-block;"></span><span>${s.text}</span>`;
  if (state === "online") setTimeout(() => { el.style.opacity = "0"; }, 3000);
  else el.style.opacity = "1";
}

class SyncEngine {
  constructor() {
    this.db = null;
    this.syncing = false;
  }

  async init() {
    this.db = await openQueueDb();
    injectStatusIndicator();
    window.addEventListener("online", () => this.processQueue());
    window.addEventListener("offline", () => this.updateOfflineStatus());
    if (navigator.onLine) {
      const pending = await queueCountPending(this.db);
      if (pending > 0) await this.processQueue();
      else setStatus("online");
    } else {
      await this.updateOfflineStatus();
    }
  }

  async write(method, storeName, idOrBody, body, ownerHash = "") {
    if (!this.db) this.db = await openQueueDb();
    const op = {
      method,
      storeName,
      id: method === "save" ? undefined : idOrBody,
      body: method === "save" ? idOrBody : body,
      ownerHash
    };
    if (!navigator.onLine) {
      await queueAdd(this.db, op);
      await this.updateOfflineStatus();
      return null;
    }
    try {
      return await this.runOperation(op);
    } catch (error) {
      if (error.message.includes("Owner verification") || error.message.includes("Unauthorized")) throw error;
      await queueAdd(this.db, op);
      await this.updateOfflineStatus();
      return null;
    }
  }

  async runOperation(op) {
    if (op.method === "save") return api.save(op.storeName, op.body, op.ownerHash);
    if (op.method === "update") return api.update(op.storeName, op.id, op.body, op.ownerHash);
    if (op.method === "remove") return api.remove(op.storeName, op.id, op.ownerHash);
    throw new Error(`Unknown sync operation: ${op.method}`);
  }

  async processQueue() {
    if (!this.db) this.db = await openQueueDb();
    if (this.syncing) return;
    this.syncing = true;
    setStatus("syncing");
    const pending = await queueGetPending(this.db);
    let errors = 0;
    for (const op of pending) {
      try {
        await this.runOperation(op);
        await queueRemove(this.db, op.queueId);
      } catch (error) {
        await queueMarkError(this.db, op.queueId, error.message);
        errors += 1;
      }
    }
    this.syncing = false;
    errors > 0 ? setStatus("error", 0, errors) : setStatus("online");
  }

  async updateOfflineStatus() {
    if (!this.db) this.db = await openQueueDb();
    setStatus("offline", await queueCountPending(this.db));
  }

  async pendingCount() {
    if (!this.db) this.db = await openQueueDb();
    return queueCountPending(this.db);
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
