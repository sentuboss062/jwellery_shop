import {
  calculateLoanInterest,
  displayPurity,
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

function addBillFooter(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(190, 178, 160);
    doc.line(15, 282, 195, 282);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Thank you for your purchase!", 15, 287);
    doc.text("कृपया पुनः पधारें", 105, 287, { align: "center" });
    doc.text(`Page ${page} of ${pages}`, 195, 287, { align: "right" });
  }
}

export async function createBillPdfDoc(bill, settings) {
  const JsPDF = await getPdfCtor();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const items = bill.items?.length ? bill.items : [{
    lineNo: 1,
    itemName: bill.itemName,
    metalType: bill.metalType,
    purity: bill.purity,
    weightGm: bill.weightGm,
    netWeightGm: bill.weightGm,
    ratePerGm: bill.ratePerGm,
    makingChargePct: bill.makingChargePct || 0,
    makingChargeRs: bill.makingChargeRs || 0,
    gstPct: bill.gstPct,
    lineTotal: bill.finalTotal
  }];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(settings.shopName || "Family Jewellery Shop", 105, 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${settings.shopAddress || ""} ${settings.shopPhone ? `| Phone: ${settings.shopPhone}` : ""}`, 105, 25, { align: "center", maxWidth: 170 });
  if (settings.gstin) doc.text(`GSTIN: ${settings.gstin}`, 105, 31, { align: "center" });
  doc.setDrawColor(175, 146, 105);
  doc.line(15, 36, 195, 36);
  if (bill.status === "Cancelled") addWatermark(doc, "CANCELLED");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Bill No", 15, 46);
  doc.text("Date", 108, 46);
  doc.text("Customer", 15, 54);
  doc.text("Phone", 108, 54);
  doc.setFont("helvetica", "normal");
  doc.text(bill.billNo, 38, 46);
  doc.text(formatDate(bill.dateISO), 125, 46);
  doc.text(bill.customerName || "-", 38, 54);
  doc.text(bill.customerMobile || "-", 125, 54);

  let y = 68;
  const columns = ["#", "Item", "Metal", "Purity", "Gross", "Net", "Rate/g", "Making %", "Making Rs", "GST%", "Amount"];
  const xs = [16, 23, 56, 73, 91, 106, 121, 139, 158, 176, 194];
  doc.setFillColor(249, 245, 238);
  doc.rect(15, y - 5, 180, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  columns.forEach((label, index) => doc.text(label, xs[index], y, { align: index >= 4 ? "right" : "left" }));
  y += 8;
  doc.setFont("helvetica", "normal");
  items.forEach((item, index) => {
    if (y > 260) {
      doc.addPage();
      y = 25;
    }
    if (index % 2 === 0) {
      doc.setFillColor(249, 245, 238);
      doc.rect(15, y - 5, 180, 8, "F");
    }
    const row = [
      String(index + 1),
      safe(item.itemName).slice(0, 17),
      safe(item.metalType),
      item.metalType === "Silver" ? "-" : displayPurity(item.purity, item.metalType),
      String(item.weightGm || 0),
      String(item.netWeightGm || item.weightGm || 0),
      String(item.ratePerGm || 0),
      String(item.makingChargePct ?? item.makingChargePercent ?? 0),
      String(item.makingChargeRs || 0),
      String(item.gstPct || 0),
      String(item.lineTotal || 0)
    ];
    row.forEach((value, colIndex) => doc.text(value, xs[colIndex], y, { align: colIndex >= 4 ? "right" : "left", maxWidth: colIndex === 1 ? 30 : undefined }));
    y += 8;
  });

  y += 8;
  if (y > 240) {
    doc.addPage();
    y = 25;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Totals", 135, y);
  y += 7;
  const makingTotal = items.reduce((sum, item) => sum + (Number(item.makingCharge || 0) + Number(item.makingChargeRs || 0)), 0);
  const totalRows = [
    ["Subtotal", formatINR(bill.subtotal || 0)],
    ["Total making charges", formatINR(makingTotal || bill.makingCharge || 0)],
    ["GST amount", formatINR(bill.gstAmt || 0)],
    ...(bill.exchangeValue ? [["Old Exchange Deduction", formatINR(bill.exchangeValue)]] : []),
    ["Net payable", formatINR(bill.finalTotal || 0)],
    ["Paid amount", formatINR(bill.paidAmount || 0)],
    ["Due amount", formatINR(bill.dueAmount || 0)]
  ];
  doc.setFont("helvetica", "normal");
  totalRows.forEach(([label, value]) => {
    doc.text(label, 135, y);
    doc.text(value, 195, y, { align: "right" });
    y += 7;
  });

  if (bill.cancelReason) {
    doc.setTextColor(168, 50, 50);
    doc.text(`Cancel reason: ${bill.cancelReason}`, 14, 214, { maxWidth: 180 });
    doc.setTextColor(33, 25, 21);
  }
  addBillFooter(doc);
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

export async function downloadExchangeReportPdf(entries) {
  const JsPDF = await getPdfCtor();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Old Exchange Report", 105, 18, { align: "center" });
  doc.setDrawColor(175, 146, 105);
  doc.line(15, 25, 195, 25);
  let y = 36;
  doc.setFontSize(8);
  doc.text("Date", 15, y);
  doc.text("Customer", 35, y);
  doc.text("Metal", 80, y);
  doc.text("Item", 100, y);
  doc.text("Gross", 142, y, { align: "right" });
  doc.text("Value", 195, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  entries.forEach((entry, index) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    if (index % 2 === 0) {
      doc.setFillColor(249, 245, 238);
      doc.rect(15, y - 4, 180, 7, "F");
    }
    doc.text(formatDate(entry.dateISO), 15, y);
    doc.text(safe(entry.customerName).slice(0, 24), 35, y);
    doc.text(safe(entry.oldMetalType), 80, y);
    doc.text(safe(entry.oldItemName).slice(0, 24), 100, y);
    doc.text(String(entry.oldWeightGm || 0), 142, y, { align: "right" });
    doc.text(String(entry.netExchangeValue || 0), 195, y, { align: "right" });
    y += 7;
  });
  addBillFooter(doc);
  doc.save(`OLD-EXCHANGE-REPORT-${new Date().toISOString().slice(0, 10)}.pdf`);
}
