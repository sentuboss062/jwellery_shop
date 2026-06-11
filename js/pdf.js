import {
  calculateLoanInterest,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  loanFilename,
  saleFilename,
  waitForGlobal
} from "./helpers.js";

async function getPdfCtor() {
  const jspdf = await waitForGlobal("jspdf");
  return jspdf.jsPDF;
}

function safe(value) {
  return String(value ?? "");
}

function addShopHeader(doc, settings, title, number, dateISO) {
  doc.setFillColor(255, 248, 236);
  doc.rect(0, 0, 210, 36, "F");
  doc.setTextColor(33, 25, 21);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(settings.shopName || "Family Jewellery Shop", 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const address = settings.shopAddress ? `${settings.shopAddress}` : "Shop address not set";
  doc.text(address, 14, 21, { maxWidth: 120 });
  doc.text(`Phone: ${settings.shopPhone || "-"}`, 14, 28);
  if (settings.gstin) doc.text(`GSTIN: ${settings.gstin}`, 68, 28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, 196, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(number, 196, 22, { align: "right" });
  doc.text(formatDate(dateISO), 196, 29, { align: "right" });
  doc.setDrawColor(175, 146, 105);
  doc.line(14, 38, 196, 38);
}

function addWatermark(doc, text) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.12 }));
  doc.setTextColor(168, 50, 50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(44);
  doc.text(text, 105, 150, { align: "center", angle: 35 });
  doc.restoreGraphicsState();
}

