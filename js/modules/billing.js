import {
  $,
  $$,
  calculateCombinedBillTotals,
  calculateExchange,
  collectForm,
  deriveFinancialYear,
  displayPurity,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  goldPurityOptionsHtml,
  isValidMobile,
  normalizeMobile,
  num,
  openDialog,
  parseGoldPurity,
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
  getAll,
  getByKey,
  getLatestRate,
  getSettings,
  listBillItems,
  nextId,
  saveCombinedBill,
  saveRate,
  updateKnownCategory
} from "../data-service.js";
import { downloadBillPdf, printBillPdf } from "../pdf.js";
import { ensureOwnerPassword } from "../security.js";

const DRAFT_KEY = "draft_billing";
const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit"];
let draftTimer = null;
let beforeUnloadHandler = null;

let state = {
  settings: null,
  latestRate: null,
  bills: [],
  categories: { Gold: [], Silver: [] },
  view: "landing",
  activeBill: null,
  editingBill: null
};

export async function render(container) {
  state.settings = await getSettings();
  state.latestRate = await getLatestRate();
  state.bills = await getAll("bills");
  state.categories = await loadCategories();
  if (state.view === "form") {
    await renderForm(container);
    return;
  }
  renderLanding(container);
}

async function loadCategories() {
  const [stockLots, billItems] = await Promise.all([getAll("stockLots"), getAll("billItems")]);
  const fromSettings = {
    Gold: state.settings.goldCategories || [],
    Silver: state.settings.silverCategories || []
  };
  const categories = { Gold: new Set(fromSettings.Gold), Silver: new Set(fromSettings.Silver) };
  [...stockLots, ...billItems].forEach((row) => {
    if (row?.metalType && row?.category) categories[row.metalType]?.add(row.category);
  });
  return {
    Gold: Array.from(categories.Gold).sort((a, b) => a.localeCompare(b)),
    Silver: Array.from(categories.Silver).sort((a, b) => a.localeCompare(b))
  };
}

function renderLanding(container) {
  const draft = getDraft();
  const rows = sortDescByDate(state.bills, "dateISO").slice(0, 20);
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Bills</h2>
            <p>Recent saved bills and resumable drafts.</p>
          </div>
          <button class="button" type="button" data-new-bill>+ New Bill</button>
        </div>
        <form id="bill-landing-search" class="form-grid two">
          <label class="field"><span>Search bills</span><input name="query" placeholder="Customer name or bill number"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="bill-landing-table">
          ${renderBillRows(rows, draft)}
        </div>
        <div id="bill-detail"></div>
      </section>
    </div>
  `;
  $("[data-new-bill]", container).addEventListener("click", async () => {
    state.view = "form";
    state.activeBill = null;
    state.editingBill = null;
    await render(container);
  });
  $("#bill-landing-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    const query = collectForm(event.currentTarget).query;
    const filtered = rows.filter((bill) => textMatches(bill, query, ["billNo", "customerName", "customerMobile"]));
    $("#bill-landing-table", container).innerHTML = renderBillRows(filtered, draft);
    wireLandingRows(container);
  });
  wireLandingRows(container);
}

function renderBillRows(rows, draft) {
  const tableRows = [
    ...(draft ? [{ ...draft, billNo: "Draft", dateISO: new Date(draft.savedAt).toISOString().slice(0, 10), customerName: draft.customerName || "-", finalTotal: draft.finalTotal || 0, status: "Draft" }] : []),
    ...rows
  ];
  return renderTable([
    { label: "Date", render: (row) => formatDate(row.dateISO) },
    { label: "Bill No", render: (row) => `<strong>${escapeHtml(row.billNo)}</strong>` },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName || "-")}<br><span class="muted">${escapeHtml(row.customerMobile || "")}</span>` },
    { label: "Total", render: (row) => formatINR(row.finalTotal || 0) },
    { label: "Status", render: (row) => renderBadge(row.status === "Draft" ? "Draft" : row.status || "Saved") },
    {
      label: "Actions",
      render: (row) => row.status === "Draft"
        ? `<button class="mini-button" type="button" data-resume-draft>Resume Draft</button>`
        : `<div class="row-actions"><button class="mini-button" data-view="${escapeHtml(row.billNo)}" type="button">View</button><button class="mini-button" data-edit="${escapeHtml(row.billNo)}" type="button">Edit</button><button class="mini-button" data-pdf="${escapeHtml(row.billNo)}" type="button">PDF</button></div>`
    }
  ], tableRows, "No bills found.");
}

