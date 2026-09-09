-- ============================================================================
-- IQ Sports Supply — trade ordering platform
-- 0001: core schema
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── enums ───────────────────────────────────────────────────────────────────
create type user_role        as enum ('admin', 'accounts', 'ops', 'client');
create type order_status     as enum ('open', 'complete', 'cancelled');
create type invoice_type     as enum ('full', 'shipment', 'backorder');
create type request_status   as enum ('pending', 'approved', 'rejected');
create type transfer_status  as enum ('draft', 'in_transit', 'received', 'cancelled');
create type xero_status      as enum ('not_synced', 'synced', 'error');
create type email_status     as enum ('sent', 'suppressed', 'failed');

-- The client-facing timeline is driven entirely by these events; there is no
-- manually editable status field anywhere in the order lifecycle.
create type order_event_type as enum (
  'placed',
  'invoice_sent',
  'payment_received',
  'supplier_ordered',
  'stock_arrived',
  'packed',
  'shipped'
);

-- ── identity ────────────────────────────────────────────────────────────────
-- One row per auth user. Role drives every RLS policy in 0002.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'client',
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);

-- ── reference data ──────────────────────────────────────────────────────────
create table tiers (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int  not null default 0
);

create table locations (
  id      uuid primary key default gen_random_uuid(),
  name    text not null unique,
  address text,
  active  boolean not null default true
);

-- Which sites an ops user works. Their packing/receiving queues are scoped to
-- these; admin sees every location.
create table ops_locations (
  profile_id  uuid references profiles(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  primary key (profile_id, location_id)
);

-- ── catalogue ───────────────────────────────────────────────────────────────
create table products (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  brand      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
-- SKU matching on import is trimmed and case-insensitive.
create unique index products_sku_lower_idx on products (lower(sku));

-- Stock is held per location; a product's total is the sum across locations.
create table stock_levels (
  product_id  uuid not null references products(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  qty         integer not null default 0 check (qty >= 0),
  primary key (product_id, location_id)
);

-- Current price = latest row with effective_from <= today. Older rows are the
-- quarterly price history and are never deleted.
create table tier_prices (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  tier_id        uuid not null references tiers(id) on delete cascade,
  price          numeric(12,2) not null check (price >= 0),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (product_id, tier_id, effective_from)
);
create index tier_prices_lookup_idx on tier_prices (product_id, tier_id, effective_from desc);

-- ── clients ─────────────────────────────────────────────────────────────────
create table clients (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  tier_id             uuid not null references tiers(id),
  email               text,
  phone               text,
  vat_no              text,
  address             text,
  vat_exempt          boolean not null default false,
  default_location_id uuid references locations(id),
  auth_user_id        uuid unique references auth.users(id) on delete set null,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);
create index clients_auth_user_idx on clients (auth_user_id);

-- Approval is the ONLY path from application to access. Nothing here grants
-- any visibility until an admin approves it.
create table account_requests (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  contact_name  text not null,
  email         text not null,
  phone         text,
  vat_no        text,
  address       text,
  business_type text,
  website       text,
  message       text,
  status        request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_note   text,
  client_id     uuid references clients(id)
);

-- ── orders ──────────────────────────────────────────────────────────────────
create table orders (
  id                     uuid primary key default gen_random_uuid(),
  number                 text not null unique,
  client_id              uuid not null references clients(id),
  date                   date not null default current_date,
  status                 order_status not null default 'open',
  fulfilment_location_id uuid not null references locations(id),
  placed_by              uuid references profiles(id),
  notes                  text,
  created_at             timestamptz not null default now()
);
create index orders_client_idx on orders (client_id, date desc);

create table order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  product_id    uuid references products(id),
  -- sku/name/unit_price are snapshotted at placement so past orders and
  -- invoices never change when the catalogue or prices do.
  sku           text not null,
  name          text not null,
  qty           integer not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  alloc_qty     integer not null default 0 check (alloc_qty >= 0),
  bo_qty        integer not null default 0 check (bo_qty >= 0),
  -- How much of bo_qty has already been placed on a supplier order. Lets a PO
  -- bundle several SOs without ever double-ordering a line.
  po_qty        integer not null default 0 check (po_qty >= 0),
  invoiced_ship boolean not null default false
);
create index order_lines_order_idx on order_lines (order_id);
create index order_lines_backorder_idx on order_lines (sku) where bo_qty > 0;

create table order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  type       order_event_type not null,
  -- clock_timestamp(), not now(): several events are written in one
  -- transaction at placement, and they must still order correctly.
  created_at timestamptz not null default clock_timestamp(),
  meta       jsonb not null default '{}'::jsonb
);
create index order_events_order_idx on order_events (order_id, created_at);

-- ── invoices ────────────────────────────────────────────────────────────────
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  order_id        uuid not null references orders(id) on delete cascade,
  client_id       uuid not null references clients(id),
  type            invoice_type not null default 'full',
  date            date not null default current_date,
  due_date        date not null,
  vat_rate        numeric(5,2) not null default 20,
  paid            boolean not null default false,
  paid_date       date,
  -- Set when the goods on this invoice are physically available. Packing is
  -- gated on paid AND ready_to_pack.
  ready_to_pack   boolean not null default false,
  packed          boolean not null default false,
  packed_at       timestamptz,
  shipped         boolean not null default false,
  shipped_at      timestamptz,
  carrier         text,
  tracking_number text,
  tracking_url    text,
  location_id     uuid not null references locations(id),
  superseded      boolean not null default false,
  xero_id         text,
  xero_status     xero_status not null default 'not_synced',
  xero_error      text,
  exported        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index invoices_client_idx on invoices (client_id, date desc);
create index invoices_packing_queue_idx on invoices (location_id)
  where paid and ready_to_pack and not packed and not superseded;

create table invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  sku        text not null,
  name       text not null,
  qty        integer not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);
