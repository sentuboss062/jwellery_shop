import {
  APP_VERSION,
  STORE_NAMES,
  backupZipFilename,
  downloadBlob,
  isoNow,
  readFileAsText,
  safeJsonParse,
  showToast,
  todayInputValue,
  waitForGlobal
} from "./helpers.js";
import { DB_VERSION } from "./db.js";
import { addRecord, exportAllStores, getActiveShopId, getSettings, listNormalizedBills, logAudit, replaceStores, updateSettings } from "./data-service.js";
import { billPdfBlob, loanPdfBlob, stockSummaryPdfBlob } from "./pdf.js";
import { ensureOwnerPassword } from "./security.js";
import { createCloudBackup, listCloudBackups } from "./api-client.js";

async function getZipCtor() {
  return waitForGlobal("JSZip");
}

function countRecords(data) {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, Array.isArray(data[name]) ? data[name].length : 0]));
}

function backupManifest(data, type = "json") {
  return {
    appVersion: APP_VERSION,
    dbVersion: DB_VERSION,
    exportedAt: isoNow(),
    originAtExport: location.origin,
    shopId: getActiveShopId(),
    backupType: type,
    recordCounts: countRecords(data)
  };
}

function summarizeStock(stockLots) {
  const map = new Map();
  stockLots.forEach((lot) => {
    if (lot.status === "Deleted") return;
    const key = `${lot.metalType}|${lot.purity}|${lot.category}`;
    const existing = map.get(key) || {
      metalType: lot.metalType,
      purity: lot.purity,
      category: lot.category,
      grossWeightGm: 0,
      availableWeightGm: 0
    };
    existing.grossWeightGm += Number(lot.grossWeightGm || 0);
    existing.availableWeightGm += Number(lot.availableWeightGm || 0);
    map.set(key, existing);
  });
  return Array.from(map.values());
}

export async function exportJsonOnly() {
  const data = await exportAllStores();
  const manifest = backupManifest(data, "json-download");
  const blob = new Blob([JSON.stringify({ manifest, stores: data }, null, 2)], { type: "application/json" });
  downloadBlob(blob, `jewellery-json-backup-${todayInputValue()}.json`);
  await updateSettings({ lastBackupAt: manifest.exportedAt });
  await addRecord("backupMeta", {
    backupId: `JSON-${Date.now()}`,
    fileName: `jewellery-json-backup-${todayInputValue()}.json`,
    createdAt: manifest.exportedAt,
    recordCounts: manifest.recordCounts,
    appVersion: APP_VERSION,
    originAtExport: location.origin
  });
  showToast("JSON backup exported.", "success");
}