function wireLandingRows(container) {
  $("[data-resume-draft]", container)?.addEventListener("click", async () => {
    state.view = "form";
    await render(container);
  });
  $$("[data-view]", container).forEach((button) => button.addEventListener("click", async () => showBillDetail(container, button.dataset.view)));
  $$("[data-edit]", container).forEach((button) => button.addEventListener("click", async () => {
    const approval = await ensureOwnerPassword("Edit bill", { message: "Owner approval is required to edit a saved bill.", danger: true });
    if (!approval) return;
    state.view = "form";
    state.editingBill = await loadBill(button.dataset.edit);
    await render(container);
  }));
  $$("[data-pdf]", container).forEach((button) => button.addEventListener("click", async () => downloadBillPdf(await loadBill(button.dataset.pdf), state.settings)));
}

async function showBillDetail(container, billNo) {
  const bill = await loadBill(billNo);
  state.activeBill = bill;
  $("#bill-detail", container).innerHTML = `
    <section class="section-band">
      <div class="section-header">
        <div>
          <h3>${escapeHtml(bill.billNo)} - ${escapeHtml(bill.customerName)}</h3>
          <p>${formatDate(bill.dateISO)} | ${renderBadge(bill.status)}</p>
        </div>
        <div class="actions-row">
          <button class="button-secondary" type="button" data-detail-pdf>Download PDF</button>
          <button class="button-ghost" type="button" data-detail-print>Print</button>
        </div>
      </div>
      ${renderTable([
        { label: "#", key: "lineNo" },
        { label: "Item", key: "itemName" },
        { label: "Metal", key: "metalType" },
        { label: "Purity", render: (row) => displayPurity(row.purity, row.metalType) },
        { label: "Weight", render: (row) => formatGm(row.weightGm) },
        { label: "Amount", render: (row) => formatINR(row.lineTotal) }
      ], bill.items || [], "No items found.")}
    </section>
  `;
  $("[data-detail-pdf]", container).addEventListener("click", () => downloadBillPdf(bill, state.settings));
  $("[data-detail-print]", container).addEventListener("click", () => printBillPdf(bill, state.settings));
}

