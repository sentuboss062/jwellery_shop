import {
  $,
  formatGm,
  formatINR,
  num,
  openDialog,
  todayInputValue,
  showToast
} from "../helpers.js";
import { getAll, getLatestRate, saveRate, summarizeData } from "../data-service.js";
import { exportFullZip, restoreBackupFromFile } from "../backup.js";
import { getStorageHealth, renderStorageCard } from "../storage-health.js";

export async function render(container) {
  const [summary, health, latestRate, rates] = await Promise.all([summarizeData(), getStorageHealth(), getLatestRate(), getAll("rates")]);
  const todayRate = rates.find((rate) => rate.rateDate === todayInputValue());
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band" id="rates-card">
        <div class="section-header">
          <div>
            <h2>Today's Rates</h2>
            <p>Reference rates used to prefill billing item rates.</p>
          </div>
          <button class="button-secondary" type="button" data-edit-rates>✎ Edit Rates</button>
        </div>
        <div class="cards-grid">
          <div class="metric-card"><small>Gold rate</small><strong>${formatINR((todayRate || latestRate)?.gold22k || (todayRate || latestRate)?.gold24k || 0)}</strong><span>₹/g reference</span></div>
          <div class="metric-card"><small>Silver rate</small><strong>${formatINR((todayRate || latestRate)?.silver999 || 0)}</strong><span>₹/g reference</span></div>
          <a class="metric-card" href="#/audit-log" style="text-decoration:none"><small>Audit Log</small><strong>View all actions</strong><span>Recorded owner and data changes</span></a>
        </div>
        <form id="rates-inline-form" class="form-grid three" hidden>
          <label class="field"><span>Gold Rate (₹/g)</span><input name="goldRate" type="number" min="0" step="0.01" value="${(todayRate || latestRate)?.gold22k || ""}"></label>
          <label class="field"><span>Silver Rate (₹/g)</span><input name="silverRate" type="number" min="0" step="0.01" value="${(todayRate || latestRate)?.silver999 || ""}"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button" type="submit">Save Rates</button></div>
        </form>
      </section>
      <section class="cards-grid">
        <div class="metric-card"><small>Today total sales</small><strong>${formatINR(summary.todaySales)}</strong><span>Cancelled bills excluded</span></div>
        <div class="metric-card"><small>Today gold sold</small><strong>${formatGm(summary.todayGoldGm)}</strong><span>Active bills</span></div>
        <div class="metric-card"><small>Today silver sold</small><strong>${formatGm(summary.todaySilverGm)}</strong><span>Active bills</span></div>
        <div class="metric-card"><small>Active loans</small><strong>${summary.activeLoansCount}</strong><span>${summary.overdueLoansCount} overdue</span></div>
        <div class="metric-card"><small>Pending loan amount</small><strong>${formatINR(summary.pendingLoanAmount)}</strong><span>Outstanding principal</span></div>
        <div class="metric-card"><small>Total due amount</small><strong>${formatINR(summary.totalDueAmount)}</strong><span>Open credit records</span></div>
        <div class="metric-card"><small>Gold stock</small><strong>${formatGm(summary.totalGoldStockGm)}</strong><span>Available grams</span></div>
        <div class="metric-card"><small>Silver stock</small><strong>${formatGm(summary.totalSilverStockGm)}</strong><span>Available grams</span></div>
        ${renderStorageCard(health, summary.lastBackupAt)}
      </section>
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Quick Actions</h2>
            <p>Common daily tasks for billing, stock, loans, and backup.</p>
          </div>
        </div>
        <div class="actions-row">
          <a class="button" href="#/billing">New Combined Bill</a>
          <a class="button-secondary" href="#/stock">Add Stock</a>
          <a class="button-secondary" href="#/loans">New Loan</a>
          <button class="button-ghost" type="button" data-export-dashboard>Export Backup</button>
          <label class="button-ghost">
            Restore Backup
            <input type="file" data-restore-dashboard accept=".zip,.json,application/zip,application/json" hidden>
          </label>
        </div>
      </section>
      <section class="section-band">
        <div class="notice warning">
          <strong>Important storage reminder</strong>
          <span>This app stores business records in this browser under the current domain/origin. Use full ZIP backup before changing domain, clearing browser data, or using a new computer.</span>
        </div>
      </section>
    </div>
  `;
  wireRates(container);
  if (!todayRate) await promptTodayRates();
  $("[data-export-dashboard]", container).addEventListener("click", async () => {
    try {
      await exportFullZip();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-restore-dashboard]", container).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await restoreBackupFromFile(file);
      location.reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function wireRates(container) {
  const form = $("#rates-inline-form", container);
  $("[data-edit-rates]", container).addEventListener("click", () => {
    form.hidden = !form.hidden;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    await saveRate({
      rateDate: todayInputValue(),
      gold24k: num(data.get("goldRate")),
      gold22k: num(data.get("goldRate")),
      gold18k: 0,
      silver999: num(data.get("silverRate")),
      sourceLabel: "Manual",
      notes: "Saved from dashboard",
      updatedAt: new Date().toISOString()
    });
    showToast("Today's rates saved.", "success");
    await render(container);
  });
}

async function promptTodayRates() {
  const result = await openDialog({
    title: "Set Today's Rates",
    message: "Enter today's reference rates, or choose Skip for now.",
    fields: [
      { name: "goldRate", label: "Gold Rate (₹/g)", type: "number", required: false },
      { name: "silverRate", label: "Silver Rate (₹/g)", type: "number", required: false }
    ],
    confirmText: "Save & Continue",
    cancelText: "Skip for now"
  });
  if (!result) return;
  await saveRate({
    rateDate: todayInputValue(),
    gold24k: num(result.goldRate),
    gold22k: num(result.goldRate),
    gold18k: 0,
    silver999: num(result.silverRate),
    sourceLabel: "Manual",
    notes: "Saved from startup prompt",
    updatedAt: new Date().toISOString()
  });
  showToast("Today's rates saved.", "success");
}
