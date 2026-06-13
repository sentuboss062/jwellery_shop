import * as indexedDb from "./db.js";
import * as api from "./api-client.js";
import syncEngine from "./sync-engine.js";
import {
  APP_VERSION,
  STORE_NAMES,
  calculateLoanInterest,
  computedLoanStatus,
  deriveFinancialYear,
  getSequenceFromId,
  isoNow,
  normalizeBillRecord,
  normalizeMobile,
  num,
  numberWithFy,
  randomId,
  roundMoney,
  roundWeight,
  todayInputValue
} from "./helpers.js";

const KEY_PATHS = {
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

let useApi = false;

async function shouldUseApi() {
  return useApi;
}

export async function initializeDataStore() {
  await indexedDb.openDB();
  api.configureApiClient();
  useApi = await api.isApiAvailable();
  return getSettings();
}

async function adapterList(storeName) {
  if (await shouldUseApi()) return api.listRecords(storeName);
  return indexedDb.getAll(storeName);
}

async function adapterGet(storeName, key) {
  if (await shouldUseApi()) return api.getRecord(storeName, key);
  return indexedDb.getByKey(storeName, key);
}

async function adapterCreate(storeName, record) {
  if (await shouldUseApi()) return syncEngine.write("save", storeName, record, undefined, await getApiOwnerHash());
  return indexedDb.addRecord(storeName, record);
}

async function adapterSave(storeName, record) {
  if (await shouldUseApi()) return syncEngine.write("save", storeName, record, undefined, await getApiOwnerHash());
  return indexedDb.putRecord(storeName, record);
}

async function adapterDelete(storeName, key) {
  if (await shouldUseApi()) return syncEngine.write("remove", storeName, key, undefined, await getApiOwnerHash());
  return indexedDb.deleteRecord(storeName, key);
}

async function adapterClear(storeName) {
  if (await shouldUseApi()) throw new Error("Full-store clear is disabled for the backend API. Restore into IndexedDB fallback or delete individual records.");
  return indexedDb.clearStore(storeName);
}

async function getApiOwnerHash() {
  if (!(await shouldUseApi())) return "";
  try {
    const settings = await api.getRecord("shopSettings", "main");
    return settings?.ownerPasswordHash || settings?.owner_pw_hash || "";
  } catch {
    return "";
  }
}

export function isBackendActive() {
  return useApi;
}

export async function getAll(storeName) {
  return adapterList(storeName);
}

export async function getByKey(storeName, key) {
  return adapterGet(storeName, key);
}

export async function getByIndex(storeName, indexName, value) {
  const records = await adapterList(storeName);
  return records.find((record) => record[indexName] === value) || null;
}

export async function getAllByIndex(storeName, indexName, value) {
  const records = await adapterList(storeName);
  return records.filter((record) => record[indexName] === value);
}

export async function addRecord(storeName, record) {
  return adapterCreate(storeName, record);
}

export async function putRecord(storeName, record) {
  return adapterSave(storeName, record);
}

export async function deleteRecord(storeName, key) {
  return adapterDelete(storeName, key);
}

export async function clearStore(storeName) {
  return adapterClear(storeName);
}

export async function countRecords(storeName) {
  return (await adapterList(storeName)).length;
}

export const listRecords = getAll;
export const getRecord = getByKey;
export const findRecordByIndex = getByIndex;
export const listRecordsByIndex = getAllByIndex;
export const createRecord = addRecord;
export const saveRecord = putRecord;
export const removeRecord = deleteRecord;
export const clearRecords = clearStore;
export const countStoreRecords = countRecords;

export async function getSettings() {
  const existing = await adapterGet("shopSettings", "main");
  if (existing) {
    if (!existing.combinedInvoicePrefix || existing.loanDefaultDailyRate === undefined || existing.loanDefaultMonthlyRate === undefined || !existing.goldCategories || !existing.silverCategories) {
      const updated = {
        ...existing,
        combinedInvoicePrefix: existing.combinedInvoicePrefix || "B",
        loanDefaultDailyRate: existing.loanDefaultDailyRate ?? 0.07,
        loanDefaultMonthlyRate: existing.loanDefaultMonthlyRate ?? 2,
        goldCategories: existing.goldCategories || [],
        silverCategories: existing.silverCategories || [],
        updatedAt: isoNow()
      };
      await adapterSave("shopSettings", updated);
      return updated;
    }
    return existing;
  }
  const now = isoNow();
  const defaults = {
    id: "main",
    shopName: "Family Jewellery Shop",
    shopAddress: "",
    shopPhone: "",
    gstin: "",
    logoDataUrl: "",
    ownerPasswordHash: "",
    ownerPasswordSalt: "",
    combinedInvoicePrefix: "B",
    goldInvoicePrefix: "G",
    silverInvoicePrefix: "S",
    loanPrefix: "L",
    loanDefaultDailyRate: 0.07,
    loanDefaultMonthlyRate: 2,
    goldCategories: [],
    silverCategories: [],
    defaultGstPct: 3,
    financialYear: deriveFinancialYear(),
    lastBackupAt: "",
    productionOrigin: location.origin,
    printFooterText: "Thank you for your business.",
    createdAt: now,
    updatedAt: now
  };
  await adapterSave("shopSettings", defaults);
  return defaults;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, id: "main", updatedAt: isoNow() };
  await adapterSave("shopSettings", next);
  return next;
}

