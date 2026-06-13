# Jewellery Shop Portal

Offline-first jewellery portal for an Indian family jewellery store. It manages combined gold/silver billing, legacy gold and silver bills, stock lots, customers, old jewellery exchange, gold loans, dues, reports, settings, audit log, and backup/restore.

## Tech Stack

- Static HTML, CSS, and vanilla JavaScript ES modules
- Service-layer data access with IndexedDB fallback
- Optional Vercel Functions API + Supabase PostgreSQL backend
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

The frontend has no build step. `db.js` is the IndexedDB fallback adapter. `api-client.js` talks to `/api` when Supabase environment variables are configured. UI modules do not call IndexedDB directly; they use `data-service.js`.

When the API health check succeeds, business records are saved through Vercel Functions into Supabase. Failed API writes are queued in IndexedDB and retried when the browser comes back online. Browser-local fallback data is not synced across devices, browsers, profiles, or domains unless the API is reachable and the sync queue can replay.

## Combined Billing

Use **Combined Billing** for new invoices. One bill can contain multiple Gold and Silver line items. Each line stores metal type, item name, category, gold purity/fineness where applicable, weight gm, rate per gm, making charge percentage, flat making charge rupees, wastage charge, discount, GST percentage, and line total.

Stock deduction is performed per line against matching metal, purity, and category stock lots. Cancelling a combined bill restores stock for every line item. Legacy `goldBills` and `silverBills` remain readable in customers, dashboard, reports, backup, and PDF export.

Rates are managed manually from the dashboard. The app prompts for today's gold and silver reference rates when no rate exists for the current date, and bill line items can update the saved reference rate from the rate field.

Stock lots support gross weight, wastage percentage, net weight, and independent gross/net adjustments. Silver entries do not require purity. Gold purity uses preset fineness values with a custom option.

## Backend Setup (Vercel + Supabase)

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. In Vercel dashboard -> Project -> Settings -> Environment Variables, add:
   - `SUPABASE_URL` - your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - service role key, never expose in frontend code
   - `API_SECRET_TOKEN` - a random secret string for API requests
   - `ALLOWED_ORIGIN` - your Vercel URL, for example `https://jwellery-shop-nu.vercel.app`
4. Deploy the folder to Vercel.
5. Visit `/api/health`; it should return `{ "ok": true, "storage": "supabase", "platform": "vercel" }`.
6. Optional: set up Uptime Robot to ping `/api/health` every 5 minutes.

`SUPABASE_SERVICE_ROLE_KEY` must be stored only in Vercel environment variables. Do not expose it in frontend JavaScript.

Security notes:

- CORS is restricted to `ALLOWED_ORIGIN`, with localhost allowed for development.
- API token checking is supported through `API_SECRET_TOKEN`.
- Write operations require the stored owner password hash where a hash already exists.
- Full-store backend deletes are blocked.
- Basic in-memory rate limiting is enabled for the Vercel API.

Backend tables include: `shops`, `shop_users`, `shops_settings`, `app_users`, `customers`, `bills`, `bill_items`, `legacy_gold_bills`, `legacy_silver_bills`, `stock_lots`, `stock_movements`, `exchange_entries`, `credits`, `credit_payments`, `loans`, `loan_payments`, `rates`, `audit_log`, `backup_meta`, and `cloud_backups`.

## Shop Mode

This version is configured for one shop. The app always uses the internal shop ID `main`, so records do not disappear because of a shop selector or shop ID mismatch.

The backend schema keeps `shops`, `shop_users`, and `shop_id` fields so the project can be upgraded to multi-shop later, but the shopkeeper-facing multi-shop controls are intentionally hidden in this version.

## Vercel Deployment

`vercel.json` serves the static app from the project root and uses `api/[...route].js` for the Supabase-backed API. `index.html` and `sw.js` are served with `Cache-Control: no-cache` to reduce update problems.

Recommended Vercel project settings:

- Framework Preset: `Other`
- Build Command: leave empty
- Output Directory: leave empty or `.`
- Install Command: leave empty

Deploy from the Vercel dashboard by importing this folder's Git repo, or use the Vercel CLI:

```bash
vercel
vercel --prod
```

## Running On Other Static Hosts

The frontend can run on any static host that serves the folder over HTTPS, including Cloudflare Pages, GitHub Pages, or a local LAN web server. Hash routing means no server rewrite is needed for screens such as `#/dashboard`.

For the optional backend, the host must support a compatible serverless API. The included API is written as a Vercel Function, so on Render, Cloudflare, or another platform you must port `api/[...route].js` to that platform's function format or keep the app in IndexedDB fallback mode.

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

The Backup / Restore screen also includes **Create Cloud Backup**. This saves a full JSON snapshot directly in the Supabase `cloud_backups` table and records metadata in `backup_meta`. Run the latest `supabase/schema.sql` before using it on an existing Supabase project.

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
- *** full Supabase Auth multi-user login with role management
- *** OTP / SMS / email verification
- *** platform host-level site-wide password protection
