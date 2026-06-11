import {
  calculateLoanInterest,
  computedLoanStatus,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  groupSum,
  monthKey,
  num,
  renderBadge,
  renderTable,
  sortDescByDate,
  todayInputValue
} from "../helpers.js";
import { getAll, listNormalizedBills } from "../data-service.js";
import { destroyCharts, renderReportsCharts } from "../charts.js";

let state = {
  goldBills: [],
  silverBills: [],
  bills: [],
  loans: [],
  credits: [],
  stockLots: []
};

export async function render(container) {
  destroyCharts(container);
  [state.bills, state.loans, state.credits, state.stockLots] = await Promise.all([
    listNormalizedBills({ includeCancelled: true }),
    getAll("loans"),
    getAll("credits"),
    getAll("stockLots")
  ]);
  const activeBills = state.bills.filter((bill) => bill.status !== "Cancelled");
  const daily = groupSum(activeBills, (bill) => bill.dateISO, (bill) => bill.finalTotal).slice(-30);
  const repayments = state.loans.flatMap((loan) => (loan.payments || []).map((payment) => ({ ...payment, loanNo: loan.loanNo, customerName: loan.customerName })));
  const pendingLoans = state.loans
    .map((loan) => ({ ...loan, status: computedLoanStatus(loan), interestAccrued: calculateLoanInterest(loan) }))
    .filter((loan) => !["Closed", "Void"].includes(loan.status));
  const openDues = state.credits.filter((credit) => credit.status !== "Closed");
  const stockSummary = buildStockSummary();

  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Reports and Charts</h2>
            <p>Simple printable reports computed from bills, loans, dues, and stock.</p>
          </div>
          <button class="button-ghost" type="button" onclick="window.print()">Print Reports</button>
        </div>
        <div class="chart-grid">
          ${chartBox("chart-daily-sales", "Daily Sales Report")}
          ${chartBox("chart-monthly-sales", "Monthly Sales Chart")}
          ${chartBox("chart-yearly-sales", "Yearly Sales Chart")}
          ${chartBox("chart-gold-grams", "Monthly Gold Grams Sold")}
          ${chartBox("chart-silver-grams", "Monthly Silver Grams Sold")}
          ${chartBox("chart-loan-given", "Loan Amount Given Monthly")}
          ${chartBox("chart-loan-pending-recovered", "Loan Pending vs Recovered")}
        </div>
      </section>
      <section class="section-band">
        <h2>Daily Sales Report</h2>
        ${renderTable([
          { label: "Date", render: (row) => formatDate(row.key) },
          { label: "Sales total", render: (row) => formatINR(row.value) }
        ], daily, "No sales found.")}
      </section>
      <section class="section-band">
        <h2>Loan Repayment Report</h2>
        ${renderTable([
          { label: "Date", render: (row) => formatDate(row.dateISO) },
          { label: "Loan no", key: "loanNo" },
          { label: "Customer", key: "customerName" },
          { label: "Amount", render: (row) => formatINR(row.amount) },
          { label: "Principal", render: (row) => formatINR(row.principalComponent || 0) },
          { label: "Interest", render: (row) => formatINR(row.interestComponent || 0) }
        ], sortDescByDate(repayments, "dateISO"), "No loan repayments found.")}
      </section>
      <section class="section-band">
        <h2>Pending Loan Report</h2>
        ${renderTable([
          { label: "Loan no", key: "loanNo" },
          { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
          { label: "Due date", render: (row) => row.dueDateISO ? formatDate(row.dueDateISO) : "-" },
          { label: "Principal", render: (row) => formatINR(row.outstandingPrincipal) },
          { label: "Interest", render: (row) => formatINR(row.interestAccrued) },
          { label: "Status", render: (row) => renderBadge(row.status) }
        ], pendingLoans, "No pending loans.")}
      </section>
      <section class="section-band">
        <h2>Stock Summary Report</h2>
        ${renderTable([
          { label: "Metal", key: "metalType" },
          { label: "Purity", key: "purity" },
          { label: "Category", key: "category" },
          { label: "Gross", render: (row) => formatGm(row.grossWeightGm) },
          { label: "Available", render: (row) => formatGm(row.availableWeightGm) }
        ], stockSummary, "No stock found.")}
      </section>
      <section class="section-band">
        <h2>Due Customer Report</h2>
        ${renderTable([
          { label: "Bill no", key: "billNo" },
          { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
          { label: "Total", render: (row) => formatINR(row.totalAmount) },
          { label: "Paid", render: (row) => formatINR(row.paidAmount) },
          { label: "Balance", render: (row) => formatINR(row.balanceAmount) },
          { label: "Status", render: (row) => renderBadge(row.status) }
        ], openDues, "No open dues.")}
      </section>
    </div>
  `;
  await renderReportsCharts(state);
}

function chartBox(id, title) {
  return `<div class="chart-box"><h3>${title}</h3><canvas id="${id}"></canvas></div>`;
}

function buildStockSummary() {
  const map = new Map();
  state.stockLots.filter((lot) => lot.status !== "Deleted").forEach((lot) => {
    const key = `${lot.metalType}|${lot.purity}|${lot.category}`;
    const row = map.get(key) || {
      metalType: lot.metalType,
      purity: lot.purity,
      category: lot.category,
      grossWeightGm: 0,
      availableWeightGm: 0
    };
    row.grossWeightGm += num(lot.grossWeightGm);
    row.availableWeightGm += num(lot.availableWeightGm);
    map.set(key, row);
  });
  return Array.from(map.values());
}