export async function logAudit(actionType, entityType, entityId, reason = "", summary = "") {
  const record = {
    eventId: randomId("AUD"),
    ts: isoNow(),
    actionType,
    entityType,
    entityId,
    reason,
    summary
  };
  await adapterCreate("auditLog", record);
  return record;
}

export async function nextId(storeName, prefix, dateISO = todayInputValue()) {
  const fy = deriveFinancialYear(dateISO);
  const records = await adapterList(storeName);
  const keyPath = KEY_PATHS[storeName];
  const start = `${prefix}-${fy}-`;
  const max = records.reduce((highest, record) => {
    const key = record[keyPath];
    return String(key).startsWith(start) ? Math.max(highest, getSequenceFromId(key)) : highest;
  }, 0);
  return numberWithFy(prefix, fy, max + 1);
}

export const issueNextId = nextId;

export async function getLatestRate() {
  const rates = await adapterList("rates");
  return rates.sort((a, b) => String(b.rateDate).localeCompare(String(a.rateDate)))[0] || null;
}

export function saveRate(rate) {
  return adapterSave("rates", rate);
}

export async function upsertCustomer(input) {
  const mobile = normalizeMobile(input.customerMobile || input.mobile);
  const now = isoNow();
  const customers = await adapterList("customers");
  const existing = customers.find((customer) => customer.mobile === mobile);
  const record = existing ? {
    ...existing,
    name: input.customerName || input.name || existing.name,
    mobile,
    address: input.customerAddress || input.address || existing.address || "",
    idProofNo: input.idProofNo || existing.idProofNo || "",
    notes: input.notes || existing.notes || "",
    updatedAt: now
  } : {
    customerId: randomId("CUS"),
    name: input.customerName || input.name,
    mobile,
    address: input.customerAddress || input.address || "",
    idProofNo: input.idProofNo || "",
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now
  };
  await adapterSave("customers", record);
  return record;
}

export async function updateCustomer(customerId, patch) {
  const current = await adapterGet("customers", customerId);
  if (!current) throw new Error("Customer not found.");
  const updated = {
    ...current,
    ...patch,
    mobile: normalizeMobile(patch.mobile ?? current.mobile),
    updatedAt: isoNow()
  };
  await adapterSave("customers", updated);
  await logAudit("customer_edit", "Customer", customerId, "Customer updated", `${updated.name || current.name} profile updated.`);
  return updated;
}

export async function softDeleteCustomer(customerId, reason = "Customer soft deleted") {
  const current = await adapterGet("customers", customerId);
  if (!current) throw new Error("Customer not found.");
  const updated = { ...current, deleted: true, deletedAt: isoNow(), updatedAt: isoNow() };
  await adapterSave("customers", updated);
  await logAudit("customer_delete", "Customer", customerId, reason, `${current.name} was soft deleted.`);
  return updated;
}

