import {
  $,
  $$,
  collectForm,
  emptyState,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  num,
  renderBadge,
  renderTable,
  sortDescByDate,
  textMatches
} from "../helpers.js";
import { computedLoanStatus } from "../helpers.js";
import { getAll, listNormalizedBills } from "../data-service.js";

let state = {
  customers: [],
  bills: [],
  loans: [],
  credits: [],
  selectedMobile: ""
};

export async function render(container) {
  [state.customers, state.bills, state.loans, state.credits] = await Promise.all([
    getAll("customers"),
    listNormalizedBills({ includeCancelled: true }),
    getAll("loans"),
    getAll("credits")
  ]);
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Customers</h2>
            <p>Customer history is calculated from bills, loans, and dues.</p>
          </div>
        </div>
        <form id="customer-search" class="form-grid two">
          <label class="field"><span>Search by name or mobile</span><input name="query" placeholder="Customer name or 10-digit mobile"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="customers-table"></div>
      </section>
      <section class="section-band" id="customer-detail">
        ${emptyState("Open a customer to view profile, purchases, loans, and dues.")}
      </section>
    </div>
  `;
  $("#customer-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    renderCustomersTable(container);
  });
  renderCustomersTable(container);
}

function customerStats(customer) {
  const mobile = customer.mobile;
  const purchases = state.bills.filter((bill) => bill.customerMobile === mobile);
  const loans = state.loans.filter((loan) => loan.customerMobile === mobile);
  const credits = state.credits.filter((credit) => credit.customerMobile === mobile);
  const lastDates = [
    ...purchases.map((bill) => bill.dateISO),
    ...loans.map((loan) => loan.startDateISO),
    ...credits.map((credit) => credit.updatedAt || credit.createdAt)
  ].filter(Boolean).sort();
  return {
    purchases,
    loans,
    credits,
    lastTransactionDate: lastDates.at(-1) || "",
    pendingDue: credits.filter((credit) => credit.status !== "Closed").reduce((sum, credit) => sum + num(credit.balanceAmount), 0),
    activeLoanCount: loans.filter((loan) => !["Closed", "Void"].includes(computedLoanStatus(loan))).length
  };
}

function filteredCustomers(container) {
  const filters = collectForm($("#customer-search", container));
  return state.customers
    .filter((customer) => textMatches(customer, filters.query, ["name", "mobile"]))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderCustomersTable(container) {
  const host = $("#customers-table", container);
  const rows = filteredCustomers(container);
  host.innerHTML = renderTable([
    { label: "Name", render: (row) => `<strong>${escapeHtml(row.name)}</strong>` },
    { label: "Mobile", key: "mobile" },
    { label: "Address", render: (row) => escapeHtml(row.address || "-") },
    { label: "ID proof", render: (row) => escapeHtml(row.idProofNo || "-") },
    { label: "Last transaction", render: (row) => formatDate(customerStats(row).lastTransactionDate) },
    { label: "Pending due", render: (row) => formatINR(customerStats(row).pendingDue) },
    { label: "Active loans", render: (row) => customerStats(row).activeLoanCount },
    { label: "Action", render: (row) => `<button class="mini-button" type="button" data-view="${escapeHtml(row.mobile)}">View</button>` }
  ], rows, "No customers found.");
  $$("[data-view]", host).forEach((button) => button.addEventListener("click", () => {
    state.selectedMobile = button.dataset.view;
    renderCustomerDetail(container);
  }));
}

function renderCustomerDetail(container) {
  const customer = state.customers.find((item) => item.mobile === state.selectedMobile);
  const host = $("#customer-detail", container);
  if (!customer) {
    host.innerHTML = emptyState("Customer not found.");
    return;
  }
  const stats = customerStats(customer);
  const activePurchases = stats.purchases.filter((bill) => bill.status !== "Cancelled");
  const totalPurchase = activePurchases.reduce((sum, bill) => sum + num(bill.finalTotal), 0);
  const totalGold = activePurchases.reduce((sum, bill) => sum + num(bill.goldWeightGm || (bill.metalType === "Gold" ? bill.weightGm : 0)), 0);
  const totalSilver = activePurchases.reduce((sum, bill) => sum + num(bill.silverWeightGm || (bill.metalType === "Silver" ? bill.weightGm : 0)), 0);
  host.innerHTML = `
    <div class="section-header">
      <div>
        <h2>${escapeHtml(customer.name)}</h2>
        <p>${escapeHtml(customer.mobile)} ${customer.address ? `- ${escapeHtml(customer.address)}` : ""}</p>
      </div>
    </div>
    <div class="cards-grid">
      <div class="metric-card"><small>Total purchase</small><strong>${formatINR(totalPurchase)}</strong><span>Cancelled bills excluded</span></div>
      <div class="metric-card"><small>Gold purchased</small><strong>${formatGm(totalGold)}</strong><span>Active bills</span></div>
      <div class="metric-card"><small>Silver purchased</small><strong>${formatGm(totalSilver)}</strong><span>Active bills</span></div>
      <div class="metric-card"><small>Pending due</small><strong>${formatINR(stats.pendingDue)}</strong><span>Open credit records</span></div>
    </div>
    <div class="page-grid">
      <section>
        <h3>Purchase History</h3>
        ${renderTable([
          { label: "Bill", render: (row) => `<strong>${escapeHtml(row.billNo)}</strong><br>${renderBadge(row.status)}` },
          { label: "Date", render: (row) => formatDate(row.dateISO) },
          { label: "Metal", render: (row) => row.items?.length > 1 ? `Mixed<br><span class="muted">${row.items.length} items</span>` : `${escapeHtml(row.metalType)} ${escapeHtml(row.purity || "")}` },
          { label: "Item", render: (row) => escapeHtml(row.itemName) },
          { label: "Weight", render: (row) => formatGm(row.weightGm) },
          { label: "Total", render: (row) => formatINR(row.finalTotal) },
          { label: "Due", render: (row) => formatINR(row.dueAmount) }
        ], sortDescByDate(stats.purchases, "dateISO"), "No purchases for this customer.")}
      </section>
      <section>
        <h3>Loan History</h3>
        ${renderTable([
          { label: "Loan", key: "loanNo" },
          { label: "Date", render: (row) => formatDate(row.startDateISO) },
          { label: "Item", key: "itemName" },
          { label: "Weight", render: (row) => formatGm(row.goldWeightGm) },
          { label: "Loan amount", render: (row) => formatINR(row.loanAmount) },
          { label: "Outstanding", render: (row) => formatINR(row.outstandingPrincipal) },
          { label: "Status", render: (row) => renderBadge(computedLoanStatus(row)) }
        ], sortDescByDate(stats.loans, "startDateISO"), "No loans for this customer.")}
      </section>
      <section>
        <h3>Due History</h3>
        ${renderTable([
          { label: "Bill", key: "billNo" },
          { label: "Total", render: (row) => formatINR(row.totalAmount) },
          { label: "Paid", render: (row) => formatINR(row.paidAmount) },
          { label: "Balance", render: (row) => formatINR(row.balanceAmount) },
          { label: "Status", render: (row) => renderBadge(row.status) }
        ], sortDescByDate(stats.credits, "updatedAt"), "No dues for this customer.")}
      </section>
    </div>
  `;
}
