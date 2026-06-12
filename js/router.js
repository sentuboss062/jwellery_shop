import { $, escapeHtml, showToast } from "./helpers.js";
import { destroyCharts } from "./charts.js";

const routes = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Today, stock, loans, dues, backups, and storage health.",
    load: () => import("./modules/dashboard.js")
  },
  "/billing": {
    title: "Combined Billing",
    subtitle: "One invoice with multiple gold and silver line items.",
    load: () => import("./modules/billing.js")
  },
  "/stock": {
    title: "Stock",
    subtitle: "Purchase lots, current stock, summaries, and adjustments.",
    load: () => import("./modules/stock.js")
  },
  "/customers": {
    title: "Customers",
    subtitle: "Search customer profiles and derived transaction history.",
    load: () => import("./modules/customers.js")
  },
  "/loans": {
    title: "Gold Loans",
    subtitle: "Loan receipts, interest, repayments, closures, and pledged item return.",
    load: () => import("./modules/loans.js")
  },
  "/exchange": {
    title: "Old Jewellery Exchange",
    subtitle: "Search old jewellery exchange entries created during billing.",
    load: () => import("./modules/exchange.js")
  },
  "/credits": {
    title: "Credit / Dues",
    subtitle: "Open balances, partial payments, and due timelines.",
    load: () => import("./modules/credits.js")
  },
  "/reports": {
    title: "Reports",
    subtitle: "Sales, stock, loans, dues, and readable charts.",
    load: () => import("./modules/reports.js")
  },
  "/audit-log": {
    title: "Audit Log",
    subtitle: "All recorded changes and protected actions.",
    load: () => import("./modules/audit-log.js")
  },
  "/backup": {
    title: "Backup / Restore",
    subtitle: "Full ZIP export, JSON export, and owner-approved restore.",
    load: async () => {
      const module = await import("./modules/settings.js");
      return { render: module.renderBackup };
    }
  },
  "/settings": {
    title: "Settings",
    subtitle: "Shop details, owner password, storage, audit log, and reset.",
    load: () => import("./modules/settings.js")
  }
};

function currentRoute() {
  const route = location.hash.replace(/^#/, "") || "/dashboard";
  return routes[route] ? route : "/dashboard";
}

export function navigate(route) {
  location.hash = `#${route}`;
}

export async function renderRoute() {
  const route = currentRoute();
  const config = routes[route];
  const app = $("#app");
  if (!app) return;
  destroyCharts(app);
  document.title = `${config.title} - Jewellery Shop Portal`;
  $("#page-title").textContent = config.title;
  $("#page-subtitle").textContent = config.subtitle;
  document.body.classList.remove("sidebar-open");
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
  app.innerHTML = `
    <div class="loading-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p>Loading ${escapeHtml(config.title)}...</p>
    </div>
  `;
  try {
    const module = await config.load();
    await module.render(app);
    app.focus({ preventScroll: true });
  } catch (error) {
    app.innerHTML = `<div class="notice danger"><strong>Screen failed to load</strong><span>${escapeHtml(error.message)}</span></div>`;
    showToast(error.message, "error");
  }
}

export function startRouter() {
  if (!location.hash) {
    history.replaceState(null, "", "#/dashboard");
  }
  window.addEventListener("hashchange", renderRoute);
  return renderRoute();
}
