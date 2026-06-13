create extension if not exists pgcrypto;

create table if not exists shops_settings (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  customer_id text primary key,
  mobile text unique,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists bills (
  bill_no text primary key,
  customer_mobile text generated always as (payload ->> 'customerMobile') stored,
  date_iso text generated always as (payload ->> 'dateISO') stored,
  status text generated always as (payload ->> 'status') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists bill_items (
  line_id text primary key,
  bill_no text generated always as (payload ->> 'billNo') stored,
  metal_type text generated always as (payload ->> 'metalType') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists legacy_gold_bills (
  bill_no text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists legacy_silver_bills (
  bill_no text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists stock_lots (
  stock_id text primary key,
  metal_type text generated always as (payload ->> 'metalType') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists stock_movements (
  movement_id text primary key,
  ref_id text generated always as (payload ->> 'refId') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists exchange_entries (
  exchange_id text primary key,
  bill_no text generated always as (payload ->> 'billNo') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists credits (
  credit_id text primary key,
  bill_no text generated always as (payload ->> 'billNo') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists credit_payments (
  payment_id text primary key,
  credit_id text not null references credits(credit_id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists loans (
  loan_no text primary key,
  customer_mobile text generated always as (payload ->> 'customerMobile') stored,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists loan_payments (
  payment_id text primary key,
  loan_no text not null references loans(loan_no) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists rates (
  rate_date text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  event_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists backup_meta (
  backup_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  user_id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role text not null default 'owner',
  password_hash text,
  created_at timestamptz not null default now()
);

create index if not exists bills_customer_mobile_idx on bills(customer_mobile);
create index if not exists bills_date_iso_idx on bills(date_iso);
create index if not exists bill_items_bill_no_idx on bill_items(bill_no);
create index if not exists stock_lots_metal_type_idx on stock_lots(metal_type);
create index if not exists stock_movements_ref_id_idx on stock_movements(ref_id);
create index if not exists credits_bill_no_idx on credits(bill_no);
create index if not exists loans_customer_mobile_idx on loans(customer_mobile);
create index if not exists customers_updated_at_idx on customers(updated_at desc);
create index if not exists bills_updated_at_idx on bills(updated_at desc);
create index if not exists stock_lots_updated_at_idx on stock_lots(updated_at desc);
create index if not exists exchange_entries_updated_at_idx on exchange_entries(updated_at desc);
create index if not exists loans_updated_at_idx on loans(updated_at desc);
create index if not exists credits_updated_at_idx on credits(updated_at desc);
create index if not exists audit_log_updated_at_idx on audit_log(updated_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to anon;