export async function exportFullZip(options = {}) {
  const JSZip = await getZipCtor();
  const zip = new JSZip();
  const data = await exportAllStores();
  const settings = await getSettings();
  const manifest = {
    ...backupManifest(data, "zip-download"),
    note: "Browser-local IndexedDB backup for Jewellery Shop Portal."
  };

  STORE_NAMES.forEach((storeName) => {
    zip.file(`json-db/${storeName}.json`, JSON.stringify(data[storeName] || [], null, 2));
  });
  zip.file("meta/manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("stock/summary.json", JSON.stringify(summarizeStock(data.stockLots || []), null, 2));

  const bills = await listNormalizedBills({ includeCancelled: true });
  for (const bill of bills) {
    const prefix = bill.billType === "Combined" ? "B" : bill.metalType === "Silver" ? "S" : "G";
    const fileName = `bills/BILL-${prefix}-${bill.billNo.replace(/^.+?-/, "")}-${bill.dateISO}.pdf`;
    zip.file(fileName, await billPdfBlob(bill, settings));
  }

  for (const loan of data.loans || []) {
    const fileName = `loan-receipts/LOAN-${loan.loanNo.replace(/^L-/, "")}-${loan.startDateISO}.pdf`;
    zip.file(fileName, await loanPdfBlob(loan, settings));
  }

  zip.file("stock/summary.pdf", await stockSummaryPdfBlob(summarizeStock(data.stockLots || []), settings));
  const blob = await zip.generateAsync({ type: "blob" });
  const fileName = options.fileName || backupZipFilename();
  if (options.download !== false) {
    downloadBlob(blob, fileName);
  }

  await updateSettings({ lastBackupAt: manifest.exportedAt });
  await addRecord("backupMeta", {
    backupId: `ZIP-${Date.now()}`,
    fileName,
    createdAt: manifest.exportedAt,
    recordCounts: manifest.recordCounts,
    appVersion: APP_VERSION,
    originAtExport: location.origin
  });
  await logAudit("BACKUP_EXPORT", "Backup", fileName, "Manual export", "Full ZIP backup exported.");
  showToast("Full ZIP backup exported.", "success");
  return { blob, fileName, manifest };
}

export async function createSupabaseCloudBackup() {
  const data = await exportAllStores();
  const manifest = backupManifest(data, "supabase-database");
  const fileName = `cloud-backup-${manifest.shopId}-${todayInputValue()}-${Date.now()}.json`;
  const result = await createCloudBackup({ fileName, manifest, stores: data });
  await updateSettings({ lastBackupAt: manifest.exportedAt });
  await addRecord("backupMeta", {
    backupId: result.backupId || `CLOUD-${Date.now()}`,
    fileName,
    createdAt: manifest.exportedAt,
    recordCounts: manifest.recordCounts,
    appVersion: APP_VERSION,
    originAtExport: location.origin,
    cloud: true,
    shopId: manifest.shopId
  });
  await logAudit("BACKUP_CLOUD_CREATE", "Backup", result.backupId || fileName, "Manual cloud backup", "Full JSON backup saved in Supabase database.");
  showToast("Cloud backup saved in Supabase.", "success");
  return result;
}

export async function getSupabaseCloudBackups() {
  try {
    return await listCloudBackups();
  } catch {
    return [];
  }
}

async function readBackupFile(file) {
  if (!file) throw new Error("Select a backup file.");
  if (file.name.toLowerCase().endsWith(".zip")) {
    const JSZip = await getZipCtor();
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file("meta/manifest.json");
    if (!manifestFile) throw new Error("ZIP backup is missing meta/manifest.json.");
    const manifest = JSON.parse(await manifestFile.async("string"));
    const stores = {};
    for (const name of STORE_NAMES) {
      const storeFile = zip.file(`json-db/${name}.json`);
      stores[name] = storeFile ? JSON.parse(await storeFile.async("string")) : [];
    }
    return { manifest, stores };
  }

  const text = await readFileAsText(file);
  const parsed = safeJsonParse(text);
  if (!parsed) throw new Error("Backup JSON could not be parsed.");
  if (parsed.manifest && parsed.stores) return parsed;
  throw new Error("JSON backup must include manifest and stores.");
}

function validateBackup(payload) {
  if (!payload?.manifest || !payload?.stores) throw new Error("Invalid backup file.");
  if (payload.manifest.dbVersion !== DB_VERSION) {
    throw new Error(`Backup database version ${payload.manifest.dbVersion} does not match app version ${DB_VERSION}.`);
  }
  for (const store of STORE_NAMES) {
    if (payload.stores[store] && !Array.isArray(payload.stores[store])) {
      throw new Error(`${store} must be an array in the backup.`);
    }
  }
}

export async function restoreBackupFromFile(file) {
  const approval = await ensureOwnerPassword("Restore backup", {
    message: "A pre-restore backup will be downloaded first. Existing browser-local data will then be replaced.",
    confirmText: "Restore",
    danger: true
  });
  if (!approval) return null;

  await exportFullZip({ fileName: `pre-restore-${backupZipFilename()}` });
  const payload = await readBackupFile(file);
  validateBackup(payload);
  await replaceStores(payload.stores);
  await logAudit("BACKUP_RESTORE", "Backup", file.name, approval.reason, `Imported backup from ${payload.manifest.originAtExport || "unknown origin"}.`);
  showToast("Backup restored. Reloading app data.", "success");
  return {
    manifest: payload.manifest,
    counts: countRecords(payload.stores)
  };
}
