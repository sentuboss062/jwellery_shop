import { escapeHtml, formatDateTime, renderTable, sortDescByDate } from "../helpers.js";
import { getAll } from "../data-service.js";

export async function render(container) {
  const rows = sortDescByDate(await getAll("auditLog"), "ts");
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Audit Log</h2>
            <p>All recorded changes, protected actions, and important business events.</p>
          </div>
        </div>
        ${renderTable([
          { label: "Timestamp", render: (row) => formatDateTime(row.ts) },
          { label: "Action", render: (row) => escapeHtml(row.actionType || "-") },
          { label: "Entity", render: (row) => `${escapeHtml(row.entityType || "-")}<br><span class="muted">${escapeHtml(row.entityId || "-")}</span>` },
          { label: "Details", render: (row) => escapeHtml(row.summary || row.reason || "-") },
          { label: "User", render: () => "Owner / local user" }
        ], rows, "No audit log entries found.")}
      </section>
    </div>
  `;
}
