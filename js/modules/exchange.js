import {
  $,
  $$,
  collectForm,
  displayPurity,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  goldPurityOptionsHtml,
  num,
  parseGoldPurity,
  randomId,
  renderTable,
  requirePositive,
  requireText,
  showToast,
  sortDescByDate
} from "../helpers.js";
import { addRecord, getAll, getLatestRate, logAudit, putRecord } from "../data-service.js";
import { downloadExchangeReportPdf } from "../pdf.js";
import { ensureOwnerPassword } from "../security.js";

const DRAFT_KEY = "draft_exchange";
let draftTimer = null;
let beforeUnloadHandler = null;

let state = {
  entries: [],
  customers: [],
  latestRate: null,
  activeTab: "entry",
  editing: null
};

export async function render(container) {
  [state.entries, state.customers, state.latestRate] = await Promise.all([
    getAll("exchangeEntries"),
    getAll("customers"),
    getLatestRate()
  ]);
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Old Jewellery Exchange</h2>
            <p>Standalone exchange entries and billing-linked exchange history.</p>
          </div>
        </div>
        <div class="tabs">
          <button class="tab-button ${state.activeTab === "entry" ? "active" : ""}" type="button" data-tab="entry">Old Exchange</button>
          <button class="tab-button ${state.activeTab === "reports" ? "active" : ""}" type="button" data-tab="reports">Reports</button>
        </div>
        <div id="exchange-tab"></div>
      </section>
    </div>
  `;
  $$("[data-tab]", container).forEach((button) => button.addEventListener("click", async () => {
    state.activeTab = button.dataset.tab;
    await render(container);
  }));
  if (state.activeTab === "reports") renderReports(container);
  else renderEntry(container);
}

function customerOptions(selected = "") {
  return state.customers.filter((customer) => !customer.deleted).map((customer) => {
    const label = `${customer.name} - ${customer.mobile}`;
    return `<option value="${escapeHtml(customer.mobile)}" ${customer.mobile === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function renderEntry(container) {
  $("#exchange-tab", container).innerHTML = `
    <section class="page-grid">
      <div class="notice">
        <strong>Old Exchange (In-Bill Deduction)</strong>
        <span>Standalone entries can be searched and reported separately from billing-embedded exchange deductions.</span>
      </div>
      <form id="exchange-form" class="page-grid">
        <div class="form-grid">
          <label class="field"><span>Customer</span><select name="customerMobile" required><option value="">Select customer</option>${customerOptions()}</select></label>
          <label class="field"><span>Metal type</span><select name="oldMetalType"><option>Gold</option><option>Silver</option></select></label>
          <label class="field"><span>Item description</span><input name="oldItemName" required></label>
          <label class="field"><span>Gross weight (g)</span><input name="oldWeightGm" type="number" min="0.001" step="0.001" required></label>
          <label class="field" data-purity-wrap><span>Purity/Fineness</span><select name="oldPuritySelect">${goldPurityOptionsHtml(91.6)}</select><input name="oldPurityCustom" type="number" min="0" step="0.01" hidden></label>
          <label class="field"><span>Deduction %</span><input name="deductionPct" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Net weight (g)</span><input class="readonly-input" name="netWeightGm" type="number" readonly></label>
          <label class="field"><span>Rate per gram</span><input name="ratePerGm" type="number" min="0" step="0.01" value="${state.latestRate?.gold22k || state.latestRate?.gold24k || 0}"></label>
          <label class="field"><span>Exchange value (₹)</span><input name="netExchangeValue" type="number" min="0" step="0.01"></label>
          <label class="field full"><span>Notes</span><textarea name="notes"></textarea></label>
        </div>
        <div class="form-actions">
          <button class="button" type="submit">${state.editing ? "Save Exchange Edit" : "Save Exchange Entry"}</button>
          <button class="button-ghost" type="button" data-clear-exchange>Clear</button>
        </div>
      </form>
      <div id="standalone-list"></div>
    </section>
  `;
  wireEntry(container);
  if (state.editing) fillEntry(container, state.editing);
  else restoreDraft(container);
  renderStandaloneList(container);
}

function wireEntry(container) {
  const form = $("#exchange-form", container);
  const recalc = () => {
    const data = collectForm(form);
    const netWeight = Math.max(0, num(data.oldWeightGm) * (1 - num(data.deductionPct) / 100));
    form.elements.netWeightGm.value = netWeight ? netWeight.toFixed(3) : "";
    if (document.activeElement !== form.elements.netExchangeValue) {
      form.elements.netExchangeValue.value = netWeight && num(data.ratePerGm) ? (netWeight * num(data.ratePerGm)).toFixed(2) : "";
    }
    queueDraft(container);
  };
  form.addEventListener("input", recalc);
  form.addEventListener("change", (event) => {
    if (event.target.name === "oldMetalType") {
      const isSilver = event.target.value === "Silver";
      $("[data-purity-wrap]", form).hidden = isSilver;
      form.elements.ratePerGm.value = isSilver ? state.latestRate?.silver999 || 0 : state.latestRate?.gold22k || state.latestRate?.gold24k || 0;
    }
    if (event.target.name === "oldPuritySelect") {
      form.elements.oldPurityCustom.hidden = event.target.value !== "custom";
    }
    recalc();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveExchange(container);
  });
  $("[data-clear-exchange]", container).addEventListener("click", () => {
    state.editing = null;
    clearDraft();
    renderEntry(container);
  });
  beforeUnloadHandler = () => saveDraft(container);
  window.removeEventListener("beforeunload", beforeUnloadHandler);
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

async function saveExchange(container) {
  const form = $("#exchange-form", container);
  const data = collectForm(form);
  try {
    const customer = state.customers.find((item) => item.mobile === data.customerMobile);
    requireText(data.customerMobile, "Customer");
    requireText(data.oldItemName, "Item description");
    requirePositive(data.oldWeightGm, "Gross weight");
    requirePositive(data.ratePerGm, "Rate per gram");
    const now = new Date().toISOString();
    const record = {
      exchangeId: state.editing?.exchangeId || randomId("EX"),
      billNo: state.editing?.billNo || "",
      source: "standalone",
      customerName: customer?.name || "",
      customerMobile: data.customerMobile,
      oldMetalType: data.oldMetalType,
      oldItemName: data.oldItemName,
      oldWeightGm: num(data.oldWeightGm),
      oldPurity: data.oldMetalType === "Silver" ? null : parseGoldPurity(data.oldPuritySelect, data.oldPurityCustom),
      deductionPct: num(data.deductionPct),
      netWeightGm: num(data.netWeightGm),
      ratePerGm: num(data.ratePerGm),
      grossValue: num(data.oldWeightGm) * num(data.ratePerGm),
      deductionAmt: Math.max(0, num(data.oldWeightGm) * num(data.ratePerGm) - num(data.netExchangeValue)),
      netExchangeValue: num(data.netExchangeValue),
      dateISO: state.editing?.dateISO || new Date().toISOString().slice(0, 10),
      notes: data.notes || "",
      createdAt: state.editing?.createdAt || now,
      updatedAt: now
    };
    await putRecord("exchangeEntries", record);
    await logAudit(state.editing ? "exchange_edit" : "exchange_create", "Exchange", record.exchangeId, state.editing ? "Exchange edited" : "Standalone exchange saved", `${record.customerName} ${record.oldMetalType} exchange ${formatINR(record.netExchangeValue)}`);
    clearDraft();
    state.editing = null;
    state.entries = await getAll("exchangeEntries");
    showToast("Exchange entry saved.", "success");
    renderEntry(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderStandaloneList(container) {
  const entries = sortDescByDate(state.entries.filter((entry) => entry.source === "standalone"), "dateISO");
  $("#standalone-list", container).innerHTML = renderTable([
    { label: "Date", render: (row) => formatDate(row.dateISO) },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Metal", key: "oldMetalType" },
    { label: "Item", key: "oldItemName" },
    { label: "Weight", render: (row) => formatGm(row.oldWeightGm) },
    { label: "Value", render: (row) => formatINR(row.netExchangeValue) },
    { label: "Action", render: (row) => `<button class="mini-button" type="button" data-edit-exchange="${escapeHtml(row.exchangeId)}">Edit</button>` }
  ], entries, "No standalone exchange entries.");
  wireEditButtons(container);
}

function renderReports(container) {
  $("#exchange-tab", container).innerHTML = `
    <form id="exchange-report-filter" class="form-grid">
      <label class="field"><span>Metal</span><select name="metal"><option>All</option><option>Gold</option><option>Silver</option></select></label>
      <label class="field"><span>From</span><input name="from" type="date"></label>
      <label class="field"><span>To</span><input name="to" type="date"></label>
      <label class="field"><span>Customer</span><input name="customer" placeholder="Search customer"></label>
      <div class="field"><span class="label">&nbsp;</span><button class="button-secondary" type="button" data-download-exchange-report>Download Report (PDF)</button></div>
    </form>
    <div id="exchange-report-table"></div>
  `;
  const redraw = () => renderReportTable(container);
  $("#exchange-report-filter", container).addEventListener("input", redraw);
  $("#exchange-report-filter", container).addEventListener("change", redraw);
  $("[data-download-exchange-report]", container).addEventListener("click", async () => {
    await downloadExchangeReportPdf(filteredEntries(container));
  });
  renderReportTable(container);
}

function filteredEntries(container) {
  const form = $("#exchange-report-filter", container);
  const filters = form ? collectForm(form) : {};
  return sortDescByDate(state.entries, "dateISO")
    .filter((entry) => !filters.metal || filters.metal === "All" || entry.oldMetalType === filters.metal)
    .filter((entry) => !filters.from || entry.dateISO >= filters.from)
    .filter((entry) => !filters.to || entry.dateISO <= filters.to)
    .filter((entry) => !filters.customer || `${entry.customerName} ${entry.customerMobile}`.toLowerCase().includes(filters.customer.toLowerCase()));
}

function renderReportTable(container) {
  const rows = filteredEntries(container);
  const totalGold = rows.filter((row) => row.oldMetalType === "Gold").reduce((sum, row) => sum + num(row.oldWeightGm), 0);
  const totalSilver = rows.filter((row) => row.oldMetalType === "Silver").reduce((sum, row) => sum + num(row.oldWeightGm), 0);
  const totalValue = rows.reduce((sum, row) => sum + num(row.netExchangeValue), 0);
  $("#exchange-report-table", container).innerHTML = `
    ${renderTable([
      { label: "Date", render: (row) => formatDate(row.dateISO) },
      { label: "Customer", key: "customerName" },
      { label: "Metal", key: "oldMetalType" },
      { label: "Item Description", key: "oldItemName" },
      { label: "Gross Wt", render: (row) => formatGm(row.oldWeightGm) },
      { label: "Purity", render: (row) => displayPurity(row.oldPurity, row.oldMetalType) },
      { label: "Exchange Value", render: (row) => formatINR(row.netExchangeValue) },
      { label: "Action", render: (row) => `<button class="mini-button" type="button" data-edit-exchange="${escapeHtml(row.exchangeId)}">Edit</button>` }
    ], rows, "No exchange entries found.")}
    <div class="notice"><strong>Summary</strong><span>Total gold bought: ${formatGm(totalGold)} | Total silver bought: ${formatGm(totalSilver)} | Total amount paid: ${formatINR(totalValue)}</span></div>
  `;
  wireEditButtons(container);
}

function wireEditButtons(container) {
  $$("[data-edit-exchange]", container).forEach((button) => button.addEventListener("click", async () => {
    const approval = await ensureOwnerPassword("Edit exchange entry", { message: "Owner password is required to edit exchange entries.", danger: true });
    if (!approval) return;
    state.editing = state.entries.find((entry) => entry.exchangeId === button.dataset.editExchange);
    state.activeTab = "entry";
    await render(container);
  }));
}

function fillEntry(container, entry) {
  const form = $("#exchange-form", container);
  const customer = state.customers.find((item) => item.mobile === entry.customerMobile);
  form.elements.customerMobile.value = customer?.mobile || entry.customerMobile || "";
  form.elements.oldMetalType.value = entry.oldMetalType || "Gold";
  form.elements.oldItemName.value = entry.oldItemName || "";
  form.elements.oldWeightGm.value = entry.oldWeightGm || "";
  form.elements.deductionPct.value = entry.deductionPct || 0;
  form.elements.netWeightGm.value = entry.netWeightGm || "";
  form.elements.ratePerGm.value = entry.ratePerGm || 0;
  form.elements.netExchangeValue.value = entry.netExchangeValue || 0;
  form.elements.notes.value = entry.notes || "";
  $("[data-purity-wrap]", form).hidden = entry.oldMetalType === "Silver";
  form.elements.oldPuritySelect.value = entry.oldPurity || 91.6;
}

function queueDraft(container) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(container), 800);
}

function saveDraft(container) {
  const form = $("#exchange-form", container);
  if (!form) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...collectForm(form), savedAt: Date.now() }));
}

function restoreDraft(container) {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (Date.now() - draft.savedAt > 86400000) {
      clearDraft();
      return;
    }
    const form = $("#exchange-form", container);
    Object.entries(draft).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    showToast("Draft restored from your last session.", "info");
  } catch {
    clearDraft();
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}
