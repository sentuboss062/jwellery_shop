# Jewellery Shop Portal

Offline-first jewellery portal for an Indian family jewellery store. It manages combined gold/silver billing, legacy gold and silver bills, stock lots, customers, old jewellery exchange, gold loans, dues, reports, settings, audit log, and backup/restore.

## Tech Stack

- Static HTML, CSS, and vanilla JavaScript ES modules
- Service-layer data access with IndexedDB fallback
- Optional Netlify Functions API + Supabase PostgreSQL backend
- Service Worker + CacheStorage for offline app shell
- jsPDF for bills and loan receipts
- Chart.js for charts
- JSZip for backup export and restore
- Web Crypto API for salted owner-password hashing

Pinned CDN files used by `index.html` and cached by `sw.js`:

- jsPDF: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js`
- Chart.js: `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js`
- JSZip: `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`

## Architecture

The frontend has no build step. `db.js` is the IndexedDB fallback adapter. `api-client.js` talks to `/.netlify/functions/api` when Supabase environment variables are configured. UI modules do not call IndexedDB directly; they use `data-service.js`.

When the API health check succeeds, business records are saved through Netlify Functions into Supabase. When the API is unavailable, the app uses browser-local IndexedDB so local/offline work still functions. Browser-local fallback data is not synced across devices, browsers, profiles, or domains.

## Combined Billing

Use **Combined Billing** for new invoices. One bill can contain multiple Gold and Silver line items. Each line stores metal type, item name, category, purity, weight gm, rate per gm, making charge percentage, wastage charge, discount, GST percentage, and line total.

Stock deduction is performed per line against matching metal, purity, and category stock lots. Cancelling a combined bill restores stock for every line item. Legacy `goldBills` and `silverBills` remain readable in customers, dashboard, reports, backup, and PDF export.

## Backend Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Add Netlify environment variables from `.env.example`.
4. Deploy the folder to Netlify.
5. Visit `/.netlify/functions/api/health`; it should return `{ "ok": true }`.

`SUPABASE_SERVICE_ROLE_KEY` must be stored only in Netlify environment variables. Do not expose it in frontend JavaScript.

Backend tables include: `shops_settings`, `app_users`, `customers`, `bills`, `bill_items`, `legacy_gold_bills`, `legacy_silver_bills`, `stock_lots`, `stock_movements`, `exchange_entries`, `credits`, `credit_payments`, `loans`, `loan_payments`, `rates`, `audit_log`, and `backup_meta`.

## Netlify Deployment

`netlify.toml` publishes `.` and uses `netlify/functions` for the API. `index.html` and `sw.js` are served with `Cache-Control: no-cache` to reduce update problems.

## Offline Mode

`app.js` registers `/sw.js`. The service worker caches the app shell, JS modules, CSS, logo, and pinned CDN libraries. After the first successful online load, the shell can open offline. Backend records need network access; IndexedDB fallback records remain available offline.

## Backup And Restore

Full ZIP export includes:

- `json-db/*.json`
- `meta/manifest.json`
- `bills/*.pdf`
- `loan-receipts/*.pdf`
- `stock/summary.json`
- `stock/summary.pdf`

Individual PDFs are downloaded by the browser. The app does not claim to write runtime server folders such as `/bills` or `/backups`.

Restore requires the owner password. The app downloads a pre-restore ZIP backup first, validates database version, imports JSON stores, and shows imported counts.

## Owner Password

The owner password is local-only protection for destructive actions. It is hashed with a salt using the browser Web Crypto API. The plain password is never stored. This is not server-grade authentication.

Owner password is required for bill cancel, saved bill edit, stock delete, closed loan edit, backup restore, and reset app.

## Test Steps

1. Open the app online and complete first-run setup.
2. Add a manual reference rate.
3. Add gold and silver stock lots.
4. Create a gold-only combined bill and verify stock decreases.
5. Create a silver-only combined bill and verify stock decreases.
6. Create a mixed gold + silver combined bill and verify both stock types decrease.
7. Create a credit bill and verify a due entry appears.
8. Add old jewellery exchange and verify bill totals reduce.
9. Cancel a bill and verify stock is restored and due is closed.
10. Add a due payment and verify bill due amount updates.
11. Create a gold loan, add partial repayment, then full repayment.
12. Download bill and loan PDFs.
13. Export full ZIP backup.
14. Reload offline and verify dashboard, records, reports, and backup export still work for IndexedDB fallback data.
15. Restore a backup with the owner password.

## Future Paid Features Excluded From This Version

- *** live bullion-rate auto-fetch integration
- *** cloud sync / multi-device shared database
- *** OTP / SMS / email verification
- *** Netlify host-level site-wide password protection