async function renderForm(container) {
  const billNo = state.editingBill?.billNo || await nextId("bills", state.settings.combinedInvoicePrefix || "B", todayInputValue());
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <button class="button-ghost" type="button" data-back-bills>← Back to Bills</button>
            <h2>${state.editingBill ? "Edit Bill" : "New Bill"}</h2>
            <p>Create one bill with gold and silver line items.</p>
          </div>
          <button class="button-secondary" type="button" data-add-line>Add Item</button>
        </div>
        <form id="combined-form" class="page-grid" autocomplete="off">
          ${categoryDatalists()}
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
                  <th>Metal</th><th>Item</th><th>Category</th><th>Purity</th><th>Weight</th><th>Rate/g</th><th>Making %</th><th>Making ₹</th><th>Wastage</th><th>Discount</th><th>GST %</th><th>Total</th><th></th>
                </tr>
              </thead>
              <tbody id="items-body"></tbody>
            </table>
          </div>
          ${exchangePanel()}
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
    </div>
  `;
  wireForm(container);
  if (state.editingBill) {
    fillBill(container, state.editingBill);
  } else if (!restoreDraft(container)) {
    addItemRow(container, { metalType: "Gold", purity: 91.6, gstPct: state.settings.defaultGstPct ?? 3 });
  }
}

function categoryDatalists() {
  return `
    <datalist id="gold-categories">${state.categories.Gold.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}<option value="+ Add new category"></option></datalist>
    <datalist id="silver-categories">${state.categories.Silver.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}<option value="+ Add new category"></option></datalist>
  `;
}

function exchangePanel() {
  return `
    <details class="exchange-box">
      <summary>Old Jewellery Exchange</summary>
      <div class="details-body form-grid">
        <label class="field"><span>Old metal type</span><select name="oldMetalType"><option value="">None</option><option>Gold</option><option>Silver</option></select></label>
        <label class="field"><span>Old item name</span><input name="oldItemName"></label>
        <label class="field"><span>Old weight gm</span><input name="oldWeightGm" type="number" min="0" step="0.001" value="0"></label>
        <label class="field" data-exchange-purity-wrap><span>Old purity/fineness</span><select name="oldPurity">${goldPurityOptionsHtml(91.6)}</select></label>
        <label class="field"><span>Exchange rate per gm</span><input name="exchangeRatePerGm" type="number" min="0" step="0.01" value="0"></label>
        <label class="field"><span>Gross value</span><input class="readonly-input" name="grossValue" readonly value="0"></label>
        <label class="field"><span>Deduction</span><input name="deductionAmt" type="number" min="0" step="0.01" value="0"></label>
        <label class="field"><span>Net exchange value</span><input class="readonly-input" name="netExchangeValue" readonly value="0"></label>
      </div>
    </details>
  `;
}

function rateFor(metalType) {
  const rate = state.latestRate;
  if (!rate) return "";
  return metalType === "Silver" ? rate.silver999 || "" : rate.gold22k || rate.gold24k || "";
}

function addItemRow(container, item = {}) {
  const body = $("#items-body", container);
  const index = body.children.length + 1;
  const metalType = item.metalType || "Gold";
  const purity = item.purity ?? 91.6;
  const line = document.createElement("tr");
  line.innerHTML = `
    <td><select data-field="metalType"><option ${metalType === "Gold" ? "selected" : ""}>Gold</option><option ${metalType === "Silver" ? "selected" : ""}>Silver</option></select></td>
    <td><input data-field="itemName" value="${escapeHtml(item.itemName || "")}" required></td>
    <td><input data-field="category" list="${metalType === "Silver" ? "silver-categories" : "gold-categories"}" value="${escapeHtml(item.category || "")}" required></td>
    <td data-purity-cell>${purityFieldHtml(metalType, purity)}</td>
    <td><input data-field="weightGm" type="number" min="0.001" step="0.001" value="${escapeHtml(item.weightGm || "")}" required></td>
    <td><div class="actions-row"><input data-field="ratePerGm" type="number" min="0.01" step="0.01" value="${escapeHtml(item.ratePerGm ?? rateFor(metalType))}" required><button class="mini-button" type="button" data-update-rate title="Update rate">↗</button></div></td>
    <td><input data-field="makingChargePct" type="number" min="0" step="0.01" value="${escapeHtml(item.makingChargePct ?? item.makingChargePercent ?? 0)}" aria-label="Making Charge %"></td>
    <td><input data-field="makingChargeRs" type="number" min="0" step="1" value="${escapeHtml(item.makingChargeRs ?? 0)}" aria-label="Making Charge Flat Rupees"></td>
    <td><input data-field="wastageCharge" type="number" min="0" step="0.01" value="${escapeHtml(item.wastageCharge ?? 0)}"></td>
    <td><input data-field="discountAmt" type="number" min="0" step="0.01" value="${escapeHtml(item.discountAmt ?? 0)}"></td>
    <td><input data-field="gstPct" type="number" min="0" step="0.01" value="${escapeHtml(item.gstPct ?? state.settings.defaultGstPct ?? 3)}"></td>
    <td><strong data-line-total>${formatINR(item.lineTotal || 0)}</strong></td>
    <td><button class="mini-button" type="button" data-remove-line>Remove</button></td>
  `;
  line.dataset.lineNo = item.lineNo || index;
  line.dataset.lineId = item.lineId || "";
  body.append(line);
  syncPurityVisibility(line);
  recalculate(container);
}

function purityFieldHtml(metalType, selected) {
  if (metalType === "Silver") return `<span class="muted">Not used</span>`;
  const isCustom = selected && ![58.3, 75, 83.3, 91.6, 99.9].some((value) => Math.abs(num(selected) - value) < 0.001);
  return `
    <select data-field="puritySelect">${goldPurityOptionsHtml(selected)}</select>
    <input data-field="purityCustom" type="number" min="0" step="0.01" value="${isCustom ? escapeHtml(selected) : ""}" ${isCustom ? "" : "hidden"}>
  `;
}

function wireForm(container) {
  const form = $("#combined-form", container);
  $("[data-back-bills]", container).addEventListener("click", async () => {
    state.view = "landing";
    state.editingBill = null;
    await render(container);
  });
  $("[data-add-line]", container).addEventListener("click", () => {
    addItemRow(container);
    queueDraft(container);
  });
  form.addEventListener("input", (event) => {
    if (event.target.name === "customerMobile") event.target.value = normalizeMobile(event.target.value).slice(0, 10);
    if (event.target.dataset.field === "makingChargeRs") event.target.value = Math.max(0, Math.floor(num(event.target.value)));
    recalculate(container);
    queueDraft(container);
  });
  form.addEventListener("change", async (event) => {
    const row = event.target.closest("tr");
    if (event.target.dataset.field === "metalType" && row) {
      row.querySelector('[data-field="category"]').setAttribute("list", event.target.value === "Silver" ? "silver-categories" : "gold-categories");
      row.querySelector("[data-purity-cell]").innerHTML = purityFieldHtml(event.target.value, 91.6);
      row.querySelector('[data-field="ratePerGm"]').value = rateFor(event.target.value);
      syncPurityVisibility(row);
    }
    if (event.target.dataset.field === "puritySelect") {
      const custom = row.querySelector('[data-field="purityCustom"]');
      custom.hidden = event.target.value !== "custom";
    }
    if (event.target.dataset.field === "category" && event.target.value === "+ Add new category") {
      const metalType = row?.querySelector('[data-field="metalType"]')?.value || "Gold";
      const result = await openDialog({
        title: `Add ${metalType} category`,
        fields: [{ name: "category", label: "Category name", required: true }],
        confirmText: "Add category"
      });
      event.target.value = result?.category || "";
      if (result?.category) {
        await updateKnownCategory(metalType, result.category);
        state.categories = await loadCategories();
      }
    }
    if (event.target.name === "oldMetalType") {
      $("[data-exchange-purity-wrap]", container).hidden = event.target.value === "Silver";
    }
    if (event.target.name === "dateISO") form.elements.fy.value = deriveFinancialYear(event.target.value);
    recalculate(container);
    queueDraft(container);
  });
  form.addEventListener("click", async (event) => {
    if (event.target.matches("[data-remove-line]")) {
      event.target.closest("tr").remove();
      if (!$("#items-body", container).children.length) addItemRow(container);
      recalculate(container);
      queueDraft(container);
    }
    if (event.target.matches("[data-update-rate]")) {
      await updateLineRate(container, event.target.closest("tr"));
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
  $("[data-clear]", container).addEventListener("click", () => {
    clearDraft();
    state.view = "form";
    state.editingBill = null;
    render(container);
  });
  beforeUnloadHandler = () => saveDraft(container);
  window.removeEventListener("beforeunload", beforeUnloadHandler);
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

function syncPurityVisibility(row) {
  const metalType = row.querySelector('[data-field="metalType"]').value;
  const cell = row.querySelector("[data-purity-cell]");
  if (metalType === "Silver") {
    if (cell.querySelector('[data-field="puritySelect"]')) cell.innerHTML = purityFieldHtml("Silver", null);
    return;
  }
  if (!cell.querySelector('[data-field="puritySelect"]')) cell.innerHTML = purityFieldHtml("Gold", 91.6);
  const select = cell.querySelector('[data-field="puritySelect"]');
  const custom = cell.querySelector('[data-field="purityCustom"]');
  if (select && custom) custom.hidden = select.value !== "custom";
}

async function updateLineRate(container, row) {
  const metalType = row.querySelector('[data-field="metalType"]').value;
  const result = await openDialog({
    title: `Update ${metalType} rate`,
    fields: [{ name: "rate", label: `${metalType} Rate (₹/g)`, type: "number", value: row.querySelector('[data-field="ratePerGm"]').value, required: true }],
    confirmText: "Save rate"
  });
  if (!result) return;
  const rate = num(result.rate);
  const latest = state.latestRate || {};
  await saveRate({
    rateDate: todayInputValue(),
    gold24k: metalType === "Gold" ? rate : latest.gold24k || latest.gold22k || 0,
    gold22k: metalType === "Gold" ? rate : latest.gold22k || latest.gold24k || 0,
    gold18k: latest.gold18k || 0,
    silver999: metalType === "Silver" ? rate : latest.silver999 || 0,
    sourceLabel: "Manual",
    notes: "Updated from billing",
    updatedAt: new Date().toISOString()
  });
  state.latestRate = await getLatestRate();
  row.querySelector('[data-field="ratePerGm"]').value = rate;
  recalculate(container);
}

function collectItems(container, billNo) {
  return $$("#items-body tr", container).map((row, index) => {
    const metalType = row.querySelector('[data-field="metalType"]').value;
    const item = {
      lineNo: index + 1,
      billNo,
      lineId: row.dataset.lineId || `${billNo}-${index + 1}`,
      metalType
    };
    $$("[data-field]", row).forEach((field) => {
      if (["puritySelect", "purityCustom"].includes(field.dataset.field)) return;
      item[field.dataset.field] = field.value.trim();
    });
    item.purity = metalType === "Silver" ? null : parseGoldPurity(row.querySelector('[data-field="puritySelect"]')?.value, row.querySelector('[data-field="purityCustom"]')?.value);
    const totals = calculateCombinedBillTotals([item]).lines[0];
    return { ...item, ...totals, weightGm: num(item.weightGm), ratePerGm: num(item.ratePerGm), makingChargeRs: Math.max(0, Math.floor(num(item.makingChargeRs))) };
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
    if (item.metalType === "Gold") requirePositive(item.purity, `${label} purity/fineness`);
    requirePositive(item.weightGm, `${label} weight`);
    requirePositive(item.ratePerGm, `${label} rate`);
    requireNonNegative(item.makingChargePct, `${label} making charge percentage`);
    requireNonNegative(item.makingChargeRs, `${label} flat making charge`);
    requireNonNegative(item.wastageCharge, `${label} wastage`);
    requireNonNegative(item.discountAmt, `${label} discount`);
    requireNonNegative(item.gstPct, `${label} GST percentage`);
  });
  if (num(data.oldWeightGm) > 0) {
    requireText(data.oldMetalType, "Old metal type");
    requireText(data.oldItemName, "Old item name");
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
  const values = { ...totals, charges: totals.makingCharge + totals.wastageCharge };
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
    source: "billing",
    customerName: data.customerName,
    customerMobile: normalizeMobile(data.customerMobile),
    oldMetalType: data.oldMetalType,
    oldItemName: data.oldItemName,
    oldWeightGm: num(data.oldWeightGm),
    oldPurity: data.oldMetalType === "Silver" ? null : data.oldPurity,
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
      approval = await ensureOwnerPassword("Edit combined bill", { message: "Editing revises stock movements for all bill items.", confirmText: "Save edit", danger: true });
      if (!approval) return;
    }
    const exchangeRecord = buildExchange(data, billNo);
    const totals = calculateCombinedBillTotals(rawItems, { paidAmount: data.paymentMode === "Credit" ? 0 : data.paidAmount, exchangeValue: exchangeRecord?.netExchangeValue || 0 });
    const items = totals.lines.map((item, index) => ({ ...item, lineNo: index + 1, billNo, lineId: rawItems[index].lineId || `${billNo}-${index + 1}`, createdAt: state.editingBill?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }));
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
    state.activeBill = await saveCombinedBill({ bill, items, exchangeRecord, editingBill: state.editingBill, auditReason: approval?.reason || "Saved combined bill" });
    for (const item of items) await updateKnownCategory(item.metalType, item.category);
    clearDraft();
    state.editingBill = null;
    state.view = "landing";
    showToast("Combined bill saved.", "success");
    await render(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadBill(billNo) {
  const bill = await getByKey("bills", billNo);
  const items = await listBillItems(billNo);
  const exchanges = await getAll("exchangeEntries");
  const exchange = exchanges.find((entry) => entry.billNo === billNo) || null;
  return { ...bill, items, exchange };
}

function fillBill(container, bill) {
  const form = $("#combined-form", container);
  ["billNo", "dateISO", "fy", "paymentMode", "customerName", "customerMobile", "paidAmount", "customerAddress"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = bill[key] || "";
  });
  if (bill.exchange) {
    form.elements.oldMetalType.value = bill.exchange.oldMetalType || "";
    form.elements.oldItemName.value = bill.exchange.oldItemName || "";
    form.elements.oldWeightGm.value = bill.exchange.oldWeightGm || 0;
    form.elements.exchangeRatePerGm.value = bill.exchange.ratePerGm || 0;
    form.elements.deductionAmt.value = bill.exchange.deductionAmt || 0;
  }
  $("#items-body", container).innerHTML = "";
  (bill.items || []).forEach((item) => addItemRow(container, item));
  recalculate(container);
}

function queueDraft(container) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(container), 800);
}

function saveDraft(container) {
  const form = $("#combined-form", container);
  if (!form) return;
  const data = collectForm(form);
  const items = collectItems(container, data.billNo || "DRAFT");
  const totals = calculateCombinedBillTotals(items, { paidAmount: data.paymentMode === "Credit" ? 0 : data.paidAmount, exchangeValue: num(data.netExchangeValue) });
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, items, finalTotal: totals.finalTotal, savedAt: Date.now() }));
}

function getDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (Date.now() - draft.savedAt > 86400000) {
      clearDraft();
      return null;
    }
    return draft;
  } catch {
    clearDraft();
    return null;
  }
}

function restoreDraft(container) {
  const draft = getDraft();
  if (!draft) return false;
  const form = $("#combined-form", container);
  Object.entries(draft).forEach(([key, value]) => {
    if (form.elements[key] && key !== "items") form.elements[key].value = value ?? "";
  });
  $("#items-body", container).innerHTML = "";
  (draft.items || []).forEach((item) => addItemRow(container, item));
  showToast("Draft restored from your last session.", "info");
  recalculate(container);
  return true;
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}
