import {
  APP_VERSION,
  STORE_NAMES,
  calculateLoanInterest,
  computedLoanStatus,
  deriveFinancialYear,
  getSequenceFromId,
  isoNow,
  normalizeMobile,
  num,
  numberWithFy,
  randomId,
  roundMoney,
  roundWeight,
  todayInputValue
} from "./helpers.js";

export const DB_NAME = "jewellery_portal";
export const DB_VERSION = 2;

const STORE_DEFS = {
  shopSettings: {
    keyPath: "id",
    indexes: []
  },
  bills: {
    keyPath: "billNo",
    indexes: [
      ["dateISO", "dateISO"],
      ["customerMobile", "customerMobile"],
      ["customerName", "customerName"],
      ["status", "status"],
      ["billType", "billType"]
    ]
  },
  billItems: {
    keyPath: "lineId",
    indexes: [
      ["billNo", "billNo"],
      ["metalType", "metalType"],
      ["purity", "purity"],
      ["category", "category"]
    ]
  },
  goldBills: {
    keyPath: "billNo",
    indexes: [
      ["dateISO", "dateISO"],
      ["customerMobile", "customerMobile"],
      ["customerName", "customerName"],
      ["status", "status"]
    ]
  },
  silverBills: {
    keyPath: "billNo",
    indexes: [
      ["dateISO", "dateISO"],
      ["customerMobile", "customerMobile"],
      ["customerName", "customerName"],
      ["status", "status"]
    ]
  },
  stockLots: {
    keyPath: "stockId",
    indexes: [
      ["metalType", "metalType"],
      ["purity", "purity"],
      ["category", "category"],
      ["availableWeightGm", "availableWeightGm"],
      ["purchaseDateISO", "purchaseDateISO"],
      ["supplierName", "supplierName"]
    ]
  },
  stockMovements: {
    keyPath: "movementId",
    indexes: [
      ["dateISO", "dateISO"],
      ["refType", "refType"],
      ["refId", "refId"],
      ["metalType", "metalType"]
    ]
  },
  customers: {
    keyPath: "customerId",
    indexes: [
      ["mobile", "mobile", { unique: true }],
      ["name", "name"]
    ]
  },
  loans: {
    keyPath: "loanNo",
    indexes: [
      ["customerMobile", "customerMobile"],
      ["customerName", "customerName"],
      ["status", "status"],
      ["startDateISO", "startDateISO"],
      ["dueDateISO", "dueDateISO"]
    ]
  },
  exchangeEntries: {
    keyPath: "exchangeId",
    indexes: [
      ["billNo", "billNo"],
      ["customerMobile", "customerMobile"],
      ["dateISO", "dateISO"]
    ]
  },
  credits: {
    keyPath: "creditId",
    indexes: [
      ["billNo", "billNo", { unique: true }],
      ["customerMobile", "customerMobile"],
      ["status", "status"],
      ["createdAt", "createdAt"]
    ]
  },
  rates: {
    keyPath: "rateDate",
    indexes: []
  },
  backupMeta: {
    keyPath: "backupId",
    indexes: [["createdAt", "createdAt"]]
  },
  auditLog: {
    keyPath: "eventId",
    indexes: [
      ["ts", "ts"],
      ["entityType", "entityType"],
      ["entityId", "entityId"],
      ["actionType", "actionType"]
    ]
  }
};

let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [storeName, def] of Object.entries(STORE_DEFS)) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: def.keyPath });
          def.indexes.forEach(([indexName, keyPath, options]) => {
            store.createIndex(indexName, keyPath, options || {});
          });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database upgrade is blocked by another open tab."));
  });
  return dbPromise;
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Database transaction aborted."));
  });
}

export async function withTransaction(storeNames, mode, callback) {
  const db = await openDB();
  const tx = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
  const result = await callback(stores, tx);
  await txDone(tx);
  return result;
}

export async function getAll(storeName) {
  const db = await openDB();
  return req(db.transaction(storeName).objectStore(storeName).getAll());
}

export async function getByKey(storeName, key) {
  const db = await openDB();
  return req(db.transaction(storeName).objectStore(storeName).get(key));
}

export async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  return req(db.transaction(storeName).objectStore(storeName).index(indexName).get(value));
}

export async function getAllByIndex(storeName, indexName, value) {
  const db = await openDB();
  return req(db.transaction(storeName).objectStore(storeName).index(indexName).getAll(value));
}

export async function addRecord(storeName, record) {
  return withTransaction([storeName], "readwrite", async (stores) => req(stores[storeName].add(record)));
}

export async function putRecord(storeName, record) {
  return withTransaction([storeName], "readwrite", async (stores) => req(stores[storeName].put(record)));
}

