import {
  $,
  formatGm,
  formatINR,
  showToast
} from "../helpers.js";
import { summarizeData } from "../data-service.js";
import { exportFullZip, restoreBackupFromFile } from "../backup.js";
import { getStorageHealth, renderStorageCard } from "../storage-health.js";

export async function render(container) {
  const [summary, health] = await Promise.all([summarizeData(), getStorageHealth()]);
  container.innerHTML = `
    <div class="page-grid">
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
          <a class="button" href="#/gold-sales">New Gold Bill</a>
          <a class="button" href="#/silver-sales">New Silver Bill</a>
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
