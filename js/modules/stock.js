import {
  $,
  $$,
  collectForm,
  deriveFinancialYear,
  displayPurity,
  emptyState,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  goldPurityOptionsHtml,
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
  todayInputValue
} from "../helpers.js";
import {
  addRecord,
  deleteRecord,
  getAll,
  getByKey,
  getSettings,
  logAudit,
  nextId,
  putRecord,
  updateKnownCategory
} from "../data-service.js";
import { ensureOwnerPassword } from "../security.js";

let state = {
  activeTab: "add",
  lots: [],
  movements: [],
  billItems: [],
  bills: [],
  settings: null,
  editing: null
};

export async function render(container) {
  [state.lots, state.movements, state.billItems, state.bills, state.settings] = await Promise.all([
    getAll("stockLots"),
    getAll("stockMovements"),
    getAll("billItems"),
    getAll("bills"),
    getSettings()
  ]);
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
          ${tabButton("sold", "Sold Items")}
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

function categoryDatalists() {
  const gold = new Set([...(state.settings?.goldCategories || []), ...state.lots.filter((lot) => lot.metalType === "Gold").map((lot) => lot.category)]);
  const silver = new Set([...(state.settings?.silverCategories || []), ...state.lots.filter((lot) => lot.metalType === "Silver").map((lot) => lot.category)]);
  return `
    <datalist id="gold-stock-categories">${Array.from(gold).filter(Boolean).sort().map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}<option value="+ Add new category"></option></datalist>
    <datalist id="silver-stock-categories">${Array.from(silver).filter(Boolean).sort().map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}<option value="+ Add new category"></option></datalist>
  `;
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
  if (state.activeTab === "sold") {
    host.innerHTML = renderSoldItems(container);
    wireSoldFilters(container);
  }
}

function renderAddForm(stockId) {
  const lot = state.editing || {};
  const isSilver = lot.metalType === "Silver";
  return `
    <form id="stock-form" class="page-grid" autocomplete="off">
      ${categoryDatalists()}
      <div class="form-grid">
        <label class="field"><span>Stock ID</span><input class="readonly-input" name="stockId" value="${escapeHtml(stockId)}" readonly></label>
        <label class="field"><span>Purchase date</span><input name="purchaseDateISO" type="date" value="${escapeHtml(lot.purchaseDateISO || todayInputValue())}" required></label>
        <label class="field"><span>Item name</span><input name="itemName" value="${escapeHtml(lot.itemName || "")}" required></label>
        <label class="field"><span>Category</span><input name="category" list="${isSilver ? "silver-stock-categories" : "gold-stock-categories"}" value="${escapeHtml(lot.category || "")}" required></label>
        <label class="field"><span>Metal type</span><select name="metalType"><option ${lot.metalType === "Gold" ? "selected" : ""}>Gold</option><option ${lot.metalType === "Silver" ? "selected" : ""}>Silver</option></select></label>
        <label class="field" data-purity-wrap ${isSilver ? "hidden" : ""}><span>Gold purity/fineness</span><select name="puritySelect">${goldPurityOptionsHtml(lot.purity || 91.6)}</select><input name="purityCustom" type="number" min="0" step="0.01" value="" hidden></label>
        <label class="field"><span>Gross weight gm</span><input name="grossWeightGm" type="number" min="0.001" step="0.001" value="${escapeHtml(lot.grossWeightGm || "")}" required></label>
        <label class="field"><span>Wastage %</span><input name="wastagePercent" type="number" min="0" step="0.01" value="${escapeHtml(lot.wastagePercent || 0)}"></label>
        <label class="field"><span>Net weight gm</span><input name="netWeightGrams" type="number" min="0" step="0.001" value="${escapeHtml(lot.netWeightGrams || lot.availableNetWeightGm || lot.availableWeightGm || "")}"></label>
        <label class="field"><span>Available weight gm</span><input class="readonly-input" name="availableWeightGm" type="number" step="0.001" value="${escapeHtml(lot.availableWeightGm || "")}" readonly></label>
        <label class="field"><span>Purchase rate</span><input name="purchaseRate" type="number" min="0" step="0.01" value="${escapeHtml(lot.purchaseRate || 0)}"></label>
        <label class="field"><span>Making Charge (₹)</span><input name="makingChargeRs" type="number" min="0" step="1" value="${escapeHtml(lot.makingChargeRs || 0)}"></label>
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
  const recalcNet = () => {
    const net = Math.max(0, num(form.elements.grossWeightGm.value) * (1 - num(form.elements.wastagePercent.value) / 100));
    if (!state.editing || !form.elements.netWeightGrams.value) form.elements.netWeightGrams.value = net ? net.toFixed(3) : "";
    if (!state.editing) form.elements.availableWeightGm.value = form.elements.netWeightGrams.value || gross.value;
  };
  gross.addEventListener("input", recalcNet);
  form.elements.wastagePercent.addEventListener("input", recalcNet);
  form.elements.netWeightGrams.addEventListener("input", () => {
    if (!state.editing) form.elements.availableWeightGm.value = form.elements.netWeightGrams.value;
  });
  form.elements.metalType.addEventListener("change", () => {
    const isSilver = form.elements.metalType.value === "Silver";
    $("[data-purity-wrap]", form).hidden = isSilver;
    form.elements.category.setAttribute("list", isSilver ? "silver-stock-categories" : "gold-stock-categories");
  });
  form.elements.category.addEventListener("change", async () => {
    if (form.elements.category.value !== "+ Add new category") return;
    const metalType = form.elements.metalType.value;
    const result = await openDialog({
      title: `Add ${metalType} category`,
      fields: [{ name: "category", label: "Category name", required: true }],
      confirmText: "Add category"
    });
    form.elements.category.value = result?.category || "";
    if (result?.category) await updateKnownCategory(metalType, result.category);
  });
  form.elements.puritySelect?.addEventListener("change", () => {
    form.elements.purityCustom.hidden = form.elements.puritySelect.value !== "custom";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = collectForm(form);
      validateStock(data);
      const purity = data.metalType === "Silver" ? null : parseGoldPurity(data.puritySelect, data.purityCustom);
      const netWeight = num(data.netWeightGrams || data.grossWeightGm);
      const now = new Date().toISOString();
      const existing = await getByKey("stockLots", data.stockId);
      const record = {
        stockId: data.stockId,
        purchaseDateISO: data.purchaseDateISO,
        itemName: data.itemName,
        category: data.category,
        metalType: data.metalType,
        purity,
        grossWeightGm: num(data.grossWeightGm),
        grossWeightGrams: num(data.grossWeightGm),
        netWeightGrams: netWeight,
        wastagePercent: num(data.wastagePercent),
        availableWeightGm: state.editing ? num(data.availableWeightGm) : netWeight,
        availableNetWeightGm: state.editing ? num(data.availableWeightGm) : netWeight,
        purchaseRate: num(data.purchaseRate),
        makingChargeRs: Math.max(0, Math.floor(num(data.makingChargeRs))),
        supplierName: data.supplierName || "",
        notes: data.notes || "",
        status: num(state.editing ? data.availableWeightGm : data.grossWeightGm) > 0 ? "Available" : "Sold Out",
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      if (state.editing) {
        await putRecord("stockLots", record);
        await updateKnownCategory(record.metalType, record.category);
        await logAudit("STOCK_EDIT", "Stock", record.stockId, "Stock edited", `${record.itemName} stock lot updated.`);
      } else {
        await addRecord("stockLots", record);
        await updateKnownCategory(record.metalType, record.category);
        await addRecord("stockMovements", {
          movementId: `MOV-${Date.now()}`,
          dateISO: data.purchaseDateISO,
          refType: "PURCHASE",
          refId: data.stockId,
          stockId: data.stockId,
          metalType: data.metalType,
          purity: data.purity,
          category: data.category,
          deltaWeightGm: netWeight,
          deltaGross: num(data.grossWeightGm),
          deltaNet: netWeight,
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
  if (data.metalType === "Gold") requirePositive(parseGoldPurity(data.puritySelect, data.purityCustom), "Gold purity");
  requirePositive(data.grossWeightGm, "Gross weight");
  requirePositive(data.netWeightGrams || data.grossWeightGm, "Net weight");
  requireNonNegative(data.purchaseRate, "Purchase rate");
}

function renderCurrentStock() {
  const rows = state.lots.filter((lot) => lot.status !== "Deleted");
  return renderTable([
    { label: "Stock ID", render: (row) => `<strong>${escapeHtml(row.stockId)}</strong><br><span class="muted">${formatDate(row.purchaseDateISO)}</span>` },
    { label: "Item", render: (row) => `${escapeHtml(row.itemName)}<br><span class="muted">${escapeHtml(row.category)}</span>` },
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)}<br><span class="muted">${displayPurity(row.purity, row.metalType)}</span>` },
    { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
    { label: "Net Wt", render: (row) => row.netWeightGrams ? formatGm(row.netWeightGrams) : `~${formatGm(row.grossWeightGm)}` },
    { label: "Available", render: (row) => formatGm(row.availableWeightGm) },
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
    const approval = await ensureOwnerPassword("Edit stock lot", {
      message: "Owner approval is required before changing stock lot weights or details.",
      confirmText: "Edit stock",
      danger: true
    });
    if (!approval) return;
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
    message: "Choose Add or Remove, then enter independent gross and net weight corrections.",
    fields: [
      { name: "adjustType", label: "Adjust type (Add or Remove)", value: "Add", required: true },
      { name: "gross", label: "Adjust Gross Wt (g)", type: "number", required: true },
      { name: "net", label: "Adjust Net Wt (g)", type: "number", required: true },
      { name: "reason", label: "Reason", type: "textarea", required: true }
    ],
    confirmText: "Apply adjustment"
  });
  if (!result) return;
  try {
    requireText(result.reason, "Adjustment reason");
    const lot = await getByKey("stockLots", stockId);
    const sign = String(result.adjustType).toLowerCase().startsWith("remove") ? -1 : 1;
    const deltaGross = sign * num(result.gross);
    const deltaNet = sign * num(result.net);
    if (deltaGross === 0 && deltaNet === 0) throw new Error("Adjustment weight cannot be zero.");
    const updated = {
      ...lot,
      grossWeightGm: num(lot.grossWeightGm) + deltaGross,
      grossWeightGrams: num(lot.grossWeightGrams, lot.grossWeightGm) + deltaGross,
      netWeightGrams: num(lot.netWeightGrams, lot.availableWeightGm) + deltaNet,
      availableWeightGm: num(lot.availableWeightGm) + deltaNet,
      availableNetWeightGm: num(lot.availableNetWeightGm, lot.availableWeightGm) + deltaNet,
      updatedAt: new Date().toISOString()
    };
    if (updated.availableWeightGm < 0 || updated.netWeightGrams < 0 || updated.grossWeightGm < 0) throw new Error("Adjustment cannot make stock weight negative.");
    await putRecord("stockLots", updated);
    await addRecord("stockMovements", {
      movementId: `MOV-${Date.now()}`,
      dateISO: todayInputValue(),
      refType: "ADJUSTMENT",
      type: "adjustment",
      refId: stockId,
      stockId,
      metalType: lot.metalType,
      purity: lot.purity,
      category: lot.category,
      deltaWeightGm: deltaNet,
      deltaGross,
      deltaNet,
      reason: result.reason
    });
    await logAudit("STOCK_ADJUST", "Stock", stockId, result.reason, `Adjusted gross ${deltaGross} gm, net ${deltaNet} gm.`);
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
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)} ${displayPurity(row.purity, row.metalType)}` },
    { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
    { label: "Purchase rate", render: (row) => formatINR(row.purchaseRate) },
    { label: "Supplier", render: (row) => escapeHtml(row.supplierName || "-") },
    { label: "Notes", render: (row) => escapeHtml(row.notes || "-") }
  ], rows, "No purchase history found.");
}

function summaryRows() {
  const map = new Map();
  state.lots.filter((lot) => lot.status !== "Deleted").forEach((lot) => {
    const key = `${lot.metalType}|${lot.metalType === "Silver" ? "silver" : lot.purity}|${lot.category}`;
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
      { label: "Purity", render: (row) => displayPurity(row.purity, row.metalType) },
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
    { label: "Metal", render: (row) => `${escapeHtml(row.metalType)} ${displayPurity(row.purity, row.metalType)}` },
    { label: "Category", key: "category" },
    { label: "Delta", render: (row) => formatGm(row.deltaWeightGm) },
    { label: "Reason", render: (row) => escapeHtml(row.reason || "-") }
  ], rows, "No stock movements found.");
}

function soldRows(container) {
  const form = $("#sold-filter", container);
  const filters = form ? collectForm(form) : {};
  return state.movements
    .filter((movement) => movement.type === "sale" || movement.refType === "SALE")
    .map((movement) => {
      const item = state.billItems.find((line) => line.lineId === movement.lineId) || {};
      const bill = state.bills.find((entry) => entry.billNo === movement.refId) || {};
      return {
        ...movement,
        billNo: movement.refId,
        customerName: bill.customerName || "-",
        itemName: item.itemName || "-",
        grossWeightGm: item.weightGm || Math.abs(num(movement.deltaGross || movement.deltaWeightGm)),
        netWeightGm: item.netWeightGm || item.weightGm || Math.abs(num(movement.deltaNet || movement.deltaWeightGm)),
        ratePerGm: item.ratePerGm || 0,
        makingCharge: (num(item.makingCharge) || 0) + (num(item.makingChargeRs) || 0),
        saleAmount: item.lineTotal || 0
      };
    })
    .filter((row) => !filters.metal || filters.metal === "All" || row.metalType === filters.metal)
    .filter((row) => !filters.from || row.dateISO >= filters.from)
    .filter((row) => !filters.to || row.dateISO <= filters.to)
    .filter((row) => !filters.category || row.category === filters.category);
}

function renderSoldItems(container) {
  const categories = Array.from(new Set(state.movements.map((movement) => movement.category).filter(Boolean))).sort();
  const rows = soldRows(container);
  const totalGold = rows.filter((row) => row.metalType === "Gold").reduce((sum, row) => sum + num(row.netWeightGm), 0);
  const totalSilver = rows.filter((row) => row.metalType === "Silver").reduce((sum, row) => sum + num(row.netWeightGm), 0);
  const totalSale = rows.reduce((sum, row) => sum + num(row.saleAmount), 0);
  return `
    <form id="sold-filter" class="form-grid">
      <label class="field"><span>Metal</span><select name="metal"><option>All</option><option>Gold</option><option>Silver</option></select></label>
      <label class="field"><span>From</span><input name="from" type="date"></label>
      <label class="field"><span>To</span><input name="to" type="date"></label>
      <label class="field"><span>Category</span><select name="category"><option value="">All</option>${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select></label>
    </form>
    <div id="sold-table">
      ${renderSoldTable(rows, totalGold, totalSilver, totalSale)}
    </div>
  `;
}

function renderSoldTable(rows, totalGold, totalSilver, totalSale) {
  return `
    ${renderTable([
      { label: "Date", render: (row) => formatDate(row.dateISO) },
      { label: "Bill No", key: "billNo" },
      { label: "Customer", key: "customerName" },
      { label: "Metal", key: "metalType" },
      { label: "Category", key: "category" },
      { label: "Item Name", key: "itemName" },
      { label: "Purity", render: (row) => displayPurity(row.purity, row.metalType) },
      { label: "Gross Wt", render: (row) => formatGm(row.grossWeightGm) },
      { label: "Net Wt", render: (row) => formatGm(row.netWeightGm) },
      { label: "Rate/g", render: (row) => formatINR(row.ratePerGm) },
      { label: "Making", render: (row) => formatINR(row.makingCharge) },
      { label: "Sale Amount", render: (row) => formatINR(row.saleAmount) }
    ], rows, "No sold items found.")}
    <div class="notice">
      <strong>Sold summary</strong>
      <span>Total gold sold: ${formatGm(totalGold)} | Total silver sold: ${formatGm(totalSilver)} | Total sale value: ${formatINR(totalSale)}</span>
    </div>
  `;
}

function wireSoldFilters(container) {
  const form = $("#sold-filter", container);
  if (!form) return;
  form.addEventListener("change", () => {
    const rows = soldRows(container);
    const totalGold = rows.filter((row) => row.metalType === "Gold").reduce((sum, row) => sum + num(row.netWeightGm), 0);
    const totalSilver = rows.filter((row) => row.metalType === "Silver").reduce((sum, row) => sum + num(row.netWeightGm), 0);
    const totalSale = rows.reduce((sum, row) => sum + num(row.saleAmount), 0);
    $("#sold-table", container).innerHTML = renderSoldTable(rows, totalGold, totalSilver, totalSale);
  });
}