export async function deleteRecord(storeName, key) {
  return withTransaction([storeName], "readwrite", async (stores) => req(stores[storeName].delete(key)));
}

export async function clearStore(storeName) {
  return withTransaction([storeName], "readwrite", async (stores) => req(stores[storeName].clear()));
}

export async function countRecords(storeName) {
  const db = await openDB();
  return req(db.transaction(storeName).objectStore(storeName).count());
}

export async function getSettings() {
  const existing = await getByKey("shopSettings", "main");
  if (existing) return existing;
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
    defaultGstPct: 3,
    financialYear: deriveFinancialYear(),
    lastBackupAt: "",
    productionOrigin: location.origin,
    printFooterText: "Thank you for your business.",
    createdAt: now,
    updatedAt: now
  };
  await putRecord("shopSettings", defaults);
  return defaults;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, id: "main", updatedAt: isoNow() };
  await putRecord("shopSettings", next);
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
  await addRecord("auditLog", record);
  return record;
}

export async function nextId(storeName, prefix, dateISO = todayInputValue()) {
  const fy = deriveFinancialYear(dateISO);
  const records = await getAll(storeName);
  let max = 0;
  const start = `${prefix}-${fy}-`;
  records.forEach((record) => {
    const key = record[STORE_DEFS[storeName].keyPath];
    if (String(key).startsWith(start)) {
      max = Math.max(max, getSequenceFromId(key));
    }
  });
  return numberWithFy(prefix, fy, max + 1);
}

export async function upsertCustomer(input) {
  const mobile = normalizeMobile(input.customerMobile || input.mobile);
  const now = isoNow();
  const existing = await getByIndex("customers", "mobile", mobile);
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
  await putRecord("customers", record);
  return record;
}

export async function getLatestRate() {
  const rates = await getAll("rates");
  return rates.sort((a, b) => String(b.rateDate).localeCompare(String(a.rateDate)))[0] || null;
}

export async function hasSufficientStock(metalType, purity, category, weightGm) {
  const lots = await getAll("stockLots");
  const total = lots
    .filter((lot) => lot.status !== "Deleted")
    .filter((lot) => lot.metalType === metalType && lot.purity === purity && lot.category === category)
    .reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
  return roundWeight(total) >= roundWeight(weightGm);
}

export async function deductStockForSale({ metalType, purity, category, weightGm, refId, dateISO }) {
  return withTransaction(["stockLots", "stockMovements"], "readwrite", async (stores) => {
    const lots = await req(stores.stockLots.getAll());
    const matching = lots
      .filter((lot) => lot.status !== "Deleted")
      .filter((lot) => lot.metalType === metalType && lot.purity === purity && lot.category === category)
      .filter((lot) => num(lot.availableWeightGm) > 0)
      .sort((a, b) => String(a.purchaseDateISO).localeCompare(String(b.purchaseDateISO)));

    let remaining = roundWeight(weightGm);
    const totalAvailable = matching.reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
    if (roundWeight(totalAvailable) < remaining) {
      throw new Error(`Insufficient ${metalType} stock for ${category} ${purity}. Available: ${roundWeight(totalAvailable)} gm.`);
    }

    for (const lot of matching) {
      if (remaining <= 0) break;
      const take = Math.min(num(lot.availableWeightGm), remaining);
      const updated = {
        ...lot,
        availableWeightGm: roundWeight(num(lot.availableWeightGm) - take),
        status: roundWeight(num(lot.availableWeightGm) - take) <= 0 ? "Sold Out" : "Available",
        updatedAt: isoNow()
      };
      await req(stores.stockLots.put(updated));
      await req(stores.stockMovements.add({
        movementId: randomId("MOV"),
        dateISO,
        refType: "SALE",
        refId,
        stockId: lot.stockId,
        metalType,
        purity,
        category,
        deltaWeightGm: -roundWeight(take),
        reason: `Sold against ${refId}`
      }));
      remaining = roundWeight(remaining - take);
    }
  });
}

export async function restoreStockForSale(refId, reason = "Bill cancelled") {
  return withTransaction(["stockLots", "stockMovements"], "readwrite", async (stores) => {
    const movements = await req(stores.stockMovements.index("refId").getAll(refId));
    const saleMovements = movements.filter((movement) => movement.refType === "SALE" && num(movement.deltaWeightGm) < 0);
    for (const movement of saleMovements) {
      const lot = await req(stores.stockLots.get(movement.stockId));
      if (!lot) continue;
      const restoredWeight = Math.abs(num(movement.deltaWeightGm));
      const updated = {
        ...lot,
        availableWeightGm: roundWeight(num(lot.availableWeightGm) + restoredWeight),
        status: "Available",
        updatedAt: isoNow()
      };
      await req(stores.stockLots.put(updated));
      await req(stores.stockMovements.add({
        movementId: randomId("MOV"),
        dateISO: todayInputValue(),
        refType: "CANCEL",
        refId,
        stockId: lot.stockId,
        metalType: movement.metalType,
        purity: movement.purity,
        category: movement.category,
        deltaWeightGm: roundWeight(restoredWeight),
        reason
      }));
    }
  });
}

