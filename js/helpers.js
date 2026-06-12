export const APP_VERSION = "1.2.0";

export const GOLD_PURITY_OPTIONS = [
  { label: "14K (58.3%)", value: 58.3 },
  { label: "18K (75.0%)", value: 75 },
  { label: "20K (83.3%)", value: 83.3 },
  { label: "22K (91.6%)", value: 91.6 },
  { label: "24K (99.9%)", value: 99.9 },
  { label: "916 Hallmark", value: 91.6 },
  { label: "750 Hallmark", value: 75 }
];

export const CDN_URLS = {
  jsPDF: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js",
  chartJs: "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
  jsZip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
};

export const STORE_NAMES = [
  "shopSettings",
  "bills",
  "billItems",
  "goldBills",
  "silverBills",
  "stockLots",
  "stockMovements",
  "customers",
  "loans",
  "exchangeEntries",
  "credits",
  "rates",
  "backupMeta",
  "auditLog"
];

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 3
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function isoNow() {
  return new Date().toISOString();
}

export function todayInputValue(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function toDate(dateLike) {
  if (!dateLike) return null;
  if (dateLike instanceof Date) return dateLike;
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    return new Date(`${dateLike}T00:00:00`);
  }
  const date = new Date(dateLike);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(dateLike) {
  const date = toDate(dateLike);
  return date ? dateFormatter.format(date) : "-";
}

export function formatDateTime(dateLike) {
  const date = toDate(dateLike);
  return date ? dateTimeFormatter.format(date) : "-";
}

export function formatINR(value) {
  return inrFormatter.format(roundMoney(value));
}

export function formatGm(value) {
  return `${numberFormatter.format(roundWeight(value))} gm`;
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function roundWeight(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
}

export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeMobile(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidMobile(value) {
  return /^\d{10}$/.test(normalizeMobile(value));
}

export function assertValidMobile(value, label = "Customer mobile") {
  if (!isValidMobile(value)) {
    throw new Error(`${label} must be exactly 10 digits.`);
  }
}

export function requireText(value, label) {
  if (!String(value ?? "").trim()) {
    throw new Error(`${label} is required.`);
  }
}

export function requirePositive(value, label) {
  if (num(value) <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

export function requireNonNegative(value, label) {
  if (num(value) < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
}

export function deriveFinancialYear(dateLike = new Date()) {
  const date = toDate(dateLike) || new Date();
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

export function numberWithFy(prefix, fy, sequence) {
  return `${prefix}-${fy}-${String(sequence).padStart(4, "0")}`;
}

export function getSequenceFromId(id) {
  const match = String(id || "").match(/-(\d{4,})$/);
  return match ? Number(match[1]) : 0;
}

export function goldPurityOptionsHtml(selected) {
  const numericSelected = num(selected, NaN);
  const options = GOLD_PURITY_OPTIONS.map((option) => {
    const isSelected = Number.isFinite(numericSelected) && Math.abs(numericSelected - option.value) < 0.001;
    return `<option value="${option.value}" ${isSelected ? "selected" : ""}>${escapeHtml(option.label)}</option>`;
  });
  const customSelected = selected && !GOLD_PURITY_OPTIONS.some((option) => Math.abs(num(selected) - option.value) < 0.001);
  options.push(`<option value="custom" ${customSelected ? "selected" : ""}>Custom...</option>`);
  return options.join("");
}

export function parseGoldPurity(selectValue, customValue = "") {
  if (selectValue === "custom") return num(customValue);
  return num(selectValue);
}

export function displayPurity(value, metalType = "Gold") {
  if (metalType === "Silver" || value === null || value === undefined || value === "") return "-";
  const numeric = num(value, NaN);
  if (!Number.isFinite(numeric)) return String(value);
  const preset = GOLD_PURITY_OPTIONS.find((option) => Math.abs(option.value - numeric) < 0.001);
  return preset ? preset.label : `${numeric}%`;
}

export function getBillStore(metalType) {
  return String(metalType).toLowerCase() === "silver" ? "silverBills" : "goldBills";
}

export function getBillPrefix(settings, metalType) {
  if (String(metalType).toLowerCase() === "silver") return settings?.silverInvoicePrefix || "S";
  return settings?.goldInvoicePrefix || "G";
}

export function randomId(prefix = "ID") {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

export function saleFilename(bill) {
  const short = bill.billType === "Combined" || bill.items?.length > 1 ? "B" : bill.metalType === "Silver" ? "S" : "G";
  return `BILL-${short}-${bill.billNo.replace(/^.+?-/, "")}-${bill.dateISO || todayInputValue()}.pdf`;
}

export function loanFilename(loan) {
  return `LOAN-${loan.loanNo.replace(/^L-/, "")}-${loan.startDateISO || todayInputValue()}.pdf`;
}

export function backupZipFilename(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `backup-${yyyy}-${mm}-${dd}_${hh}${mi}${ss}_IST.zip`;
}

export function calculateExchange(entry = {}) {
  const grossValue = roundMoney(num(entry.oldWeightGm) * num(entry.ratePerGm));
  const netExchangeValue = Math.max(0, roundMoney(grossValue - num(entry.deductionAmt)));
  return { grossValue, netExchangeValue };
}

export function calculateSaleTotals(input = {}) {
  const metalValue = roundMoney(num(input.weightGm) * num(input.ratePerGm));
  const charges = roundMoney(num(input.makingCharge) + num(input.wastageCharge));
  const discount = num(input.discountAmt);
  const exchangeValue = num(input.exchangeValue);
  const taxable = Math.max(0, roundMoney(metalValue + charges - discount - exchangeValue));
  const gstAmt = roundMoney((taxable * num(input.gstPct)) / 100);
  const finalTotal = roundMoney(taxable + gstAmt);
  const paidAmount = Math.min(roundMoney(num(input.paidAmount)), finalTotal);
  const dueAmount = Math.max(0, roundMoney(finalTotal - paidAmount));
  return {
    metalValue,
    subtotal: taxable,
    gstAmt,
    finalTotal,
    paidAmount,
    dueAmount
  };
}

export function calculateBillLine(input = {}) {
  const metalValue = roundMoney(num(input.weightGm) * num(input.ratePerGm));
  const makingChargePct = num(input.makingChargePct ?? input.makingChargePercent);
  const makingChargeRs = Math.max(0, Math.floor(num(input.makingChargeRs)));
  const makingCharge = roundMoney((metalValue * makingChargePct) / 100 + makingChargeRs);
  const wastageCharge = roundMoney(num(input.wastageCharge));
  const discountAmt = roundMoney(num(input.discountAmt ?? input.discount));
  const taxable = Math.max(0, roundMoney(metalValue + makingCharge + wastageCharge - discountAmt));
  const gstPct = num(input.gstPct);
  const gstAmt = roundMoney((taxable * gstPct) / 100);
  const lineTotal = roundMoney(taxable + gstAmt);
  return {
    metalValue,
    makingChargePct,
    makingChargePercent: makingChargePct,
    makingChargeRs,
    makingCharge,
    wastageCharge,
    discountAmt,
    taxable,
    gstPct,
    gstAmt,
    lineTotal
  };
}

export function calculateCombinedBillTotals(items = [], input = {}) {
  const lines = items.map((item) => ({ ...item, ...calculateBillLine(item) }));
  const metalValue = roundMoney(lines.reduce((sum, item) => sum + num(item.metalValue), 0));
  const makingCharge = roundMoney(lines.reduce((sum, item) => sum + num(item.makingCharge), 0));
  const wastageCharge = roundMoney(lines.reduce((sum, item) => sum + num(item.wastageCharge), 0));
  const discountAmt = roundMoney(lines.reduce((sum, item) => sum + num(item.discountAmt), 0));
  const gstAmt = roundMoney(lines.reduce((sum, item) => sum + num(item.gstAmt), 0));
  const subtotalBeforeExchange = roundMoney(lines.reduce((sum, item) => sum + num(item.taxable), 0));
  const exchangeValue = roundMoney(num(input.exchangeValue));
  const subtotal = Math.max(0, roundMoney(subtotalBeforeExchange - exchangeValue));
  const finalTotal = Math.max(0, roundMoney(subtotal + gstAmt));
  const paidAmount = Math.min(roundMoney(num(input.paidAmount)), finalTotal);
  const dueAmount = Math.max(0, roundMoney(finalTotal - paidAmount));
  return {
    lines,
    metalValue,
    makingCharge,
    wastageCharge,
    discountAmt,
    subtotalBeforeExchange,
    exchangeValue,
    subtotal,
    gstAmt,
    finalTotal,
    paidAmount,
    dueAmount
  };
}

export function normalizeBillRecord(bill, items = null) {
  if (!bill) return null;
  const isCombined = bill.billType === "Combined" || bill.items || items;
  const billItems = items || bill.items || [{
    lineId: `${bill.billNo}-1`,
    billNo: bill.billNo,
    metalType: bill.metalType,
    itemName: bill.itemName,
    category: bill.category,
    purity: bill.purity,
    weightGm: num(bill.weightGm),
    ratePerGm: num(bill.ratePerGm),
    makingChargePct: bill.makingChargePct ?? 0,
    makingChargePercent: bill.makingChargePct ?? 0,
    makingChargeRs: bill.makingChargeRs ?? 0,
    makingCharge: num(bill.makingCharge),
    wastageCharge: num(bill.wastageCharge),
    discountAmt: num(bill.discountAmt),
    gstPct: num(bill.gstPct),
    metalValue: roundMoney(num(bill.weightGm) * num(bill.ratePerGm)),
    gstAmt: num(bill.gstAmt),
    lineTotal: num(bill.finalTotal)
  }];
  const goldWeightGm = billItems.filter((item) => item.metalType === "Gold").reduce((sum, item) => sum + num(item.weightGm), 0);
  const silverWeightGm = billItems.filter((item) => item.metalType === "Silver").reduce((sum, item) => sum + num(item.weightGm), 0);
  return {
    ...bill,
    billType: isCombined ? "Combined" : bill.metalType,
    metalType: isCombined ? "Mixed" : bill.metalType,
    items: billItems,
    itemName: bill.itemName || billItems.map((item) => item.itemName).filter(Boolean).join(", "),
    category: bill.category || billItems.map((item) => item.category).filter(Boolean).join(", "),
    weightGm: bill.weightGm ?? roundWeight(goldWeightGm + silverWeightGm),
    goldWeightGm: roundWeight(goldWeightGm),
    silverWeightGm: roundWeight(silverWeightGm)
  };
}

export function monthsBetween(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return 0;
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

export function getLoanInterestDetails(loan, asOfDate = todayInputValue(), viewMode = "stored") {
  if (!loan) {
    return { interest: 0, methodLabel: "Simple Interest (loan under 1 year)", days: 0, months: 0 };
  }
  const principal = Math.max(0, num(loan.outstandingPrincipal, loan.loanAmount));
  const start = toDate(loan.startDateISO);
  const asOf = toDate(asOfDate) || new Date();
  if (!start || principal <= 0 || asOf <= start) {
    return { interest: 0, methodLabel: "Simple Interest (loan under 1 year)", days: 0, months: 0 };
  }
  const days = Math.max(0, Math.ceil((asOf - start) / 86400000));
  const months = monthsBetween(start, asOf);
  const dailyRatePercent = num(loan.dailyRatePercent ?? loan.loanDefaultDailyRate ?? loan.interestRatePct, 0.07);
  const monthlyRatePercent = num(loan.monthlyRatePercent ?? loan.loanDefaultMonthlyRate, 2);
  if (viewMode === "daily") {
    const interest = roundMoney((principal * dailyRatePercent * days) / 100);
    return { interest, methodLabel: "Daily view", days, months, dailyRatePercent, monthlyRatePercent };
  }
  if (viewMode === "monthly") {
    const interest = roundMoney(principal * Math.pow(1 + monthlyRatePercent / 100, months) - principal);
    return { interest, methodLabel: `Monthly compound view, N = ${months} months`, days, months, dailyRatePercent, monthlyRatePercent };
  }
  if (days <= 365) {
    const interest = roundMoney((principal * dailyRatePercent * days) / 100);
    return {
      interest,
      methodLabel: "Simple Interest (loan under 1 year)",
      days,
      months,
      dailyRatePercent,
      monthlyRatePercent
    };
  }
  const interest = roundMoney(principal * Math.pow(1 + monthlyRatePercent / 100, months) - principal);
  return {
    interest,
    methodLabel: `Compound Interest - monthly compounding, N = ${months} months`,
    note: "Interest method changed to compound (monthly) as loan has exceeded 1 year.",
    days,
    months,
    dailyRatePercent,
    monthlyRatePercent
  };
}

export function calculateLoanInterest(loan, asOfDate = todayInputValue()) {
  return getLoanInterestDetails(loan, asOfDate).interest;
}

export function computedLoanStatus(loan, date = todayInputValue()) {
  if (!loan) return "Active";
  if (loan.status === "Closed" || loan.closureDateISO) return "Closed";
  if (loan.status === "Void") return "Void";
  if (loan.dueDateISO && toDate(loan.dueDateISO) < toDate(date)) return "Overdue";
  return "Active";
}

export function collectForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === "string" ? value.trim() : value;
  });
  return data;
}

export function setFormValues(form, values = {}) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
    }
  });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function showToast(message, type = "info") {
  const host = $("#toast-container");
  if (!host) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

export function renderBadge(value) {
  const text = escapeHtml(value || "-");
  const normalized = String(value || "").toLowerCase();
  let kind = "";
  if (["active", "paid", "closed", "available", "ok", "persisted"].includes(normalized)) kind = "ok";
  if (["overdue", "partial", "low", "draft"].includes(normalized)) kind = "warn";
  if (["cancelled", "void", "unpaid", "not persisted"].includes(normalized)) kind = "danger";
  if (["credit"].includes(normalized)) kind = "info";
  return `<span class="badge ${kind}">${text}</span>`;
}

export function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function renderTable(columns, rows, emptyMessage = "No records found.") {
  if (!rows.length) return emptyState(emptyMessage);
  const head = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("");
  const body = rows.map((row) => {
    const cells = columns.map((col) => `<td>${col.render ? col.render(row) : escapeHtml(row[col.key])}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function monthKey(dateLike) {
  const date = toDate(dateLike);
  if (!date) return "Unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function yearKey(dateLike) {
  const date = toDate(dateLike);
  return date ? String(date.getFullYear()) : "Unknown";
}

export function groupSum(rows, keyFn, valueFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    map.set(key, roundMoney((map.get(key) || 0) + num(valueFn(row))));
  });
  return Array.from(map, ([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
}

export function waitForGlobal(name, timeoutMs = 7000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (window[name]) {
        resolve(window[name]);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`${name} did not load. Check network once, then reload for offline use.`));
        return;
      }
      setTimeout(check, 80);
    }
    check();
  });
}

export function openDialog(options) {
  const root = $("#modal-root");
  if (!root) return Promise.reject(new Error("Dialog root is missing."));
  const {
    title,
    message = "",
    fields = [],
    confirmText = "Confirm",
    cancelText = "Cancel",
    danger = false
  } = options;

  return new Promise((resolve) => {
    const idPrefix = randomId("dialog");
    const fieldHtml = fields.map((field, index) => {
      const id = `${idPrefix}-${index}`;
      const required = field.required ? "required" : "";
      const value = escapeHtml(field.value ?? "");
      if (field.type === "textarea") {
        return `<label class="field"><span>${escapeHtml(field.label)}</span><textarea id="${id}" name="${escapeHtml(field.name)}" ${required}>${value}</textarea></label>`;
      }
      return `<label class="field"><span>${escapeHtml(field.label)}</span><input id="${id}" type="${escapeHtml(field.type || "text")}" name="${escapeHtml(field.name)}" value="${value}" ${required}></label>`;
    }).join("");

    root.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <form class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="${idPrefix}-title">
          <h2 id="${idPrefix}-title">${escapeHtml(title)}</h2>
          ${message ? `<p>${escapeHtml(message)}</p>` : ""}
          <div class="page-grid">${fieldHtml}</div>
          <div class="modal-actions">
            <button type="button" class="button-ghost" data-cancel>${escapeHtml(cancelText)}</button>
            <button type="submit" class="${danger ? "button-danger" : "button"}">${escapeHtml(confirmText)}</button>
          </div>
        </form>
      </div>
    `;
    const form = $("form", root);
    const firstInput = $("input, textarea", form);
    firstInput?.focus();

    function close(value) {
      root.innerHTML = "";
      resolve(value);
    }

    $("[data-cancel]", form).addEventListener("click", () => close(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = collectForm(form);
      close(result);
    });
    root.addEventListener("click", function onRootClick(event) {
      if (event.target.classList.contains("modal-backdrop")) {
        root.removeEventListener("click", onRootClick);
        close(null);
      }
    });
  });
}

export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsText(file);
  });
}

export async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function printCurrentPage() {
  window.print();
}

export function withinDateRange(rowDate, from, to) {
  if (!rowDate) return false;
  if (from && rowDate < from) return false;
  if (to && rowDate > to) return false;
  return true;
}

export function textMatches(row, query, fields) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => String(row[field] || "").toLowerCase().includes(q));
}

export function sortDescByDate(rows, field = "createdAt") {
  return [...rows].sort((a, b) => String(b[field] || "").localeCompare(String(a[field] || "")));
}
