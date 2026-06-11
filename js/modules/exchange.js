import {
  $,
  collectForm,
  escapeHtml,
  formatDate,
  formatGm,
  formatINR,
  renderTable,
  sortDescByDate,
  textMatches,
  withinDateRange
} from "../helpers.js";
import { getAll } from "../data-service.js";

let state = {
  entries: []
};

export async function render(container) {
  state.entries = await getAll("exchangeEntries");
  container.innerHTML = `
    <div class="page-grid">
      <section class="section-band">
        <div class="section-header">
          <div>
            <h2>Old Jewellery Exchange</h2>
            <p>Exchange entries are created from gold and silver bill forms.</p>
          </div>
        </div>
        <form id="exchange-search" class="form-grid">
          <label class="field"><span>Search</span><input name="query" placeholder="Exchange ID, bill no, customer, mobile"></label>
          <label class="field"><span>From date</span><input name="from" type="date"></label>
          <label class="field"><span>To date</span><input name="to" type="date"></label>
          <div class="field"><span class="label">&nbsp;</span><button class="button-ghost" type="submit">Search</button></div>
        </form>
        <div id="exchange-table"></div>
      </section>
    </div>
  `;
  $("#exchange-search", container).addEventListener("submit", (event) => {
    event.preventDefault();
    renderExchangeTable(container);
  });
  renderExchangeTable(container);
}

function filteredEntries(container) {
  const filters = collectForm($("#exchange-search", container));
  return sortDescByDate(state.entries, "dateISO")
    .filter((entry) => textMatches(entry, filters.query, ["exchangeId", "billNo", "customerName", "customerMobile", "oldItemName"]))
    .filter((entry) => withinDateRange(entry.dateISO, filters.from, filters.to));
}

function renderExchangeTable(container) {
  $("#exchange-table", container).innerHTML = renderTable([
    { label: "Exchange ID", render: (row) => `<strong>${escapeHtml(row.exchangeId)}</strong>` },
    { label: "Bill no", key: "billNo" },
    { label: "Customer", render: (row) => `${escapeHtml(row.customerName)}<br><span class="muted">${escapeHtml(row.customerMobile)}</span>` },
    { label: "Old metal", key: "oldMetalType" },
    { label: "Old item", key: "oldItemName" },
    { label: "Old weight", render: (row) => formatGm(row.oldWeightGm) },
    { label: "Old purity", key: "oldPurity" },
    { label: "Net value", render: (row) => formatINR(row.netExchangeValue) },
    { label: "Date", render: (row) => formatDate(row.dateISO) }
  ], filteredEntries(container), "No exchange entries found.");
}
