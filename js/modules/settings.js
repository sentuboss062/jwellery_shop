import {
  $,
  $$,
  collectForm,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatINR,
  num,
  openDialog,
  readFileAsDataUrl,
  renderTable,
  requireNonNegative,
  requireText,
  showToast,
  sortDescByDate,
  todayInputValue
} from "../helpers.js";
import {
  getAll,
  getActiveShopId,
  getSettings,
  logAudit,
  resetAllData,
  saveRate,
  setActiveShopId,
  updateSettings
} from "../data-service.js";
import { createSupabaseCloudBackup, exportFullZip, exportJsonOnly, getSupabaseCloudBackups, restoreBackupFromFile } from "../backup.js";
import { requestPersistentStorage, getStorageHealth, renderStorageCard } from "../storage-health.js";
import { ensureOwnerPassword, setOwnerPassword } from "../security.js";

export async function render(container) {
  const activeShopId = getActiveShopId();
  const [settings, auditLog, health] = await Promise.all([
    getSettings(),
    getAll("auditLog"),
    getStorageHealth()
  ]);
  const originMismatch = settings.productionOrigin && settings.productionOrigin !== location.origin;
  container.innerHTML = `
    <div class="page-grid">
      ${originMismatch ? `<div class="notice danger"><strong>You are running under a different origin. Browser data may not match your production data.</strong><span>Stored origin: ${escapeHtml(settings.productionOrigin)}. Current origin: ${escapeHtml(location.origin)}.</span></div>` : ""}
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Shop Settings</h2>
            <p>Basic bill details, active shop identity, owner password, and print footer.</p>
          </div>
        </div>
        <form id="shop-context-form" class="form-grid">
          <label class="field"><span>Active shop ID</span><input name="shopId" value="${escapeHtml(activeShopId)}" required></label>
          <label class="field"><span>Shop user / login label</span><input name="shopUserLabel" value="${escapeHtml(settings.shopUserLabel || "")}" placeholder="Owner name or login id"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-secondary" type="submit">Switch / Save Shop</button></div>
        </form>
        <div class="notice warning">
          <strong>Multi-shop data separation</strong>
          <span>Use a different shop ID for each shopkeeper before creating records. Existing records stay under their original shop ID.</span>
        </div>
        <form id="settings-form" class="page-grid">
          <div class="form-grid">
            <label class="field"><span>Shop name</span><input name="shopName" value="${escapeHtml(settings.shopName)}" required></label>
            <label class="field"><span>Shop phone</span><input name="shopPhone" value="${escapeHtml(settings.shopPhone || "")}"></label>
            <label class="field"><span>GSTIN</span><input name="gstin" value="${escapeHtml(settings.gstin || "")}"></label>
            <label class="field"><span>Default GST %</span><input name="defaultGstPct" type="number" min="0" step="0.01" value="${escapeHtml(settings.defaultGstPct ?? 3)}"></label>
            <label class="field"><span>Combined invoice prefix</span><input name="combinedInvoicePrefix" value="${escapeHtml(settings.combinedInvoicePrefix || "B")}" required></label>
            <label class="field"><span>Gold invoice prefix</span><input name="goldInvoicePrefix" value="${escapeHtml(settings.goldInvoicePrefix || "G")}" required></label>
            <label class="field"><span>Silver invoice prefix</span><input name="silverInvoicePrefix" value="${escapeHtml(settings.silverInvoicePrefix || "S")}" required></label>
            <label class="field"><span>Loan prefix</span><input name="loanPrefix" value="${escapeHtml(settings.loanPrefix || "L")}" required></label>
            <label class="field"><span>Daily Rate (%/day)</span><input name="loanDefaultDailyRate" type="number" min="0" step="0.01" value="${escapeHtml(settings.loanDefaultDailyRate ?? 0.07)}"></label>
            <label class="field"><span>Monthly Rate (%/month)</span><input name="loanDefaultMonthlyRate" type="number" min="0" step="0.01" value="${escapeHtml(settings.loanDefaultMonthlyRate ?? 2)}"></label>
            <label class="field"><span>Financial year</span><input name="financialYear" value="${escapeHtml(settings.financialYear || "")}"></label>
            <label class="field full"><span>Shop address</span><textarea name="shopAddress">${escapeHtml(settings.shopAddress || "")}</textarea></label>
            <label class="field full"><span>Print footer text</span><textarea name="printFooterText">${escapeHtml(settings.printFooterText || "")}</textarea></label>
            <label class="field full"><span>Logo upload optional</span><input class="file-input" name="logoFile" type="file" accept="image/*"></label>
          </div>
          <div class="form-actions">
            <button class="button" type="submit">Save Settings</button>
            <button class="button-secondary" type="button" data-password>Set / Change Owner Password</button>
            <button class="button-secondary" type="button" data-persist>Request Persistent Storage</button>
          </div>
        </form>
      </section>
      <section class="cards-grid">
        ${renderStorageCard(health, settings.lastBackupAt)}
        <div class="metric-card"><small>Current origin</small><strong>${escapeHtml(location.origin)}</strong><span>Browser storage bucket</span></div>
        <div class="metric-card"><small>Stored production origin</small><strong>${escapeHtml(settings.productionOrigin || "-")}</strong><span>Warns when origin changes</span></div>
      </section>
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Audit Log</h2>
            <p>Owner-gated and important business actions are recorded here.</p>
          </div>
          <button class="button-danger" type="button" data-reset>Reset App</button>
        </div>
        ${renderTable([
          { label: "Time", render: (row) => formatDateTime(row.ts) },
          { label: "Action", key: "actionType" },
          { label: "Entity", render: (row) => `${escapeHtml(row.entityType)}<br><span class="muted">${escapeHtml(row.entityId)}</span>` },
          { label: "Reason", render: (row) => escapeHtml(row.reason || "-") },
          { label: "Summary", render: (row) => escapeHtml(row.summary || "-") }
        ], sortDescByDate(auditLog, "ts").slice(0, 200), "No audit events yet.")}
      </section>
    </div>
  `;
  wireSettings(container);
}

