import {
  $,
  $$,
  calculateExchange,
  calculateSaleTotals,
  collectForm,
  deriveFinancialYear,
  emptyState,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatGm,
  formatINR,
  getBillPrefix,
  getBillStore,
  isValidMobile,
  normalizeMobile,
  num,
  printCurrentPage,
  renderBadge,
  renderTable,
  requireNonNegative,
  requirePositive,
  requireText,
  roundMoney,
  showToast,
  sortDescByDate,
  textMatches,
  todayInputValue,
  withinDateRange
} from "../helpers.js";
import {
  addRecord,
  createOrUpdateCreditFromBill,
  deductStockForSale,
  getAll,
  getByKey,
  getLatestRate,
  getSettings,
  hasSufficientStock,
  logAudit,
  nextId,
  putRecord,
  restoreStockForSale,
  upsertCustomer
} from "../data-service.js";
import { downloadBillPdf, printBillPdf } from "../pdf.js";
import { ensureOwnerPassword } from "../security.js";

const GOLD_PURITIES = ["24K", "22K", "18K", "14K"];
const SILVER_PURITIES = ["999", "925", "90%"];
const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit"];

let state = {
  metalType: "Gold",
  settings: null,
  latestRate: null,
  activeBill: null,
  editingBill: null,
  bills: []
};

export async function render(container) {
  return renderSalesScreen(container, "Gold");
}

