import {
  $,
  $$,
  calculateLoanInterest,
  collectForm,
  computedLoanStatus,
  deriveFinancialYear,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  isValidMobile,
  normalizeMobile,
  num,
  openDialog,
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
  addLoanPayment,
  addRecord,
  getAll,
  getByKey,
  getSettings,
  logAudit,
  nextId,
  putRecord,
  upsertCustomer
} from "../data-service.js";
import { downloadLoanPdf, printLoanPdf } from "../pdf.js";
import { ensureOwnerPassword } from "../security.js";

let state = {
  settings: null,
  loans: [],
  activeLoan: null,
  editingLoan: null
};

export async function render(container) {
  state.settings = await getSettings();
  state.loans = await getAll("loans");
  const loanNo = await nextId("loans", state.settings.loanPrefix || "L", todayInputValue());
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Gold Loans</h2>
            <p>Create loans, collect repayments, print receipts, and track pledged item return.</p>
          </div>
        </div>
        <form id="loan-form" class="page-grid" autocomplete="off">
          ${renderLoanForm(loanNo)}
          <div class="form-actions">
            <button class="button" type="submit">Save Loan</button>
            <button class="button-secondary" type="button" data-print-loan>Print Receipt</button>
            <button class="button-secondary" type="button" data-download-loan>Download PDF</button>
            <button class="button-ghost" type="button" data-clear-loan>Clear</button>
          </div>
        </form>
      </section>
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Loan History</h2>
            <p>Interest is calculated on current outstanding amount.</p>
          </div>
        </div>
        <form id="loan-search" class="form-grid">
          <label class="field"><span>Search</span><input name="query" placeholder="Name, mobile, item, loan no"></label>
          <label class="field"><span>From date</span><input name="from" type="date"></label>
          <label class="field"><span>To date</span><input name="to" type="date"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="loan-history"></div>
      </section>
      <section class="section-band" id="loan-detail"></section>
    </div>
  `;
  wireLoanForm(container);
  renderLoanHistory(container);
  renderLoanDetail(container);
}

function renderLoanForm(loanNo) {
  return `
    <div class="form-grid">
      <label class="field"><span>Loan no</span><input class="readonly-input" name="loanNo" value="${escapeHtml(loanNo)}" readonly></label>
      <label class="field"><span>Customer name</span><input name="customerName" required></label>
      <label class="field"><span>Customer mobile</span><input name="customerMobile" inputmode="numeric" maxlength="10" required></label>
      <label class="field"><span>Status</span><input class="readonly-input" name="status" value="Active" readonly></label>
      <label class="field full"><span>Address</span><textarea name="address"></textarea></label>
      <label class="field"><span>Item name</span><input name="itemName" required></label>
      <label class="field"><span>Gold weight gm</span><input name="goldWeightGm" type="number" min="0.001" step="0.001" required></label>
      <label class="field"><span>Gold purity</span><input name="goldPurity" required placeholder="22K"></label>
      <label class="field"><span>Estimated value</span><input name="estimatedValue" type="number" min="0.01" step="0.01" required></label>
      <label class="field"><span>Loan amount</span><input name="loanAmount" type="number" min="0.01" step="0.01" required></label>
      <label class="field"><span>Interest rate %</span><input name="interestRatePct" type="number" min="0" step="0.01" required></label>
      <label class="field"><span>Interest basis</span><select name="interestBasis"><option>Monthly Simple</option><option>Daily Simple</option></select></label>
      <label class="field"><span>Start date</span><input name="startDateISO" type="date" value="${todayInputValue()}" required></label>
      <label class="field"><span>Due date</span><input name="dueDateISO" type="date"></label>
      <label class="field full"><span>Notes</span><textarea name="notes"></textarea></label>
    </div>
  `;
}

function wireLoanForm(container) {
  const form = $("#loan-form", container);
  form.addEventListener("input", (event) => {
    if (event.target.name === "customerMobile") {
      event.target.value = normalizeMobile(event.target.value).slice(0, 10);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveLoan(container);
  });
  $("#loan-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    renderLoanHistory(container);
  });
  $("[data-clear-loan]", container).addEventListener("click", async () => {
    state.activeLoan = null;
    state.editingLoan = null;
    await render(container);
  });
  $("[data-print-loan]", container).addEventListener("click", async () => {
    if (!state.activeLoan) {
      showToast("Save or open a loan first.", "error");
      return;
    }
    await printLoanPdf(state.activeLoan, state.settings);
  });
  $("[data-download-loan]", container).addEventListener("click", async () => {
    if (!state.activeLoan) {
      showToast("Save or open a loan first.", "error");
      return;
    }
    await downloadLoanPdf(state.activeLoan, state.settings);
  });
}

function validateLoan(data) {
  requireText(data.customerName, "Customer name");
  if (!isValidMobile(data.customerMobile)) throw new Error("Customer mobile must be exactly 10 digits.");
  requireText(data.itemName, "Item name");
  requirePositive(data.goldWeightGm, "Gold weight");
  requireText(data.goldPurity, "Gold purity");
  requirePositive(data.estimatedValue, "Estimated value");
  requirePositive(data.loanAmount, "Loan amount");
  requireNonNegative(data.interestRatePct, "Interest rate");
  requireText(data.startDateISO, "Start date");
}

async function saveLoan(container) {
  const form = $("#loan-form", container);
  const data = collectForm(form);
  data.customerMobile = normalizeMobile(data.customerMobile);
  try {
    validateLoan(data);
    let approval = null;
    if (data.dueDateISO && data.dueDateISO < data.startDateISO) {
      approval = await ensureOwnerPassword("Confirm loan due date", {
        message: "Due date is before start date. Owner approval is required to save this loan.",
        confirmText: "Confirm date",
        danger: true
      });
      if (!approval) return;
    }
    const existing = await getByKey("loans", data.loanNo);
    if (existing && !state.editingLoan) throw new Error("Duplicate loan number. Clear the form and try again.");
    if (state.editingLoan && computedLoanStatus(state.editingLoan) === "Closed") {
      approval = await ensureOwnerPassword("Edit closed loan", {
        message: "Closed loan edits require owner approval and an audit reason.",
        confirmText: "Save edit",
        danger: true
      });
      if (!approval) return;
    }
    const now = new Date().toISOString();
    const loan = {
      loanNo: data.loanNo,
      customerName: data.customerName,
      customerMobile: data.customerMobile,
      address: data.address || "",
      itemName: data.itemName,
      goldWeightGm: num(data.goldWeightGm),
      goldPurity: data.goldPurity,
      estimatedValue: num(data.estimatedValue),
      loanAmount: num(data.loanAmount),
      interestRatePct: num(data.interestRatePct),
      interestBasis: data.interestBasis,
      startDateISO: data.startDateISO,
      dueDateISO: data.dueDateISO || "",
      status: state.editingLoan?.status || "Active",
      notes: data.notes || "",
      payments: state.editingLoan?.payments || [],
      outstandingPrincipal: state.editingLoan ? num(state.editingLoan.outstandingPrincipal) : num(data.loanAmount),
      interestAccrued: 0,
      closureDateISO: state.editingLoan?.closureDateISO || "",
      returnItemMarked: state.editingLoan?.returnItemMarked || false,
      createdAt: state.editingLoan?.createdAt || now,
      updatedAt: now
    };
    loan.status = computedLoanStatus(loan);
    loan.interestAccrued = calculateLoanInterest(loan);
    if (state.editingLoan) {
      await putRecord("loans", loan);
    } else {
      await addRecord("loans", loan);
    }
    await upsertCustomer({
      customerName: loan.customerName,
      customerMobile: loan.customerMobile,
      customerAddress: loan.address
    });
    await logAudit(state.editingLoan ? "LOAN_EDIT" : "LOAN_CREATE", "Loan", loan.loanNo, approval?.reason || "Loan saved", `${loan.customerName} loan ${loan.loanNo}`);
    state.activeLoan = loan;
    state.editingLoan = null;
    state.loans = await getAll("loans");
    showToast("Loan saved.", "success");
    renderLoanHistory(container);
    renderLoanDetail(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function filteredLoans(container) {
  const filters = collectForm($("#loan-search", container));
  return sortDescByDate(state.loans, "startDateISO")
    .filter((loan) => textMatches(loan, filters.query, ["loanNo", "customerName", "customerMobile", "itemName"]))
    .filter((loan) => withinDateRange(loan.startDateISO, filters.from, filters.to));
}

function renderLoanHistory(container) {
  const host = $("#loan-history", container);
  const rows = filteredLoans(container).map((loan) => ({ ...loan, status: computedLoanStatus(loan), interestAccrued: calculateLoanInterest(loan) }));
  host.innerHTML = renderTable([
    { label: "Loan no", render: (row) => `<strong>${escapeHtml(row.loanNo)}</strong><br><span class="muted">${formatDate(row.startDateISO)}</span>` },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Item", render: (row) => `${escapeHtml(row.itemName)}<br><span class="muted">${escapeHtml(row.goldPurity)} ${formatGm(row.goldWeightGm)}</span>` },
    { label: "Loan", render: (row) => formatINR(row.loanAmount) },
    { label: "Outstanding", render: (row) => `${formatINR(row.outstandingPrincipal)}<br><span class="muted">Interest ${formatINR(row.interestAccrued)}</span>` },
    { label: "Due", render: (row) => row.dueDateISO ? formatDate(row.dueDateISO) : "-" },
    { label: "Status", render: (row) => renderBadge(row.status) },
    {
      label: "Actions",
      render: (row) => `
        <div class="row-actions">
          <button class="mini-button" type="button" data-open-loan="${escapeHtml(row.loanNo)}">Open</button>
          <button class="mini-button" type="button" data-loan-pay="${escapeHtml(row.loanNo)}" ${["Closed", "Void"].includes(row.status) ? "disabled" : ""}>Pay</button>
          <button class="mini-button" type="button" data-loan-close="${escapeHtml(row.loanNo)}" ${["Closed", "Void"].includes(row.status) ? "disabled" : ""}>Full</button>
          <button class="mini-button" type="button" data-loan-pdf="${escapeHtml(row.loanNo)}">PDF</button>
          <button class="mini-button" type="button" data-loan-void="${escapeHtml(row.loanNo)}" ${row.status === "Void" ? "disabled" : ""}>Void</button>
        </div>
      `
    }
  ], rows, "No loans found.");
  wireLoanRows(container, host);
}

function wireLoanRows(container, host) {
  $$("[data-open-loan]", host).forEach((button) => button.addEventListener("click", async () => {
    const loan = await getByKey("loans", button.dataset.openLoan);
    state.activeLoan = loan;
    state.editingLoan = loan;
    fillLoanForm(container, loan);
    renderLoanDetail(container);
  }));
  $$("[data-loan-pay]", host).forEach((button) => button.addEventListener("click", async () => promptLoanPayment(container, button.dataset.loanPay, false)));
  $$("[data-loan-close]", host).forEach((button) => button.addEventListener("click", async () => promptLoanPayment(container, button.dataset.loanClose, true)));
  $$("[data-loan-pdf]", host).forEach((button) => button.addEventListener("click", async () => {
    const loan = await getByKey("loans", button.dataset.loanPdf);
    if (loan) await downloadLoanPdf({ ...loan, status: computedLoanStatus(loan), interestAccrued: calculateLoanInterest(loan) }, state.settings);
  }));
  $$("[data-loan-void]", host).forEach((button) => button.addEventListener("click", async () => voidLoan(container, button.dataset.loanVoid)));
}

function fillLoanForm(container, loan) {
  const form = $("#loan-form", container);
  Object.entries({
    loanNo: loan.loanNo,
    customerName: loan.customerName,
    customerMobile: loan.customerMobile,
    address: loan.address || "",
    itemName: loan.itemName,
    goldWeightGm: loan.goldWeightGm,
    goldPurity: loan.goldPurity,
    estimatedValue: loan.estimatedValue,
    loanAmount: loan.loanAmount,
    interestRatePct: loan.interestRatePct,
    interestBasis: loan.interestBasis,
    startDateISO: loan.startDateISO,
    dueDateISO: loan.dueDateISO || "",
    status: computedLoanStatus(loan),
    notes: loan.notes || ""
  }).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function promptLoanPayment(container, loanNo, closeFull) {
  const loan = await getByKey("loans", loanNo);
  if (!loan) return;
  const interest = calculateLoanInterest(loan);
  const totalDue = num(loan.outstandingPrincipal) + interest;
  const result = await openDialog({
    title: closeFull ? "Full repayment" : "Partial repayment",
    message: `Current principal plus interest is ${formatINR(totalDue)}.`,
    fields: [
      { name: "amount", label: "Payment amount", type: "number", value: closeFull ? totalDue : "", required: true },
      { name: "note", label: "Note", type: "textarea" }
    ],
    confirmText: "Save payment"
  });
  if (!result) return;
  try {
    const updated = await addLoanPayment(loanNo, num(result.amount), result.note || "", closeFull);
    await logAudit(closeFull ? "LOAN_FULL_REPAYMENT" : "LOAN_PARTIAL_REPAYMENT", "Loan", loanNo, "Repayment", `${formatINR(num(result.amount))} received.`);
    state.activeLoan = updated;
    state.loans = await getAll("loans");
    showToast("Loan payment saved.", "success");
    renderLoanHistory(container);
    renderLoanDetail(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function voidLoan(container, loanNo) {
  const loan = await getByKey("loans", loanNo);
  if (!loan) return;
  try {
    const approval = await ensureOwnerPassword("Void loan", {
      message: "Voiding keeps the loan visible but removes it from active pending counts.",
      confirmText: "Void loan",
      danger: true
    });
    if (!approval) return;
    const updated = {
      ...loan,
      status: "Void",
      voidReason: approval.reason,
      updatedAt: new Date().toISOString()
    };
    await putRecord("loans", updated);
    await logAudit("LOAN_VOID", "Loan", loanNo, approval.reason, `Loan ${loanNo} voided.`);
    state.activeLoan = updated;
    state.loans = await getAll("loans");
    showToast("Loan voided.", "success");
    renderLoanHistory(container);
    renderLoanDetail(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderLoanDetail(container) {
  const host = $("#loan-detail", container);
  const loan = state.activeLoan;
  if (!loan) {
    host.innerHTML = "";
    return;
  }
  const status = computedLoanStatus(loan);
  const interest = calculateLoanInterest(loan);
  host.innerHTML = `
    <div class="section-header">
      <div>
        <h2>${escapeHtml(loan.loanNo)} - ${escapeHtml(loan.customerName)}</h2>
        <p>${escapeHtml(loan.itemName)} | ${formatGm(loan.goldWeightGm)} | ${renderBadge(status)}</p>
      </div>
      <button class="button-secondary" type="button" data-return-item ${status !== "Closed" || loan.returnItemMarked ? "disabled" : ""}>Mark Returned Item</button>
    </div>
    <div class="cards-grid">
      <div class="metric-card"><small>Loan amount</small><strong>${formatINR(loan.loanAmount)}</strong><span>Issued ${formatDate(loan.startDateISO)}</span></div>
      <div class="metric-card"><small>Outstanding principal</small><strong>${formatINR(loan.outstandingPrincipal)}</strong><span>Before current interest</span></div>
      <div class="metric-card"><small>Interest accrued</small><strong>${formatINR(interest)}</strong><span>${escapeHtml(loan.interestBasis)}</span></div>
      <div class="metric-card"><small>Item returned</small><strong>${loan.returnItemMarked ? "Yes" : "No"}</strong><span>${loan.closureDateISO ? `Closed ${formatDate(loan.closureDateISO)}` : "Loan not closed"}</span></div>
    </div>
    <h3>Payment History</h3>
    ${(loan.payments || []).length ? `<ul class="timeline">${loan.payments.map((payment) => `
      <li><strong>${formatDate(payment.dateISO)}</strong> - ${formatINR(payment.amount)}<br><span class="muted">Principal ${formatINR(payment.principalComponent || 0)}, interest ${formatINR(payment.interestComponent || 0)} ${payment.note ? `- ${escapeHtml(payment.note)}` : ""}</span></li>
    `).join("")}</ul>` : emptyState("No loan payments recorded.")}
  `;
  $("[data-return-item]", host)?.addEventListener("click", async () => {
    const updated = { ...loan, returnItemMarked: true, updatedAt: new Date().toISOString() };
    await putRecord("loans", updated);
    await logAudit("LOAN_ITEM_RETURNED", "Loan", loan.loanNo, "Closed loan item returned", `Pledged item returned for ${loan.loanNo}.`);
    state.activeLoan = updated;
    state.loans = await getAll("loans");
    showToast("Returned item marked.", "success");
    renderLoanDetail(container);
  });
}