export async function updateKnownCategory(metalType, category) {
  const value = String(category || "").trim();
  if (!value) return;
  const settings = await getSettings();
  const key = metalType === "Silver" ? "silverCategories" : "goldCategories";
  const existing = new Set(settings[key] || []);
  existing.add(value);
  await updateSettings({ [key]: Array.from(existing).sort((a, b) => a.localeCompare(b)) });
}

export async function listBillItems(billNo) {
  const items = await adapterList("billItems");
  return items.filter((item) => item.billNo === billNo).sort((a, b) => num(a.lineNo) - num(b.lineNo));
}

export async function listNormalizedBills(options = {}) {
  const [bills, billItems, goldBills, silverBills] = await Promise.all([
    adapterList("bills"),
    adapterList("billItems"),
    adapterList("goldBills"),
    adapterList("silverBills")
  ]);
  const newBills = bills.map((bill) => normalizeBillRecord(bill, billItems.filter((item) => item.billNo === bill.billNo)));
  const oldBills = [...goldBills, ...silverBills].map((bill) => normalizeBillRecord(bill));
  const allBills = [...newBills, ...oldBills];
  return options.includeCancelled ? allBills : allBills.filter((bill) => bill.status !== "Cancelled");
}

export async function listBills(metalType) {
  if (metalType === "Combined") return adapterList("bills");
  return adapterList(metalType === "Silver" ? "silverBills" : "goldBills");
}

export async function getBill(metalType, billNo) {
  if (metalType === "Combined") {
    const bill = await adapterGet("bills", billNo);
    if (!bill) return null;
    return normalizeBillRecord(bill, await listBillItems(billNo));
  }
  return adapterGet(metalType === "Silver" ? "silverBills" : "goldBills", billNo);
}

export function createBill(metalType, bill) {
  return adapterCreate(metalType === "Silver" ? "silverBills" : "goldBills", bill);
}

export function saveBill(metalType, bill) {
  return adapterSave(metalType === "Silver" ? "silverBills" : "goldBills", bill);
}

export async function hasSufficientStock(metalType, purity, category, weightGm) {
  const lots = await adapterList("stockLots");
  const total = lots
    .filter((lot) => lot.status !== "Deleted")
    .filter((lot) => lot.metalType === metalType && lot.category === category)
    .filter((lot) => metalType === "Silver" || String(lot.purity) === String(purity))
    .reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
  return roundWeight(total) >= roundWeight(weightGm);
}

export async function assertSufficientStockForItems(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const key = `${item.metalType}|${item.purity}|${item.category}`;
    const normalizedKey = item.metalType === "Silver" ? `${item.metalType}|silver|${item.category}` : key;
    grouped.set(normalizedKey, {
      metalType: item.metalType,
      purity: item.purity,
      category: item.category,
      weightGm: roundWeight((grouped.get(normalizedKey)?.weightGm || 0) + num(item.weightGm))
    });
  });
  for (const item of grouped.values()) {
    if (!(await hasSufficientStock(item.metalType, item.purity, item.category, item.weightGm))) {
      throw new Error(`Insufficient ${item.metalType} stock for ${item.category} ${item.purity}.`);
    }
  }
}

export async function deductStockForSale({ metalType, purity, category, weightGm, refId, dateISO, lineId = "" }) {
  const lots = (await adapterList("stockLots"))
    .filter((lot) => lot.status !== "Deleted")
    .filter((lot) => lot.metalType === metalType && lot.category === category)
    .filter((lot) => metalType === "Silver" || String(lot.purity) === String(purity))
    .filter((lot) => num(lot.availableWeightGm) > 0)
    .sort((a, b) => String(a.purchaseDateISO).localeCompare(String(b.purchaseDateISO)));
  let remaining = roundWeight(weightGm);
  const totalAvailable = lots.reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
  if (roundWeight(totalAvailable) < remaining) {
    throw new Error(`Insufficient ${metalType} stock for ${category} ${purity}. Available: ${roundWeight(totalAvailable)} gm.`);
  }
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(num(lot.availableWeightGm), remaining);
    const nextWeight = roundWeight(num(lot.availableWeightGm) - take);
    await adapterSave("stockLots", {
      ...lot,
      availableWeightGm: nextWeight,
      availableNetWeightGm: nextWeight,
      status: nextWeight <= 0 ? "Sold Out" : "Available",
      updatedAt: isoNow()
    });
    await adapterCreate("stockMovements", {
      movementId: randomId("MOV"),
      dateISO,
      refType: "SALE",
      type: "sale",
      refId,
      lineId,
      stockId: lot.stockId,
      metalType,
      purity,
      category,
      deltaWeightGm: -roundWeight(take),
      deltaGross: -roundWeight(take),
      deltaNet: -roundWeight(take),
      reason: `Sold against ${refId}`
    });
    remaining = roundWeight(remaining - take);
  }
}

