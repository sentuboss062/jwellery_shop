import {
  $,
  $$,
  collectForm,
  deriveFinancialYear,
  emptyState,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  num,
  openDialog,
  renderBadge,
  renderTable,
  requireNonNegative,
  requirePositive,
  requireText,
  showToast,
  sortDescByDate,
  todayInputValue
} from "../helpers.js";
import {
  addRecord,
  adjustStock,
  deleteRecord,
  getAll,
  getByKey,
  logAudit,
  nextId,
  putRecord
} from "../data-service.js";
import { ensureOwnerPassword } from "../security.js";

let state = {
  activeTab: "add",
  lots: [],
  movements: [],
  editing: null
};

export async function render(container) {
  state.lots = await getAll("stockLots");
  state.movements = await getAll("stockMovements");
  state.editing = null;
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Jewellery Stock</h2>
            <p>Track purchase lots, available grams, movements, and stock adjustments.</p>
          </div>
        </div>
        <div class="tabs" role="tablist">
          ${tabButton("add", "Add Stock")}
          ${tabButton("current", "Current Stock")}
          ${tabButton("history", "Purchase History")}
          ${tabButton("summary", "Stock Summary")}
          ${tabButton("adjust", "Adjustments")}
        </div>
        <div id="stock-tab"></div>
      </section>
    </div>
  `;
  wireTabs(container);
  await renderTab(container);
}

function tabButton(id, label) {
  return `<button class="tab-button ${state.activeTab === id ? "active" : ""}" type="button" data-tab="${id}">${label}</button>`;
}

function wireTabs(container) {
  $$("[data-tab]", container).forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeTab = button.dataset.tab;
      await render(container);
    });
  });
}

async function renderTab(container) {
  const host = $("#stock-tab", container);
  if (state.activeTab === "add") {
    const stockId = state.editing?.stockId || await nextId("stockLots", "STK", todayInputValue());
    host.innerHTML = renderAddForm(stockId);
    wireAddForm(container);
  }
  if (state.activeTab === "current") {
    host.innerHTML = renderCurrentStock();
    wireCurrentStock(container);
  }
  if (state.activeTab === "history") {
    host.innerHTML = renderPurchaseHistory();
  }
  if (state.activeTab === "summary") {
    host.innerHTML = renderSummary();
  }
  if (state.activeTab === "adjust") {
    host.innerHTML = renderAdjustments();
  }
}

function renderAddForm(stockId) {
  const lot = state.editing || {};
  return `
    <form id="stock-form" class="page-grid" autocomplete="off">
      <div class="form-grid">
        <label class="field"><span>Stock ID</span><input class="readonly-input" name="stockId" value="${escapeHtml(stockId)}" readonly></label>
        <label class="field"><span>Purchase date</span><input name="purchaseDateISO" type="date" value="${escapeHtml(lot.purchaseDateISO || todayInputValue())}" required></label>
        <label class="field"><span>Item name</span><input name="itemName" value="${escapeHtml(lot.itemName || "")}" required></label>
        <label class="field"><span>Category</span><input name="category" value="${escapeHtml(lot.category || "")}" required></label>
        <label class="field"><span>Metal type</span><select name="metalType"><option ${lot.metalType === "Gold" ? "selected" : ""}>Gold</option><option ${lot.metalType === "Silver" ? "selected" : ""}>Silver</option></select></label>
        <label class="field"><span>Purity</span><input name="purity" value="${escapeHtml(lot.purity || "")}" placeholder="22K, 18K, 999" required></label>
        <label class="field"><span>Gross weight gm</span><input name="grossWeightGm" type="number" min="0.001" step="0.001" value="${escapeHtml(lot.grossWeightGm || "")}" required></label>
        <label class="field"><span>Available weight gm</span><input class="readonly-input" name="availableWeightGm" type="number" step="0.001" value="${escapeHtml(lot.availableWeightGm || "")}" readonly></label>
        <label class="field"><span>Purchase rate</span><input name="purchaseRate" type="number" min="0" step="0.01" value="${escapeHtml(lot.purchaseRate || 0)}"></label>
        <label class="field"><span>Selling rate</span><input name="sellingRate" type="number" min="0" step="0.01" value="${escapeHtml(lot.sellingRate || 0)}"></label>
        <label class="field"><span>Supplier name</span><input name="supplierName" value="${escapeHtml(lot.supplierName || "")}"></label>
        <label class="field full"><span>Notes</span><textarea name="notes">${escapeHtml(lot.notes || "")}</textarea></label>
      </div>
      <div class="form-actions">
        <button class="button" type="submit">${state.editing ? "Save Stock Edit" : "Add Stock"}</button>
        <button class="button-ghost" type="button" data-clear-stock>Clear</button>
      </div>
    </form>
  `;
}

function wireAddForm(container) {
  const form = $("#stock-form", container);
  const gross = form.elements.grossWeightGm;
  gross.addEventListener("input", () => {
    if (!state.editing) form.elements.availableWeightGm.value = gross.value;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = collectForm(form);
      validateStock(data);
      const now = new Date().toISOString();
      const existing = await getByKey("stockLots", data.stockId);
      const record = {
        stockId: data.stockId,
        purchaseDateISO: data.purchaseDateISO,
        itemName: data.itemName,
        category: data.category,
        metalType: data.metalType,
        purity: data.purity,
        grossWeightGm: num(data.grossWeightGm),
        availableWeightGm: state.editing ? num(data.availableWeightGm) : num(data.grossWeightGm),
        purchaseRate: num(data.purchaseRate),
        sellingRate: num(data.sellingRate),
        supplierName: data.supplierName || "",
        notes: data.notes || "",
        status: num(state.editing ? data.availableWeightGm : data.grossWeightGm) > 0 ? "Available" : "Sold Out",
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      if (state.editing) {
        await putRecord("stockLots", record);
        await logAudit("STOCK_EDIT", "Stock", record.stockId, "Stock edited", `${record.itemName} stock lot updated.`);
      } else {
        await addRecord("stockLots", record);
        await addRecord("stockMovements", {
          movementId: `MOV-${Date.now()}`,
          dateISO: data.purchaseDateISO,
          refType: "PURCHASE",
          refId: data.stockId,
          stockId: data.stockId,
          metalType: data.metalType,
          purity: data.purity,
          category: data.category,
          deltaWeightGm: num(data.grossWeightGm),
          reason: "Purchase entry"
        });
        await logAudit("STOCK_CREATE", "Stock", record.stockId, "Stock purchase", `${record.metalType} ${record.itemName} added.`);
      }
      showToast("Stock saved.", "success");
      state.lots = await getAll("stockLots");
      state.movements = await getAll("stockMovements");
      state.editing = null;
      await render(container);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-clear-stock]", container).addEventListener("click", async () => {
    state.editing = null;
    await render(container);
  });
}

function validateStock(data) {
  requireText(data.itemName, "Item name");
  requireText(data.category, "Category");
  requireText(data.metalType, "Metal type");
  requireText(data.purity, "Purity");
  requirePositive(data.grossWeightGm, "Gross weight");
  requireNonNegative(data.purchaseRate, "Purchase rate");
  requireNonNegative(data.sellingRate, "Selling rate");
}

function renderCurrentStock() {
  const rows = state.lots.filter((lot) => lot.status !== "Deleted");
  return renderTable([
    { label: "Stock ID", render: (row) => `<strong>${escapeHtml(row.stockId)}</strong><br><span class="muted">${formatDate(row.purchaseDateISO)}</span>` },
    { label: "Item", render: (row) => `${escapeHtml(row.itemName)}<br><span class="muted">${escapeHtml(row.category)}</span>` },
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)}<br><span class="muted">${escapeHtml(row.purity)}</span>` },
    { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
    { label: "Available", render: (row) => formatGm(row.availableWeightGm) },
    { label: "Selling rate", render: (row) => formatINR(row.sellingRate) },
    { label: "Supplier", render: (row) => escapeHtml(row.supplierName || "-") },
    { label: "Status", render: (row) => renderBadge(row.status) },
    {
      label: "Actions",
      render: (row) => `
        <div class="row-actions">
          <button class="mini-button" type="button" data-edit-stock="${escapeHtml(row.stockId)}">Edit</button>
          <button class="mini-button" type="button" data-adjust-stock="${escapeHtml(row.stockId)}">Adjust</button>
          <button class="mini-button" type="button" data-delete-stock="${escapeHtml(row.stockId)}">Delete</button>
        </div>
      `
    }
  ], rows, "No stock lots found.");
}