function wireSettings(container) {
  $("#shop-context-form", container).addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = collectForm(event.currentTarget);
      requireText(data.shopId, "Active shop ID");
      const shopId = setActiveShopId(data.shopId);
      await updateSettings({ shopId, shopUserLabel: data.shopUserLabel || "" });
      await logAudit("SHOP_CONTEXT_UPDATE", "Shop", shopId, "Shop context saved", "Active shop identity updated.");
      showToast("Shop saved. Reloading this shop data.", "success");
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#settings-form", container).addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const data = collectForm(form);
      requireText(data.shopName, "Shop name");
      requireText(data.combinedInvoicePrefix, "Combined invoice prefix");
      requireText(data.goldInvoicePrefix, "Gold invoice prefix");
      requireText(data.silverInvoicePrefix, "Silver invoice prefix");
      requireText(data.loanPrefix, "Loan prefix");
      requireNonNegative(data.defaultGstPct, "Default GST percentage");
      requireNonNegative(data.loanDefaultDailyRate, "Default daily loan rate");
      requireNonNegative(data.loanDefaultMonthlyRate, "Default monthly loan rate");
      const patch = {
        shopName: data.shopName,
        shopAddress: data.shopAddress,
        shopPhone: data.shopPhone,
        gstin: data.gstin,
        defaultGstPct: num(data.defaultGstPct),
        combinedInvoicePrefix: data.combinedInvoicePrefix,
        goldInvoicePrefix: data.goldInvoicePrefix,
        silverInvoicePrefix: data.silverInvoicePrefix,
        loanPrefix: data.loanPrefix,
        loanDefaultDailyRate: num(data.loanDefaultDailyRate),
        loanDefaultMonthlyRate: num(data.loanDefaultMonthlyRate),
        financialYear: data.financialYear,
        printFooterText: data.printFooterText
      };
      const file = form.elements.logoFile.files?.[0];
      if (file) patch.logoDataUrl = await readFileAsDataUrl(file);
      const settings = await updateSettings(patch);
      document.getElementById("brand-shop-name").textContent = settings.shopName || "Jewellery Portal";
      await logAudit("SETTINGS_UPDATE", "Settings", "main", "Settings saved", "Shop settings updated.");
      showToast("Settings saved.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("[data-password]", container).addEventListener("click", async () => {
    const result = await openDialog({
      title: "Set owner password",
      message: "This is local-only protection stored as a salted hash in this browser.",
      fields: [
        { name: "password", label: "New owner password", type: "password", required: true },
        { name: "confirm", label: "Confirm password", type: "password", required: true }
      ],
      confirmText: "Save password"
    });
    if (!result) return;
    try {
      if (result.password !== result.confirm) throw new Error("Passwords do not match.");
      await setOwnerPassword(result.password);
      showToast("Owner password saved.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("[data-persist]", container).addEventListener("click", async () => {
    await requestPersistentStorage();
  });

  $("[data-reset]", container).addEventListener("click", async () => {
    try {
      const approval = await ensureOwnerPassword("Reset app", {
        message: "This clears browser-local business data. Export a backup first.",
        confirmText: "Continue",
        danger: true
      });
      if (!approval) return;
      const final = await openDialog({
        title: "Final reset confirmation",
        message: "Type RESET to clear this app data in the current browser origin.",
        fields: [{ name: "confirm", label: "Confirmation", required: true }],
        confirmText: "Reset app",
        danger: true
      });
      if (!final || final.confirm !== "RESET") return;
      await resetAllData();
      showToast("App reset complete.", "success");
      location.reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

export async function renderRates(container) {
  const rates = await getAll("rates");
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Reference Rates</h2>
            <p>Manual rate management only. These values help prefill bill forms.</p>
          </div>
        </div>
        <div class="notice">
          <strong>Manual reference rate</strong>
          <span>You may note MCX or market references in the notes, but this app does not auto-fetch live bullion rates.</span>
        </div>
        <form id="rate-form" class="form-grid">
          <label class="field"><span>Rate date</span><input name="rateDate" type="date" value="${todayInputValue()}" required></label>
          <label class="field"><span>Gold 24K</span><input name="gold24k" type="number" min="0" step="0.01"></label>
          <label class="field"><span>Gold 22K</span><input name="gold22k" type="number" min="0" step="0.01"></label>
          <label class="field"><span>Gold 18K</span><input name="gold18k" type="number" min="0" step="0.01"></label>
          <label class="field"><span>Silver 999</span><input name="silver999" type="number" min="0" step="0.01"></label>
          <label class="field"><span>Source label</span><input name="sourceLabel" value="Manual"></label>
          <label class="field full"><span>Notes</span><textarea name="notes"></textarea></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button" type="submit">Save Rate</button></div>
        </form>
      </section>
      <section class="section-band">
        <h2>Saved Rates</h2>
        ${renderTable([
          { label: "Date", render: (row) => formatDate(row.rateDate) },
          { label: "Gold 24K", render: (row) => formatINR(row.gold24k || 0) },
          { label: "Gold 22K", render: (row) => formatINR(row.gold22k || 0) },
          { label: "Gold 18K", render: (row) => formatINR(row.gold18k || 0) },
          { label: "Silver 999", render: (row) => formatINR(row.silver999 || 0) },
          { label: "Source", render: (row) => escapeHtml(row.sourceLabel || "Manual") },
          { label: "Notes", render: (row) => escapeHtml(row.notes || "-") }
        ], sortDescByDate(rates, "rateDate"), "No rates saved.")}
      </section>
    </div>
  `;
  $("#rate-form", container).addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = collectForm(event.currentTarget);
      requireText(data.rateDate, "Rate date");
      ["gold24k", "gold22k", "gold18k", "silver999"].forEach((key) => requireNonNegative(data[key], key));
      await saveRate({
        rateDate: data.rateDate,
        gold24k: num(data.gold24k),
        gold22k: num(data.gold22k),
        gold18k: num(data.gold18k),
        silver999: num(data.silver999),
        sourceLabel: data.sourceLabel || "Manual",
        notes: data.notes || "",
        updatedAt: new Date().toISOString()
      });
      await logAudit("RATE_SAVE", "Rate", data.rateDate, "Reference rate saved", "Manual reference rate updated.");
      showToast("Reference rate saved.", "success");
      await renderRates(container);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

export async function renderBackup(container) {
  const [settings, health, cloudBackups] = await Promise.all([getSettings(), getStorageHealth(), getSupabaseCloudBackups()]);
  const activeShopId = getActiveShopId();
  const originMismatch = settings.productionOrigin && settings.productionOrigin !== location.origin;
  container.innerHTML = `
    <div class="page-grid">
      ${originMismatch ? `<div class="notice danger"><strong>You are running under a different origin. Browser data may not match your production data.</strong><span>Stored origin: ${escapeHtml(settings.productionOrigin)}. Current origin: ${escapeHtml(location.origin)}.</span></div>` : ""}
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Backup / Restore</h2>
            <p>Export local ZIP backups or save a full JSON snapshot directly in Supabase for the active shop.</p>
          </div>
        </div>
        <div class="notice warning">
          <strong>Before domain changes or browser cleanup</strong>
          <span>Export a full ZIP. Browser storage belongs to the exact origin, so a new Vercel domain or custom domain has a different data bucket. Avoid private/incognito mode.</span>
        </div>
        <div class="cards-grid">
          ${renderStorageCard(health, settings.lastBackupAt)}
          <div class="metric-card"><small>Current origin</small><strong>${escapeHtml(location.origin)}</strong><span>Exported in manifest</span></div>
          <div class="metric-card"><small>Active shop</small><strong>${escapeHtml(activeShopId)}</strong><span>Cloud backups are saved for this shop ID</span></div>
        </div>
        <div class="actions-row">
          <button class="button" type="button" data-cloud-backup>Create Cloud Backup</button>
          <button class="button" type="button" data-export-zip>Export Full ZIP</button>
          <button class="button-secondary" type="button" data-export-json>Export JSON Only</button>
          <label class="button-danger">
            Restore Backup
            <input type="file" data-restore-file accept=".zip,.json,application/zip,application/json" hidden>
          </label>
          <button class="button-ghost" type="button" data-persist-backup>Request Persistent Storage</button>
        </div>
        <div id="restore-summary"></div>
      </section>
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Supabase Cloud Backups</h2>
            <p>Recent database-saved snapshots for the active shop.</p>
          </div>
        </div>
        ${renderTable([
          { label: "Created", render: (row) => formatDateTime(row.created_at || row.createdAt) },
          { label: "File", render: (row) => escapeHtml(row.file_name || row.fileName || "-") },
          { label: "Shop", render: (row) => escapeHtml(row.shop_id || row.shopId || activeShopId) },
          { label: "Records", render: (row) => escapeHtml(Object.entries(row.record_counts || row.recordCounts || {}).map(([key, value]) => `${key}: ${value}`).join(", ") || "-") },
          { label: "Version", render: (row) => escapeHtml(row.app_version || row.appVersion || "-") }
        ], cloudBackups, "No cloud backups saved for this shop yet.")}
      </section>
    </div>
  `;
  $("[data-cloud-backup]", container).addEventListener("click", async () => {
    try {
      await createSupabaseCloudBackup();
      await renderBackup(container);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-export-zip]", container).addEventListener("click", async () => {
    try {
      await exportFullZip();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-export-json]", container).addEventListener("click", async () => {
    try {
      await exportJsonOnly();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-restore-file]", container).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await restoreBackupFromFile(file);
      if (result) {
        $("#restore-summary", container).innerHTML = `<div class="notice success"><strong>Restore complete</strong><span>${Object.entries(result.counts).map(([key, value]) => `${key}: ${value}`).join(", ")}</span></div>`;
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("[data-persist-backup]", container).addEventListener("click", async () => {
    await requestPersistentStorage();
  });
}