create index invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- ── purchase orders ─────────────────────────────────────────────────────────
-- Deliberately carries NO price columns and NO client identity: what goes to
-- the supplier is SKUs and quantities only.
create table purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  date                date not null default current_date,
  received            boolean not null default false,
  received_at         timestamptz,
  receive_location_id uuid not null references locations(id),
  created_at          timestamptz not null default now()
);

create table po_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  sku          text not null,
  name         text not null,
  qty          integer not null check (qty > 0),
  -- The client order this line is for. The supplier is asked to quote it back
  -- so arriving stock maps unambiguously to the right order.
  so_reference text,
  order_id     uuid references orders(id) on delete set null,
  received_qty integer not null default 0 check (received_qty >= 0)
);
create index po_lines_po_idx on po_lines (po_id);

-- ── stock transfers ─────────────────────────────────────────────────────────
create table stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  from_location_id uuid not null references locations(id),
  to_location_id   uuid not null references locations(id),
  date             date not null default current_date,
  status           transfer_status not null default 'draft',
  created_at       timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

create table stock_transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  product_id  uuid not null references products(id),
  sku         text not null,
  name        text not null,
  qty         integer not null check (qty > 0)
);

-- ── import audit ────────────────────────────────────────────────────────────
create table price_imports (
  id            uuid primary key default gen_random_uuid(),
  date          timestamptz not null default now(),
  tier_id       uuid references tiers(id),
  filename      text,
  rows_added    integer not null default 0,
  rows_changed  integer not null default 0,
  rows_missing  integer not null default 0,
  effective_from date,
  applied_by    uuid references profiles(id)
);

-- Saved column mapping per tier, so every subsequent quarter is pure
-- drag-and-drop with no setup.
create table import_templates (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null,              -- 'prices' | 'clients' | 'stock'
  tier_id      uuid references tiers(id),
  header_row   integer not null default 1,
  mapping      jsonb not null,             -- { sku: "A", name: "B", ... }
  updated_at   timestamptz not null default now(),
  unique (scope, tier_id)
);

-- ── settings (single row) ───────────────────────────────────────────────────
create table settings (
  id                 integer primary key default 1 check (id = 1),
  company            text not null default 'IQ Sports Supply Ltd',
  company_address    text not null default '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ',
  invoice_prefix     text not null default 'IQ-2026-',
  next_invoice       integer not null default 3,
  next_order         integer not null default 1,
  next_po            integer not null default 1,
  next_transfer      integer not null default 1,
  vat_rate           numeric(5,2) not null default 20,
  payment_days       integer not null default 30,
  xero_account_code  text not null default '200',
  tax_type_std       text not null default '20% (VAT on Income)',
  tax_type_zero      text not null default 'Zero Rated Income',
  confirmation_cc    text[] not null default '{}',   -- Rohail, James
  supplier_recipient text not null default '',       -- James
  application_recipient text not null default '',    -- James only
  email_from         text not null default 'IQ Sports Supply <orders@iqsportssupply.com>'
);

-- ── outbox ──────────────────────────────────────────────────────────────────
-- Every outbound email is recorded here. Without RESEND_API_KEY messages are
-- stored 'suppressed' and shown in-app instead of being sent, so the whole
-- flow works before the email provider exists.
create table email_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null,       -- order_confirmation | supplier_order | shipped | ...
  to_addrs    text[] not null,
  cc_addrs    text[] not null default '{}',
  subject     text not null,
  body        text not null,
  status      email_status not null,
  error       text,
  order_id    uuid references orders(id) on delete set null,
  invoice_id  uuid references invoices(id) on delete set null,
  po_id       uuid references purchase_orders(id) on delete set null
);

-- ── Xero connection (single row) ────────────────────────────────────────────
create table xero_connection (
  id            integer primary key default 1 check (id = 1),
  tenant_id     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  connected_at  timestamptz,
  connected_by  uuid references profiles(id)
);

-- ── audit log ───────────────────────────────────────────────────────────────
create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor      uuid references profiles(id),
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index audit_log_entity_idx on audit_log (entity, entity_id, created_at desc);
