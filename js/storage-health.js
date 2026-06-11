import { formatDateTime, formatINR, showToast } from "./helpers.js";

export async function getStorageHealth() {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const usagePct = quota ? Math.round((usage / quota) * 100) : 0;
  return {
    persisted,
    usage,
    quota,
    usagePct,
    usageLabel: bytesToLabel(usage),
    quotaLabel: bytesToLabel(quota)
  };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    showToast("Persistent storage request is not supported in this browser.", "error");
    return false;
  }
  const granted = await navigator.storage.persist();
  showToast(granted ? "Persistent storage is enabled." : "Browser did not grant persistent storage.", granted ? "success" : "error");
  return granted;
}

export function bytesToLabel(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function renderStorageCard(health, lastBackupAt = "") {
  return `
    <div class="metric-card">
      <small>Storage persistence</small>
      <strong>${health.persisted ? "Persisted" : "Not persisted"}</strong>
      <span>${health.persisted ? "Browser will try to protect this data." : "Request persistence from Settings."}</span>
    </div>
    <div class="metric-card">
      <small>Storage usage</small>
      <strong>${health.usageLabel}</strong>
      <span>${health.usagePct}% of ${health.quotaLabel || "available quota"}</span>
    </div>
    <div class="metric-card">
      <small>Last backup</small>
      <strong>${lastBackupAt ? formatDateTime(lastBackupAt) : "Never"}</strong>
      <span>Export a ZIP after important entries.</span>
    </div>
  `;
}
