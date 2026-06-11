import {
  $,
  $$,
  calculateCombinedBillTotals,
  calculateExchange,
  collectForm,
  deriveFinancialYear,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  isValidMobile,
  normalizeMobile,
  num,
  randomId,
  renderBadge,
  renderTable,
  requireNonNegative,
  requirePositive,
  requireText,
  showToast,
  sortDescByDate,
  textMatches,
  todayInputValue,
  withinDateRange
} from "../helpers.js";
import {
  cancelCombinedBill,
  getLatestRate,
  getSettings,
  listBillItems,
  getByKey,
  getAll,
  nextId,
  saveCombinedBill
} from "../data-service.js";
import { downloadBillPdf, printBillPdf } from "../pdf.js";
import { ensureOwnerPassword } from "../security.js";

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit"];
const GOLD_PURITIES = ["24K", "22K", "18K", "14K"];
const SILVER_PURITIES = ["999", "925", "90%"];

let state = {
  settings: null,
  latestRate: null,
  bills: [],
  activeBill: null,
  editingBill: null
};

export async function render(container) {
  state.settings = await getSettings();
  state.latestRate = await getLatestRate();
  state.bills = await getAll("bills");
  const billNo = await nextId("bills", state.settings.combinedInvoicePrefix || "B", todayInputValue());
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Combined Billing</h2>
            <p>Create one bill with gold and silver items, shared customer details, exchange, dues, and PDF.</p>
          </div>
          <button class="button-secondary" type="button" data-add-line>Add Item</button>
        </div>
        <form id="combined-form" class="page-grid" autocomplete="off">
          <div class="form-grid">
            <label class="field"><span>Bill no</span><input class="readonly-input" name="billNo" value="${escapeHtml(billNo)}" readonly></label>
            <label class="field"><span>Date</span><input name="dateISO" type="date" value="${todayInputValue()}" required></label>
            <label class="field"><span>Financial year</span><input class="readonly-input" name="fy" value="${deriveFinancialYear()}" readonly></label>
            <label class="field"><span>Payment mode</span><select name="paymentMode">${PAYMENT_MODES.map((mode) => `<option>${mode}</option>`).join("")}</select></label>
            <label class="field"><span>Customer name</span><input name="customerName" required></label>
            <label class="field"><span>Customer mobile</span><input name="customerMobile" inputmode="numeric" maxlength="10" required></label>
            <label class="field"><span>Paid amount</span><input name="paidAmount" type="number" min="0" step="0.01" value="0"></label>
            <label class="field full"><span>Customer address</span><textarea name="customerAddress"></textarea></label>
          </div>
          <div class="table-wrap">
            <table class="line-items-table">
              <thead>
                <tr>
                  <th>Metal</th><th>Item</th><th>Category</th><th>Purity</th><th>Weight gm</th><th>Rate/gm</th><th>Making %</th><th>Wastage</th><th>Discount</th><th>GST %</th><th>Line total</th><th></th>
                </tr>
              </thead>
              <tbody id="items-body"></tbody>
            </table>
          </div>
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
          <div class="totals-panel">
            <div><span>Metal value</span><strong data-total="metalValue">${formatINR(0)}</strong></div>
            <div><span>Making + wastage</span><strong data-total="charges">${formatINR(0)}</strong></div>
            <div><span>Discount</span><strong data-total="discountAmt">${formatINR(0)}</strong></div>
            <div><span>Exchange value</span><strong data-total="exchangeValue">${formatINR(0)}</strong></div>
            <div><span>GST</span><strong data-total="gstAmt">${formatINR(0)}</strong></div>
            <div><span>Final total</span><strong data-total="finalTotal">${formatINR(0)}</strong></div>
            <div><span>Due amount</span><strong data-total="dueAmount">${formatINR(0)}</strong></div>
          </div>
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
            <h2>Combined Bill History</h2>
            <p>Gold-only, silver-only, and mixed bills created from this screen.</p>
          </div>
        </div>
        <form id="combined-search" class="form-grid">
          <label class="field"><span>Search</span><input name="query" placeholder="Bill no, customer, mobile, item"></label>
          <label class="field"><span>From date</span><input name="from" type="date"></label>
          <label class="field"><span>To date</span><input name="to" type="date"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="combined-history"></div>
      </section>
    </div>
  `;
  wire(container);
  addItemRow(container, { metalType: "Gold", purity: "22K", gstPct: state.settings.defaultGstPct ?? 3 });
  renderHistory(container);
}

function rateFor(metalType, purity) {
  const rate = state.latestRate;
  if (!rate) return "";
  if (metalType === "Silver") return rate.silver999 || "";
  if (purity === "24K") return rate.gold24k || rate.gold22k || "";
  if (purity === "18K") return rate.gold18k || "";
  return rate.gold22k || "";
}

function purityOptions(metalType, selected) {
  return (metalType === "Silver" ? SILVER_PURITIES : GOLD_PURITIES)
    .map((purity) => `<option value="${purity}" ${purity === selected ? "selected" : ""}>${purity}</option>`)
    .join("");
}

function addItemRow(container, item = {}) {
  const body = $("#items-body", container);
  const index = body.children.length + 1;
  const metalType = item.metalType || "Gold";
  const purity = item.purity || (metalType === "Gold" ? "22K" : "999");
  const rate = item.ratePerGm ?? rateFor(metalType, purity);
  const line = document.createElement("tr");
  line.innerHTML = `
    <td><select data-field="metalType"><option ${metalType === "Gold" ? "selected" : ""}>Gold</option><option ${metalType === "Silver" ? "selected" : ""}>Silver</option></select></td>
    <td><input data-field="itemName" value="${escapeHtml(item.itemName || "")}" required></td>
    <td><input data-field="category" value="${escapeHtml(item.category || "")}" required></td>
    <td><select data-field="purity">${purityOptions(metalType, purity)}</select></td>
    <td><input data-field="weightGm" type="number" min="0.001" step="0.001" value="${escapeHtml(item.weightGm || "")}" required></td>
    <td><input data-field="ratePerGm" type="number" min="0.01" step="0.01" value="${escapeHtml(rate)}" required></td>
    <td><input data-field="makingChargePct" type="number" min="0" step="0.01" value="${escapeHtml(item.makingChargePct ?? 0)}"></td>
    <td><input data-field="wastageCharge" type="number" min="0" step="0.01" value="${escapeHtml(item.wastageCharge ?? 0)}"></td>
    <td><input data-field="discountAmt" type="number" min="0" step="0.01" value="${escapeHtml(item.discountAmt ?? 0)}"></td>
    <td><input data-field="gstPct" type="number" min="0" step="0.01" value="${escapeHtml(item.gstPct ?? state.settings.defaultGstPct ?? 3)}"></td>
    <td><strong data-line-total>${formatINR(item.lineTotal || 0)}</strong></td>
    <td><button class="mini-button" type="button" data-remove-line>Remove</button></td>
  `;
  line.dataset.lineNo = item.lineNo || index;
  body.append(line);
  recalculate(container);
}

function wire(container) {
  const form = $("#combined-form", container);
  $("[data-add-line]", container).addEventListener("click", () => addItemRow(container));
  form.addEventListener("input", (event) => {
    if (event.target.name === "customerMobile") event.target.value = normalizeMobile(event.target.value).slice(0, 10);
    recalculate(container);
  });
  form.addEventListener("change", (event) => {
    const row = event.target.closest("tr");
    if (event.target.dataset.field === "metalType" && row) {
      const metalType = event.target.value;
      const purityField = row.querySelector('[data-field="purity"]');
      const purity = metalType === "Gold" ? "22K" : "999";
      purityField.innerHTML = purityOptions(metalType, purity);
      row.querySelector('[data-field="ratePerGm"]').value = rateFor(metalType, purity);
    }
    if (event.target.dataset.field === "purity" && row) {
      row.querySelector('[data-field="ratePerGm"]').value = rateFor(row.querySelector('[data-field="metalType"]').value, event.target.value);
    }
    if (event.target.name === "dateISO") form.elements.fy.value = deriveFinancialYear(event.target.value);
    recalculate(container);
  });
  form.addEventListener("click", (event) => {
    if (event.target.matches("[data-remove-line]")) {
      event.target.closest("tr").remove();
      if (!$("#items-body", container).children.length) addItemRow(container);
      recalculate(container);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveBill(container);
  });
  $("[data-print]", container).addEventListener("click", async () => {
    if (!state.activeBill) return showToast("Save or open a bill first.", "error");
    await printBillPdf(state.activeBill, state.settings);
  });
  $("[data-download]", container).addEventListener("click", async () => {
    if (!state.activeBill) return showToast("Save or open a bill first.", "error");
    await downloadBillPdf(state.activeBill, state.settings);
  });
  $("[data-clear]", container).addEventListener("click", () => render(container));
  $("#combined-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    renderHistory(container);
  });
}

function collectItems(container, billNo) {
  return $$("#items-body tr", container).map((row, index) => {
    const item = { lineNo: index + 1, billNo, lineId: row.dataset.lineId || `${billNo}-${index + 1}` };
    $$("[data-field]", row).forEach((field) => {
      item[field.dataset.field] = field.value.trim();
    });
    const totals = calculateCombinedBillTotals([item]).lines[0];
    return { ...item, ...totals, weightGm: num(item.weightGm), ratePerGm: num(item.ratePerGm) };
  });
}

function validateBill(data, items) {
  requireText(data.customerName, "Customer name");
  if (!isValidMobile(data.customerMobile)) throw new Error("Customer mobile must be exactly 10 digits.");
  if (!items.length) throw new Error("Add at least one bill item.");
  requireNonNegative(data.paidAmount, "Paid amount");
  items.forEach((item, index) => {
    const label = `Line ${index + 1}`;
    requireText(item.itemName, `${label} item name`);
    requireText(item.category, `${label} category`);
    requireText(item.purity, `${label} purity`);
    requirePositive(item.weightGm, `${label} weight`);
    requirePositive(item.ratePerGm, `${label} rate`);
    requireNonNegative(item.makingChargePct, `${label} making charge percentage`);
    requireNonNegative(item.wastageCharge, `${label} wastage`);
    requireNonNegative(item.discountAmt, `${label} discount`);
    requireNonNegative(item.gstPct, `${label} GST percentage`);
  });
  if (num(data.oldWeightGm) > 0) {
    requireText(data.oldMetalType, "Old metal type");
    requireText(data.oldItemName, "Old item name");
    requireText(data.oldPurity, "Old purity");
    requirePositive(data.exchangeRatePerGm, "Exchange rate per gm");
  }
}

function recalculate(container) {
  const form = $("#combined-form", container);
  if (!form) return;
  const data = collectForm(form);
  const exchange = calculateExchange({ oldWeightGm: data.oldWeightGm, ratePerGm: data.exchangeRatePerGm, deductionAmt: data.deductionAmt });
  form.elements.grossValue.value = exchange.grossValue;
  form.elements.netExchangeValue.value = exchange.netExchangeValue;
  const items = collectItems(container, data.billNo || "DRAFT");
  const totals = calculateCombinedBillTotals(items, { paidAmount: data.paymentMode === "Credit" ? 0 : data.paidAmount, exchangeValue: exchange.netExchangeValue });
  totals.lines.forEach((line, index) => {
    const row = $("#items-body", container).children[index];
    if (row) row.querySelector("[data-line-total]").textContent = formatINR(line.lineTotal);
  });
  const charges = totals.makingCharge + totals.wastageCharge;
  const values = { ...totals, charges };
  Object.entries(values).forEach(([key, value]) => {
    const target = form.querySelector(`[data-total="${key}"]`);
    if (target) target.textContent = formatINR(value);
  });
}

function buildExchange(data, billNo) {
  const values = calculateExchange({ oldWeightGm: data.oldWeightGm, ratePerGm: data.exchangeRatePerGm, deductionAmt: data.deductionAmt });
  if (values.netExchangeValue <= 0) return null;
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
    grossValue: values.grossValue,
    deductionAmt: num(data.deductionAmt),
    netExchangeValue: values.netExchangeValue,
    dateISO: data.dateISO,
    createdAt: state.editingBill?.createdAt || new Date().toISOString()
  };
}

async function saveBill(container) {
  const form = $("#combined-form", container);
  const data = collectForm(form);
  data.customerMobile = normalizeMobile(data.customerMobile);
  const billNo = data.billNo;
  const rawItems = collectItems(container, billNo);
  try {
    validateBill(data, rawItems);
    let approval = null;
    if (state.editingBill) {
      approval = await ensureOwnerPassword("Edit combined bill", {
        message: "Editing revises stock movements for all bill items.",
        confirmText: "Save edit",
        danger: true
      });
      if (!approval) return;
    }
    const exchangeRecord = buildExchange(data, billNo);
    const totals = calculateCombinedBillTotals(rawItems, {
      paidAmount: data.paymentMode === "Credit" ? 0 : data.paidAmount,
      exchangeValue: exchangeRecord?.netExchangeValue || 0
    });
    const items = totals.lines.map((item, index) => ({
      ...item,
      lineNo: index + 1,
      billNo,
      lineId: rawItems[index].lineId || `${billNo}-${index + 1}`,
      createdAt: state.editingBill?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    const bill = {
      billNo,
      dateISO: data.dateISO,
      fy: deriveFinancialYear(data.dateISO),
      billType: "Combined",
      customerName: data.customerName,
      customerMobile: data.customerMobile,
      customerAddress: data.customerAddress || "",
      itemName: items.map((item) => item.itemName).join(", "),
      category: items.map((item) => item.category).join(", "),
      metalType: items.some((item) => item.metalType === "Gold") && items.some((item) => item.metalType === "Silver") ? "Mixed" : items[0].metalType,
      metalValue: totals.metalValue,
      makingCharge: totals.makingCharge,
      wastageCharge: totals.wastageCharge,
      discountAmt: totals.discountAmt,
      gstAmt: totals.gstAmt,
      subtotal: totals.subtotal,
      finalTotal: totals.finalTotal,
      paymentMode: data.paymentMode,
      paidAmount: data.paymentMode === "Credit" ? 0 : totals.paidAmount,
      dueAmount: data.paymentMode === "Credit" ? totals.finalTotal : totals.dueAmount,
      exchangeId: exchangeRecord?.exchangeId || "",
      exchangeValue: exchangeRecord?.netExchangeValue || 0,
      status: "Active",
      cancelReason: "",
      cancelledAt: "",
      revisionHistory: state.editingBill ? [...(state.editingBill.revisionHistory || []), { ts: new Date().toISOString(), reason: approval.reason, before: state.editingBill }] : [],
      createdAt: state.editingBill?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.activeBill = await saveCombinedBill({
      bill,
      items,
      exchangeRecord,
      editingBill: state.editingBill,
      auditReason: approval?.reason || "Saved combined bill"
    });
    state.editingBill = null;
    state.bills = await getAll("bills");
    showToast("Combined bill saved.", "success");
    renderHistory(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function filteredBills(container) {
  const filters = collectForm($("#combined-search", container));
  return sortDescByDate(state.bills, "dateISO")
    .filter((bill) => textMatches(bill, filters.query, ["billNo", "customerName", "customerMobile", "itemName"]))
    .filter((bill) => withinDateRange(bill.dateISO, filters.from, filters.to));
}

function renderHistory(container) {
  const host = $("#combined-history", container);
  host.innerHTML = renderTable([
    { label: "Bill", render: (row) => `<strong>${escapeHtml(row.billNo)}</strong><br><span class="muted">${formatDate(row.dateISO)}</span>` },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Items", render: (row) => escapeHtml(row.itemName || "Multiple items") },
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
        </div>`
    }
  ], filteredBills(container), "No combined bills found.");
  $$("[data-open]", host).forEach((button) => button.addEventListener("click", () => openBill(container, button.dataset.open, false)));
  $$("[data-edit]", host).forEach((button) => button.addEventListener("click", () => openBill(container, button.dataset.edit, true)));
  $$("[data-pdf]", host).forEach((button) => button.addEventListener("click", async () => downloadBillPdf(await loadBill(button.dataset.pdf), state.settings)));
  $$("[data-print-row]", host).forEach((button) => button.addEventListener("click", async () => printBillPdf(await loadBill(button.dataset.printRow), state.settings)));
  $$("[data-cancel]", host).forEach((button) => button.addEventListener("click", async () => {
    try {
      const approval = await ensureOwnerPassword("Cancel combined bill", {
        message: "Cancellation restores stock for every bill item and closes related dues.",
        confirmText: "Cancel bill",
        danger: true
      });
      if (!approval) return;
      state.activeBill = await cancelCombinedBill(button.dataset.cancel, approval.reason);
      state.bills = await getAll("bills");
      showToast("Bill cancelled and stock restored.", "success");
      renderHistory(container);
    } catch (error) {
      showToast(error.message, "error");
    }
  }));
}

