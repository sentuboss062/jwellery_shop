import {
  $,
  $$,
  collectForm,
  emptyState,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatINR,
  num,
  openDialog,
  renderBadge,
  renderTable,
  showToast,
  sortDescByDate,
  textMatches
} from "../helpers.js";
import { addCreditPayment, getAll, getByKey, logAudit } from "../data-service.js";

let state = {
  credits: [],
  selectedCredit: null
};

export async function render(container) {
  state.credits = await getAll("credits");
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Credit / Dues</h2>
            <p>Dues are created automatically for credit bills or partial payments.</p>
          </div>
        </div>
        <form id="credit-search" class="form-grid two">
          <label class="field"><span>Search</span><input name="query" placeholder="Name, mobile, bill no"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="credit-table"></div>
      </section>
      <section class="section-band" id="credit-detail"></section>
    </div>
  `;
  $("#credit-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    renderCreditTable(container);
  });
  renderCreditTable(container);
  renderCreditDetail(container);
}

function filteredCredits(container) {
  const filters = collectForm($("#credit-search", container));
  return sortDescByDate(state.credits, "updatedAt")
    .filter((credit) => textMatches(credit, filters.query, ["billNo", "customerName", "customerMobile"]));
}

function renderCreditTable(container) {
  const host = $("#credit-table", container);
  const rows = filteredCredits(container);
  host.innerHTML = renderTable([
    { label: "Bill no", render: (row) => `<strong>${escapeHtml(row.billNo)}</strong><br><span class="muted">${escapeHtml(row.billStore)}</span>` },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Total amount", render: (row) => formatINR(row.totalAmount) },
    { label: "Paid amount", render: (row) => formatINR(row.paidAmount) },
    { label: "Balance", render: (row) => formatINR(row.balanceAmount) },
    { label: "Status", render: (row) => renderBadge(row.status) },
    { label: "Last updated", render: (row) => formatDateTime(row.updatedAt) },
    {
      label: "Actions",
      render: (row) => `
        <div class="row-actions">
          <button class="mini-button" type="button" data-view-credit="${escapeHtml(row.creditId)}">View</button>
          <button class="mini-button" type="button" data-pay-credit="${escapeHtml(row.creditId)}" ${row.status === "Closed" ? "disabled" : ""}>Add Payment</button>
        </div>
      `
    }
  ], rows, "No dues found.");

  $$("[data-view-credit]", host).forEach((button) => button.addEventListener("click", async () => {
    state.selectedCredit = await getByKey("credits", button.dataset.viewCredit);
    renderCreditDetail(container);
  }));
  $$("[data-pay-credit]", host).forEach((button) => button.addEventListener("click", async () => {
    await promptPayment(container, button.dataset.payCredit);
  }));
}

async function promptPayment(container, creditId) {
  const credit = await getByKey("credits", creditId);
  if (!credit) return;
  const result = await openDialog({
    title: "Add due payment",
    message: `Current balance is ${formatINR(credit.balanceAmount)}.`,
    fields: [
      { name: "amount", label: "Payment amount", type: "number", required: true },
      { name: "note", label: "Note", type: "textarea" }
    ],
    confirmText: "Save payment"
  });
  if (!result) return;
  try {
    if (num(result.amount) > num(credit.balanceAmount)) {
      throw new Error("Payment cannot be more than the current balance.");
    }
    state.selectedCredit = await addCreditPayment(creditId, num(result.amount), result.note || "");
    await logAudit("CREDIT_PAYMENT", "Credit", credit.billNo, "Due payment", `${formatINR(num(result.amount))} received.`);
    state.credits = await getAll("credits");
    showToast("Due payment saved.", "success");
    renderCreditTable(container);
    renderCreditDetail(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderCreditDetail(container) {
  const host = $("#credit-detail", container);
  const credit = state.selectedCredit;
  if (!credit) {
    host.innerHTML = emptyState("Open a due record to view payment history.");
    return;
  }
  host.innerHTML = `
    <div class="section-header">
      <div>
        <h2>${escapeHtml(credit.billNo)} due timeline</h2>
        <p>${escapeHtml(credit.customerName)} - ${escapeHtml(credit.customerMobile)}</p>
      </div>
      ${renderBadge(credit.status)}
    </div>
    <div class="cards-grid">
      <div class="metric-card"><small>Total</small><strong>${formatINR(credit.totalAmount)}</strong><span>Bill value</span></div>
      <div class="metric-card"><small>Paid</small><strong>${formatINR(credit.paidAmount)}</strong><span>Including partial payments</span></div>
      <div class="metric-card"><small>Balance</small><strong>${formatINR(credit.balanceAmount)}</strong><span>${credit.status}</span></div>
      <div class="metric-card"><small>Payments</small><strong>${(credit.paymentHistory || []).length}</strong><span>Recorded entries</span></div>
    </div>
    ${(credit.paymentHistory || []).length ? `<ul class="timeline">${credit.paymentHistory.map((payment) => `
      <li><strong>${formatDate(payment.dateISO)}</strong> - ${formatINR(payment.amount)}<br><span class="muted">${escapeHtml(payment.note || "Payment")}</span></li>
    `).join("")}</ul>` : emptyState("No partial payments recorded yet.")}
  `;
}