export async function adjustStock(stockId, deltaWeightGm, reason) {
  const lot = await getByKey("stockLots", stockId);
  if (!lot) throw new Error("Stock lot not found.");
  const nextWeight = roundWeight(num(lot.availableWeightGm) + num(deltaWeightGm));
  if (nextWeight < 0) throw new Error("Adjustment cannot make available weight negative.");
  const now = isoNow();
  await withTransaction(["stockLots", "stockMovements"], "readwrite", async (stores) => {
    await req(stores.stockLots.put({
      ...lot,
      availableWeightGm: nextWeight,
      status: nextWeight <= 0 ? "Sold Out" : "Available",
      updatedAt: now
    }));
    await req(stores.stockMovements.add({
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
    }));
  });
}

export async function createOrUpdateCreditFromBill(bill, billStore) {
  const existing = await getByIndex("credits", "billNo", bill.billNo);
  if (bill.status === "Cancelled" || num(bill.dueAmount) <= 0) {
    if (existing) {
      await putRecord("credits", {
        ...existing,
        balanceAmount: 0,
        status: "Closed",
        updatedAt: isoNow()
      });
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
  await putRecord("credits", record);
  return record;
}

export async function addCreditPayment(creditId, amount, note = "") {
  const credit = await getByKey("credits", creditId);
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
  await putRecord("credits", updated);

  const bill = await getByKey(credit.billStore, credit.billNo);
  if (bill) {
    await putRecord(credit.billStore, {
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
  const loan = await getByKey("loans", loanNo);
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
  await putRecord("loans", updated);
  return updated;
}

export async function exportAllStores() {
  const entries = await Promise.all(STORE_NAMES.map(async (store) => [store, await getAll(store)]));
  return Object.fromEntries(entries);
}

export async function replaceStores(data) {
  const storesToReplace = STORE_NAMES.filter((name) => name !== "backupMeta");
  await withTransaction(storesToReplace, "readwrite", async (stores) => {
    for (const storeName of storesToReplace) {
      await req(stores[storeName].clear());
      const records = Array.isArray(data[storeName]) ? data[storeName] : [];
      for (const record of records) {
        await req(stores[storeName].put(record));
      }
    }
  });
}

export async function resetAllData() {
  await withTransaction(STORE_NAMES, "readwrite", async (stores) => {
    for (const name of STORE_NAMES) {
      await req(stores[name].clear());
    }
  });
  await getSettings();
  await logAudit("RESET", "Database", "jewellery_portal", "App reset", "All browser-local records were reset.");
}

export async function summarizeData() {
  const [
    goldBills,
    silverBills,
    stockLots,
    loans,
    credits,
    settings
  ] = await Promise.all([
    getAll("goldBills"),
    getAll("silverBills"),
    getAll("stockLots"),
    getAll("loans"),
    getAll("credits"),
    getSettings()
  ]);

  const today = todayInputValue();
  const activeBills = [...goldBills, ...silverBills].filter((bill) => bill.status !== "Cancelled");
  const todayBills = activeBills.filter((bill) => bill.dateISO === today);
  const activeLoans = loans.map((loan) => ({ ...loan, status: computedLoanStatus(loan) })).filter((loan) => loan.status !== "Closed" && loan.status !== "Void");
  const overdueLoans = activeLoans.filter((loan) => loan.status === "Overdue");
  const openCredits = credits.filter((credit) => credit.status !== "Closed");

  return {
    todaySales: todayBills.reduce((sum, bill) => sum + num(bill.finalTotal), 0),
    todayGoldGm: todayBills.filter((bill) => bill.metalType === "Gold").reduce((sum, bill) => sum + num(bill.weightGm), 0),
    todaySilverGm: todayBills.filter((bill) => bill.metalType === "Silver").reduce((sum, bill) => sum + num(bill.weightGm), 0),
    activeLoansCount: activeLoans.length,
    overdueLoansCount: overdueLoans.length,
    pendingLoanAmount: activeLoans.reduce((sum, loan) => sum + num(loan.outstandingPrincipal), 0),
    totalDueAmount: openCredits.reduce((sum, credit) => sum + num(credit.balanceAmount), 0),
    totalGoldStockGm: stockLots.filter((lot) => lot.metalType === "Gold" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0),
    totalSilverStockGm: stockLots.filter((lot) => lot.metalType === "Silver" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0),
    lastBackupAt: settings.lastBackupAt || ""
  };
}