async function loadBill(billNo) {
  const bill = await getByKey("bills", billNo);
  const items = await listBillItems(billNo);
  const exchanges = await getAll("exchangeEntries");
  const exchange = exchanges.find((entry) => entry.billNo === billNo) || null;
  return { ...bill, items, exchange };
}

async function openBill(container, billNo, edit) {
  const bill = await loadBill(billNo);
  state.activeBill = bill;
  state.editingBill = edit ? bill : null;
  const form = $("#combined-form", container);
  ["billNo", "dateISO", "fy", "paymentMode", "customerName", "customerMobile", "paidAmount", "customerAddress"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = bill[key] || "";
  });
  if (bill.exchange) {
    form.elements.oldMetalType.value = bill.exchange.oldMetalType || "";
    form.elements.oldItemName.value = bill.exchange.oldItemName || "";
    form.elements.oldWeightGm.value = bill.exchange.oldWeightGm || 0;
    form.elements.oldPurity.value = bill.exchange.oldPurity || "";
    form.elements.exchangeRatePerGm.value = bill.exchange.ratePerGm || 0;
    form.elements.deductionAmt.value = bill.exchange.deductionAmt || 0;
  }
  $("#items-body", container).innerHTML = "";
  bill.items.forEach((item) => addItemRow(container, item));
  recalculate(container);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}
