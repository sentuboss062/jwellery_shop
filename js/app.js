import { $, collectForm, escapeHtml, requireText, showToast } from "./helpers.js";
import { initializeDataStore, migrateLoanInterestV2, updateSettings, getSettings } from "./data-service.js";
import { setOwnerPassword } from "./security.js";
import { startRouter } from "./router.js";

async function bootstrap() {
  wireShell();
  updateNetworkStatus();
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  await registerServiceWorker();

  const settings = await initializeDataStore();
  await runLoanInterestMigration();
  updateBrand(settings);
  updateOriginWarning(settings);
  if (!settings.ownerPasswordHash) {
    renderFirstRunSetup(settings);
    return;
  }
  await startRouter();
}

async function runLoanInterestMigration() {
  if (localStorage.getItem("loanInterestMigrated_v2")) return;
  await migrateLoanInterestV2();
  localStorage.setItem("loanInterestMigrated_v2", "1");
}

function wireShell() {
  $("#menu-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });
  document.querySelectorAll(".nav-list a").forEach((link) => {
    link.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  });
}

function updateNetworkStatus(message) {
  const node = $("#offline-status");
  if (!node) return;
  if (message) {
    node.textContent = message;
    node.className = "status-pill ready";
    return;
  }
  if (navigator.onLine) {
    node.textContent = "Online";
    node.className = "status-pill ready";
  } else {
    node.textContent = "Offline";
    node.className = "status-pill offline";
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    updateNetworkStatus("No SW support");
    return;
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    updateNetworkStatus("Offline ready");
  } catch (error) {
    console.warn("Service worker registration failed", error);
    updateNetworkStatus(navigator.onLine ? "Online" : "Offline");
  }
}

function updateBrand(settings) {
  $("#brand-shop-name").textContent = settings.shopName || "Jewellery Portal";
}

function updateOriginWarning(settings) {
  const warning = $("#origin-warning");
  if (!warning) return;
  const mismatch = settings.productionOrigin && settings.productionOrigin !== location.origin;
  warning.hidden = !mismatch;
}

function renderFirstRunSetup(settings) {
  $("#page-title").textContent = "First-run Setup";
  $("#page-subtitle").textContent = "Set shop details and owner password before using the portal.";
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.remove("active"));
  const app = $("#app");
  app.innerHTML = `
    <section class="section-band setup-panel">
      <div class="section-header">
        <div>
          <h2>Set up your jewellery shop portal</h2>
          <p>Records are saved in this browser using IndexedDB. Take regular ZIP backups and avoid private browsing.</p>
        </div>
      </div>
      <form id="first-run-form" class="page-grid">
        <div class="form-grid two">
          <label class="field"><span>Shop name</span><input name="shopName" value="${escapeHtml(settings.shopName || "")}" required></label>
          <label class="field"><span>Shop phone</span><input name="shopPhone" value="${escapeHtml(settings.shopPhone || "")}"></label>
          <label class="field full"><span>Shop address</span><textarea name="shopAddress">${escapeHtml(settings.shopAddress || "")}</textarea></label>
          <label class="field"><span>Owner password</span><input name="password" type="password" required></label>
          <label class="field"><span>Confirm password</span><input name="confirm" type="password" required></label>
        </div>
        <div class="notice">
          <strong>Local-only protection</strong>
          <span>The owner password gates destructive actions in this browser. It is not server-grade authentication.</span>
        </div>
        <div class="form-actions">
          <button class="button" type="submit">Finish Setup</button>
        </div>
      </form>
    </section>
  `;
  $("#first-run-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = collectForm(event.currentTarget);
      requireText(data.shopName, "Shop name");
      if (data.password !== data.confirm) throw new Error("Passwords do not match.");
      const next = await updateSettings({
        shopName: data.shopName,
        shopPhone: data.shopPhone,
        shopAddress: data.shopAddress,
        productionOrigin: location.origin
      });
      await setOwnerPassword(data.password);
      updateBrand(await getSettings());
      showToast("Setup complete.", "success");
      await startRouter();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

bootstrap().catch((error) => {
  console.error(error);
  const app = $("#app");
  if (app) {
    app.innerHTML = `<div class="notice danger"><strong>App could not start</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
});