export async function deductStockForBillItems(billNo, dateISO, items) {
  for (const item of items) {
    await deductStockForSale({
      metalType: item.metalType,
      purity: item.purity,
      category: item.category,
      weightGm: item.weightGm,
      refId: billNo,
      dateISO,
      lineId: item.lineId
    });
  }
}

export async function restoreStockForSale(refId, reason = "Bill cancelled") {
  const movements = (await adapterList("stockMovements")).filter((movement) => movement.refId === refId && movement.refType === "SALE" && num(movement.deltaWeightGm) < 0);
  for (const movement of movements) {
    const lot = await adapterGet("stockLots", movement.stockId);
    if (!lot) continue;
    const restoredWeight = Math.abs(num(movement.deltaWeightGm));
    await adapterSave("stockLots", {
      ...lot,
      availableWeightGm: roundWeight(num(lot.availableWeightGm) + restoredWeight),
      availableNetWeightGm: roundWeight(num(lot.availableNetWeightGm, lot.availableWeightGm) + restoredWeight),
      status: "Available",
      updatedAt: isoNow()
    });
    await adapterCreate("stockMovements", {
      movementId: randomId("MOV"),
      dateISO: todayInputValue(),
      refType: "CANCEL",
      refId,
      lineId: movement.lineId || "",
      stockId: lot.stockId,
      metalType: movement.metalType,
      purity: movement.purity,
      category: movement.category,
      deltaWeightGm: roundWeight(restoredWeight),
      deltaGross: roundWeight(restoredWeight),
      deltaNet: roundWeight(restoredWeight),
      reason
    });
  }
}

export async function adjustStock(stockId, deltaWeightGm, reason) {
  const lot = await adapterGet("stockLots", stockId);
  if (!lot) throw new Error("Stock lot not found.");
  const nextWeight = roundWeight(num(lot.availableWeightGm) + num(deltaWeightGm));
  if (nextWeight < 0) throw new Error("Adjustment cannot make available weight negative.");
  await adapterSave("stockLots", {
    ...lot,
    availableWeightGm: nextWeight,
    availableNetWeightGm: nextWeight,
    status: nextWeight <= 0 ? "Sold Out" : "Available",
    updatedAt: isoNow()
  });
  await adapterCreate("stockMovements", {
    movementId: randomId("MOV"),
    dateISO: todayInputValue(),
    refType: "ADJUSTMENT",
    refId: stockId,
    stockId,
    metalType: lot.metalType,
    purity: lot.purity,
    category: lot.category,
    deltaWeightGm: roundWeight(deltaWeightGm),
    reason
  });
}

export async function saveCombinedBill({ bill, items, exchangeRecord, editingBill = null, auditReason = "Saved bill" }) {
  let oldItems = [];
  if (editingBill) {
    oldItems = await listBillItems(editingBill.billNo);
    await restoreStockForSale(editingBill.billNo, `Edit revision: ${auditReason}`);
  }
  try {
    await assertSufficientStockForItems(items);
  } catch (error) {
    if (editingBill && oldItems.length) {
      await deductStockForBillItems(editingBill.billNo, editingBill.dateISO, oldItems);
    }
    throw error;
  }
  if (editingBill) {
    for (const item of oldItems) await adapterDelete("billItems", item.lineId);
  }
  await adapterSave("bills", bill);
  for (const item of items) await adapterSave("billItems", item);
  for (const item of items) await updateKnownCategory(item.metalType, item.category);
  await deductStockForBillItems(bill.billNo, bill.dateISO, items);
  await upsertCustomer(bill);
  if (exchangeRecord) await adapterSave("exchangeEntries", exchangeRecord);
  await createOrUpdateCreditFromBill(bill, "bills");
  await logAudit(editingBill ? "BILL_EDIT" : "BILL_CREATE", "bills", bill.billNo, auditReason, `Combined bill ${bill.billNo} for ${bill.customerName}`);
  return normalizeBillRecord(bill, items);
}