function drawRows(doc, startY, rows) {
  let y = startY;
  doc.setFontSize(10);
  rows.forEach(([label, value], index) => {
    const fill = index % 2 === 0;
    if (fill) {
      doc.setFillColor(252, 247, 238);
      doc.rect(14, y - 5, 182, 8, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.text(label, 18, y);
    doc.setFont("helvetica", "normal");
    doc.text(safe(value), 88, y, { maxWidth: 104 });
    y += 8;
  });
  return y;
}

function addFooter(doc, settings) {
  doc.setDrawColor(190, 178, 160);
  doc.line(14, 276, 196, 276);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(settings.printFooterText || "Thank you for your business.", 14, 282, { maxWidth: 115 });
  doc.text("Customer signature", 145, 282);
  doc.line(145, 274, 196, 274);
}

export async function createBillPdfDoc(bill, settings) {
  const JsPDF = await getPdfCtor();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const items = bill.items?.length ? bill.items : null;
  addShopHeader(doc, settings, `${items ? "Jewellery" : bill.metalType || "Jewellery"} Sale Bill`, bill.billNo, bill.dateISO);
  if (bill.status === "Cancelled") addWatermark(doc, "CANCELLED");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Customer", 14, 50);
  doc.text(items ? "Items" : "Item and Pricing", 108, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  drawRows(doc, 60, [
    ["Name", bill.customerName],
    ["Mobile", bill.customerMobile],
    ["Address", bill.customerAddress || "-"],
    ["Payment", bill.paymentMode || "-"],
    ["Status", bill.status || "Active"]
  ]);

  let totalsY = 116;
  if (items) {
    let y = 60;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    ["Metal", "Item", "Purity", "Wt", "Rate", "Making", "GST", "Total"].forEach((label, index) => {
      doc.text(label, [108, 123, 145, 157, 167, 179, 190, 198][index], y, { align: index >= 3 ? "right" : "left" });
    });
    doc.setFont("helvetica", "normal");
    y += 6;
    items.slice(0, 12).forEach((item, index) => {
      if (index % 2 === 0) {
        doc.setFillColor(252, 247, 238);
        doc.rect(106, y - 4, 90, 7, "F");
      }
      doc.text(safe(item.metalType), 108, y);
      doc.text(safe(item.itemName).slice(0, 13), 123, y);
      doc.text(safe(item.purity), 145, y);
      doc.text(String(item.weightGm || 0), 157, y, { align: "right" });
      doc.text(String(item.ratePerGm || 0), 167, y, { align: "right" });
      doc.text(String(item.makingChargePct ?? 0), 179, y, { align: "right" });
      doc.text(String(item.gstPct || 0), 190, y, { align: "right" });
      doc.text(String(item.lineTotal || 0), 198, y, { align: "right" });
      y += 7;
    });
    totalsY = Math.max(122, y + 10);
  } else {
    let y = 60;
    const rightRows = [
      ["Item", bill.itemName],
      ["Category", bill.category],
      ["Metal / Purity", `${bill.metalType} / ${bill.purity}`],
      ["Weight", formatGm(bill.weightGm)],
      ["Rate per gm", formatINR(bill.ratePerGm)]
    ];
    rightRows.forEach(([label, value], index) => {
      if (index % 2 === 0) {
        doc.setFillColor(252, 247, 238);
        doc.rect(108, y - 5, 88, 8, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.text(label, 112, y);
      doc.setFont("helvetica", "normal");
      doc.text(safe(value), 156, y, { maxWidth: 38 });
      y += 8;
    });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Totals", 14, totalsY);
  const exchange = bill.exchangeId ? formatINR(bill.exchangeValue || 0) : "-";
  const totalRows = [
    ["Metal value", formatINR(bill.metalValue ?? ((bill.weightGm || 0) * (bill.ratePerGm || 0)))],
    ["Making charge", formatINR(bill.makingCharge || 0)],
    ["Wastage charge", formatINR(bill.wastageCharge || 0)],
    ["Discount", formatINR(bill.discountAmt || 0)],
    ["Exchange value", exchange],
    ["Subtotal", formatINR(bill.subtotal || 0)],
    [`GST ${bill.gstPct || 0}%`, formatINR(bill.gstAmt || 0)],
    ["Final total", formatINR(bill.finalTotal || 0)],
    ["Paid", formatINR(bill.paidAmount || 0)],
    ["Due", formatINR(bill.dueAmount || 0)]
  ];
  drawRows(doc, totalsY + 10, totalRows);

  if (bill.cancelReason) {
    doc.setTextColor(168, 50, 50);
    doc.text(`Cancel reason: ${bill.cancelReason}`, 14, 214, { maxWidth: 180 });
    doc.setTextColor(33, 25, 21);
  }
  addFooter(doc, settings);
  return doc;
}

export async function billPdfBlob(bill, settings) {
  const doc = await createBillPdfDoc(bill, settings);
  return doc.output("blob");
}

export async function downloadBillPdf(bill, settings) {
  const doc = await createBillPdfDoc(bill, settings);
  doc.save(saleFilename(bill));
}

export async function printBillPdf(bill, settings) {
  const doc = await createBillPdfDoc(bill, settings);
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output("blob"));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export async function createLoanPdfDoc(loan, settings) {
  const JsPDF = await getPdfCtor();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  addShopHeader(doc, settings, "Gold Loan Receipt", loan.loanNo, loan.startDateISO);
  if (loan.status === "Void") addWatermark(doc, "VOID");
  if (loan.status === "Closed") addWatermark(doc, "CLOSED");

  const interest = calculateLoanInterest(loan);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Customer and Loan Details", 14, 52);
  drawRows(doc, 62, [
    ["Customer", loan.customerName],
    ["Mobile", loan.customerMobile],
    ["Address", loan.address || "-"],
    ["Item", loan.itemName],
    ["Gold weight", formatGm(loan.goldWeightGm)],
    ["Purity", loan.goldPurity],
    ["Estimated value", formatINR(loan.estimatedValue)],
    ["Loan amount", formatINR(loan.loanAmount)],
    ["Outstanding", formatINR(loan.outstandingPrincipal)],
    ["Interest accrued", formatINR(interest)],
    ["Interest basis", `${loan.interestRatePct}% - ${loan.interestBasis}`],
    ["Due date", loan.dueDateISO ? formatDate(loan.dueDateISO) : "-"],
    ["Status", loan.status || "Active"],
    ["Returned item", loan.returnItemMarked ? "Yes" : "No"]
  ]);

  doc.setFont("helvetica", "bold");
  doc.text("Payment History", 14, 184);
  doc.setFont("helvetica", "normal");
  const payments = loan.payments || [];
  if (!payments.length) {
    doc.text("No payments recorded.", 14, 194);
  } else {
    let y = 194;
    payments.slice(-8).forEach((payment) => {
      doc.text(`${formatDate(payment.dateISO)} - ${formatINR(payment.amount)} (${payment.note || "payment"})`, 14, y, { maxWidth: 170 });
      y += 7;
    });
  }
  addFooter(doc, settings);
  return doc;
}

export async function loanPdfBlob(loan, settings) {
  const doc = await createLoanPdfDoc(loan, settings);
  return doc.output("blob");
}

export async function downloadLoanPdf(loan, settings) {
  const doc = await createLoanPdfDoc(loan, settings);
  doc.save(loanFilename(loan));
}

export async function printLoanPdf(loan, settings) {
  const doc = await createLoanPdfDoc(loan, settings);
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output("blob"));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export async function stockSummaryPdfBlob(summary, settings) {
  const JsPDF = await getPdfCtor();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  addShopHeader(doc, settings, "Stock Summary", "Current Stock", new Date().toISOString());
  let y = 54;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", 14, y);
  y += 10;
  const rows = summary.map((row) => [
    `${row.metalType} / ${row.purity} / ${row.category}`,
    `${formatGm(row.availableWeightGm)} available from ${formatGm(row.grossWeightGm)} gross`
  ]);
  drawRows(doc, y, rows);
  addFooter(doc, settings);
  return doc.output("blob");
}