export async function renderSalesScreen(container, metalType) {
  state = {
    metalType,
    settings: await getSettings(),
    latestRate: await getLatestRate(),
    activeBill: null,
    editingBill: null,
    bills: await getAll(getBillStore(metalType))
  };
  const prefix = getBillPrefix(state.settings, metalType);
  const billNo = await nextId(getBillStore(metalType), prefix, todayInputValue());
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>${metalType} Sales Billing</h2>
            <p>Create bills, deduct stock, record exchange, and manage due amount.</p>
          </div>
          <button class="button-secondary" type="button" data-use-rate>Use latest saved rate</button>
        </div>
        ${state.latestRate ? "" : `<div class="notice warning"><strong>No reference rate saved</strong><span>Add manual rates from the Rates screen. You can still type the sale rate.</span></div>`}
        <form id="sale-form" class="page-grid" autocomplete="off">
          ${renderSaleFormFields(metalType, billNo)}
          <div class="form-actions">
            <button class="button" type="submit">Save Bill</button>
            <button class="button-secondary" type="button" data-print>Print</button>
            <button class="button-secondary" type="button" data-download>Download PDF</button>
            <button class="button-ghost" type="button" data-clear>Clear</button>
          </div>
        </form>
      </section>
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>${metalType} Bill History</h2>
            <p>Cancelled bills remain visible but do not count in reports.</p>
          </div>
        </div>
        <form id="sale-search" class="form-grid" autocomplete="off">
          <label class="field"><span>Search</span><input name="query" placeholder="Bill no, customer, mobile, item"></label>
          <label class="field"><span>From date</span><input name="from" type="date"></label>
          <label class="field"><span>To date</span><input name="to" type="date"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="sale-history"></div>
      </section>
    </div>
  `;

  wireSalesForm(container);
  renderHistory(container);
}

function renderSaleFormFields(metalType, billNo) {
  const purityOptions = (metalType === "Gold" ? GOLD_PURITIES : SILVER_PURITIES)
    .map((purity) => `<option value="${purity}">${purity}</option>`)
    .join("");
  const paymentOptions = PAYMENT_MODES.map((mode) => `<option value="${mode}">${mode}</option>`).join("");
  const defaultPurity = metalType === "Gold" ? "22K" : "999";
  const rate = getRateForPurity(metalType, defaultPurity);
  return `
    <div class="form-grid">
      <label class="field"><span>Bill no</span><input class="readonly-input" name="billNo" value="${escapeHtml(billNo)}" readonly></label>
      <label class="field"><span>Date</span><input name="dateISO" type="date" value="${todayInputValue()}" required></label>
      <label class="field"><span>Financial year</span><input class="readonly-input" name="fy" value="${deriveFinancialYear()}" readonly></label>
      <label class="field"><span>Payment mode</span><select name="paymentMode">${paymentOptions}</select></label>
      <label class="field"><span>Customer name</span><input name="customerName" required></label>
      <label class="field"><span>Customer mobile</span><input name="customerMobile" inputmode="numeric" maxlength="10" required></label>
      <label class="field full"><span>Customer address</span><textarea name="customerAddress"></textarea></label>
      <label class="field"><span>Item name</span><input name="itemName" required placeholder="Ring, chain, anklet"></label>
      <label class="field"><span>Category</span><input name="category" required placeholder="Ring, Chain, Coin"></label>
      <label class="field"><span>Purity</span><select name="purity">${purityOptions}</select></label>
      <label class="field"><span>Weight gm</span><input name="weightGm" type="number" min="0.001" step="0.001" required></label>
      <label class="field"><span>Rate per gm</span><input name="ratePerGm" type="number" min="0.01" step="0.01" value="${rate}" required></label>
      <label class="field"><span>Making charge</span><input name="makingCharge" type="number" min="0" step="0.01" value="0"></label>
      <label class="field"><span>Wastage charge</span><input name="wastageCharge" type="number" min="0" step="0.01" value="0"></label>
      <label class="field"><span>Discount</span><input name="discountAmt" type="number" min="0" step="0.01" value="0"></label>
      <label class="field"><span>GST %</span><input name="gstPct" type="number" min="0" step="0.01" value="${escapeHtml(state.settings.defaultGstPct ?? 3)}"></label>
      <label class="field"><span>Paid amount</span><input name="paidAmount" type="number" min="0" step="0.01" value="0"></label>
      <label class="field full"><span>Notes</span><textarea name="notes"></textarea></label>
      <details class="exchange-box">
        <summary>Old Jewellery Exchange</summary>
        <div class="details-body form-grid">
          <label class="field"><span>Old metal type</span><select name="oldMetalType"><option value="">None</option><option>Gold</option><option>Silver</option></select></label>
          <label class="field"><span>Old item name</span><input name="oldItemName"></label>
          <label class="field"><span>Old weight gm</span><input name="oldWeightGm" type="number" min="0" step="0.001" value="0"></label>
          <label class="field"><span>Old purity</span><input name="oldPurity"></label>
          <label class="field"><span>Exchange rate per gm</span><input name="exchangeRatePerGm" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Gross value</span><input class="readonly-input" name="grossValue" readonly value="0"></label>
          <label class="field"><span>Deduction</span><input name="deductionAmt" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Net exchange value</span><input class="readonly-input" name="netExchangeValue" readonly value="0"></label>
        </div>
      </details>
      <div class="totals-panel field full" aria-live="polite">
        <div><span>Metal value</span><strong data-total="metalValue">${formatINR(0)}</strong></div>
        <div><span>Subtotal after charges, discount, exchange</span><strong data-total="subtotal">${formatINR(0)}</strong></div>
        <div><span>GST amount</span><strong data-total="gstAmt">${formatINR(0)}</strong></div>
        <div><span>Final total</span><strong data-total="finalTotal">${formatINR(0)}</strong></div>
        <div><span>Due amount</span><strong data-total="dueAmount">${formatINR(0)}</strong></div>
      </div>
    </div>
  `;
}

function getRateForPurity(metalType, purity) {
  const rate = state.latestRate;
  if (!rate) return "";
  if (metalType === "Silver") return rate.silver999 || "";
  if (purity === "24K") return rate.gold24k || rate.gold22k || "";
  if (purity === "18K") return rate.gold18k || "";
  return rate.gold22k || "";
}

function wireSalesForm(container) {
  const form = $("#sale-form", container);
  const search = $("#sale-search", container);
  const recalcFields = "input, select";

  form.addEventListener("input", (event) => {
    if (event.target.name === "customerMobile") {
      event.target.value = normalizeMobile(event.target.value).slice(0, 10);
    }
    recalculateTotals(form);
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "purity" && !state.editingBill) {
      const rate = getRateForPurity(state.metalType, event.target.value);
      if (rate) form.elements.ratePerGm.value = rate;
    }
    if (event.target.name === "dateISO") {
      form.elements.fy.value = deriveFinancialYear(event.target.value);
    }
    recalculateTotals(form);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSale(container);
  });

  $("[data-use-rate]", container).addEventListener("click", () => {
    const rate = getRateForPurity(state.metalType, form.elements.purity.value);
    if (!rate) {
      showToast("No matching saved reference rate found.", "error");
      return;
    }
    form.elements.ratePerGm.value = rate;
    recalculateTotals(form);
  });
  $("[data-print]", container).addEventListener("click", async () => {
    if (!state.activeBill) {
      showToast("Save or open a bill first.", "error");
      return;
    }
    await printBillPdf(state.activeBill, state.settings);
  });
  $("[data-download]", container).addEventListener("click", async () => {
    if (!state.activeBill) {
      showToast("Save or open a bill first.", "error");
      return;
    }
    await downloadBillPdf(state.activeBill, state.settings);
  });
  $("[data-clear]", container).addEventListener("click", async () => {
    await resetSaleForm(container);
  });
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    renderHistory(container);
  });
  recalculateTotals(form);
}

function recalculateTotals(form) {
  const data = collectForm(form);
  const exchange = calculateExchange({
    oldWeightGm: data.oldWeightGm,
    ratePerGm: data.exchangeRatePerGm,
    deductionAmt: data.deductionAmt
  });
  form.elements.grossValue.value = exchange.grossValue;
  form.elements.netExchangeValue.value = exchange.netExchangeValue;
  const totals = calculateSaleTotals({
    ...data,
    exchangeValue: exchange.netExchangeValue
  });
  Object.entries(totals).forEach(([key, value]) => {
    const target = form.querySelector(`[data-total="${key}"]`);
    if (target) target.textContent = formatINR(value);
  });
}

function validateSale(data) {
  requireText(data.customerName, "Customer name");
  if (!isValidMobile(data.customerMobile)) throw new Error("Customer mobile must be exactly 10 digits.");
  requireText(data.itemName, "Item name");
  requireText(data.category, "Category");
  requireText(data.purity, "Purity");
  requirePositive(data.weightGm, "Weight");
  requirePositive(data.ratePerGm, "Rate per gm");
  requireNonNegative(data.makingCharge, "Making charge");
  requireNonNegative(data.wastageCharge, "Wastage charge");
  requireNonNegative(data.discountAmt, "Discount");
  requireNonNegative(data.gstPct, "GST percentage");
  requireNonNegative(data.paidAmount, "Paid amount");
  requireNonNegative(data.oldWeightGm, "Old jewellery weight");
  requireNonNegative(data.exchangeRatePerGm, "Exchange rate");
  requireNonNegative(data.deductionAmt, "Exchange deduction");
  if (num(data.oldWeightGm) > 0) {
    requireText(data.oldMetalType, "Old metal type");
    requireText(data.oldItemName, "Old item name");
    requireText(data.oldPurity, "Old purity");
    requirePositive(data.exchangeRatePerGm, "Exchange rate per gm");
  }
}

function buildBillRecord(data, exchangeRecord) {
  const exchangeValue = exchangeRecord?.netExchangeValue || 0;
  const totals = calculateSaleTotals({ ...data, exchangeValue });
  return {
    billNo: data.billNo,
    dateISO: data.dateISO,
    fy: deriveFinancialYear(data.dateISO),
    customerName: data.customerName,
    customerMobile: normalizeMobile(data.customerMobile),
    customerAddress: data.customerAddress || "",
    itemName: data.itemName,
    category: data.category,
    metalType: state.metalType,
    purity: data.purity,
    weightGm: num(data.weightGm),
    ratePerGm: num(data.ratePerGm),
    makingCharge: num(data.makingCharge),
    wastageCharge: num(data.wastageCharge),
    discountAmt: num(data.discountAmt),
    gstPct: num(data.gstPct),
    gstAmt: totals.gstAmt,
    subtotal: totals.subtotal,
    finalTotal: totals.finalTotal,
    paymentMode: data.paymentMode,
    paidAmount: data.paymentMode === "Credit" ? 0 : totals.paidAmount,
    dueAmount: data.paymentMode === "Credit" ? totals.finalTotal : totals.dueAmount,
    exchangeId: exchangeRecord?.exchangeId || "",
    exchangeValue,
    status: "Active",
    cancelReason: "",
    cancelledAt: "",
    notes: data.notes || "",
    revisionHistory: state.editingBill?.revisionHistory || [],
    createdAt: state.editingBill?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function buildExchangeRecord(data, billNo) {
  const exchange = calculateExchange({
    oldWeightGm: data.oldWeightGm,
    ratePerGm: data.exchangeRatePerGm,
    deductionAmt: data.deductionAmt
  });
  if (exchange.netExchangeValue <= 0) return null;
  return {
    exchangeId: state.editingBill?.exchangeId || `EX-${billNo}`,
    billNo,
    customerName: data.customerName,
    customerMobile: normalizeMobile(data.customerMobile),
    oldMetalType: data.oldMetalType,
    oldItemName: data.oldItemName,
    oldWeightGm: num(data.oldWeightGm),
    oldPurity: data.oldPurity,
    ratePerGm: num(data.exchangeRatePerGm),
    grossValue: exchange.grossValue,
    deductionAmt: num(data.deductionAmt),
    netExchangeValue: exchange.netExchangeValue,
    dateISO: data.dateISO,
    createdAt: state.editingBill?.createdAt || new Date().toISOString()
  };
}

async function saveSale(container) {
  const form = $("#sale-form", container);
  const data = collectForm(form);
  data.customerMobile = normalizeMobile(data.customerMobile);
  data.billNo = data.billNo || await nextId(getBillStore(state.metalType), getBillPrefix(state.settings, state.metalType), data.dateISO);
  try {
    validateSale(data);
    const billStore = getBillStore(state.metalType);
    const existing = await getByKey(billStore, data.billNo);
    if (existing && !state.editingBill) throw new Error("Duplicate bill number. Clear the form and try again.");
    if (!(await hasSufficientStock(state.metalType, data.purity, data.category, num(data.weightGm)))) {
      throw new Error(`Insufficient ${state.metalType} stock for ${data.category} ${data.purity}.`);
    }

    let approval = null;
    if (state.editingBill) {
      approval = await ensureOwnerPassword("Edit saved bill", {
        message: "Editing a saved bill will revise stock movement and audit history.",
        confirmText: "Save edit",
        danger: true
      });
      if (!approval) return;
      await restoreStockForSale(state.editingBill.billNo, `Edit revision: ${approval.reason}`);
    }

    const exchangeRecord = buildExchangeRecord(data, data.billNo);
    const bill = buildBillRecord(data, exchangeRecord);
    if (state.editingBill) {
      bill.revisionHistory = [
        ...(state.editingBill.revisionHistory || []),
        { ts: new Date().toISOString(), reason: approval.reason, before: state.editingBill }
      ];
      await putRecord(billStore, bill);
    } else {
      await addRecord(billStore, bill);
    }
    await deductStockForSale({
      metalType: state.metalType,
      purity: bill.purity,
      category: bill.category,
      weightGm: bill.weightGm,
      refId: bill.billNo,
      dateISO: bill.dateISO
    });
    await upsertCustomer(bill);
    if (exchangeRecord) await putRecord("exchangeEntries", exchangeRecord);
    await createOrUpdateCreditFromBill(bill, billStore);
    await logAudit(state.editingBill ? "BILL_EDIT" : "BILL_CREATE", billStore, bill.billNo, approval?.reason || "Saved bill", `${bill.metalType} bill ${bill.billNo} for ${bill.customerName}`);
    state.activeBill = bill;
    state.editingBill = null;
    state.bills = await getAll(billStore);
    showToast(`${state.metalType} bill saved.`, "success");
    await resetSaleForm(container, false);
    state.activeBill = bill;
    renderHistory(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function resetSaleForm(container, clearActive = true) {
  const form = $("#sale-form", container);
  const prefix = getBillPrefix(state.settings, state.metalType);
  const billNo = await nextId(getBillStore(state.metalType), prefix, todayInputValue());
  form.reset();
  form.elements.billNo.value = billNo;
  form.elements.dateISO.value = todayInputValue();
  form.elements.fy.value = deriveFinancialYear();
  form.elements.gstPct.value = state.settings.defaultGstPct ?? 3;
  form.elements.paidAmount.value = 0;
  form.elements.makingCharge.value = 0;
  form.elements.wastageCharge.value = 0;
  form.elements.discountAmt.value = 0;
  form.elements.oldWeightGm.value = 0;
  form.elements.exchangeRatePerGm.value = 0;
  form.elements.deductionAmt.value = 0;
  form.elements.ratePerGm.value = getRateForPurity(state.metalType, form.elements.purity.value) || "";
  if (clearActive) state.activeBill = null;
  state.editingBill = null;
  recalculateTotals(form);
}

function setFormFromBill(container, bill, edit = false) {
  const form = $("#sale-form", container);
  form.elements.billNo.value = bill.billNo;
  form.elements.dateISO.value = bill.dateISO;
  form.elements.fy.value = bill.fy;
  form.elements.paymentMode.value = bill.paymentMode;
  form.elements.customerName.value = bill.customerName;
  form.elements.customerMobile.value = bill.customerMobile;
  form.elements.customerAddress.value = bill.customerAddress || "";
  form.elements.itemName.value = bill.itemName;
  form.elements.category.value = bill.category;
  form.elements.purity.value = bill.purity;
  form.elements.weightGm.value = bill.weightGm;
  form.elements.ratePerGm.value = bill.ratePerGm;
  form.elements.makingCharge.value = bill.makingCharge;
  form.elements.wastageCharge.value = bill.wastageCharge;
  form.elements.discountAmt.value = bill.discountAmt;
  form.elements.gstPct.value = bill.gstPct;
  form.elements.paidAmount.value = bill.paidAmount;
  form.elements.notes.value = bill.notes || "";
  recalculateTotals(form);
  state.activeBill = bill;
  state.editingBill = edit ? bill : null;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function filteredBills(container) {
  const searchForm = $("#sale-search", container);
  const filters = collectForm(searchForm);
  return sortDescByDate(state.bills, "dateISO")
    .filter((bill) => textMatches(bill, filters.query, ["billNo", "customerName", "customerMobile", "itemName"]))
    .filter((bill) => withinDateRange(bill.dateISO, filters.from, filters.to));
}

function renderHistory(container) {
  const host = $("#sale-history", container);
  const rows = filteredBills(container);
  host.innerHTML = renderTable([
    { label: "Bill no", render: (row) => `<strong>${escapeHtml(row.billNo)}</strong><br><span class="muted">${formatDate(row.dateISO)}</span>` },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Item", render: (row) => `${escapeHtml(row.itemName)}<br><span class="muted">${escapeHtml(row.category)} ${escapeHtml(row.purity)}</span>` },
    { label: "Weight", render: (row) => formatGm(row.weightGm) },
    { label: "Total", render: (row) => `${formatINR(row.finalTotal)}<br><span class="muted">Due ${formatINR(row.dueAmount)}</span>` },
    { label: "Status", render: (row) => renderBadge(row.status) },
    {
      label: "Actions",
      render: (row) => `
        <div class="row-actions">
          <button class="mini-button" data-open="${escapeHtml(row.billNo)}" type="button">Open</button>
          <button class="mini-button" data-pdf="${escapeHtml(row.billNo)}" type="button">PDF</button>
          <button class="mini-button" data-print-row="${escapeHtml(row.billNo)}" type="button">Print</button>
          <button class="mini-button" data-edit="${escapeHtml(row.billNo)}" type="button" ${row.status === "Cancelled" ? "disabled" : ""}>Edit</button>
          <button class="mini-button" data-cancel="${escapeHtml(row.billNo)}" type="button" ${row.status === "Cancelled" ? "disabled" : ""}>Cancel</button>
        </div>
      `
    }
  ], rows, `No ${state.metalType.toLowerCase()} bills found.`);

  $$("[data-open]", host).forEach((button) => button.addEventListener("click", () => {
    const bill = state.bills.find((item) => item.billNo === button.dataset.open);
    if (bill) setFormFromBill(container, bill, false);
  }));
  $$("[data-edit]", host).forEach((button) => button.addEventListener("click", () => {
    const bill = state.bills.find((item) => item.billNo === button.dataset.edit);
    if (bill) setFormFromBill(container, bill, true);
  }));
  $$("[data-pdf]", host).forEach((button) => button.addEventListener("click", async () => {
    const bill = state.bills.find((item) => item.billNo === button.dataset.pdf);
    if (bill) await downloadBillPdf(bill, state.settings);
  }));
  $$("[data-print-row]", host).forEach((button) => button.addEventListener("click", async () => {
    const bill = state.bills.find((item) => item.billNo === button.dataset.printRow);
    if (bill) await printBillPdf(bill, state.settings);
  }));
  $$("[data-cancel]", host).forEach((button) => button.addEventListener("click", async () => {
    await cancelBill(container, button.dataset.cancel);
  }));
}

async function cancelBill(container, billNo) {
  const billStore = getBillStore(state.metalType);
  const bill = await getByKey(billStore, billNo);
  if (!bill || bill.status === "Cancelled") return;
  try {
    const approval = await ensureOwnerPassword("Cancel bill", {
      message: "Cancellation restores stock, closes related due record, and keeps the bill visible in history.",
      confirmText: "Cancel bill",
      danger: true
    });
    if (!approval) return;
    await restoreStockForSale(billNo, `Bill cancelled: ${approval.reason}`);
    const updated = {
      ...bill,
      status: "Cancelled",
      cancelReason: approval.reason,
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putRecord(billStore, updated);
    await createOrUpdateCreditFromBill(updated, billStore);
    await logAudit("BILL_CANCEL", billStore, billNo, approval.reason, `Cancelled ${state.metalType} bill ${billNo}.`);
    state.bills = await getAll(billStore);
    state.activeBill = updated;
    showToast("Bill cancelled and stock restored.", "success");
    renderHistory(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}