export async function cancelCombinedBill(billNo, reason) {
  const bill = await adapterGet("bills", billNo);
  if (!bill) throw new Error("Bill not found.");
  await restoreStockForSale(billNo, `Bill cancelled: ${reason}`);
  const updated = {
    ...bill,
    status: "Cancelled",
    cancelReason: reason,
    cancelledAt: isoNow(),
    updatedAt: isoNow()
  };
  await adapterSave("bills", updated);
  await createOrUpdateCreditFromBill(updated, "bills");
  await logAudit("BILL_CANCEL", "bills", billNo, reason, `Cancelled combined bill ${billNo}.`);
  return normalizeBillRecord(updated, await listBillItems(billNo));
}

export async function createOrUpdateCreditFromBill(bill, billStore) {
  const existing = (await adapterList("credits")).find((credit) => credit.billNo === bill.billNo);
  if (bill.status === "Cancelled" || num(bill.dueAmount) <= 0) {
    if (existing) {
      await adapterSave("credits", { ...existing, balanceAmount: 0, status: "Closed", updatedAt: isoNow() });
    }
    return null;
  }
  const now = isoNow();
  const record = existing ? {
    ...existing,
    customerName: bill.customerName,
    customerMobile: bill.customerMobile,
    totalAmount: bill.finalTotal,
    paidAmount: bill.paidAmount,
    balanceAmount: bill.dueAmount,
    status: bill.dueAmount > 0 ? "Open" : "Closed",
    updatedAt: now
  } : {
    creditId: randomId("DUE"),
    billNo: bill.billNo,
    billStore,
    customerName: bill.customerName,
    customerMobile: bill.customerMobile,
    totalAmount: bill.finalTotal,
    paidAmount: bill.paidAmount,
    balanceAmount: bill.dueAmount,
    paymentHistory: [],
    status: "Open",
    createdAt: now,
    updatedAt: now
  };
  await adapterSave("credits", record);
  return record;
}

export async function addCreditPayment(creditId, amount, note = "") {
  const credit = await adapterGet("credits", creditId);
  if (!credit) throw new Error("Due record not found.");
  if (num(amount) <= 0) throw new Error("Payment amount must be greater than zero.");
  const payment = {
    paymentId: randomId("PAY"),
    amount: roundMoney(amount),
    dateISO: todayInputValue(),
    note,
    createdAt: isoNow()
  };
  const paidAmount = roundMoney(num(credit.paidAmount) + payment.amount);
  const balanceAmount = Math.max(0, roundMoney(num(credit.totalAmount) - paidAmount));
  const updated = {
    ...credit,
    paidAmount,
    balanceAmount,
    paymentHistory: [...(credit.paymentHistory || []), payment],
    status: balanceAmount <= 0 ? "Closed" : "Open",
    updatedAt: isoNow()
  };
  await adapterSave("credits", updated);
  const bill = await adapterGet(credit.billStore, credit.billNo);
  if (bill) {
    await adapterSave(credit.billStore, {
      ...bill,
      paidAmount: Math.min(roundMoney(num(bill.finalTotal)), paidAmount),
      dueAmount: balanceAmount,
      paymentMode: balanceAmount <= 0 && bill.paymentMode === "Credit" ? "Cash" : bill.paymentMode,
      updatedAt: isoNow()
    });
  }
  return updated;
}