function wireCurrentStock(container) {
  $$("[data-edit-stock]", container).forEach((button) => button.addEventListener("click", async () => {
    state.editing = await getByKey("stockLots", button.dataset.editStock);
    state.activeTab = "add";
    await render(container);
  }));
  $$("[data-adjust-stock]", container).forEach((button) => button.addEventListener("click", async () => {
    await promptAdjustment(container, button.dataset.adjustStock);
  }));
  $$("[data-delete-stock]", container).forEach((button) => button.addEventListener("click", async () => {
    await deleteStockLot(container, button.dataset.deleteStock);
  }));
}

async function promptAdjustment(container, stockId) {
  const result = await openDialog({
    title: "Stock adjustment",
    message: "Use positive grams to add stock and negative grams to reduce available stock.",
    fields: [
      { name: "delta", label: "Adjustment grams", type: "number", required: true },
      { name: "reason", label: "Reason", type: "textarea", required: true }
    ],
    confirmText: "Apply adjustment"
  });
  if (!result) return;
  try {
    requireText(result.reason, "Adjustment reason");
    if (num(result.delta) === 0) throw new Error("Adjustment grams cannot be zero.");
    await adjustStock(stockId, num(result.delta), result.reason);
    await logAudit("STOCK_ADJUST", "Stock", stockId, result.reason, `Adjusted by ${num(result.delta)} gm.`);
    state.lots = await getAll("stockLots");
    state.movements = await getAll("stockMovements");
    showToast("Stock adjustment saved.", "success");
    await render(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteStockLot(container, stockId) {
  const lot = await getByKey("stockLots", stockId);
  if (!lot) return;
  const movements = state.movements.filter((movement) => movement.stockId === stockId);
  if (movements.some((movement) => movement.refType === "SALE" || movement.refType === "CANCEL")) {
    showToast("Stock lot has sale movements and cannot be deleted.", "error");
    return;
  }
  if (num(lot.availableWeightGm) !== num(lot.grossWeightGm)) {
    showToast("Only untouched draft purchase rows can be deleted.", "error");
    return;
  }
  try {
    const approval = await ensureOwnerPassword("Delete stock row", {
      message: "Only bad draft rows without sale movements should be deleted.",
      confirmText: "Delete row",
      danger: true
    });
    if (!approval) return;
    await deleteRecord("stockLots", stockId);
    await logAudit("STOCK_DELETE", "Stock", stockId, approval.reason, `Deleted draft stock lot ${stockId}.`);
    state.lots = await getAll("stockLots");
    state.movements = await getAll("stockMovements");
    showToast("Stock row deleted.", "success");
    await render(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderPurchaseHistory() {
  const rows = sortDescByDate(state.lots, "purchaseDateISO");
  return renderTable([
    { label: "Date", render: (row) => formatDate(row.purchaseDateISO) },
    { label: "Stock ID", key: "stockId" },
    { label: "Item", render: (row) => `${escapeHtml(row.itemName)}<br><span class="muted">${escapeHtml(row.category)}</span>` },
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)} ${escapeHtml(row.purity)}` },
    { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
    { label: "Purchase rate", render: (row) => formatINR(row.purchaseRate) },
    { label: "Supplier", render: (row) => escapeHtml(row.supplierName || "-") },
    { label: "Notes", render: (row) => escapeHtml(row.notes || "-") }
  ], rows, "No purchase history found.");
}

function summaryRows() {
  const map = new Map();
  state.lots.filter((lot) => lot.status !== "Deleted").forEach((lot) => {
    const key = `${lot.metalType}|${lot.purity}|${lot.category}`;
    const existing = map.get(key) || {
      metalType: lot.metalType,
      purity: lot.purity,
      category: lot.category,
      grossWeightGm: 0,
      availableWeightGm: 0
    };
    existing.grossWeightGm += num(lot.grossWeightGm);
    existing.availableWeightGm += num(lot.availableWeightGm);
    map.set(key, existing);
  });
  return Array.from(map.values());
}

function renderSummary() {
  const rows = summaryRows();
  const totalGold = state.lots.filter((lot) => lot.metalType === "Gold" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
  const totalSilver = state.lots.filter((lot) => lot.metalType === "Silver" && lot.status !== "Deleted").reduce((sum, lot) => sum + num(lot.availableWeightGm), 0);
  return `
    <div class="cards-grid">
      <div class="metric-card"><small>Total gold grams</small><strong>${formatGm(totalGold)}</strong><span>Available stock</span></div>
      <div class="metric-card"><small>Total silver grams</small><strong>${formatGm(totalSilver)}</strong><span>Available stock</span></div>
      <div class="metric-card"><small>Purity groups</small><strong>${new Set(rows.map((row) => `${row.metalType}-${row.purity}`)).size}</strong><span>Computed from lots</span></div>
      <div class="metric-card"><small>Categories</small><strong>${new Set(rows.map((row) => row.category)).size}</strong><span>Computed from lots</span></div>
    </div>
    ${renderTable([
      { label: "Metal", key: "metalType" },
      { label: "Purity", key: "purity" },
      { label: "Category", key: "category" },
      { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
      { label: "Available", render: (row) => formatGm(row.availableWeightGm) }
    ], rows, "No stock summary available.")}
  `;
}

function renderAdjustments() {
  const rows = sortDescByDate(state.movements, "dateISO");
  return renderTable([
    { label: "Date", render: (row) => formatDate(row.dateISO) },
    { label: "Movement ID", key: "movementId" },
    { label: "Type", key: "refType" },
    { label: "Reference", key: "refId" },
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)} ${escapeHtml(row.purity)}` },
    { label: "Category", key: "category" },
    { label: "Delta", render: (row) => formatGm(row.deltaWeightGm) },
    { label: "Reason", render: (row) => escapeHtml(row.reason || "-") }
  ], rows, "No stock movements found.");
}
