import { groupSum, monthKey, num, yearKey, waitForGlobal } from "./helpers.js";

const chartRegistry = new Map();

async function getChartCtor() {
  return waitForGlobal("Chart");
}

export function destroyCharts(scope = document) {
  const canvases = Array.from(scope.querySelectorAll("canvas[id]"));
  canvases.forEach((canvas) => {
    const chart = chartRegistry.get(canvas.id);
    if (chart) {
      chart.destroy();
      chartRegistry.delete(canvas.id);
    }
  });
}

export async function createChart(canvasId, config) {
  const Chart = await getChartCtor();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (chartRegistry.has(canvasId)) chartRegistry.get(canvasId).destroy();
  const chart = new Chart(canvas, config);
  chartRegistry.set(canvasId, chart);
  return chart;
}

function barConfig(labels, data, label, color = "#7b4a16") {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: color, borderColor: color, borderWidth: 1 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  };
}

function lineConfig(labels, data, label, color = "#0e6f68") {
  return {
    type: "line",
    data: {
      labels,
      datasets: [{ label, data, borderColor: color, backgroundColor: `${color}22`, tension: 0.25, fill: true }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  };
}

export async function renderReportsCharts({ goldBills, silverBills, loans, credits }) {
  const bills = (arguments[0].bills || [...(goldBills || []), ...(silverBills || [])]).filter((bill) => bill.status !== "Cancelled");
  const dailySales = groupSum(bills, (bill) => bill.dateISO, (bill) => bill.finalTotal).slice(-30);
  const monthlySales = groupSum(bills, (bill) => monthKey(bill.dateISO), (bill) => bill.finalTotal).slice(-18);
  const yearlySales = groupSum(bills, (bill) => yearKey(bill.dateISO), (bill) => bill.finalTotal);
  const monthlyGold = groupSum(bills, (bill) => monthKey(bill.dateISO), (bill) => bill.goldWeightGm || (bill.metalType === "Gold" ? bill.weightGm : 0)).slice(-18);
  const monthlySilver = groupSum(bills, (bill) => monthKey(bill.dateISO), (bill) => bill.silverWeightGm || (bill.metalType === "Silver" ? bill.weightGm : 0)).slice(-18);
  const monthlyLoans = groupSum(loans.filter((loan) => loan.status !== "Void"), (loan) => monthKey(loan.startDateISO), (loan) => loan.loanAmount).slice(-18);
  const loanRecovered = loans.reduce((sum, loan) => sum + (loan.payments || []).reduce((inner, payment) => inner + num(payment.amount), 0), 0);
  const loanPending = loans.filter((loan) => loan.status !== "Closed" && loan.status !== "Void").reduce((sum, loan) => sum + num(loan.outstandingPrincipal), 0);
  const dueBalances = credits.filter((credit) => credit.status !== "Closed").reduce((sum, credit) => sum + num(credit.balanceAmount), 0);

  await createChart("chart-daily-sales", barConfig(dailySales.map((row) => row.key), dailySales.map((row) => row.value), "Daily sales", "#7b4a16"));
  await createChart("chart-monthly-sales", lineConfig(monthlySales.map((row) => row.key), monthlySales.map((row) => row.value), "Monthly revenue", "#0e6f68"));
  await createChart("chart-yearly-sales", barConfig(yearlySales.map((row) => row.key), yearlySales.map((row) => row.value), "Yearly revenue", "#255f9f"));
  await createChart("chart-gold-grams", barConfig(monthlyGold.map((row) => row.key), monthlyGold.map((row) => row.value), "Gold gm sold", "#a96f1f"));
  await createChart("chart-silver-grams", barConfig(monthlySilver.map((row) => row.key), monthlySilver.map((row) => row.value), "Silver gm sold", "#778899"));
  await createChart("chart-loan-given", lineConfig(monthlyLoans.map((row) => row.key), monthlyLoans.map((row) => row.value), "Loan amount given", "#a83232"));
  await createChart("chart-loan-pending-recovered", {
    type: "doughnut",
    data: {
      labels: ["Pending principal", "Recovered payments", "Open customer dues"],
      datasets: [{ data: [loanPending, loanRecovered, dueBalances], backgroundColor: ["#a83232", "#1f7a4d", "#255f9f"] }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}