export async function addLoanPayment(loanNo, amount, note = "", closeIfPaid = false) {
  const loan = await adapterGet("loans", loanNo);
  if (!loan) throw new Error("Loan not found.");
  if (loan.status === "Void") throw new Error("Voided loans cannot accept payments.");
  if (num(amount) <= 0) throw new Error("Payment amount must be greater than zero.");
  const interestAccrued = calculateLoanInterest(loan);
  const totalDue = roundMoney(num(loan.outstandingPrincipal) + interestAccrued);
  const paymentAmount = Math.min(roundMoney(amount), totalDue);
  const remainingAfterInterest = Math.max(0, roundMoney(paymentAmount - interestAccrued));
  const outstandingPrincipal = Math.max(0, roundMoney(num(loan.outstandingPrincipal) - remainingAfterInterest));
  const status = closeIfPaid || outstandingPrincipal <= 0 ? "Closed" : computedLoanStatus(loan);
  const payment = {
    paymentId: randomId("LPAY"),
    dateISO: todayInputValue(),
    amount: paymentAmount,
    interestComponent: Math.min(paymentAmount, interestAccrued),
    principalComponent: remainingAfterInterest,
    note,
    createdAt: isoNow()
  };
  const updated = {
    ...loan,
    payments: [...(loan.payments || []), payment],
    outstandingPrincipal,
    interestAccrued: status === "Closed" ? 0 : calculateLoanInterest({ ...loan, outstandingPrincipal }),
    status,
    closureDateISO: status === "Closed" ? todayInputValue() : loan.closureDateISO || "",
    updatedAt: isoNow()
  };
  await adapterSave("loans", updated);
  return updated;
}

export async function exportAllStores() {
  const entries = await Promise.all(STORE_NAMES.map(async (store) => [store, await adapterList(store)]));
  return Object.fromEntries(entries);
}

export async function replaceStores(data) {
  for (const storeName of STORE_NAMES.filter((name) => name !== "backupMeta")) {
    await adapterClear(storeName);
    for (const record of Array.isArray(data[storeName]) ? data[storeName] : []) {
      await adapterSave(storeName, record);
    }
  }
}

export async function resetAllData() {
  for (const storeName of STORE_NAMES) await adapterClear(storeName);
  await getSettings();
  await logAudit("RESET", "Database", "jewellery_portal", "App reset", "All records were reset.");
}

export async function migrateLoanInterestV2() {
  const loans = await adapterList("loans");
  for (const loan of loans.filter((entry) => !["Closed", "Void"].includes(entry.status))) {
    await adapterSave("loans", {
      ...loan,
      dailyRatePercent: loan.dailyRatePercent ?? loan.loanDefaultDailyRate ?? 0.07,
      monthlyRatePercent: loan.monthlyRatePercent ?? loan.loanDefaultMonthlyRate ?? 2,
      interestAccrued: calculateLoanInterest(loan),
      updatedAt: isoNow()
    });
  }
}

export async function summarizeData() {
  const [bills, stockLots, loans, credits, settings] = await Promise.all([
    listNormalizedBills(),
    adapterList("stockLots"),
    adapterList("loans"),
    adapterList("credits"),
    getSettings()
  ]);
  const today = todayInputValue();
  const todayBills = bills.filter((bill) => bill.dateISO === today);
  const activeLoans = loans.map((loan) => ({ ...loan, status: computedLoanStatus(loan) })).filter((loan) => loan.status !== "Closed" && loan.status !== "Void");
  const overdueLoans = activeLoans.filter((loan) => loan.status === "Overdue");
  const openCredits = credits.filter((credit) => credit.status !== "Closed");
  return {
    todaySales: todayBills.reduce((sum, bill) => sum + num(bill.finalTotal), 0),
    todayGoldGm: todayBills.reduce((sum, bill) => sum + num(bill.goldWeightGm), 0),
    todaySilverGm: todayBills.reduce((sum, bill) => sum + num(bill.silverWeightGm), 0),
    activeLoansCount: activeLoans.length,
    overdueLoansCount: overdueLoans.length,
    pendingLoanAmount: activeLoans.reduce((sum, loan) => sum + num(loan.outstandingPrincipal), 0),
    totalDueAmount: openCredits.reduce((sum, credit) => sum + num(credit.balanceAmount), 0),
    totalGoldStockGm: stockLots.filter((lot) => lot.metalType === "Gold" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0),
    totalSilverStockGm: stockLots.filter((lot) => lot.metalType === "Silver" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0),
    lastBackupAt: settings.lastBackupAt || "",
    backendMode: useApi ? "API" : "IndexedDB"
  };
}
