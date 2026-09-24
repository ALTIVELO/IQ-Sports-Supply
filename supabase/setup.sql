-- ============================================================================
-- IQ Sports Supply — complete database setup
--
-- GENERATED FILE — do not edit. Regenerate with supabase/build-setup.sh after
-- changing anything under supabase/migrations/.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
--
-- Safe to re-run: every object is guarded, so if a run stops partway you can
-- fix the cause and run the same file again without resetting the database.
--
-- The last statement prints a table of checks. Every row should say PASS.
-- The one exception is "signup trigger on auth.users": that trigger cannot be
-- installed on some hosted projects, and the app does not need it — it creates
-- the profile row itself on first sign-in. Any other FAIL is real.
-- ============================================================================



-- ###########################################################################
-- 0001_schema.sql
-- ###########################################################################

-- ============================================================================
-- IQ Sports Supply — trade ordering platform
-- 0001: core schema
-- ============================================================================

-- gen_random_uuid() is core Postgres since 13, so this is optional. Hosted
-- platforms often disallow CREATE EXTENSION, and that must not stop the run.
do $$
begin
  create extension if not exists "pgcrypto";
exception when insufficient_privilege or duplicate_object then
  raise notice 'pgcrypto not created (%) — continuing, gen_random_uuid() is built in', sqlerrm;
end $$;

-- ── enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role        as enum ('admin', 'accounts', 'ops', 'client');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type order_status     as enum ('open', 'complete', 'cancelled');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type invoice_type     as enum ('full', 'shipment', 'backorder');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type request_status   as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type transfer_status  as enum ('draft', 'in_transit', 'received', 'cancelled');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type xero_status      as enum ('not_synced', 'synced', 'error');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type email_status     as enum ('sent', 'suppressed', 'failed');

exception when duplicate_object then null;
end $$;
-- The client-facing timeline is driven entirely by these events; there is no
-- manually editable status field anywhere in the order lifecycle.
do $$ begin
  create type order_event_type as enum (
    'placed',
    'invoice_sent',
    'payment_received',
    'supplier_ordered',
    'stock_arrived',
    'packed',
    'shipped'
  );

exception when duplicate_object then null;
end $$;
-- ── identity ────────────────────────────────────────────────────────────────
-- One row per auth user. Role drives every RLS policy in 0002.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'client',
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);

-- ── reference data ──────────────────────────────────────────────────────────
create table if not exists tiers (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int  not null default 0
);

create table if not exists locations (
  id      uuid primary key default gen_random_uuid(),
  name    text not null unique,
  address text,
  active  boolean not null default true
);

-- Which sites an ops user works. Their packing/receiving queues are scoped to
-- these; admin sees every location.
create table if not exists ops_locations (
  profile_id  uuid references profiles(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  primary key (profile_id, location_id)
);

-- ── catalogue ───────────────────────────────────────────────────────────────
create table if not exists products (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  brand      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
-- SKU matching on import is trimmed and case-insensitive.
create unique index if not exists products_sku_lower_idx on products (lower(sku));

-- Stock is held per location; a product's total is the sum across locations.
create table if not exists stock_levels (
  product_id  uuid not null references products(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  qty         integer not null default 0 check (qty >= 0),
  primary key (product_id, location_id)
);

-- Current price = latest row with effective_from <= today. Older rows are the
-- quarterly price history and are never deleted.
create table if not exists tier_prices (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  tier_id        uuid not null references tiers(id) on delete cascade,
  price          numeric(12,2) not null check (price >= 0),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (product_id, tier_id, effective_from)
);
create index if not exists tier_prices_lookup_idx on tier_prices (product_id, tier_id, effective_from desc);

-- ── clients ─────────────────────────────────────────────────────────────────
create table if not exists clients (
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
create index if not exists clients_auth_user_idx on clients (auth_user_id);

-- Approval is the ONLY path from application to access. Nothing here grants
-- any visibility until an admin approves it.
create table if not exists account_requests (
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
create table if not exists orders (
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
create index if not exists orders_client_idx on orders (client_id, date desc);

create table if not exists order_lines (
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
create index if not exists order_lines_order_idx on order_lines (order_id);
create index if not exists order_lines_backorder_idx on order_lines (sku) where bo_qty > 0;

create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  type       order_event_type not null,
  -- clock_timestamp(), not now(): several events are written in one
  -- transaction at placement, and they must still order correctly.
  created_at timestamptz not null default clock_timestamp(),
  meta       jsonb not null default '{}'::jsonb
);
create index if not exists order_events_order_idx on order_events (order_id, created_at);

-- ── invoices ────────────────────────────────────────────────────────────────
create table if not exists invoices (
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
create index if not exists invoices_client_idx on invoices (client_id, date desc);
create index if not exists invoices_packing_queue_idx on invoices (location_id)
  where paid and ready_to_pack and not packed and not superseded;

create table if not exists invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  sku        text not null,
  name       text not null,
  qty        integer not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- ── purchase orders ─────────────────────────────────────────────────────────
-- Deliberately carries NO price columns and NO client identity: what goes to
-- the supplier is SKUs and quantities only.
create table if not exists purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  date                date not null default current_date,
  received            boolean not null default false,
  received_at         timestamptz,
  receive_location_id uuid not null references locations(id),
  created_at          timestamptz not null default now()
);

create table if not exists po_lines (
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
create index if not exists po_lines_po_idx on po_lines (po_id);

-- ── stock transfers ─────────────────────────────────────────────────────────
create table if not exists stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  from_location_id uuid not null references locations(id),
  to_location_id   uuid not null references locations(id),
  date             date not null default current_date,
  status           transfer_status not null default 'draft',
  created_at       timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

create table if not exists stock_transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  product_id  uuid not null references products(id),
  sku         text not null,
  name        text not null,
  qty         integer not null check (qty > 0)
);

-- ── import audit ────────────────────────────────────────────────────────────
create table if not exists price_imports (
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
create table if not exists import_templates (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null,              -- 'prices' | 'clients' | 'stock'
  tier_id      uuid references tiers(id),
  header_row   integer not null default 1,
  mapping      jsonb not null,             -- { sku: "A", name: "B", ... }
  updated_at   timestamptz not null default now(),
  unique (scope, tier_id)
);

-- ── settings (single row) ───────────────────────────────────────────────────
create table if not exists settings (
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
  email_from         text not null default 'IQ Sports Supply <orders@iqsportsupply.com>'
);

-- ── outbox ──────────────────────────────────────────────────────────────────
-- Every outbound email is recorded here. Without RESEND_API_KEY messages are
-- stored 'suppressed' and shown in-app instead of being sent, so the whole
-- flow works before the email provider exists.
create table if not exists email_log (
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
create table if not exists xero_connection (
  id            integer primary key default 1 check (id = 1),
  tenant_id     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  connected_at  timestamptz,
  connected_by  uuid references profiles(id)
);

-- ── audit log ───────────────────────────────────────────────────────────────
create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor      uuid references profiles(id),
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id, created_at desc);


-- ###########################################################################
-- 0002_functions.sql
-- ###########################################################################

-- ============================================================================
-- 0002: domain logic.
-- The workflow rules live here rather than in the app so that allocation,
-- numbering and invoicing are atomic and race-safe under concurrent orders.
-- ============================================================================

-- ── identity helpers ────────────────────────────────────────────────────────
create or replace function public.my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid())
                  in ('admin','accounts','ops'), false);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false);
$$;

-- The client record belonging to the signed-in user, or null for staff.
create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from clients where auth_user_id = auth.uid();
$$;

-- Locations an ops user is assigned to. Admin and accounts see every site.
create or replace function public.my_location_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select l.id from locations l
   where (select role from profiles where id = auth.uid()) in ('admin','accounts')
  union
  select ol.location_id from ops_locations ol where ol.profile_id = auth.uid();
$$;

-- ── race-safe sequential numbering ──────────────────────────────────────────
-- UPDATE ... RETURNING takes a row lock on the single settings row, so two
-- concurrent callers serialise and can never be handed the same number.
create or replace function public.next_order_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update settings set next_order = next_order + 1 where id = 1
    returning next_order - 1 into n;
  return 'SO-' || lpad(n::text, 3, '0');
end $$;

create or replace function public.next_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer; p text;
begin
  update settings set next_invoice = next_invoice + 1 where id = 1
    returning next_invoice - 1, invoice_prefix into n, p;
  return p || lpad(n::text, 3, '0');
end $$;

create or replace function public.next_po_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update settings set next_po = next_po + 1 where id = 1
    returning next_po - 1 into n;
  return 'PO-' || lpad(n::text, 3, '0');
end $$;

create or replace function public.next_transfer_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update settings set next_transfer = next_transfer + 1 where id = 1
    returning next_transfer - 1 into n;
  return 'TR-' || lpad(n::text, 3, '0');
end $$;

-- ── pricing ─────────────────────────────────────────────────────────────────
-- Current price is the latest row effective on or before the given date, so a
-- quarterly sheet can be uploaded early and switch over on its own.
create or replace function public.current_tier_price(
  p_product uuid, p_tier uuid, p_on date default current_date
) returns numeric
language sql stable security definer set search_path = public as $$
  select price from tier_prices
   where product_id = p_product and tier_id = p_tier and effective_from <= p_on
   order by effective_from desc
   limit 1;
$$;

-- ── invoice readiness ───────────────────────────────────────────────────────
-- An invoice may only be packed once its goods physically exist. Payment is
-- checked separately; the packing queue requires both.
create or replace function public.refresh_invoice_readiness(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare outstanding integer;
begin
  select coalesce(sum(bo_qty), 0) into outstanding
    from order_lines where order_id = p_order_id;

  -- A full invoice covers the whole order, so it waits for the whole order.
  update invoices set ready_to_pack = (outstanding = 0)
   where order_id = p_order_id and type = 'full' and not superseded and not packed;

  -- A shipment invoice only covers stock that was already allocated.
  update invoices set ready_to_pack = true
   where order_id = p_order_id and type = 'shipment' and not superseded and not packed;

  -- A backorder invoice becomes packable when its shortfall has arrived.
  update invoices set ready_to_pack = (outstanding = 0)
   where order_id = p_order_id and type = 'backorder' and not superseded and not packed;

  update orders set status = (case when outstanding = 0 then 'complete' else 'open' end)::order_status
   where id = p_order_id and status <> 'cancelled';
end $$;

-- ── order placement ─────────────────────────────────────────────────────────
-- Rule 1 + rule 2 in one transaction: allocate from the fulfilment location,
-- backorder the shortfall, and raise the full invoice immediately.
--
-- p_lines: [{ "product_id": uuid, "qty": int, "unit_price": numeric|null }]
-- unit_price is honoured for staff only; a client user always gets tier price.
create or replace function public.place_order(
  p_client_id   uuid,
  p_location_id uuid,
  p_lines       jsonb,
  p_notes       text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_client      clients%rowtype;
  v_settings    settings%rowtype;
  v_location    uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_invoice_id  uuid;
  v_invoice_no  text;
  v_line        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_price       numeric(12,2);
  v_stock       integer;
  v_alloc       integer;
  v_bo          integer;
  v_total_bo    integer := 0;
  v_vat         numeric(5,2);
  v_po_id       uuid;
  v_po_no       text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then
    raise exception 'Not authorised';
  end if;

  -- A client user may only ever order for their own account.
  if v_role = 'client' then
    if p_client_id is distinct from my_client_id() then
      raise exception 'Not authorised to order for this client';
    end if;
  end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if not v_client.active then raise exception 'Client account is not active'; end if;

  select * into v_settings from settings where id = 1;

  v_location := coalesce(p_location_id, v_client.default_location_id);
  if v_location is null then
    raise exception 'No fulfilment location for this order';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Order has no lines';
  end if;

  v_order_no := next_order_number();
  insert into orders (number, client_id, date, fulfilment_location_id, placed_by, notes)
  values (v_order_no, p_client_id, current_date, v_location, auth.uid(), p_notes)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    -- Staff may override the price per line; clients never can.
    if v_role = 'client' or v_line->>'unit_price' is null then
      v_price := current_tier_price(v_product.id, v_client.tier_id);
    else
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    if v_price is null then
      raise exception 'No price for % on this tier', v_product.sku;
    end if;

    -- Allocation draws from THIS location's stock only. FOR UPDATE serialises
    -- concurrent orders competing for the same units.
    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_location
     for update;
    v_stock := coalesce(v_stock, 0);

    v_alloc := least(v_qty, v_stock);
    v_bo    := v_qty - v_alloc;

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_location;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price, v_alloc, v_bo);

    v_total_bo := v_total_bo + v_bo;
  end loop;

  -- Rule 2: the full order is invoiced at placement.
  v_vat := case when v_client.vat_exempt then 0 else v_settings.vat_rate end;
  v_invoice_no := next_invoice_number();
  insert into invoices (number, order_id, client_id, type, date, due_date,
                        vat_rate, location_id, ready_to_pack)
  values (v_invoice_no, v_order_id, p_client_id, 'full', current_date,
          current_date + v_settings.payment_days, v_vat, v_location, v_total_bo = 0)
  returning id into v_invoice_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_invoice_id, sku, name, qty, unit_price from order_lines where order_id = v_order_id;

  insert into order_events (order_id, type, meta)
  values (v_order_id, 'placed', jsonb_build_object('number', v_order_no)),
         (v_order_id, 'invoice_sent', jsonb_build_object('invoice', v_invoice_no, 'invoice_id', v_invoice_id));

  -- Rule 3: the shortfall goes to the supplier straight away, every line
  -- carrying its SO reference.
  if v_total_bo > 0 then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_location)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order_no, v_order_id
      from order_lines where order_id = v_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = v_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  perform refresh_invoice_readiness(v_order_id);
  return v_order_id;
end $$;

-- ── invoice split ───────────────────────────────────────────────────────────
-- Staff action for when a part-shipment becomes necessary: replaces the live
-- full invoice with a shipment invoice for what is allocated and a backorder
-- invoice dated to the stock availability date.
create or replace function public.split_invoice(
  p_order_id uuid,
  p_available_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv        invoices%rowtype;
  v_settings   settings%rowtype;
  v_ship_id    uuid;
  v_bo_id      uuid;
  v_date       date;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_settings from settings where id = 1;

  select * into v_inv from invoices
   where order_id = p_order_id and type = 'full' and not superseded and not paid;
  if not found then
    raise exception 'No open full invoice to split for this order';
  end if;

  if not exists (select 1 from order_lines where order_id = p_order_id and bo_qty > 0) then
    raise exception 'Nothing on back order — no split needed';
  end if;

  v_date := coalesce(p_available_date, current_date);

  if exists (select 1 from order_lines where order_id = p_order_id and alloc_qty > 0) then
    insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                          location_id, ready_to_pack)
    values (next_invoice_number(), p_order_id, v_inv.client_id, 'shipment', current_date,
            current_date + v_settings.payment_days, v_inv.vat_rate, v_inv.location_id, true)
    returning id into v_ship_id;

    insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
    select v_ship_id, sku, name, alloc_qty, unit_price
      from order_lines where order_id = p_order_id and alloc_qty > 0;
  end if;

  -- The backorder invoice is dated to when the stock becomes available, so the
  -- client's payment terms run from availability, not from placement.
  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                        location_id, ready_to_pack)
  values (next_invoice_number(), p_order_id, v_inv.client_id, 'backorder', v_date,
          v_date + v_settings.payment_days, v_inv.vat_rate, v_inv.location_id, false)
  returning id into v_bo_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_bo_id, sku, name, bo_qty, unit_price
    from order_lines where order_id = p_order_id and bo_qty > 0;

  update invoices set superseded = true where id = v_inv.id;
  update order_lines set invoiced_ship = true where order_id = p_order_id and alloc_qty > 0;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', v_inv.id, 'split',
          jsonb_build_object('shipment', v_ship_id, 'backorder', v_bo_id, 'available', v_date));

  perform refresh_invoice_readiness(p_order_id);
end $$;

-- ── supplier orders ─────────────────────────────────────────────────────────
-- Staff-built PO. May bundle several SOs; lines stay grouped and referenced
-- per SO so arriving stock maps back unambiguously.
--
-- p_backorder_lines: [{ "order_line_id": uuid, "qty": int }]
-- p_extra_lines:     [{ "sku": text, "name": text, "qty": int }]  (stock top-up)
create or replace function public.create_supplier_order(
  p_location_id      uuid,
  p_backorder_lines  jsonb default '[]'::jsonb,
  p_extra_lines      jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po_id   uuid;
  v_po_no   text;
  v_row     jsonb;
  v_ol      order_lines%rowtype;
  v_order   orders%rowtype;
  v_qty     integer;
  v_orders  uuid[] := '{}';
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  if jsonb_array_length(coalesce(p_backorder_lines,'[]'::jsonb))
   + jsonb_array_length(coalesce(p_extra_lines,'[]'::jsonb)) = 0 then
    raise exception 'Supplier order has no lines';
  end if;

  v_po_no := next_po_number();
  insert into purchase_orders (number, date, receive_location_id)
  values (v_po_no, current_date, p_location_id)
  returning id into v_po_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_backorder_lines,'[]'::jsonb)) loop
    select * into v_ol from order_lines where id = (v_row->>'order_line_id')::uuid for update;
    if not found then raise exception 'Unknown order line'; end if;
    select * into v_order from orders where id = v_ol.order_id;

    -- Never order more than is still outstanding and not already with a supplier.
    v_qty := least((v_row->>'qty')::integer, v_ol.bo_qty - v_ol.po_qty);
    if v_qty <= 0 then continue; end if;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    values (v_po_id, v_ol.sku, v_ol.name, v_qty, v_order.number, v_order.id);

    update order_lines set po_qty = po_qty + v_qty where id = v_ol.id;
    v_orders := array_append(v_orders, v_order.id);
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_extra_lines,'[]'::jsonb)) loop
    if coalesce((v_row->>'qty')::integer, 0) <= 0 or coalesce(v_row->>'sku','') = '' then
      continue;
    end if;
    insert into po_lines (po_id, sku, name, qty)
    values (v_po_id, trim(v_row->>'sku'), coalesce(v_row->>'name',''), (v_row->>'qty')::integer);
  end loop;

  if not exists (select 1 from po_lines where po_id = v_po_id) then
    delete from purchase_orders where id = v_po_id;
    raise exception 'Supplier order has no lines';
  end if;

  insert into order_events (order_id, type, meta)
  select distinct o, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id)
    from unnest(v_orders) as o;

  return v_po_id;
end $$;

-- ── receiving ───────────────────────────────────────────────────────────────
-- Rule 5: matched by SO reference first, then oldest-first for unreferenced
-- stock; surplus lands in the receiving location's stock.
--
-- p_receipts: [{ "po_line_id": uuid, "qty": int }]
create or replace function public.receive_po(
  p_po_id          uuid,
  p_receipts       jsonb,
  p_available_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_po        purchase_orders%rowtype;
  v_settings  settings%rowtype;
  v_row       jsonb;
  v_pl        po_lines%rowtype;
  v_remaining integer;
  v_take      integer;
  v_ol        record;
  v_product   uuid;
  v_date      date;
  v_orders    uuid[] := '{}';
  v_touched   uuid[];
  v_order_id  uuid;
  v_complete  boolean;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Unknown purchase order'; end if;
  select * into v_settings from settings where id = 1;
  v_date := coalesce(p_available_date, current_date);

  for v_row in select * from jsonb_array_elements(p_receipts) loop
    select * into v_pl from po_lines where id = (v_row->>'po_line_id')::uuid and po_id = p_po_id for update;
    if not found then continue; end if;

    v_remaining := coalesce((v_row->>'qty')::integer, 0);
    if v_remaining <= 0 then continue; end if;

    update po_lines set received_qty = received_qty + v_remaining where id = v_pl.id;

    -- 1. The order the supplier quoted this line against gets it first.
    if v_pl.order_id is not null then
      for v_ol in
        select ol.id, ol.bo_qty, ol.order_id
          from order_lines ol
         where ol.order_id = v_pl.order_id
           and lower(trim(ol.sku)) = lower(trim(v_pl.sku))
           and ol.bo_qty > 0
         order by ol.id
         for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_ol.bo_qty);
        update order_lines set bo_qty = bo_qty - v_take,
                               alloc_qty = alloc_qty + v_take,
                               po_qty = greatest(0, po_qty - v_take)
         where id = v_ol.id;
        v_remaining := v_remaining - v_take;
        v_orders := array_append(v_orders, v_ol.order_id);
      end loop;
    end if;

    -- 2. Anything left over covers other open back orders, oldest order first.
    for v_ol in
      select ol.id, ol.bo_qty, ol.order_id
        from order_lines ol
        join orders o on o.id = ol.order_id
       where lower(trim(ol.sku)) = lower(trim(v_pl.sku))
         and ol.bo_qty > 0
         and o.status <> 'cancelled'
       order by o.date, o.number, ol.id
       for update of ol
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_ol.bo_qty);
      update order_lines set bo_qty = bo_qty - v_take,
                             alloc_qty = alloc_qty + v_take,
                             po_qty = greatest(0, po_qty - v_take)
       where id = v_ol.id;
      v_remaining := v_remaining - v_take;
      v_orders := array_append(v_orders, v_ol.order_id);
    end loop;

    -- 3. Surplus becomes free stock at the receiving location.
    if v_remaining > 0 then
      select id into v_product from products where lower(sku) = lower(trim(v_pl.sku));
      if v_product is not null then
        insert into stock_levels (product_id, location_id, qty)
        values (v_product, v_po.receive_location_id, v_remaining)
        on conflict (product_id, location_id) do update set qty = stock_levels.qty + excluded.qty;
      end if;
    end if;
  end loop;

  -- Re-date the backorder invoices to the availability date and refresh the
  -- packing queue for every order this receipt touched.
  select not exists (select 1 from po_lines where po_id = p_po_id and received_qty < qty)
    into v_complete;

  select coalesce(array_agg(distinct o), '{}'::uuid[]) into v_touched from unnest(v_orders) as o;
  foreach v_order_id in array v_touched loop
    update invoices
       set date = v_date, due_date = v_date + v_settings.payment_days
     where order_id = v_order_id and type = 'backorder' and not superseded and not paid;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'stock_arrived',
            jsonb_build_object('po', v_po.number, 'available_from', v_date));

    perform refresh_invoice_readiness(v_order_id);
  end loop;

  update purchase_orders
     set received = v_complete,
         received_at = case when v_complete then now() else received_at end
   where id = p_po_id;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'purchase_order', p_po_id, 'receive',
          jsonb_build_object('available_from', v_date, 'receipts', p_receipts));
end $$;

-- ── payment, packing, shipping ──────────────────────────────────────────────
-- Rule 4: payment gates dispatch. Normally set from Xero; this is the manual
-- fallback and the admin override.
create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_paid_date  date default null,
  p_source     text default 'manual'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.paid then return; end if;

  update invoices set paid = true, paid_date = coalesce(p_paid_date, current_date)
   where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'payment_received',
          jsonb_build_object('invoice', v_inv.number, 'source', p_source));

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'mark_paid', jsonb_build_object('source', p_source));
end $$;

create or replace function public.mark_invoice_packed(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if not v_inv.paid then raise exception 'Invoice is not paid — nothing ships before payment'; end if;
  if not v_inv.ready_to_pack then raise exception 'Stock for this invoice has not arrived yet'; end if;

  update invoices set packed = true, packed_at = now() where id = p_invoice_id;
  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'packed', jsonb_build_object('invoice', v_inv.number));
end $$;

create or replace function public.mark_invoice_shipped(
  p_invoice_id     uuid,
  p_carrier        text,
  p_tracking_number text,
  p_tracking_url   text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if not v_inv.packed then raise exception 'Invoice has not been packed yet'; end if;

  update invoices set shipped = true, shipped_at = now(), carrier = p_carrier,
                      tracking_number = p_tracking_number, tracking_url = p_tracking_url
   where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'shipped',
          jsonb_build_object('invoice', v_inv.number, 'carrier', p_carrier,
                             'tracking_number', p_tracking_number, 'tracking_url', p_tracking_url));
end $$;

-- ── stock transfers ─────────────────────────────────────────────────────────
create or replace function public.receive_transfer(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t stock_transfers%rowtype; v_l record;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Unknown transfer'; end if;
  if v_t.status = 'received' then return; end if;

  for v_l in select * from stock_transfer_lines where transfer_id = p_transfer_id loop
    update stock_levels set qty = qty - v_l.qty
     where product_id = v_l.product_id and location_id = v_t.from_location_id and qty >= v_l.qty;
    if not found then
      raise exception 'Not enough stock of % at the sending location', v_l.sku;
    end if;
    insert into stock_levels (product_id, location_id, qty)
    values (v_l.product_id, v_t.to_location_id, v_l.qty)
    on conflict (product_id, location_id) do update set qty = stock_levels.qty + excluded.qty;
  end loop;

  update stock_transfers set status = 'received' where id = p_transfer_id;
  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'stock_transfer', p_transfer_id, 'receive');
end $$;

-- ── trade account approval ──────────────────────────────────────────────────
-- The only path from application to access. Tier and default fulfilment
-- location are chosen here, at approval time.
create or replace function public.approve_account_request(
  p_request_id  uuid,
  p_tier_id     uuid,
  p_location_id uuid,
  p_note        text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_req account_requests%rowtype; v_client_id uuid;
begin
  if not (is_admin() or my_role() = 'accounts') then raise exception 'Not authorised'; end if;
  select * into v_req from account_requests where id = p_request_id for update;
  if not found then raise exception 'Unknown application'; end if;
  if v_req.status <> 'pending' then raise exception 'Application has already been reviewed'; end if;

  insert into clients (name, tier_id, email, phone, vat_no, address, default_location_id)
  values (v_req.company_name, p_tier_id, v_req.email, v_req.phone, v_req.vat_no,
          v_req.address, p_location_id)
  returning id into v_client_id;

  update account_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = p_note, client_id = v_client_id
   where id = p_request_id;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'account_request', p_request_id, 'approve',
          jsonb_build_object('client_id', v_client_id, 'tier_id', p_tier_id));

  return v_client_id;
end $$;

-- ── new auth users get a profile ────────────────────────────────────────────
-- Default role is 'client' and a client user only gains visibility once an
-- admin links them to an approved client record.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'client')
  on conflict (id) do nothing;

  -- Link an approved client that was created for this email address.
  update public.clients set auth_user_id = new.id
   where auth_user_id is null and lower(email) = lower(new.email);

  return new;
end $$;

-- auth.users is owned by the auth service, and some hosted setups do not let
-- the SQL editor's role add a trigger to it. That must not abort this file:
-- the trigger is a convenience (it creates the profile row and links an
-- approved client on first sign-in), and the app degrades to a manual
-- `update profiles set role = ...` without it.
do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception when insufficient_privilege then
  raise notice
    'Could not add the signup trigger to auth.users (%). Everything else is '
    'installed. Add it from the Supabase dashboard, or create profile rows by '
    'hand — see supabase/README.md.', sqlerrm;
end $$;


-- ###########################################################################
-- 0003_rls.sql
-- ###########################################################################

-- ============================================================================
-- 0003: Row Level Security.
--
-- A client may see ONLY their own catalogue view (their tier's prices), their
-- own orders, backorders and invoices. They never see other clients, other
-- tiers' prices, supplier information, or stock levels — the in-stock /
-- back-order flag they get is derived server-side and never exposes a count.
-- ============================================================================

alter table profiles            enable row level security;
alter table tiers               enable row level security;
alter table locations           enable row level security;
alter table ops_locations       enable row level security;
alter table products            enable row level security;
alter table stock_levels        enable row level security;
alter table tier_prices         enable row level security;
alter table clients             enable row level security;
alter table account_requests    enable row level security;
alter table orders              enable row level security;
alter table order_lines         enable row level security;
alter table order_events        enable row level security;
alter table invoices            enable row level security;
alter table invoice_lines       enable row level security;
alter table purchase_orders     enable row level security;
alter table po_lines            enable row level security;
alter table stock_transfers     enable row level security;
alter table stock_transfer_lines enable row level security;
alter table price_imports       enable row level security;
alter table import_templates    enable row level security;
alter table settings            enable row level security;
alter table email_log           enable row level security;
alter table xero_connection     enable row level security;
alter table audit_log           enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles for select using (id = auth.uid());
drop policy if exists profiles_staff_read on profiles;
create policy profiles_staff_read on profiles for select using (is_staff());
drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for all using (is_admin()) with check (is_admin());

-- ── reference data ──────────────────────────────────────────────────────────
-- Tier names are harmless; a client still cannot read another tier's prices.
drop policy if exists tiers_read on tiers;
create policy tiers_read on tiers for select using (auth.uid() is not null);
drop policy if exists tiers_admin_write on tiers;
create policy tiers_admin_write on tiers for all using (is_admin()) with check (is_admin());

drop policy if exists locations_staff_read on locations;
create policy locations_staff_read on locations for select using (is_staff());
drop policy if exists locations_admin_write on locations;
create policy locations_admin_write on locations for all using (is_admin()) with check (is_admin());

drop policy if exists ops_locations_read on ops_locations;
create policy ops_locations_read on ops_locations for select using (is_staff());
drop policy if exists ops_locations_admin_write on ops_locations;
create policy ops_locations_admin_write on ops_locations for all using (is_admin()) with check (is_admin());

-- ── catalogue ───────────────────────────────────────────────────────────────
drop policy if exists products_read on products;
create policy products_read on products for select using (auth.uid() is not null);
drop policy if exists products_staff_write on products;
create policy products_staff_write on products for all using (is_staff()) with check (is_staff());

-- Stock levels are staff-only. Clients get an availability flag computed in a
-- security-definer view, never the underlying quantities.
drop policy if exists stock_levels_staff on stock_levels;
create policy stock_levels_staff on stock_levels for all using (is_staff()) with check (is_staff());

-- A client reads only the price rows for their own tier.
drop policy if exists tier_prices_staff on tier_prices;
create policy tier_prices_staff on tier_prices for all using (is_staff()) with check (is_staff());
drop policy if exists tier_prices_own_tier on tier_prices;
create policy tier_prices_own_tier on tier_prices for select using (
  tier_id = (select c.tier_id from clients c where c.auth_user_id = auth.uid())
);

-- ── clients ─────────────────────────────────────────────────────────────────
drop policy if exists clients_staff on clients;
create policy clients_staff on clients for all using (is_staff()) with check (is_staff());
drop policy if exists clients_self_read on clients;
create policy clients_self_read on clients for select using (auth_user_id = auth.uid());

-- Applications are submitted through a server-side route with the service
-- role, so no anonymous insert policy is needed here.
drop policy if exists account_requests_staff on account_requests;
create policy account_requests_staff on account_requests for all
  using (is_staff()) with check (is_staff());

-- ── orders ──────────────────────────────────────────────────────────────────
drop policy if exists orders_staff on orders;
create policy orders_staff on orders for all using (is_staff()) with check (is_staff());
drop policy if exists orders_client_read on orders;
create policy orders_client_read on orders for select using (client_id = my_client_id());

drop policy if exists order_lines_staff on order_lines;
create policy order_lines_staff on order_lines for all using (is_staff()) with check (is_staff());
drop policy if exists order_lines_client_read on order_lines;
create policy order_lines_client_read on order_lines for select using (
  exists (select 1 from orders o where o.id = order_id and o.client_id = my_client_id())
);

drop policy if exists order_events_staff on order_events;
create policy order_events_staff on order_events for all using (is_staff()) with check (is_staff());
drop policy if exists order_events_client_read on order_events;
create policy order_events_client_read on order_events for select using (
  exists (select 1 from orders o where o.id = order_id and o.client_id = my_client_id())
);

-- ── invoices ────────────────────────────────────────────────────────────────
drop policy if exists invoices_staff on invoices;
create policy invoices_staff on invoices for all using (is_staff()) with check (is_staff());
drop policy if exists invoices_client_read on invoices;
create policy invoices_client_read on invoices for select using (client_id = my_client_id());

drop policy if exists invoice_lines_staff on invoice_lines;
create policy invoice_lines_staff on invoice_lines for all using (is_staff()) with check (is_staff());
drop policy if exists invoice_lines_client_read on invoice_lines;
create policy invoice_lines_client_read on invoice_lines for select using (
  exists (select 1 from invoices i where i.id = invoice_id and i.client_id = my_client_id())
);

-- ── supplier, stock movement, admin tables: staff only ──────────────────────
drop policy if exists purchase_orders_staff on purchase_orders;
create policy purchase_orders_staff on purchase_orders for all using (is_staff()) with check (is_staff());
drop policy if exists po_lines_staff on po_lines;
create policy po_lines_staff on po_lines for all using (is_staff()) with check (is_staff());
drop policy if exists stock_transfers_staff on stock_transfers;
create policy stock_transfers_staff on stock_transfers for all using (is_staff()) with check (is_staff());
drop policy if exists stock_transfer_lines_staff on stock_transfer_lines;
create policy stock_transfer_lines_staff on stock_transfer_lines for all using (is_staff()) with check (is_staff());
drop policy if exists price_imports_staff on price_imports;
create policy price_imports_staff on price_imports for all using (is_staff()) with check (is_staff());
drop policy if exists import_templates_staff on import_templates;
create policy import_templates_staff on import_templates for all using (is_staff()) with check (is_staff());
drop policy if exists email_log_staff on email_log;
create policy email_log_staff on email_log for select using (is_staff());
drop policy if exists audit_log_staff on audit_log;
create policy audit_log_staff on audit_log for select using (is_staff());

drop policy if exists xero_connection_read on xero_connection;
create policy xero_connection_read on xero_connection for select
  using (is_admin() or my_role() = 'accounts');
drop policy if exists xero_connection_write on xero_connection;
create policy xero_connection_write on xero_connection for all
  using (is_admin() or my_role() = 'accounts')
  with check (is_admin() or my_role() = 'accounts');

-- Settings are readable by any signed-in user (the portal needs VAT rate and
-- company details) but only admin and accounts may change them.
drop policy if exists settings_read on settings;
create policy settings_read on settings for select using (auth.uid() is not null);
drop policy if exists settings_write on settings;
create policy settings_write on settings for update
  using (is_admin() or my_role() = 'accounts')
  with check (is_admin() or my_role() = 'accounts');

-- ── client-safe availability ────────────────────────────────────────────────
-- Returns a boolean and nothing more: no quantity, no per-location breakdown.
create or replace function public.product_in_stock(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stock_levels where product_id = p_product and qty > 0);
$$;

-- ── client catalogue view ───────────────────────────────────────────────────
-- What a client is allowed to know about availability: a boolean, never a
-- count, and never per-location. Security-invoker so tier_prices RLS still
-- restricts each client to their own tier.
-- cascade: later migrations build views on top of this one, and a plain
-- drop fails the moment one exists — which is every re-run of setup.sql.
-- Each dependent view is recreated by its own migration further down.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;


-- ###########################################################################
-- 0004_seed.sql
-- ###########################################################################

-- ============================================================================
-- 0004: seed. Settings, tiers, fulfilment sites, and the sample catalogue and
-- client carried over from the prototype so the full loop can be walked
-- through end to end on a fresh database.
--
-- Invoice numbering continues from IQ-2026-001/002, already issued: next is 003.
-- ============================================================================

insert into settings (id) values (1) on conflict (id) do nothing;

insert into tiers (name, sort) values
  ('Distributor', 1), ('Shop', 2), ('Club', 3), ('Retail', 4)
on conflict (name) do nothing;

-- The four fulfilment sites. Addresses are left blank for the three that do
-- not share the registered office; fill them in on the Locations screen.
insert into locations (name, address) values
  ('Slough',      '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ'),
  ('Cornwall',    null),
  ('Maryport',    null),
  ('Glastonbury', null)
on conflict (name) do nothing;

-- ── sample catalogue ────────────────────────────────────────────────────────
insert into products (sku, name, brand) values
  ('BBR9100B',    'Shimano Dura-Ace BB-R9100 Bottom Bracket BSA',        'Shimano'),
  ('BPL05ARF25',  'Shimano Brake Pad L05A Resin w/ Fin',                 'Shimano'),
  ('BPB05SR25',   'Shimano Brake Pad B05S Resin',                        'Shimano'),
  ('FCR9200C26',  'Shimano Dura-Ace FC-R9200 Crankset 170mm 52-36',      'Shimano'),
  ('TP-AOPW-54',  'Tripeak AOPW Oversized Pulley Wheel 54T',             'Tripeak')
on conflict (sku) do nothing;

-- Prototype stock, held at the Slough site.
insert into stock_levels (product_id, location_id, qty)
select p.id, l.id, v.qty
  from (values ('BBR9100B', 0), ('BPL05ARF25', 6), ('BPB05SR25', 20),
               ('FCR9200C26', 2), ('TP-AOPW-54', 8)) as v(sku, qty)
  join products p on p.sku = v.sku
  cross join (select id from locations where name = 'Slough') l
on conflict (product_id, location_id) do nothing;

insert into tier_prices (product_id, tier_id, price, effective_from)
select p.id, t.id, v.price, current_date
  from (values
    ('BBR9100B',   'Distributor',  24.50), ('BBR9100B',   'Shop',  28.00),
    ('BBR9100B',   'Club',         31.50), ('BBR9100B',   'Retail', 39.99),
    ('BPL05ARF25', 'Distributor',  11.20), ('BPL05ARF25', 'Shop',  13.50),
    ('BPL05ARF25', 'Club',         15.00), ('BPL05ARF25', 'Retail', 19.99),
    ('BPB05SR25',  'Distributor',   5.40), ('BPB05SR25',  'Shop',   6.80),
    ('BPB05SR25',  'Club',          7.60), ('BPB05SR25',  'Retail',  9.99),
    ('FCR9200C26', 'Distributor', 428.00), ('FCR9200C26', 'Shop',  472.00),
    ('FCR9200C26', 'Club',        505.00), ('FCR9200C26', 'Retail', 599.99),
    ('TP-AOPW-54', 'Distributor', 189.00), ('TP-AOPW-54', 'Shop',  215.00),
    ('TP-AOPW-54', 'Club',        232.00), ('TP-AOPW-54', 'Retail', 279.00)
  ) as v(sku, tier, price)
  join products p on p.sku = v.sku
  join tiers t on t.name = v.tier
on conflict (product_id, tier_id, effective_from) do nothing;

insert into clients (name, tier_id, email, vat_no, address, default_location_id)
select 'MDI Ltd', t.id, 'dave@mikedixonimports.co.uk', '618 6837 06',
       'Unit 4 Wellington Point, Amy Johnson Way, Blackpool FY4 2RG', l.id
  from tiers t, locations l
 where t.name = 'Distributor' and l.name = 'Slough'
   and not exists (select 1 from clients where name = 'MDI Ltd');


-- ###########################################################################
-- 0005_categories.sql
-- ###########################################################################

-- ============================================================================
-- 0005: product categories.
--
-- Price sheets carry a SKU, a description and a price — never a category — so
-- categories are derived from the description when a sheet is imported. The
-- rules live in src/lib/catalogue/categories.ts; this migration holds the
-- categories themselves and the column that points at them.
-- ============================================================================

create table if not exists categories (
  id   uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort integer not null default 0
);

alter table products add column if not exists category_id uuid references categories(id);
create index if not exists products_category_idx on products (category_id) where active;

alter table categories enable row level security;

-- Any signed-in user may read the category list; a client needs it to filter
-- their catalogue. Only staff may change it.
drop policy if exists categories_read on categories;
create policy categories_read on categories for select using (auth.uid() is not null);

drop policy if exists categories_staff_write on categories;
create policy categories_staff_write on categories for all
  using (is_staff()) with check (is_staff());

-- Keep these in step with CATEGORIES in src/lib/catalogue/categories.ts.
insert into categories (slug, name, sort) values
  ('brake-pads',      'Brake pads',              10),
  ('rotors',          'Disc rotors',             20),
  ('brakes',          'Brakes & levers',         30),
  ('chains',          'Chains',                  40),
  ('chainsets',       'Chainsets & cranks',      50),
  ('chainrings',      'Chainrings',              60),
  ('cassettes',       'Cassettes & sprockets',   70),
  ('derailleurs',     'Derailleurs',             80),
  ('shifters',        'Shifters',                90),
  ('bottom-brackets', 'Bottom brackets',        100),
  ('pulleys',         'Pulleys & jockey wheels',110),
  ('bearings',        'Bearings',               120),
  ('headsets',        'Headsets',               130),
  ('hubs',            'Hubs',                   140),
  ('wheels',          'Wheels & rims',          150),
  ('spokes',          'Spokes & nipples',       160),
  ('tyres',           'Tyres',                  170),
  ('tubes',           'Inner tubes',            180),
  ('pedals',          'Pedals & cleats',        190),
  ('handlebars',      'Handlebars & tape',      200),
  ('stems',           'Stems',                  210),
  ('seatposts',       'Seatposts',              220),
  ('saddles',         'Saddles',                230),
  ('cables',          'Cables & housing',       240),
  ('tools',           'Tools',                  250),
  ('lubricants',      'Lubricants & care',      260),
  -- Added after seeing a real supplier order form: Di2 batteries, chargers and
  -- E-tube wires; power-meter chainsets, which the form lists only by chainring
  -- size; and complete groupset bundles.
  ('groupsets',       'Groupsets',                5),
  ('power-meters',    'Power meters',            55),
  ('electronics',     'Di2 & electronics',       95)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- The client-facing view gains the category, so the portal can filter on it.
--
-- The tier is pinned to the signed-in client's own tier rather than left to
-- RLS to narrow. Both work for a real client, but relying on RLS alone means
-- any caller it does not filter — the service role, a future admin tool — gets
-- an arbitrary tier's prices back, silently and plausibly. Naming the tier
-- makes the view correct on its own, with RLS as a second line rather than the
-- only one. Availability is still only ever a boolean.
-- cascade: later migrations build views on top of this one, and a plain
-- drop fails the moment one exists — which is every re-run of setup.sql.
-- Each dependent view is recreated by its own migration further down.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  c.slug as category_slug,
  c.name as category_name,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c.tier_id from clients c where c.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;


-- ###########################################################################
-- 0006_application_fields.sql
-- ###########################################################################

-- ============================================================================
-- 0006: fuller company details on the trade account application.
--
-- The apply form only ever asked for the bare minimum needed to review an
-- application by hand. Reviewing distributors and importers in particular
-- needs more: a trading name distinct from the registered company, the
-- company and EORI numbers, a social media presence, and a legal invoicing
-- address that may differ from where the goods are actually picked from.
--
-- These are additive and nullable — existing rows and the approval flow
-- (approve_account_request) are untouched. `address` keeps its existing
-- meaning as the trading address.
-- ============================================================================

alter table account_requests
  add column if not exists trading_name      text,
  add column if not exists company_number    text,
  add column if not exists eori_no           text,
  add column if not exists social_media      text,
  add column if not exists invoicing_address text;


-- ###########################################################################
-- 0007_product_images.sql
-- ###########################################################################

-- ============================================================================
-- 0007: product images.
--
-- Supplier price sheets carry no images, so these are attached afterwards —
-- uploaded by staff, or pointed at a supplier's own URL on import. The column
-- holds a full URL rather than a storage path so both work without the app
-- having to know which it is looking at.
-- ============================================================================

alter table products add column if not exists image_url text;

-- Bucket for staff uploads. Public read: a product photo is not confidential,
-- and a public URL means no signing on every catalogue render.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists product_images_staff_write on storage.objects;
create policy product_images_staff_write on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_staff());

drop policy if exists product_images_staff_update on storage.objects;
create policy product_images_staff_update on storage.objects for update
  using (bucket_id = 'product-images' and public.is_staff());

drop policy if exists product_images_staff_delete on storage.objects;
create policy product_images_staff_delete on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_staff());

-- The client-facing view gains the image. Still security_invoker, and the tier
-- is still pinned to the signed-in client's own.
-- cascade: later migrations build views on top of this one, and a plain
-- drop fails the moment one exists — which is every re-run of setup.sql.
-- Each dependent view is recreated by its own migration further down.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  c.slug as category_slug,
  c.name as category_name,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;


-- ###########################################################################
-- 0008_category_tree.sql
-- ###########################################################################

-- ============================================================================
-- 0008: collections become two levels.
--
-- The catalogue started as componentry only, so a flat list of part types was
-- enough. It now has to carry complete bicycles, frames, helmets, clothing,
-- accessories and workshop tools as well, and twenty-seven part types sitting
-- alongside "Clothing" as equals reads as noise.
--
-- So: a group holds collections, and a collection holds products. A product may
-- also attach directly to a group — "Helmet" with no further detail is a real
-- description, and it is better filed under Helmets than forced into a
-- sub-type the text does not support.
-- ============================================================================

alter table categories add column if not exists parent_id uuid references categories(id);
create index if not exists categories_parent_idx on categories (parent_id, sort);

-- 'tools' becomes the group name, so the existing part-type leaf of that name
-- is renamed. Products reference categories by id, so nothing is detached.
update categories set slug = 'workshop-tools', name = 'Workshop tools'
 where slug = 'tools' and parent_id is null
   and not exists (select 1 from categories c2 where c2.slug = 'workshop-tools');

-- ── groups ──────────────────────────────────────────────────────────────────
insert into categories (slug, name, sort) values
  ('bicycles',    'Complete bicycles', 10),
  ('frames',      'Frames & forks',    20),
  ('components',  'Bike parts',        30),
  ('wheelsets',   'Wheels & tyres',    40),
  ('clothing',    'Clothing',          50),
  ('helmets',     'Helmets',           60),
  ('accessories', 'Accessories',       70),
  ('tools',       'Tools & workshop',  80)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- ── new collections ─────────────────────────────────────────────────────────
insert into categories (slug, name, sort) values
  ('road-bikes',      'Road',              10),
  ('gravel-bikes',    'Gravel & cyclocross',20),
  ('mountain-bikes',  'Mountain',          30),
  ('e-bikes',         'Electric',          40),
  ('hybrid-bikes',    'Hybrid & urban',    50),
  ('kids-bikes',      'Kids',              60),
  ('track-bikes',     'Track & TT',        70),

  ('road-frames',     'Road frames',       10),
  ('gravel-frames',   'Gravel frames',     20),
  ('mountain-frames', 'Mountain frames',   30),
  ('forks',           'Forks',             40),

  ('road-helmets',    'Road helmets',      10),
  ('mtb-helmets',     'Mountain helmets',  20),
  ('aero-helmets',    'Aero & TT helmets', 30),
  ('kids-helmets',    'Kids helmets',      40),

  ('jerseys',         'Jerseys',           10),
  ('shorts',          'Shorts & bibs',     20),
  ('jackets',         'Jackets & gilets',  30),
  ('base-layers',     'Base layers',       40),
  ('gloves',          'Gloves',            50),
  ('socks',           'Socks',             60),
  ('shoes',           'Shoes',             70),
  ('eyewear',         'Eyewear',           80),

  ('bottles',         'Bottles & cages',   10),
  ('lights',          'Lights',            20),
  ('computers',       'Computers & sensors',30),
  ('pumps',           'Pumps & inflation', 40),
  ('locks',           'Locks',             50),
  ('luggage',         'Bags & luggage',    60),
  ('mudguards',       'Mudguards & racks', 70),

  ('torque-tools',    'Torque tools',      20),
  ('bleed-kits',      'Bleed kits',        30),
  ('wheel-tools',     'Wheel & spoke tools',40)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- ── parenting ───────────────────────────────────────────────────────────────
-- Everything that was a flat part type becomes a child of Bike parts, except
-- the few that belong to another group now that those groups exist.
update categories child
   set parent_id = parent.id
  from categories parent
 where parent.slug = 'components'
   and child.parent_id is null
   and child.slug in (
     'brake-pads','rotors','brakes','chains','chainsets','chainrings','cassettes',
     'derailleurs','shifters','bottom-brackets','pulleys','bearings','headsets',
     'hubs','pedals','handlebars','stems','seatposts','saddles','cables',
     'electronics','power-meters','groupsets');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'wheelsets' and child.parent_id is null
   and child.slug in ('wheels','spokes','tyres','tubes');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'tools' and child.parent_id is null
   and child.slug in ('workshop-tools','torque-tools','bleed-kits','wheel-tools','lubricants');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'bicycles' and child.parent_id is null
   and child.slug in ('road-bikes','gravel-bikes','mountain-bikes','e-bikes',
                      'hybrid-bikes','kids-bikes','track-bikes');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'frames' and child.parent_id is null
   and child.slug in ('road-frames','gravel-frames','mountain-frames','forks');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'helmets' and child.parent_id is null
   and child.slug in ('road-helmets','mtb-helmets','aero-helmets','kids-helmets');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'clothing' and child.parent_id is null
   and child.slug in ('jerseys','shorts','jackets','base-layers','gloves',
                      'socks','shoes','eyewear');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'accessories' and child.parent_id is null
   and child.slug in ('bottles','lights','computers','pumps','locks',
                      'luggage','mudguards');

-- No category may be its own parent, and a group must not be parented.
update categories set parent_id = null where parent_id = id;


-- ###########################################################################
-- 0009_client_account.sql
-- ###########################################################################

-- ============================================================================
-- 0009: clients maintain their own details and shipping addresses.
--
-- A client record was staff-maintained and held one address. A trade customer
-- with a shop and a warehouse needs several, and should be able to correct
-- their own contact details without emailing to ask.
--
-- The security shape is the point here. A client must never be able to write
-- tier_id, vat_exempt, default_location_id, active or auth_user_id — tier_id
-- alone decides every price they see, so a blanket UPDATE policy on `clients`
-- would let anyone move themselves onto distributor pricing. Clients therefore
-- get no UPDATE policy at all; they go through a definer function that touches
-- only the columns they own.
-- ============================================================================

alter table clients
  add column if not exists trading_name      text,
  add column if not exists contact_name      text,
  add column if not exists company_number    text,
  add column if not exists eori_no           text,
  add column if not exists invoicing_address text;

-- ── shipping addresses ──────────────────────────────────────────────────────
create table if not exists client_addresses (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  label      text not null,
  recipient  text,
  address    text not null,
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists client_addresses_client_idx
  on client_addresses (client_id) where active;

alter table client_addresses enable row level security;

-- No privileged column here, so RLS alone is enough: a client sees and edits
-- their own addresses and no one else's.
drop policy if exists client_addresses_staff on client_addresses;
create policy client_addresses_staff on client_addresses for all
  using (is_staff()) with check (is_staff());

drop policy if exists client_addresses_own on client_addresses;
create policy client_addresses_own on client_addresses for all
  using (client_id = my_client_id())
  with check (client_id = my_client_id());

-- Exactly one default per client, enforced rather than trusted to the caller.
create or replace function public.one_default_address() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_default then
    update client_addresses set is_default = false
     where client_id = new.client_id and id <> new.id and is_default;
  end if;
  return new;
end $$;

drop trigger if exists client_addresses_one_default on client_addresses;
create trigger client_addresses_one_default
  after insert or update of is_default on client_addresses
  for each row when (new.is_default)
  execute function public.one_default_address();

-- Carry the single address each client already has into the new table, so
-- nothing is lost and everyone starts with a usable default.
insert into client_addresses (client_id, label, address, is_default)
select c.id, 'Main address', c.address, true
  from clients c
 where coalesce(trim(c.address), '') <> ''
   and not exists (select 1 from client_addresses a where a.client_id = c.id);

-- ── orders remember where they went ─────────────────────────────────────────
-- ship_to is a snapshot, like unit_price on an order line: correcting an
-- address must never rewrite where a past order was actually sent.
alter table orders
  add column if not exists shipping_address_id uuid references client_addresses(id),
  add column if not exists ship_to text;

-- ── a client editing their own record ───────────────────────────────────────
create or replace function public.update_my_client_details(
  p_name              text,
  p_trading_name      text,
  p_contact_name      text,
  p_email             text,
  p_phone             text,
  p_vat_no            text,
  p_company_number    text,
  p_eori_no           text,
  p_address           text,
  p_invoicing_address text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  v_client := my_client_id();
  if v_client is null then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Company name is required'; end if;

  -- Named columns only. tier_id, vat_exempt, default_location_id, active and
  -- auth_user_id are deliberately absent and stay staff-controlled.
  update clients
     set name              = trim(p_name),
         trading_name      = nullif(trim(coalesce(p_trading_name, '')), ''),
         contact_name      = nullif(trim(coalesce(p_contact_name, '')), ''),
         email             = nullif(trim(coalesce(p_email, '')), ''),
         phone             = nullif(trim(coalesce(p_phone, '')), ''),
         vat_no            = nullif(trim(coalesce(p_vat_no, '')), ''),
         company_number    = nullif(trim(coalesce(p_company_number, '')), ''),
         eori_no           = nullif(trim(coalesce(p_eori_no, '')), ''),
         address           = nullif(trim(coalesce(p_address, '')), ''),
         invoicing_address = nullif(trim(coalesce(p_invoicing_address, '')), '')
   where id = v_client;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'client', v_client, 'self_update');
end $$;

-- ── placing an order against a chosen address ───────────────────────────────
-- Replaces place_order with a shipping-address argument. Everything else is
-- unchanged; the address is validated against the ordering client, resolved to
-- their default when not given, and snapshotted onto the order.
--
-- The old four-argument signature is dropped rather than left alongside it:
-- CREATE OR REPLACE with an extra defaulted parameter makes an overload, not a
-- replacement, and a four-argument call would keep hitting the old one and
-- quietly record no address at all.
drop function if exists public.place_order(uuid, uuid, jsonb, text);

create or replace function public.place_order(
  p_client_id   uuid,
  p_location_id uuid,
  p_lines       jsonb,
  p_notes       text default null,
  p_address_id  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_client      clients%rowtype;
  v_settings    settings%rowtype;
  v_location    uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_invoice_id  uuid;
  v_invoice_no  text;
  v_line        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_price       numeric(12,2);
  v_stock       integer;
  v_alloc       integer;
  v_bo          integer;
  v_total_bo    integer := 0;
  v_vat         numeric(5,2);
  v_po_id       uuid;
  v_po_no       text;
  v_addr        client_addresses%rowtype;
  v_ship_to     text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'Not authorised'; end if;

  if v_role = 'client' and p_client_id is distinct from my_client_id() then
    raise exception 'Not authorised to order for this client';
  end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if not v_client.active then raise exception 'Client account is not active'; end if;

  select * into v_settings from settings where id = 1;

  v_location := coalesce(p_location_id, v_client.default_location_id);
  if v_location is null then raise exception 'No fulfilment location for this order'; end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Order has no lines';
  end if;

  -- The address must belong to the client being ordered for. Without this an
  -- id from another client's account would be accepted and their address
  -- printed on the packing list.
  if p_address_id is not null then
    select * into v_addr from client_addresses
     where id = p_address_id and client_id = p_client_id and active;
    if not found then raise exception 'That delivery address is not on this account'; end if;
  else
    select * into v_addr from client_addresses
     where client_id = p_client_id and active
     order by is_default desc, created_at
     limit 1;
  end if;

  v_ship_to := coalesce(
    case when v_addr.id is not null
         then concat_ws(E'\n', nullif(v_addr.recipient, ''), v_addr.address)
    end,
    v_client.address);

  v_order_no := next_order_number();
  insert into orders (number, client_id, date, fulfilment_location_id, placed_by, notes,
                      shipping_address_id, ship_to)
  values (v_order_no, p_client_id, current_date, v_location, auth.uid(), p_notes,
          v_addr.id, v_ship_to)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    if v_role = 'client' or v_line->>'unit_price' is null then
      v_price := current_tier_price(v_product.id, v_client.tier_id);
    else
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    if v_price is null then raise exception 'No price for % on this tier', v_product.sku; end if;

    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_location for update;
    v_stock := coalesce(v_stock, 0);

    v_alloc := least(v_qty, v_stock);
    v_bo    := v_qty - v_alloc;

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_location;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price, v_alloc, v_bo);

    v_total_bo := v_total_bo + v_bo;
  end loop;

  v_vat := case when v_client.vat_exempt then 0 else v_settings.vat_rate end;
  v_invoice_no := next_invoice_number();
  insert into invoices (number, order_id, client_id, type, date, due_date,
                        vat_rate, location_id, ready_to_pack)
  values (v_invoice_no, v_order_id, p_client_id, 'full', current_date,
          current_date + v_settings.payment_days, v_vat, v_location, v_total_bo = 0)
  returning id into v_invoice_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_invoice_id, sku, name, qty, unit_price from order_lines where order_id = v_order_id;

  insert into order_events (order_id, type, meta)
  values (v_order_id, 'placed', jsonb_build_object('number', v_order_no)),
         (v_order_id, 'invoice_sent', jsonb_build_object('invoice', v_invoice_no, 'invoice_id', v_invoice_id));

  if v_total_bo > 0 then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_location)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order_no, v_order_id
      from order_lines where order_id = v_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = v_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  perform refresh_invoice_readiness(v_order_id);
  return v_order_id;
end $$;


-- ###########################################################################
-- 0010_staff_accounts.sql
-- ###########################################################################

-- ============================================================================
-- 0010: named staff accounts, and who gets told about orders and applications.
--
-- A staff account cannot simply be inserted: the profile row is keyed to an
-- auth user that does not exist until that person signs in for the first time.
-- Promoting them by hand afterwards means someone has to remember, and until
-- they do the new starter signs in as a client and sees the trade portal.
--
-- So the allowlist comes first. An address listed here is given its role the
-- moment the account appears, whether that is through the signup trigger or
-- through the application's own fallback — and anyone already signed in with
-- the wrong role is corrected when this file runs.
-- ============================================================================

create table if not exists staff_invites (
  email      text primary key,
  role       user_role not null default 'admin',
  note       text,
  created_at timestamptz not null default now(),
  constraint staff_invites_email_lower check (email = lower(email)),
  constraint staff_invites_not_client check (role <> 'client')
);

comment on table staff_invites is
  'Addresses that become staff on first sign-in. Being listed here grants a '
  'role, so only an admin may read or write it.';

alter table staff_invites enable row level security;

-- Deliberately admin-only, not is_staff(): this table decides who is staff, so
-- letting ops or accounts edit it would let them promote themselves.
drop policy if exists staff_invites_admin on staff_invites;
create policy staff_invites_admin on staff_invites for all
  using (is_admin()) with check (is_admin());

insert into staff_invites (email, role, note) values
  ('james@iqsportsupply.com',  'admin', 'Director'),
  ('rohail@iqsportsupply.com', 'admin', 'Director')
on conflict (email) do update set role = excluded.role, note = excluded.note;

-- ── first sign-in picks the role up ─────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  -- An allowlisted address is staff from its very first sign-in; everyone
  -- else is a client, as before.
  select si.role into v_role
    from staff_invites si where si.email = lower(new.email);

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name',
          coalesce(v_role, 'client'))
  on conflict (id) do nothing;

  -- Link an approved client that was created for this email address. Staff
  -- are excluded: a staff address must never be attached to a trade account.
  if v_role is null then
    update public.clients set auth_user_id = new.id
     where auth_user_id is null and lower(email) = lower(new.email);
  end if;

  return new;
end $$;

-- Same caveat as 0002: some hosted setups will not let this trigger be added
-- to auth.users, and that must not abort the file. The application's own
-- ensureProfile() applies the same allowlist, so sign-in works either way.
do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception when insufficient_privilege then
  raise notice
    'Could not add the signup trigger to auth.users (%). Everything else is '
    'installed, and the app assigns staff roles itself on first sign-in.',
    sqlerrm;
end $$;

-- ── correct anyone who has already signed in ────────────────────────────────
update profiles p
   set role = si.role
  from staff_invites si
 where lower(p.email) = si.email
   and p.role is distinct from si.role;

-- A staff address must not also be a trade account; detach it if it ever was.
update clients c
   set auth_user_id = null
  from profiles p
  join staff_invites si on si.email = lower(p.email)
 where c.auth_user_id = p.id;

-- ── who hears about orders and applications ─────────────────────────────────
-- application_recipient held one address. Both directors want the
-- applications, so it becomes a list like confirmation_cc already is.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'settings' and column_name = 'application_recipient') then
    alter table settings rename column application_recipient to application_recipients;
    alter table settings
      alter column application_recipients drop default,
      alter column application_recipients type text[]
        using case when coalesce(trim(application_recipients), '') = ''
                   then '{}'::text[] else array[application_recipients] end,
      alter column application_recipients set default '{}'::text[];
  end if;
end $$;

alter table settings
  add column if not exists application_recipients text[] not null default '{}';

update settings set
  confirmation_cc        = array['james@iqsportsupply.com','rohail@iqsportsupply.com'],
  application_recipients = array['james@iqsportsupply.com','rohail@iqsportsupply.com'],
  supplier_recipient     = case when coalesce(trim(supplier_recipient), '') = ''
                                then 'james@iqsportsupply.com' else supplier_recipient end
 where id = 1;


-- ###########################################################################
-- 0011_staff_admin.sql
-- ###########################################################################

-- ============================================================================
-- 0011: an admin manages the staff list from the app.
--
-- 0010 introduced staff_invites and seeded the two directors. Editing it meant
-- opening the SQL editor, which is not something to ask of someone adding a
-- warehouse hand, so these two functions put it behind a screen.
--
-- Both are definer functions rather than direct table writes because granting
-- an account a role is exactly the operation that must not be loosened: they
-- check who is asking, and they refuse the three ways an admin could lock the
-- company out of its own system or hand a role to a customer.
-- ============================================================================

-- Raises unless the caller is an admin. Every entry point starts here.
create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only an admin can change who works here';
  end if;
end $$;

-- How many admins would remain if this address stopped being one. Counted
-- across both the allowlist and the profiles, because a person may exist in
-- either — invited but not yet signed in, or promoted by hand years ago.
create or replace function public.other_admin_count(p_email text) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from (
    select si.email from staff_invites si
      where si.role = 'admin' and si.email <> lower(p_email)
    union
    select lower(p.email) from profiles p
      where p.role = 'admin' and lower(p.email) <> lower(p_email)
         and p.email is not null
  ) remaining;
$$;

/**
 * Adds a staff member, or changes the role of one who is already listed.
 *
 * Takes effect immediately for someone who has already signed in, and waits in
 * the allowlist for someone who has not — so an admin never has to come back
 * and finish the job once the new starter first logs in.
 */
create or replace function public.invite_staff(
  p_email text,
  p_role  user_role,
  p_note  text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  perform assert_admin();

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  if p_role = 'client' then
    raise exception 'Use Clients to manage trade accounts, not this screen';
  end if;

  -- A trade customer must never be turned into staff here: their orders and
  -- pricing hang off the client record this would orphan.
  if exists (select 1 from clients where lower(email) = v_email) then
    raise exception 'That address belongs to a trade account, so it cannot be staff';
  end if;

  -- Demoting the last admin leaves nobody who can undo it.
  if p_role <> 'admin' and other_admin_count(v_email) = 0 then
    raise exception 'That would leave no admin. Make someone else an admin first';
  end if;

  insert into staff_invites (email, role, note)
  values (v_email, p_role, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (email) do update
    set role = excluded.role,
        note = coalesce(excluded.note, staff_invites.note);

  -- Anyone already signed in changes role now rather than at next login.
  update profiles set role = p_role where lower(email) = v_email;

  -- A role other than ops has no business holding site assignments.
  if p_role <> 'ops' then
    delete from ops_locations
     where profile_id in (select id from profiles where lower(email) = v_email);
  end if;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'staff', null, 'invite:' || v_email || ':' || p_role);
end $$;

/**
 * Removes someone's access. They keep their sign-in, but land on the "no
 * access" page rather than the staff app — the same place any stranger lands.
 */
create or replace function public.revoke_staff(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  perform assert_admin();

  -- Removing yourself is almost always a slip, and it is the one mistake you
  -- cannot undo from this screen.
  if v_email = (select lower(email) from profiles where id = auth.uid()) then
    raise exception 'You cannot remove your own access';
  end if;

  if other_admin_count(v_email) = 0 then
    raise exception 'That would leave no admin. Make someone else an admin first';
  end if;

  delete from staff_invites where email = v_email;
  delete from ops_locations
   where profile_id in (select id from profiles where lower(email) = v_email);
  update profiles set role = 'client' where lower(email) = v_email;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'staff', null, 'revoke:' || v_email);
end $$;


-- ###########################################################################
-- 0012_bulk_delete_products.sql
-- ###########################################################################

-- ============================================================================
-- 0012: removing products from the catalogue in bulk.
--
-- A price list arrives with lines that should never have been listed, or a
-- supplier drops a range, and clearing them one at a time is not realistic.
--
-- The care needed is in what "delete" means. order_lines and
-- stock_transfer_lines reference products without ON DELETE, so Postgres
-- already refuses to destroy anything that has been sold or moved — correctly,
-- because an invoice has to keep saying what was on it. A bulk action that
-- simply failed on those rows would be useless on any real selection, so this
-- splits the work: anything with no history is genuinely deleted, anything
-- with history is withdrawn from the catalogue instead, and the caller is told
-- which was which rather than being left to guess.
-- ============================================================================

create or replace function public.delete_products(p_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role      user_role;
  v_deletable uuid[];
  v_withdrawn text[];
  v_deleted   integer;
begin
  select role into v_role from profiles where id = auth.uid();
  -- Deliberately narrower than the rest of the catalogue screen, which any
  -- staff member can use: ops pack boxes, and should not be able to empty the
  -- price list from the same page they check a SKU on.
  if v_role is null or v_role not in ('admin', 'accounts') then
    raise exception 'Only an admin or accounts user can delete products';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Nothing was selected';
  end if;

  -- Sold or moved at any point, so the history has to keep naming them.
  select coalesce(array_agg(p.sku order by p.sku), '{}')
    into v_withdrawn
    from products p
   where p.id = any(p_ids)
     and (exists (select 1 from order_lines ol where ol.product_id = p.id)
       or exists (select 1 from stock_transfer_lines tl where tl.product_id = p.id));

  update products set active = false
   where id = any(p_ids)
     and (exists (select 1 from order_lines ol where ol.product_id = products.id)
       or exists (select 1 from stock_transfer_lines tl where tl.product_id = products.id));

  select coalesce(array_agg(p.id), '{}')
    into v_deletable
    from products p
   where p.id = any(p_ids)
     and not exists (select 1 from order_lines ol where ol.product_id = p.id)
     and not exists (select 1 from stock_transfer_lines tl where tl.product_id = p.id);

  -- tier_prices and stock_levels cascade, so this clears their rows too.
  delete from products where id = any(v_deletable);
  get diagnostics v_deleted = row_count;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'product', null,
          'bulk_delete:' || v_deleted || ' deleted,'
          || coalesce(array_length(v_withdrawn, 1), 0) || ' withdrawn');

  return jsonb_build_object(
    'deleted',   v_deleted,
    'withdrawn', to_jsonb(v_withdrawn));
end $$;


-- ###########################################################################
-- 0013_product_groups.sql
-- ###########################################################################

-- ============================================================================
-- 0013: variants and build-your-own kits.
--
-- A tyre in five sizes, and a groupset the customer specs themselves, look
-- like different features but are the same shape underneath — and neither
-- needs a new kind of product. Every size and every component is already a
-- real SKU on the price list, with its own tier price and its own stock; what
-- is missing is a way to present them as one thing to choose from.
--
-- So a group holds ordered steps, and each step offers options that point at
-- products that already exist:
--
--   Continental GP5000     → one step  "Size"     → 700x25 / 700x28 / 700x32
--   Dura-Ace R9200 build   → steps     "Chainset" → 170mm 52-36 / 172.5mm …
--                                      "Cassette" → 11-30 / 11-34
--                                      "Rotors"   → 140mm / 160mm
--
-- One step reads as a variant picker, several read as a builder. There is no
-- kind column deciding which: the number of steps already says it, and a flag
-- that could disagree with the steps is a state worth not having.
--
-- Nothing here holds a price. Pricing stays in tier_prices against the real
-- product, so a group can never quote a figure the catalogue would not honour.
-- ============================================================================

create table if not exists product_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  brand       text,
  description text,
  category_id uuid references categories(id) on delete set null,
  image_url   text,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint product_groups_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists product_groups_category_idx
  on product_groups (category_id) where active;

create table if not exists product_group_steps (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references product_groups(id) on delete cascade,
  name     text not null,
  hint     text,
  -- How many of the chosen option one kit needs: two rotors, one cassette.
  qty      integer not null default 1 check (qty > 0),
  -- A step nobody has to answer, such as an optional power meter.
  required boolean not null default true,
  sort     integer not null default 0
);
create index if not exists product_group_steps_group_idx
  on product_group_steps (group_id, sort);

create table if not exists product_group_options (
  id      uuid primary key default gen_random_uuid(),
  step_id uuid not null references product_group_steps(id) on delete cascade,
  -- Cascade: a product deleted from the catalogue must not leave an option
  -- pointing at nothing for a customer to pick.
  product_id uuid not null references products(id) on delete cascade,
  -- What the customer sees on the button. Falls back to the product name.
  label   text,
  sort    integer not null default 0,
  unique (step_id, product_id)
);
create index if not exists product_group_options_step_idx
  on product_group_options (step_id, sort);

-- ── who sees what ───────────────────────────────────────────────────────────
alter table product_groups       enable row level security;
alter table product_group_steps  enable row level security;
alter table product_group_options enable row level security;

-- Read by anyone signed in, exactly like products and categories: the group
-- carries no price, so there is nothing tier-specific to leak. Writes are
-- staff-only, as with the rest of the catalogue.
drop policy if exists product_groups_read on product_groups;
create policy product_groups_read on product_groups for select
  using (active or is_staff());
drop policy if exists product_groups_staff_write on product_groups;
create policy product_groups_staff_write on product_groups for all
  using (is_staff()) with check (is_staff());

drop policy if exists product_group_steps_read on product_group_steps;
create policy product_group_steps_read on product_group_steps for select using (true);
drop policy if exists product_group_steps_staff_write on product_group_steps;
create policy product_group_steps_staff_write on product_group_steps for all
  using (is_staff()) with check (is_staff());

drop policy if exists product_group_options_read on product_group_options;
create policy product_group_options_read on product_group_options for select using (true);
drop policy if exists product_group_options_staff_write on product_group_options;
create policy product_group_options_staff_write on product_group_options for all
  using (is_staff()) with check (is_staff());

-- ── what a client may actually choose ───────────────────────────────────────
-- An option is only offerable if the product behind it is still active and
-- carries a price on the asking client's tier. Without this a build could show
-- a step whose every option prices at nothing, and place_order would then bill
-- a line the catalogue never quoted.
--
-- security_invoker so client_catalogue's own RLS decides the rows, which is
-- what pins each client to their own tier.
create or replace view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;


-- ###########################################################################
-- 0014_group_axes.sql
-- ###########################################################################

-- ============================================================================
-- 0014: choosing a part by two things at once, and real groupset builds.
--
-- A chainset is one SKU that fixes both the crank length and the chainring
-- pair: FCR9200C26 is 170mm and 52/36, and there are fifteen of them per
-- groupset. Presenting that as a flat list of fifteen radio buttons asks the
-- customer to scan for a combination rather than state one, which is not how
-- anybody specs a bike.
--
-- So a step may name up to two axes. When it does, the builder offers one
-- control per axis and resolves the pair to the single SKU that matches. A
-- step with no axes is unchanged — a plain list, which is right for a cassette
-- or a rotor.
--
-- The axis values are read out of the product name rather than the part code:
-- the supplier writes "C/SET D/Ace R9200 50/34 170mm", which states both
-- plainly, where the code says C26 and would have to be decoded from a
-- convention we would be guessing at.
-- ============================================================================

alter table product_group_steps
  add column if not exists axis1_name text,
  add column if not exists axis2_name text;

alter table product_group_options
  add column if not exists axis1_value text,
  add column if not exists axis2_value text;

create index if not exists product_group_options_axes_idx
  on product_group_options (step_id, axis1_value, axis2_value);

-- Two options on the same step must not claim the same pair, or the controls
-- would resolve to whichever row came back first.
create unique index if not exists product_group_options_axis_unique
  on product_group_options (step_id, axis1_value, axis2_value)
  where axis1_value is not null;

-- The client view carries the axes through, so the builder can group by them.
-- Dropped rather than replaced: CREATE OR REPLACE cannot add a column in the
-- middle of an existing view's column list.
drop view if exists client_group_options;
create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;

-- ── reading a spec out of a supplier's description ──────────────────────────
-- "C/SET D/Ace R9200 50/34 170mm"        → 50/34, 170mm
-- "Power 50 / 34 - double - 172.5 mm"    → 50/34, 172.5mm
-- "CASS D/Ace R9200 12 spd 11-30T"       → 11-30T
create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(substring(p_name from '(\d{2}\s*/\s*\d{2})'), ' ', '')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    else null
  end;
$$;

-- Clear every overload of these two before defining them. A signature-by-
-- signature drop is not enough here: setup.sql applies 0014 and then 0015 on
-- every run, so re-running recreates 0014's shorter version alongside 0015's
-- longer one, and the four-argument calls inside seed_shimano_groupset then
-- match both and fail as ambiguous.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

/**
 * Adds one step to a group and attaches every catalogue SKU matching a
 * pattern. Re-runnable: the step is matched by name, and an option already
 * present is left alone, so this can be applied again after a price list
 * import brings new SKUs in.
 */
create or replace function public.seed_group_step(
  p_group_slug text,
  p_step_name  text,
  p_sort       integer,
  p_pattern    text,
  p_required   boolean default true,
  p_qty        integer default 1,
  p_axis1      text default null,
  p_axis2      text default null,
  p_hint       text default null,
  p_exclude    text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2
     where id = v_step;
  end if;

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         -- Where the axes say it all, the label repeats them rather than the
         -- supplier's whole shorthand line.
         case when p_axis1 is not null then
           concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
         else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         row_number() over (order by p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     -- A step with axes can only offer SKUs whose spec we could actually read.
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;
end $$;

/** Builds one Shimano Di2 groupset out of whatever of it is in the catalogue. */
create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into product_groups (slug, name, brand, description, category_id)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, and rotors front '
         || 'and rear or none at all. Every part is ordered as its own line at '
         || 'its own price, so you can adjust anything before you check out.',
         (select id from categories where slug = 'groupsets')
  on conflict (slug) do update set name = excluded.name;

  -- The parts that make it that groupset. One option each, so they are simply
  -- shown as included rather than asked about.
  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  -- The specification.
  perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
    'Crank length', 'Chainring', 'Standard chainset — power meter versions are listed separately',
    p_chainset || 'P%');
  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  -- The Di2 electronics. Included rather than asked about, and the reason the
  -- configured build comes to exactly the price the supplier publishes for the
  -- standard bundle: the seven parts above total £1,122.62 on Dura-Ace, and
  -- these four bring it to £1,209.87, which is their own bundle price.
  perform seed_group_step(p_slug, 'Battery',        9, p_battery);
  perform seed_group_step(p_slug, 'Charger',       10, p_charger);
  perform seed_group_step(p_slug, 'Di2 wire 900mm',  11, p_wire_a);
  perform seed_group_step(p_slug, 'Di2 wire 1000mm', 12, p_wire_b);

  -- Rotors: chosen independently front and rear, or left off entirely.
  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Leave out if the wheels already have rotors');
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front');
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');

select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');


-- ###########################################################################
-- 0015_rotor_sizes.sql
-- ###########################################################################

-- ============================================================================
-- 0015: rotors chosen by size.
--
-- The supplier's sheet gives no description for any rotor — just a code and a
-- price — so 0014 left them reading "Shimano Disc Rotor RTCL900SE", which is
-- no use to anyone specifying a bike. The size is in the code: Shimano writes
-- SS, S, M and L for 140, 160, 180 and 203mm, and spells the bigger XTR sizes
-- out (RTCL750200E is 200mm).
--
-- That convention is an assumption, not something the sheet states. It is kept
-- in one CASE below so it is easy to see and easy to correct, and it holds
-- against the data: all 48 rotors resolve, and the price bands per size line
-- up. On a groupset only the road sizes are offered, which is what a road
-- groupset takes.
--
-- Unlike a chainset, several rotors share a size — three 160mm in the R9200
-- range, differing in lockring — so size is a label and a filter here rather
-- than an axis, which would need one SKU per value.
-- ============================================================================

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(substring(p_name from '(\d{2}\s*/\s*\d{2})'), ' ', '')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Rotor size' then
      coalesce(
        -- XTR and downhill sizes are written out in the code itself.
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        -- Otherwise the letter after the model number. SS is tested before S,
        -- or every 140 would read as a 160.
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

-- Clear every overload of these two before defining them. A signature-by-
-- signature drop is not enough here: setup.sql applies 0014 and then 0015 on
-- every run, so re-running recreates 0014's shorter version alongside 0015's
-- longer one, and the four-argument calls inside seed_shimano_groupset then
-- match both and fail as ambiguous.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  -- A spec used to label and narrow the options without making it an axis,
  -- for a step where several SKUs legitimately share the same value.
  p_spec        text default null,
  p_spec_values text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2
     where id = v_step;
  end if;

  -- An option that no longer belongs — a size we have stopped offering on this
  -- step — is cleared out, so narrowing the list actually narrows it.
  if p_spec is not null and p_spec_values is not null then
    delete from product_group_options o
     using products p
     where o.step_id = v_step and p.id = o.product_id
       and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values);
  end if;

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           -- The size is the choice. The part code is already printed under
           -- the label, so repeating it here only reads as noise.
           when p_spec is not null then spec_value(p.name, p_spec)
           else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         row_number() over (order by spec_value(p.name, p_spec) nulls last, p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and (p_spec_values is null or spec_value(p.name, p_spec) = any (p_spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;

  -- Labels are rebuilt for options already present, so re-running after this
  -- migration renames the ones 0014 left reading as bare part codes.
  if p_spec is not null then
    update product_group_options o
       set label = spec_value(p.name, p_spec)
      from products p
     where p.id = o.product_id and o.step_id = v_step;
  end if;
end $$;

-- Rebuild both groupsets so the rotor steps pick this up.
create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into product_groups (slug, name, brand, description, category_id)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, and rotors front '
         || 'and rear or none at all. Every part is ordered as its own line at '
         || 'its own price, so you can adjust anything before you check out.',
         (select id from categories where slug = 'groupsets')
  on conflict (slug) do update set name = excluded.name;

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
    'Crank length', 'Chainring', 'Standard chainset — power meter versions are listed separately',
    p_chainset || 'P%');
  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  -- Road sizes only: a road groupset takes 140 or 160, and offering the 180
  -- and 203 from the same range would only invite a wrong order.
  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Choose 160mm or 140mm, or leave out if the wheels already have rotors',
    null, 'Rotor size', array['140mm','160mm']);
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front',
    null, 'Rotor size', array['140mm','160mm']);

  perform seed_group_step(p_slug, 'Battery',         9, p_battery);
  perform seed_group_step(p_slug, 'Charger',        10, p_charger);
  perform seed_group_step(p_slug, 'Di2 wire 900mm',  11, p_wire_a);
  perform seed_group_step(p_slug, 'Di2 wire 1000mm', 12, p_wire_b);
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');

select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');

-- Every rotor in the catalogue gets its size in its name, not just the ones a
-- groupset offers: "Shimano Disc Rotor RTCL900SE" tells a customer nothing.
update products
   set name = 'Shimano ' || spec_value(name, 'Rotor size') || ' Disc Rotor ' || sku
 where name like 'Shimano Disc Rotor %'
   and spec_value(name, 'Rotor size') is not null;


-- ###########################################################################
-- 0016_power_groupsets.sql
-- ###########################################################################

-- ============================================================================
-- 0016: the power-meter groupsets.
--
-- A power-meter build is the standard build with the power chainset in place
-- of the standard one, and the supplier's own arithmetic says exactly that:
-- Dura-Ace at 1209.87 less the 177.88 chainset plus the 496.80 power chainset
-- is 1528.79, which is their published bundle price to the penny, and Ultegra
-- works out the same way at 994.16.
--
-- So this adds a flag to the seeding rather than a second list of steps. The
-- two builds are separate groups because that is how they are sold — the
-- difference is £319 on Dura-Ace, which is a choice made before speccing
-- rather than during it — but nothing about the parts list is duplicated.
--
-- The power chainsets carry the same crank length and chainring axes: the
-- supplier writes them as "Power 50 / 34 - double - 172.5 mm", which states
-- both just as plainly as the standard line does.
-- ============================================================================

-- Same reason as 0014 and 0015: p_power is a new parameter, and a re-run of
-- setup.sql would otherwise leave the older signature alongside this one.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  p_spec        text default null,
  p_spec_values text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2
     where id = v_step;
  end if;

  -- Anything no longer matching this step's pattern is cleared out, so a step
  -- that is narrowed — or switched from standard to power chainsets — actually
  -- changes rather than accumulating both.
  delete from product_group_options o
   using products p
   where o.step_id = v_step and p.id = o.product_id
     and (p.sku not like p_pattern
          or (p_exclude is not null and p.sku like p_exclude)
          or (p_spec_values is not null
              and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values)));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           when p_spec is not null then spec_value(p.name, p_spec)
           else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         row_number() over (order by spec_value(p.name, p_spec) nulls last, p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and (p_spec_values is null or spec_value(p.name, p_spec) = any (p_spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;

  if p_spec is not null then
    update product_group_options o
       set label = spec_value(p.name, p_spec)
      from products p
     where p.id = o.product_id and o.step_id = v_step;
  end if;
end $$;

create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100',
  p_power boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into product_groups (slug, name, brand, description, category_id, sort)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, and rotors front '
         || 'and rear or none at all. Every part is ordered as its own line at '
         || 'its own price, so you can adjust anything before you check out.'
         || case when p_power then
              E'\n\nThis build uses the power-meter chainset. The same groupset '
              || 'without one is listed separately.'
            else '' end,
         (select id from categories where slug = 'groupsets'),
         case when p_power then 1 else 0 end
  on conflict (slug) do update
    set name = excluded.name, description = excluded.description, sort = excluded.sort;

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  -- The only difference between the two builds: which chainsets are offered.
  if p_power then
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset || 'P%', true, 1,
      'Crank length', 'Chainring', 'Power-meter chainset');
  else
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
      'Crank length', 'Chainring', 'Standard chainset — the power-meter build is listed separately',
      p_chainset || 'P%');
  end if;

  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Choose 160mm or 140mm, or leave out if the wheels already have rotors',
    null, 'Rotor size', array['140mm','160mm']);
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front',
    null, 'Rotor size', array['140mm','160mm']);

  perform seed_group_step(p_slug, 'Battery',         9, p_battery);
  perform seed_group_step(p_slug, 'Charger',        10, p_charger);
  perform seed_group_step(p_slug, 'Di2 wire 900mm',  11, p_wire_a);
  perform seed_group_step(p_slug, 'Di2 wire 1000mm', 12, p_wire_b);
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');

select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');

select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);

select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);


-- ###########################################################################
-- 0017_rings_and_wires.sql
-- ###########################################################################

-- ============================================================================
-- 0017: chainrings written with a hyphen, and a choice of Di2 wire length.
--
-- Two things, both found by looking at what a Dura-Ace build actually offers.
--
-- 52/36 at 170mm — the commonest road setup there is — was missing from the
-- standard build. Not because the SKU is absent but because it is described
-- "Crankset 170mm 52-36", with a hyphen, where every other line uses a slash.
-- The reader only knew about slashes, so that one chainset came through with
-- no chainring at all: present on the step, unreachable from the controls,
-- and invisible in a list of what is on offer. A chainring is now read either
-- way and always stored as a slash, so the two spellings land on one value.
--
-- Guarding against the same shape of fault: an option that cannot supply a
-- value for an axis the step names is no longer added at all. It could never
-- be chosen, and a step is easier to trust when everything on it is reachable.
--
-- And the Di2 wires were two fixed parts, a 900 and a 1000, included without
-- being asked about. Which lengths a frame needs is the mechanic's call, so
-- both are now chosen. The build still takes two, which is what the supplier's
-- own bundle price is built on.
-- ============================================================================

do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      -- "52/36", "52 / 36" and "52-36" are the same pair written three ways.
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      -- A cassette range is also hyphenated, so it is matched before the
      -- chainring rule could ever see it; the two never share a step.
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      -- Three or four digits: a 900mm wire and a 1000mm one.
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Rotor size' then
      coalesce(
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  p_spec        text default null,
  p_spec_values text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2
     where id = v_step;
  end if;

  delete from product_group_options o
   using products p
   where o.step_id = v_step and p.id = o.product_id
     and (p.sku not like p_pattern
          or (p_exclude is not null and p.sku like p_exclude)
          or (p_spec_values is not null
              and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values))
          -- An option that cannot answer an axis the step names could never be
          -- picked from the controls, so it does not belong on the step.
          or (p_axis1 is not null and spec_value(p.name, p_axis1) is null)
          or (p_axis2 is not null and spec_value(p.name, p_axis2) is null));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           when p_spec is not null then spec_value(p.name, p_spec)
           else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         -- Ordered by the number in the spec, not its text, or a 1000mm wire
         -- would list before a 900mm one.
         row_number() over (order by
           nullif(regexp_replace(coalesce(spec_value(p.name, p_spec), ''),
                                 '[^0-9.]', '', 'g'), '')::numeric nulls last,
           p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and (p_axis2 is null or spec_value(p.name, p_axis2) is not null)
     and (p_spec_values is null or spec_value(p.name, p_spec) = any (p_spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;

  -- Order is recomputed, not just set on first insert: options added before a
  -- step knew how to read a spec kept the order they were found in, which is
  -- how the rotors came to list 160 before 140.
  with ordered as (
    select o.id,
           row_number() over (order by
             nullif(regexp_replace(coalesce(spec_value(p.name, p_spec), ''),
                                   '[^0-9.]', '', 'g'), '')::numeric nulls last,
             p.sku) as rn
      from product_group_options o
      join products p on p.id = o.product_id
     where o.step_id = v_step)
  update product_group_options o set sort = ordered.rn
    from ordered where ordered.id = o.id;

  -- Labels and axis values are rebuilt for options already present, so a
  -- chainset that used to read with no chainring now reads with one.
  update product_group_options o
     set label = case
                   when p_axis1 is not null then
                     concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
                   when p_spec is not null then spec_value(p.name, p_spec)
                   else p.name end,
         axis1_value = spec_value(p.name, p_axis1),
         axis2_value = spec_value(p.name, p_axis2)
    from products p
   where p.id = o.product_id and o.step_id = v_step;
end $$;

create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100',
  p_power boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_wires text := 'EWSD300%';
begin
  insert into product_groups (slug, name, brand, description, category_id, sort)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, Di2 wire lengths, '
         || 'and rotors front and rear or none at all. Every part is ordered as '
         || 'its own line at its own price, so you can adjust anything before you '
         || 'check out.'
         || case when p_power then
              E'\n\nThis build uses the power-meter chainset. The same groupset '
              || 'without one is listed separately.'
            else '' end,
         (select id from categories where slug = 'groupsets'),
         case when p_power then 1 else 0 end
  on conflict (slug) do update
    set name = excluded.name, description = excluded.description, sort = excluded.sort;

  select id into v_group from product_groups where slug = p_slug;

  -- The wires used to be two fixed parts named for their length. They are a
  -- choice now, so the old steps go rather than sitting alongside the new ones.
  delete from product_group_steps
   where group_id = v_group and name in ('Di2 wire 900mm', 'Di2 wire 1000mm');

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  if p_power then
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset || 'P%', true, 1,
      'Crank length', 'Chainring', 'Power-meter chainset');
  else
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
      'Crank length', 'Chainring', 'Standard chainset — the power-meter build is listed separately',
      p_chainset || 'P%');
  end if;

  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Choose 160mm or 140mm, or leave out if the wheels already have rotors',
    null, 'Rotor size', array['140mm','160mm']);
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front',
    null, 'Rotor size', array['140mm','160mm']);

  perform seed_group_step(p_slug, 'Battery',  9, p_battery);
  perform seed_group_step(p_slug, 'Charger', 10, p_charger);

  -- Two wires, each a length. Which lengths a frame needs is the mechanic's
  -- call; the supplier's bundle happens to be a 900 and a 1000.
  perform seed_group_step(p_slug, 'First Di2 wire',  11, v_wires, true, 1,
    null, null, 'Choose the length this frame needs', null, 'Wire length');
  perform seed_group_step(p_slug, 'Second Di2 wire', 12, v_wires, true, 1,
    null, null, 'The second run, often a different length', null, 'Wire length');
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');
select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');
select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);


-- ###########################################################################
-- 0018_order_admin.sql
-- ###########################################################################

-- ============================================================================
-- 0018: amending, cancelling and crediting an order, and loading past ones.
--
-- Everything here changes an order after it has been placed, which is the part
-- of the system where a mistake is expensive: stock has been committed, an
-- invoice has a number, and a client may already have paid. So each of these
-- refuses rather than improvises when the order has moved past the point where
-- the change is safe, and every one of them leaves an event behind.
--
-- Two new document types. A proforma is a request to confirm, not a debt: it
-- carries no due date and must never count toward what a client owes, which is
-- the point of offering one for back-ordered goods a client will not pay for
-- in advance. A credit note is the opposite sign — money back — and likewise
-- is not an invoice waiting to be paid.
-- ============================================================================

do $$ begin
  alter type invoice_type add value if not exists 'proforma';
  alter type invoice_type add value if not exists 'credit';
end $$;

do $$ begin
  alter type order_event_type add value if not exists 'edited';
  alter type order_event_type add value if not exists 'cancelled';
  alter type order_event_type add value if not exists 'credited';
  alter type order_event_type add value if not exists 'proforma_sent';
end $$;

-- Why an order was cancelled, and what a credit note is for, belong with them.
alter table orders   add column if not exists cancelled_at     timestamptz;
alter table orders   add column if not exists cancelled_reason text;
alter table invoices add column if not exists credit_of        uuid references invoices(id);
alter table invoices add column if not exists note             text;

comment on column invoices.credit_of is
  'The invoice this credit note reverses. Null on every other type.';

-- ── shared guards ───────────────────────────────────────────────────────────
-- An order stops being safe to change once money or goods have moved. Each
-- caller says which of those it minds, but they all mind the same things.
create or replace function public.assert_order_amendable(p_order_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Unknown order'; end if;
  if v_order.status = 'cancelled' then
    raise exception 'That order is cancelled';
  end if;

  if exists (select 1 from invoices
              where order_id = p_order_id and not superseded and paid
                and type in ('full','shipment','backorder')) then
    raise exception 'This order has been paid. Raise a credit note instead of changing it';
  end if;
  if exists (select 1 from invoices
              where order_id = p_order_id and not superseded and (packed or shipped)) then
    raise exception 'This order has already been packed or shipped';
  end if;
  -- A supplier order exists for every back-ordered line from the moment the
  -- order is placed, so its mere existence cannot be the objection. What
  -- cannot be undone is stock that has already arrived against it.
  if exists (select 1 from po_lines where order_id = p_order_id and received_qty > 0) then
    raise exception 'Part of this order has already arrived from the supplier';
  end if;
end $$;

/** Puts allocated stock back on the shelf. Used when lines change or go away. */
create or replace function public.release_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_loc uuid;
begin
  select fulfilment_location_id into v_loc from orders where id = p_order_id;
  update stock_levels s
     set qty = s.qty + l.alloc_qty
    from order_lines l
   where l.order_id = p_order_id and l.alloc_qty > 0
     and s.product_id = l.product_id and s.location_id = v_loc;
  update order_lines set alloc_qty = 0, bo_qty = qty where order_id = p_order_id;
end $$;

/**
 * Takes an order's lines back off any supplier order that has not yet been
 * received, so a PO stops claiming goods the order no longer wants. The PO
 * itself is left in place: staff can see it emptied and tell the supplier.
 */
create or replace function public.withdraw_from_supplier(p_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_removed integer;
begin
  delete from po_lines where order_id = p_order_id and received_qty = 0;
  get diagnostics v_removed = row_count;
  update order_lines set po_qty = 0 where order_id = p_order_id;
  return v_removed;
end $$;

/**
 * Replaces an order's lines with the set given, re-allocating stock and
 * reissuing the invoice.
 *
 * p_lines is the whole order as it should now read, not a patch: a line left
 * out is a line removed. Prices already agreed are kept — a line still present
 * keeps the price it was placed at, because re-pricing an order while amending
 * a quantity is not what anyone means by editing it.
 */
create or replace function public.edit_order(p_order_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order    orders%rowtype;
  v_client   clients%rowtype;
  v_settings settings%rowtype;
  v_line     jsonb;
  v_product  products%rowtype;
  v_qty      integer;
  v_price    numeric(12,2);
  v_stock    integer;
  v_alloc    integer;
  v_inv_id   uuid;
  v_withdrawn integer;
  v_po_id    uuid;
  v_po_no    text;
begin
  perform assert_order_amendable(p_order_id);

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'An order must have at least one line. Cancel it instead';
  end if;

  select * into v_order from orders where id = p_order_id;
  select * into v_client from clients where id = v_order.client_id;
  select * into v_settings from settings where id = 1;

  -- Prices already agreed on this order, so an edit does not silently reprice.
  create temporary table if not exists _kept_price (product_id uuid primary key, unit_price numeric(12,2))
    on commit drop;
  delete from _kept_price;
  insert into _kept_price (product_id, unit_price)
  select distinct on (product_id) product_id, unit_price
    from order_lines where order_id = p_order_id and product_id is not null;

  perform release_order_stock(p_order_id);
  v_withdrawn := withdraw_from_supplier(p_order_id);
  delete from order_lines where order_id = p_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    v_price := coalesce(
      (v_line->>'unit_price')::numeric,
      (select unit_price from _kept_price where product_id = v_product.id),
      current_tier_price(v_product.id, v_client.tier_id));
    if v_price is null then raise exception 'No price for % on this tier', v_product.sku; end if;

    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_order.fulfilment_location_id
     for update;
    v_stock := coalesce(v_stock, 0);
    v_alloc := least(v_qty, v_stock);

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_order.fulfilment_location_id;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (p_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price,
            v_alloc, v_qty - v_alloc);
  end loop;

  -- The old invoice no longer describes the order, so it is superseded rather
  -- than edited: an invoice number that once meant one thing must not come to
  -- mean another.
  update invoices set superseded = true
   where order_id = p_order_id and not superseded and type in ('full','shipment','backorder');

  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                        location_id, ready_to_pack)
  values (next_invoice_number(), p_order_id, v_order.client_id, 'full', current_date,
          current_date + v_settings.payment_days,
          case when v_client.vat_exempt then 0 else v_settings.vat_rate end,
          v_order.fulfilment_location_id, false)
  returning id into v_inv_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_inv_id, sku, name, qty, unit_price from order_lines where order_id = p_order_id;

  -- Whatever the order now needs and we do not hold goes to the supplier, the
  -- same way placing it would have. Without this an edited line would sit on
  -- back order with nothing on its way.
  if exists (select 1 from order_lines where order_id = p_order_id and bo_qty > 0) then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_order.fulfilment_location_id)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order.number, p_order_id
      from order_lines where order_id = p_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = p_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (p_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  insert into order_events (order_id, type, meta)
  values (p_order_id, 'edited',
          jsonb_build_object('invoice', v_inv_id, 'supplier_lines_withdrawn', v_withdrawn));
  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'order', p_order_id, 'edit');

  perform refresh_invoice_readiness(p_order_id);
end $$;

/** Cancels an order: stock back, invoices withdrawn, the record kept. */
create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_order_amendable(p_order_id);

  perform release_order_stock(p_order_id);
  perform withdraw_from_supplier(p_order_id);
  update order_lines set bo_qty = 0 where order_id = p_order_id;

  update invoices set superseded = true
   where order_id = p_order_id and not superseded;

  update orders
     set status = 'cancelled', cancelled_at = now(),
         cancelled_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_order_id;

  insert into order_events (order_id, type, meta)
  values (p_order_id, 'cancelled', jsonb_build_object('reason', p_reason));
  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'order', p_order_id, 'cancel');
end $$;

/**
 * Removes an order entirely. Admin only, and only one that never became
 * anything: nothing paid, packed, shipped or ordered from a supplier.
 *
 * Cancelling is almost always the right operation — it keeps the number, the
 * invoice and the reason — so this exists for an order raised against the
 * wrong client and noticed straight away.
 */
create or replace function public.delete_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_number text;
begin
  if not is_admin() then
    raise exception 'Only an admin can delete an order. Cancelling keeps the record';
  end if;
  perform assert_order_amendable(p_order_id);

  if exists (select 1 from invoices where order_id = p_order_id and (paid or packed or shipped)) then
    raise exception 'This order has history. Cancel it rather than deleting it';
  end if;

  select number into v_number from orders where id = p_order_id;
  perform release_order_stock(p_order_id);
  perform withdraw_from_supplier(p_order_id);

  -- Recorded before it goes, because afterwards there is nothing to point at.
  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'order', p_order_id, 'delete', jsonb_build_object('number', v_number));

  delete from invoices where order_id = p_order_id;
  delete from orders where id = p_order_id;
end $$;

/**
 * A credit note against an invoice, in whole or in part.
 *
 * p_lines is [{ "sku": text, "qty": int }] naming what is being credited, or
 * null for the whole invoice. Quantities are held positive and the document
 * says what it is; storing a negative invoice would make every sum over the
 * invoices table quietly wrong for anyone who forgot this type existed.
 *
 * Credits do not carry a due date and are never "unpaid" — they are money
 * going the other way, not a debt waiting on the client.
 */
create or replace function public.credit_invoice(
  p_invoice_id uuid,
  p_lines      jsonb default null,
  p_reason     text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv    invoices%rowtype;
  v_credit uuid;
  v_line   jsonb;
  v_src    invoice_lines%rowtype;
  v_qty    integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.type in ('credit','proforma') then
    raise exception 'A % cannot be credited', v_inv.type;
  end if;

  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                        location_id, credit_of, note, paid, paid_date)
  values (next_invoice_number(), v_inv.order_id, v_inv.client_id, 'credit', current_date,
          current_date, v_inv.vat_rate, v_inv.location_id, v_inv.id,
          nullif(trim(coalesce(p_reason, '')), ''), true, current_date)
  returning id into v_credit;

  if p_lines is null then
    insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
    select v_credit, sku, name, qty, unit_price
      from invoice_lines where invoice_id = p_invoice_id;
  else
    for v_line in select * from jsonb_array_elements(p_lines) loop
      select * into v_src from invoice_lines
       where invoice_id = p_invoice_id and sku = v_line->>'sku' limit 1;
      if not found then
        raise exception '% is not on that invoice', v_line->>'sku';
      end if;

      v_qty := greatest(1, (v_line->>'qty')::integer);
      if v_qty > v_src.qty then
        raise exception 'Cannot credit % of % — the invoice only has %',
          v_qty, v_src.sku, v_src.qty;
      end if;

      insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
      values (v_credit, v_src.sku, v_src.name, v_qty, v_src.unit_price);
    end loop;
  end if;

  if not exists (select 1 from invoice_lines where invoice_id = v_credit) then
    raise exception 'A credit note needs at least one line';
  end if;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'credited',
          jsonb_build_object('credit', v_credit, 'against', v_inv.number, 'reason', p_reason));
  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'invoice', v_credit, 'credit_note');

  return v_credit;
end $$;

/**
 * A proforma for whatever is still on back order.
 *
 * For the client who will not pay for goods in advance: it shows them what is
 * coming and what it will cost without asking for money, and the real invoice
 * follows when the stock does. It carries no due date and is deliberately
 * excluded from anything that totals what a client owes.
 */
create or replace function public.proforma_for_backorder(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_pro uuid;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_inv from invoices
   where order_id = p_order_id and not superseded and type in ('full','backorder')
   order by date desc limit 1;
  if not found then raise exception 'No live invoice for this order'; end if;

  if not exists (select 1 from order_lines where order_id = p_order_id and bo_qty > 0) then
    raise exception 'Nothing on back order for this order';
  end if;

  -- Only ever one live proforma per order; raising another replaces it.
  update invoices set superseded = true
   where order_id = p_order_id and type = 'proforma' and not superseded;

  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                        location_id, ready_to_pack, note)
  values (next_invoice_number(), p_order_id, v_inv.client_id, 'proforma', current_date,
          current_date, v_inv.vat_rate, v_inv.location_id, false,
          'Proforma only — no payment is due on this document.')
  returning id into v_pro;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_pro, sku, name, bo_qty, unit_price
    from order_lines where order_id = p_order_id and bo_qty > 0;

  insert into order_events (order_id, type, meta)
  values (p_order_id, 'proforma_sent', jsonb_build_object('invoice', v_pro));
  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'invoice', v_pro, 'proforma');

  return v_pro;
end $$;

/**
 * Loads an order that happened before this system existed.
 *
 * Deliberately not place_order: it takes the date it actually happened, never
 * touches stock, raises no supplier order, and lands settled and complete.
 * A historic order is a record of something finished, not an instruction.
 *
 * p_lines: [{ "sku": text, "name": text?, "qty": int, "unit_price": numeric }]
 */
create or replace function public.import_historic_order(
  p_client_id uuid,
  p_date      date,
  p_lines     jsonb,
  p_number    text default null,
  p_notes     text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_client   clients%rowtype;
  v_settings settings%rowtype;
  v_order    uuid;
  v_inv      uuid;
  v_number   text;
  v_line     jsonb;
  v_product  products%rowtype;
  v_sku      text;
  v_qty      integer;
  v_price    numeric(12,2);
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if p_date is null then raise exception 'A historic order needs the date it was placed'; end if;
  if p_date > current_date then raise exception 'That date is in the future'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'That order has no lines';
  end if;

  select * into v_settings from settings where id = 1;

  -- Their own reference is kept where they have one, so a client asking about
  -- an old order number finds it. Anything already used gets ours instead.
  v_number := nullif(trim(coalesce(p_number, '')), '');
  if v_number is null or exists (select 1 from orders where number = v_number) then
    v_number := next_order_number();
  end if;

  insert into orders (number, client_id, date, status, fulfilment_location_id, placed_by, notes)
  values (v_number, p_client_id, p_date, 'complete',
          coalesce(v_client.default_location_id,
                   (select id from locations where active order by name limit 1)),
          auth.uid(), nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_order;

  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate,
                        location_id, paid, paid_date, ready_to_pack, packed, shipped)
  values (next_invoice_number(), v_order, p_client_id, 'full', p_date,
          p_date + v_settings.payment_days,
          case when v_client.vat_exempt then 0 else v_settings.vat_rate end,
          (select fulfilment_location_id from orders where id = v_order),
          true, p_date, true, true, true)
  returning id into v_inv;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku := trim(v_line->>'sku');
    if coalesce(v_sku, '') = '' then raise exception 'A line has no SKU'; end if;
    v_qty := greatest(1, (v_line->>'qty')::integer);
    v_price := (v_line->>'unit_price')::numeric;
    if v_price is null then
      raise exception 'Line % has no price — a past order must say what was charged', v_sku;
    end if;

    -- Matched to the catalogue where it still exists, so the client's history
    -- links up; a SKU we no longer list is still recorded, by name.
    select * into v_product from products where lower(sku) = lower(v_sku);

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price,
                             alloc_qty, bo_qty, invoiced_ship)
    values (v_order, v_product.id, coalesce(v_product.sku, v_sku),
            coalesce(nullif(trim(v_line->>'name'), ''), v_product.name, v_sku),
            v_qty, v_price, v_qty, 0, true);

    insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
    values (v_inv, coalesce(v_product.sku, v_sku),
            coalesce(nullif(trim(v_line->>'name'), ''), v_product.name, v_sku), v_qty, v_price);
  end loop;

  insert into order_events (order_id, type, created_at, meta)
  values (v_order, 'placed', p_date::timestamptz, jsonb_build_object('historic', true)),
         (v_order, 'payment_received', p_date::timestamptz, jsonb_build_object('historic', true));

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'order', v_order, 'import_historic');

  return v_order;
end $$;


-- ###########################################################################
-- 0019_mark_paid.sql
-- ###########################################################################

-- ============================================================================
-- 0019: a proforma is not an unpaid invoice.
--
-- 0018 added proformas and credit notes without telling mark_invoice_paid
-- about either, so a proforma — a document that asks for nothing — appeared on
-- the invoice list in red as unpaid, with a button offering to settle it.
-- Marking one paid would have recorded a payment against money never demanded,
-- and the real invoice that follows would then be chased on its own.
--
-- The payment date is also worth having properly. Payment usually reaches us
-- before anyone gets to the screen, and an invoice recorded as paid today when
-- it was paid last Tuesday makes the ledger disagree with the bank.
-- ============================================================================

create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_paid_date  date default null,
  p_source     text default 'manual'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_date date;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.paid then return; end if;

  if v_inv.type = 'proforma' then
    raise exception 'A proforma asks for no payment. Raise the invoice first';
  end if;
  if v_inv.type = 'credit' then
    raise exception 'A credit note is money owed back, not a payment to receive';
  end if;
  if v_inv.superseded then
    raise exception 'That invoice has been superseded — pay the one that replaced it';
  end if;

  v_date := coalesce(p_paid_date, current_date);
  if v_date > current_date then
    raise exception 'That payment date is in the future';
  end if;
  -- An invoice cannot have been paid before it existed.
  if v_date < v_inv.date then
    raise exception 'That is before the invoice was raised on %', to_char(v_inv.date, 'DD Mon YYYY');
  end if;

  update invoices set paid = true, paid_date = v_date where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'payment_received',
          jsonb_build_object('invoice', v_inv.number, 'source', p_source, 'date', v_date));

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'mark_paid',
          jsonb_build_object('source', p_source, 'date', v_date));
end $$;


-- ###########################################################################
-- 0020_cost_prices.sql
-- ###########################################################################

-- ============================================================================
-- 0020: what a product costs us, and what an order earns.
--
-- Cost gets its own table rather than a column, for two reasons.
--
-- It is dated, exactly like a sell price. A margin worked out for a March
-- order should use March's cost and must not move when the supplier reprices
-- in June, so the history is kept and nothing is ever overwritten.
--
-- And it is ours alone. RLS is row-level: a cost column on products or on
-- order_lines — both of which a signed-in client reads — would hand every
-- customer our buying price and our margin. A separate table can simply have
-- no client policy at all, which is a much shorter thing to get right.
-- ============================================================================

create table if not exists product_costs (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  cost           numeric(12,2) not null check (cost >= 0),
  -- Who we buy it from, where a price list says. Free text for now: there is
  -- one supplier, and inventing a supplier table before there are two of them
  -- buys nothing.
  supplier       text,
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (product_id, effective_from)
);
create index if not exists product_costs_lookup_idx
  on product_costs (product_id, effective_from desc);

-- What a line of an order cost us, fixed at the moment it was placed.
--
-- Kept beside order_lines rather than on it, because a client may read their
-- own order lines and may never read this.
create table if not exists order_line_costs (
  order_line_id uuid primary key references order_lines(id) on delete cascade,
  unit_cost     numeric(12,2) not null check (unit_cost >= 0)
);

alter table product_costs    enable row level security;
alter table order_line_costs enable row level security;

drop policy if exists product_costs_staff on product_costs;
create policy product_costs_staff on product_costs
  for all using (is_staff()) with check (is_staff());

drop policy if exists order_line_costs_staff on order_line_costs;
create policy order_line_costs_staff on order_line_costs
  for all using (is_staff()) with check (is_staff());

-- No client policy on either table, deliberately. RLS denies by default, so
-- the absence of a policy is the rule.

/**
 * What a product cost us on a given day, or null if we never recorded it.
 *
 * Security INVOKER, unlike current_tier_price beside it. A client is entitled
 * to be told their own price and calls that one directly; nobody outside the
 * company is entitled to this, so it runs under the caller's own permissions
 * and RLS returns them nothing.
 */
create or replace function public.current_cost(
  p_product uuid, p_on date default current_date
) returns numeric
language sql stable security invoker set search_path = public as $$
  select cost from product_costs
   where product_id = p_product and effective_from <= p_on
   order by effective_from desc
   limit 1;
$$;

/**
 * Records what a line cost us, as the line is created.
 *
 * A trigger rather than a step inside place_order, because order lines are
 * also written by edit_order and by import_historic_order, and a margin that
 * depends on three functions each remembering to do the same thing is a
 * margin that will one day be wrong. Runs as definer: the client placing the
 * order cannot read product_costs, but the line still has to be priced.
 */
create or replace function public.snapshot_order_line_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_on date; v_cost numeric;
begin
  if new.product_id is null then return new; end if;

  select date into v_on from orders where id = new.order_id;

  select cost into v_cost from product_costs
   where product_id = new.product_id
     and effective_from <= coalesce(v_on, current_date)
   order by effective_from desc
   limit 1;

  -- Nothing recorded for this product yet. The line stands; refill_order_line_costs
  -- fills it in once a cost is imported.
  if v_cost is null then return new; end if;

  insert into order_line_costs (order_line_id, unit_cost)
  values (new.id, v_cost)
  on conflict (order_line_id) do update set unit_cost = excluded.unit_cost;

  return new;
end $$;

drop trigger if exists order_lines_cost_snapshot on order_lines;
create trigger order_lines_cost_snapshot
  after insert on order_lines
  for each row execute function snapshot_order_line_cost();

/**
 * Fills in the cost of order lines that have none, from the cost in force on
 * the day the order was placed.
 *
 * Costs usually arrive after the orders do — the first price list is imported
 * over a system that has already been selling. This catches those up, and
 * never touches a line that already has a cost: once recorded, what a sale
 * cost us is history and does not get revised.
 */
create or replace function public.refill_order_line_costs()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  insert into order_line_costs (order_line_id, unit_cost)
  select l.id, c.cost
    from order_lines l
    join orders o on o.id = l.order_id
    join lateral (
      select pc.cost from product_costs pc
       where pc.product_id = l.product_id and pc.effective_from <= o.date
       order by pc.effective_from desc
       limit 1
    ) c on true
   where l.product_id is not null
     and not exists (select 1 from order_line_costs x where x.order_line_id = l.id);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- A price import now carries cost as well as sell prices, so the audit row
-- says how much of each it moved.
alter table price_imports add column if not exists costs_changed integer not null default 0;

-- ── saved import layouts ────────────────────────────────────────────────────
-- A price file now describes every tier at once, so its saved column mapping
-- is no longer per tier: it is keyed (scope, null).
--
-- Which exposes a constraint that never worked. Postgres counts nulls as
-- distinct by default, so `unique (scope, tier_id)` never fired for the scopes
-- that always had a null tier — saving a mapping twice quietly left two rows,
-- and the screen picked whichever came back first.
delete from import_templates a
 using import_templates b
 where a.scope = b.scope
   and a.tier_id is not distinct from b.tier_id
   and a.updated_at < b.updated_at;

-- A layout still keyed to a tier is from before, and its mapping names a
-- single "price" column that no longer means anything.
delete from import_templates where scope = 'prices' and tier_id is not null;

alter table import_templates drop constraint if exists import_templates_scope_tier_id_key;
create unique index if not exists import_templates_scope_tier_idx
  on import_templates (scope, tier_id) nulls not distinct;


-- ###########################################################################
-- 0021_configurator_only.sql
-- ###########################################################################

-- ============================================================================
-- 0021: collections you configure rather than pick from.
--
-- A groupset is specified, not chosen off a shelf: crank length, chainring,
-- cassette, rotors, wires. The builder does that, and does it properly.
--
-- The supplier's own price list also carries half a dozen fixed-spec bundle
-- SKUs, which import and file themselves under Groupsets like any other
-- product. Beside four builders they are worse than redundant — they offer a
-- customer a groupset they cannot spec, at a price the builder would have
-- matched anyway, and the obvious reading of two lists on one page is that
-- they are different things.
--
-- So a category can say that it is served by its builders. The products stay
-- in the catalogue — staff price them, cost them and margin them like anything
-- else, and the bundle price is what the builder's total is checked against —
-- they simply stop being offered loose.
-- ============================================================================

alter table categories
  add column if not exists configurator_only boolean not null default false;

comment on column categories.configurator_only is
  'Clients see this collection''s configurators, not its loose products. '
  'Staff see everything, always: this changes what is offered, not what exists.';

update categories set configurator_only = true where slug = 'groupsets';

-- The flag has to reach the client, so it joins the catalogue view. It is a
-- column rather than a filter on purpose: client_group_options is built on
-- this view, and filtering here would delete from every builder any option
-- that happened to be filed in a configured collection.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

-- Dropped by the cascade above, and unchanged from 0014.
create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;


-- ###########################################################################
-- 0022_sales_reporting.sql
-- ###########################################################################

-- ============================================================================
-- 0022: what the business did, over a period.
--
-- Three functions, all staff-only, all reading the same thing: an order's own
-- lines at the price they were sold and the cost recorded against them when
-- they were placed. Revenue is net of VAT, because VAT was never ours.
--
-- Revenue is recognised on the order date rather than the invoice or payment
-- date. This is an order book: the question a trade counter asks is "what did
-- we sell in March", and an order placed in March that settles in April was
-- still March's work. Cancelled orders are not sales and are excluded
-- entirely — not shown at zero, not counted as an order.
--
-- A line with no recorded cost counts as costing nothing, which flatters the
-- margin. That cannot be silently true, so the totals carry the count of such
-- lines and the screen says so.
-- ============================================================================

-- Dropped by name first. 0023 changes what sales_totals returns, and CREATE OR
-- REPLACE cannot change a return type — so re-applying the whole migration set
-- over a database that already has 0023 would stop here without this.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('sales_totals', 'sales_over_time', 'top_clients')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

/** Headline figures for a period. One row, always. */
create or replace function public.sales_totals(p_from date, p_to date)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric, uncosted_lines integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select coalesce(count(distinct o.id), 0)::integer,
         coalesce(sum(l.qty * l.unit_price), 0)::numeric,
         coalesce(sum(l.qty * coalesce(c.unit_cost, 0)), 0)::numeric,
         coalesce(sum(l.qty * (l.unit_price - coalesce(c.unit_cost, 0))), 0)::numeric,
         coalesce(count(*) filter (where c.unit_cost is null), 0)::integer
    from orders o
    join order_lines l on l.order_id = o.id
    left join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to;
end $$;

/**
 * The same figures a bucket at a time.
 *
 * Every bucket in the range comes back, including the ones that sold nothing:
 * a quiet Tuesday is a fact about the week, and a chart that simply omits it
 * draws a line straight over the gap.
 */
create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  -- Named rather than interpolated: p_grain reaches date_trunc, and the set of
  -- grains this reports on is three.
  v_step := case p_grain
              when 'day'   then interval '1 day'
              when 'week'  then interval '1 week'
              when 'month' then interval '1 month'
            end;
  if v_step is null then
    raise exception 'Unknown grain % — day, week or month', p_grain;
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, p_to::timestamp),
             v_step)::date as bucket
  ),
  sold as (
    select date_trunc(p_grain, o.date::timestamp)::date as bucket,
           count(distinct o.id)::integer                as orders,
           sum(l.qty * l.unit_price)                    as revenue,
           sum(l.qty * coalesce(c.unit_cost, 0))        as cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.date between p_from and p_to
     group by 1
  )
  select b.bucket,
         coalesce(s.orders, 0),
         coalesce(s.revenue, 0)::numeric,
         coalesce(s.cost, 0)::numeric,
         coalesce(s.revenue - s.cost, 0)::numeric
    from buckets b
    left join sold s on s.bucket = b.bucket
   order by b.bucket;
end $$;

/** Who the period's money came from, best first. */
create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5
)
returns table (
  client_id uuid, client_name text, orders integer, revenue numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select cl.id, cl.name,
         count(distinct o.id)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * (l.unit_price - coalesce(c.unit_cost, 0)))::numeric
    from orders o
    join clients cl     on cl.id = o.client_id
    join order_lines l  on l.order_id = o.id
    left join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by cl.id, cl.name
   order by 5 desc, 4 desc
   limit greatest(1, coalesce(p_limit, 5));
end $$;


-- ###########################################################################
-- 0023_report_costed_only.sql
-- ###########################################################################

-- ============================================================================
-- 0023: a sale we cannot cost is not reported on.
--
-- 0022 counted a line with no recorded cost as costing nothing, which put its
-- whole price into profit. The screen said so, but a caveat under a number is
-- not the same as a number you can trust: the figure still got quoted, and it
-- was still wrong in the flattering direction.
--
-- So an order line is now reported only if we know what it cost us. No cost,
-- no revenue, no profit, no margin — it is not in the report at all. What is
-- left is a smaller set of sales with a true margin, which is worth more than
-- a complete set with a false one.
--
-- Revenue therefore no longer matches the order book, and that must not be a
-- surprise. sales_totals returns what it left out, in lines and in money, and
-- the screen says so above the figures.
--
-- The rule is per line rather than per order. An order of eleven lines with
-- one new SKU on it is ten lines of real margin, and throwing those away to
-- punish the eleventh would lose far more than it protects.
-- ============================================================================

-- The return type gains columns, which CREATE OR REPLACE cannot do, and a
-- second signature left behind would be picked over this one at random.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('sales_totals', 'sales_over_time', 'top_clients')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

/**
 * Headline figures for a period, over the sales we can cost.
 *
 * excluded_lines and excluded_revenue are the ones left out: the report is
 * honest about being partial rather than quietly smaller than the order book.
 */
create or replace function public.sales_totals(p_from date, p_to date)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric,
  excluded_lines integer, excluded_revenue numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with lines as (
    select o.id as order_id, l.qty, l.unit_price, c.unit_cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.date between p_from and p_to
  )
  select
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is null), 0)::numeric
  from lines;
end $$;

/**
 * The same figures a bucket at a time.
 *
 * Every bucket in the range comes back, including the ones with nothing left
 * in them: a period whose only sales could not be costed reads as zero here,
 * and the count of what was excluded sits above the chart to explain it.
 */
create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  v_step := case p_grain
              when 'day'   then interval '1 day'
              when 'week'  then interval '1 week'
              when 'month' then interval '1 month'
            end;
  if v_step is null then
    raise exception 'Unknown grain % — day, week or month', p_grain;
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, p_to::timestamp),
             v_step)::date as bucket
  ),
  sold as (
    select date_trunc(p_grain, o.date::timestamp)::date as bucket,
           count(distinct o.id)::integer                as orders,
           sum(l.qty * l.unit_price)                    as revenue,
           sum(l.qty * c.unit_cost)                     as cost
      from orders o
      join order_lines l       on l.order_id = o.id
      -- Inner: a line we cannot cost is not a line this report knows about.
      join order_line_costs c  on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.date between p_from and p_to
     group by 1
  )
  select b.bucket,
         coalesce(s.orders, 0),
         coalesce(s.revenue, 0)::numeric,
         coalesce(s.cost, 0)::numeric,
         coalesce(s.revenue - s.cost, 0)::numeric
    from buckets b
    left join sold s on s.bucket = b.bucket
   order by b.bucket;
end $$;

/** Who the period's money came from, best first, over the sales we can cost. */
create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5
)
returns table (
  client_id uuid, client_name text, orders integer, revenue numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select cl.id, cl.name,
         count(distinct o.id)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * (l.unit_price - c.unit_cost))::numeric
    from orders o
    join clients cl         on cl.id = o.client_id
    join order_lines l      on l.order_id = o.id
    join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by cl.id, cl.name
   -- Name last, so two clients level on both figures keep a stable order
   -- rather than swapping places between one page load and the next.
   order by 5 desc, 4 desc, cl.name
   limit greatest(1, coalesce(p_limit, 5));
end $$;


-- ###########################################################################
-- 0024_delivery_tracking.sql
-- ###########################################################################

-- ============================================================================
-- 0024: delivery tracking — a real second milestone after shipped.
--
-- "Shipped" only ever meant the parcel left the warehouse. Nothing recorded
-- that it actually reached the client, yet the client portal and history
-- already called an order "Delivered" the moment tracking was entered. This
-- adds a genuine delivered milestone — set by hand once a parcel is confirmed
-- at the client's door — with its own order event and its own notification,
-- so "Delivered" means delivered.
-- ============================================================================

alter table invoices
  add column if not exists delivered    boolean not null default false,
  add column if not exists delivered_at timestamptz;

-- The client-facing timeline is driven entirely by order_events (0001), so a
-- new milestone needs a new enum value before anything can log one. Adding a
-- value is safe outside of a transaction that also reads it, which nothing
-- here does — the function below only uses it when it runs later, not when
-- it is created.
alter type order_event_type add value if not exists 'delivered';

-- ── mark delivered ──────────────────────────────────────────────────────────
-- Mirrors mark_invoice_shipped: gated on the previous stage, idempotent, logs
-- one order_events row so the client timeline and the notification are both
-- driven off the same fact.
create or replace function public.mark_invoice_delivered(p_invoice_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if not v_inv.shipped then raise exception 'Invoice has not shipped yet'; end if;
  if v_inv.delivered then return; end if;

  update invoices set delivered = true, delivered_at = now() where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'delivered', jsonb_build_object('invoice', v_inv.number));
end $$;

-- ── who gets copied ──────────────────────────────────────────────────────────
-- confirmation_cc already held the directors' addresses for order
-- confirmation only; it now also carries dispatch and delivery, so both
-- directors are copied on every client-facing milestone email, not just the
-- first one.
comment on column settings.confirmation_cc is
  'Copied on order confirmation, dispatch and delivery emails to the client.';


-- ###########################################################################
-- 0025_password_login.sql
-- ###########################################################################

-- ============================================================================
-- 0025: does this person have a password?
--
-- A password is an addition here, never a replacement: the emailed sign-in
-- link keeps working for everybody, which is what makes "I have forgotten it"
-- a non-event rather than a phone call, and means nobody locks themselves out
-- of a trade account at five to five on a Friday.
--
-- Supabase's client API will set a password but will not say whether one
-- exists, and the account screens need to know which sentence to show. The
-- fact lives in auth.users.encrypted_password, which no client may read — so
-- this reports the one bit of it that is the caller's own business, about the
-- caller only.
-- ============================================================================

create or replace function public.has_password()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select coalesce(u.encrypted_password, '') <> ''
       from auth.users u
      where u.id = auth.uid()),
    false);
$$;

comment on function public.has_password() is
  'Whether the signed-in user can sign in with a password as well as a link. '
  'Answers about the caller and nobody else, and returns a boolean rather than '
  'anything derived from the hash.';


-- ###########################################################################
-- 0026_temporary_password.sql
-- ###########################################################################

-- ============================================================================
-- 0026: a password that has to be changed.
--
-- A new customer needs to get in before they have an inbox habit with us, and
-- "wait for the link" is a poor first impression when somebody is on the phone
-- to you. So staff can hand out a temporary password — read out once, never
-- emailed — and the account insists on a real one the first time it is used.
--
-- The flag lives on profiles rather than in auth metadata because it is ours:
-- every screen already reads this row to find a role, RLS already decides who
-- may write it, and it can be tested here rather than only against a live
-- Supabase.
-- ============================================================================

alter table profiles
  add column if not exists must_change_password boolean not null default false;

comment on column profiles.must_change_password is
  'Set when staff issue a temporary password. Every guarded screen sends the '
  'user to change it, and only the server action that actually changes a '
  'password clears it.';


-- ###########################################################################
-- 0027_currency.sql
-- ###########################################################################

-- ============================================================================
-- 0027: a price knows which money it is in.
--
-- Until now every figure in the system was sterling by assumption — the £ was
-- typed into the component that renders money, and nothing else in the schema
-- had an opinion. That held for as long as every supplier invoiced us in
-- pounds. DRAG's export list is in euros, and the trade prices we set off it
-- are in euros too, because that is what the customer pays and what we owe.
--
-- Converting on import was the cheaper option and the wrong one: it would bake
-- one morning's rate into a price list that stands for a year, and every
-- margin on the staff side would then be measured against a cost we never
-- actually paid. So the currency travels with the price instead.
--
-- Three rules make that safe rather than merely recorded:
--
--   * a product is priced in one currency — cost and every tier alike;
--   * an order is in one currency, enforced as lines are added, because a
--     total that sums euros and pounds is not a total;
--   * an invoice takes its currency from its order and cannot drift from it.
--
-- Reporting takes a currency rather than mixing them. The dashboard asks for
-- one at a time; summing across a rate we did not transact at would be the
-- same lie as converting on import, only later and larger.
-- ============================================================================

-- Two for now. An enum would need a migration to add a third anyway, and a
-- check constraint says the same thing where anyone reading the table sees it.
alter table products add column if not exists currency text not null default 'GBP';
alter table orders   add column if not exists currency text not null default 'GBP';
alter table invoices add column if not exists currency text not null default 'GBP';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_currency_check') then
    alter table products add constraint products_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table orders add constraint orders_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_currency_check') then
    alter table invoices add constraint invoices_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
end $$;

comment on column products.currency is
  'The money this product''s cost and every tier price are quoted in.';
comment on column orders.currency is
  'Taken from the first line placed. Every other line must agree.';
comment on column invoices.currency is
  'Copied from the order. Never set directly.';

-- ── one order, one currency ─────────────────────────────────────────────────

/**
 * Keeps an order to a single currency.
 *
 * The first line decides it — a basket does not announce its currency up
 * front, and defaulting every order to sterling would quietly mislabel a
 * euro one. Every line after that must agree, and a line that does not is
 * refused rather than converted: there is no rate here to convert at, and
 * inventing one would put a made-up number on an invoice.
 *
 * A line with no product_id is a free-text line typed by staff. It takes the
 * order's currency as it stands, because there is nothing to check it against.
 */
create or replace function public.enforce_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product  text;
  v_order    text;
  v_has_line boolean;
begin
  if new.product_id is null then return new; end if;

  select currency into v_product from products where id = new.product_id;
  if v_product is null then return new; end if;

  select currency into v_order from orders where id = new.order_id;

  select exists (
    select 1 from order_lines
     where order_id = new.order_id
       and (tg_op = 'INSERT' or id <> new.id)
  ) into v_has_line;

  if not v_has_line then
    update orders set currency = v_product where id = new.order_id;
    return new;
  end if;

  if v_order is distinct from v_product then
    raise exception
      'Order is in %, and % is priced in % — an order cannot mix currencies',
      v_order, new.sku, v_product
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists order_lines_currency on order_lines;
create trigger order_lines_currency
  before insert or update of product_id on order_lines
  for each row execute function public.enforce_order_currency();

/** An invoice is a demand for money in the currency the order was placed in. */
create or replace function public.invoice_currency_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select currency into new.currency from orders where id = new.order_id;
  return new;
end $$;

drop trigger if exists invoices_currency on invoices;
create trigger invoices_currency
  before insert or update of order_id on invoices
  for each row execute function public.invoice_currency_from_order();

-- Existing rows predate all of this and are all sterling, but the orders they
-- belong to are the authority from here on, so make the columns agree now
-- rather than leaving two sources of truth that happen to match.
update orders o set currency = p.currency
  from order_lines l
  join products p on p.id = l.product_id
 where l.order_id = o.id
   and o.currency is distinct from p.currency;

update invoices i set currency = o.currency
  from orders o
 where o.id = i.order_id
   and i.currency is distinct from o.currency;

-- ── the catalogue carries it to the client ──────────────────────────────────

-- A column in the middle of the list, which CREATE OR REPLACE VIEW cannot do.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  p.currency,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

-- Dropped by the cascade above. Unchanged from 0021 but for the currency.
create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;

-- ── reporting is per currency ───────────────────────────────────────────────

-- Signatures change, and an older overload left behind would be chosen over
-- this one by argument count alone.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('sales_totals', 'sales_over_time', 'top_clients')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

/**
 * Headline figures for a period, in one currency, over the sales we can cost.
 *
 * excluded_lines and excluded_revenue are the ones left out for want of a
 * cost. Orders in another currency are not "excluded" in that sense — they
 * belong to a different report, not a gap in this one — so they are simply
 * not here, and the screen offers the other currency instead.
 */
create or replace function public.sales_totals(
  p_from date, p_to date, p_currency text default 'GBP'
)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric,
  excluded_lines integer, excluded_revenue numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with lines as (
    select o.id as order_id, l.qty, l.unit_price, c.unit_cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.currency = p_currency
       and o.date between p_from and p_to
  )
  select
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is null), 0)::numeric
  from lines;
end $$;

/** The same figures a bucket at a time, in one currency. */
create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day', p_currency text default 'GBP'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  v_step := case p_grain
              when 'day'   then interval '1 day'
              when 'week'  then interval '1 week'
              when 'month' then interval '1 month'
            end;
  if v_step is null then
    raise exception 'Unknown grain % — day, week or month', p_grain;
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, p_to::timestamp),
             v_step)::date as bucket
  ),
  sold as (
    select date_trunc(p_grain, o.date::timestamp)::date as bucket,
           count(distinct o.id)::integer                as orders,
           sum(l.qty * l.unit_price)                    as revenue,
           sum(l.qty * c.unit_cost)                     as cost
      from orders o
      join order_lines l       on l.order_id = o.id
      -- Inner: a line we cannot cost is not a line this report knows about.
      join order_line_costs c  on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.currency = p_currency
       and o.date between p_from and p_to
     group by 1
  )
  select b.bucket,
         coalesce(s.orders, 0),
         coalesce(s.revenue, 0)::numeric,
         coalesce(s.cost, 0)::numeric,
         coalesce(s.revenue - s.cost, 0)::numeric
    from buckets b
    left join sold s on s.bucket = b.bucket
   order by b.bucket;
end $$;

/** Who the period's money came from, best first, in one currency. */
create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5, p_currency text default 'GBP'
)
returns table (
  client_id uuid, client_name text, orders integer, revenue numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select cl.id, cl.name,
         count(distinct o.id)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * (l.unit_price - c.unit_cost))::numeric
    from orders o
    join clients cl         on cl.id = o.client_id
    join order_lines l      on l.order_id = o.id
    join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.currency = p_currency
     and o.date between p_from and p_to
   group by cl.id, cl.name
   -- Name last, so two clients level on both figures keep a stable order
   -- rather than swapping places between one page load and the next.
   order by 5 desc, 4 desc, cl.name
   limit greatest(1, coalesce(p_limit, 5));
end $$;

/**
 * Which currencies there is anything to report on, commonest first.
 *
 * The dashboard only offers a second currency once a second one exists, so a
 * sterling-only distributor never sees a control that would do nothing.
 */
create or replace function public.sold_currencies()
returns table (currency text, orders integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select o.currency, count(*)::integer
    from orders o
   where o.status <> 'cancelled'
   group by o.currency
   order by 2 desc, 1;
end $$;


-- ###########################################################################
-- 0028_variants_and_notes.sql
-- ###########################################################################

-- ============================================================================
-- 0028: one bike, several frames — and what a price does not include.
--
-- A bike is not one line on a price list. DRAG build the Ronin CF 7.0 in S, M,
-- L, XL and XXL, and a shop ordering one is ordering a size: the size is the
-- thing that gets picked, stocked, allocated and shipped, and two sizes of the
-- same bike are two different objects in a warehouse.
--
-- So each size is its own product, with its own SKU, its own cost and its own
-- stock — everything downstream of the catalogue already works that way and
-- needs no changes at all. What is added here is only the fact that a set of
-- products are sizes of one thing, so the catalogue can offer them as one
-- product with a size to pick rather than five lines that look like five
-- bikes.
--
-- Deliberately not the configurator from 0013. A groupset is specified over
-- several steps and the builder exists for that; a frame size is one choice
-- from a short list, and sending somebody to a multi-step builder to answer it
-- would be worse than the five lines.
--
-- price_note is the other half. DRAG quote ex-works in euros: no import duty,
-- no VAT. VAT the system already adds at checkout, duty it cannot know — so
-- the price carries a note saying so, and the note follows it onto every
-- screen a customer sees a price on, and onto the invoice.
-- ============================================================================

alter table products add column if not exists variant_group text;
alter table products add column if not exists variant_label text;
alter table products add column if not exists variant_sort  integer;
alter table products add column if not exists price_note    text;

comment on column products.variant_group is
  'Shared by every size of one bike. Null for a product sold as one thing.';
comment on column products.variant_label is
  'This product''s size, as the customer picks it: S, M, L, 440.';
comment on column products.variant_sort is
  'Where this size sits in the range. XS before S before M, not alphabetical.';
comment on column products.price_note is
  'What this price does not include, shown wherever a customer sees it.';

do $$
begin
  -- A group with no label would be a size nobody can name, and a label with no
  -- group is a size of nothing. Either on its own is a half-written import.
  if not exists (select 1 from pg_constraint where conname = 'products_variant_pair') then
    alter table products add constraint products_variant_pair check (
      (variant_group is null and variant_label is null)
      or (variant_group is not null and variant_label is not null)
    );
  end if;
end $$;

-- Two products claiming the same size of the same bike is a catalogue that
-- cannot say what was ordered. Case-insensitive, because "M" and "m" are one
-- size however the spreadsheet spelled them.
create unique index if not exists products_variant_unique
  on products (variant_group, lower(variant_label))
  where variant_group is not null;

create index if not exists products_variant_group_idx
  on products (variant_group) where variant_group is not null;

-- ── the catalogue carries both to the client ────────────────────────────────

drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  p.currency,
  p.price_note,
  p.variant_group,
  p.variant_label,
  p.variant_sort,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

-- Dropped by the cascade above. Unchanged from 0027.
create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;


-- ###########################################################################
-- 0029_current_prices.sql
-- ###########################################################################

-- ============================================================================
-- 0029: ask for the price in force, not for every price there has ever been.
--
-- Two screens — the staff catalogue and the order desk — read the whole of
-- tier_prices, sort it by date and keep the first row they see for each
-- product and tier. That works only while the whole table fits in one
-- response, and PostgREST caps a response at a thousand rows by default.
--
-- It fitted for a year. Then one import added a few hundred products across
-- four tiers, all dated the same day, and those rows — being the newest —
-- filled the entire response on their own. Every older price fell off the end,
-- so the catalogue showed a dash in every tier column and the order desk said
-- there was no price. Nothing had been deleted; the rows were simply never
-- asked for. Costs kept working because there is one cost row per product
-- rather than one per tier, so that table was still under the cap — which is
-- exactly why the screens looked like they had lost only the selling prices.
--
-- The fix is to stop shipping history to the browser at all. These return one
-- row per product per tier: the price in force on a date, already chosen. The
-- caller asks about the products it is showing, so the answer is bounded by
-- what is on screen instead of by how long we have been trading.
--
-- Both are SECURITY INVOKER on purpose. tier_prices already restricts a client
-- to their own tier and product_costs to staff, and a definer function here
-- would quietly hand every tier's price to anyone who called it.
-- ============================================================================

/**
 * The price each tier pays for these products, as at a date.
 *
 * DISTINCT ON does in one pass what the screens were doing by sorting the
 * whole table and keeping the first row of each group — except the database
 * has the index for it and returns one row instead of fifteen.
 *
 * A product with no price on a tier has no row here. That is the honest
 * answer: it has no price on that tier, which is not the same as a price of
 * zero, and the screens now say so.
 */
-- Dropped first rather than replaced. A later migration widens what these
-- return, and setup.sql is one file replayed from the top: on the second run
-- this statement meets a function of that wider shape, and CREATE OR REPLACE
-- cannot change a return type. Dropping is a no-op on a fresh database and
-- makes a re-run behave like a first run, which is what the file promises.
drop function if exists public.current_tier_prices(uuid[], date);
create function public.current_tier_prices(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, tier_id uuid, price numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (tp.product_id, tp.tier_id)
         tp.product_id, tp.tier_id, tp.price
    from tier_prices tp
   where tp.product_id = any(p_products)
     and tp.effective_from <= p_on
   order by tp.product_id, tp.tier_id, tp.effective_from desc;
$$;

/** What these products cost us, as at a date. Staff only, by RLS. */
drop function if exists public.current_costs(uuid[], date);
create function public.current_costs(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, cost numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (pc.product_id)
         pc.product_id, pc.cost
    from product_costs pc
   where pc.product_id = any(p_products)
     and pc.effective_from <= p_on
   order by pc.product_id, pc.effective_from desc;
$$;

-- The lookup both of them lean on. Without it this is a sequential scan of
-- every price we have ever set, once per screen.
create index if not exists tier_prices_current_idx
  on tier_prices (product_id, tier_id, effective_from desc);
create index if not exists product_costs_current_idx
  on product_costs (product_id, effective_from desc);


-- ###########################################################################
-- 0030_derive_variants.sql
-- ###########################################################################

-- ============================================================================
-- 0030: the sizes that were already in the names.
--
-- A Dura-Ace chainset is one model in eighteen shapes: three chainrings across
-- six crank lengths. A cassette is one model in two ratios, a rotor in four
-- sizes, a Di2 wire in two lengths. Every one of those is a separate SKU on
-- the supplier's sheet, which is right — the warehouse picks a 172.5mm 52/36,
-- not "a chainset" — but a catalogue that lists eighteen chainsets is a
-- catalogue nobody can read.
--
-- 0028 gave products a variant_group and a variant_label, and the DRAG bikes
-- arrived with theirs in the file. Shimano's did not: the size is written into
-- the description and nowhere else. So this reads it out.
--
-- It reads it out with spec_value, the same function the groupset builder has
-- used since 0015 to tell a 170mm crank from a 172.5mm one. Writing a second
-- parser here would be writing something that can disagree with the builder
-- about what a product is, and the two would drift apart the first time a
-- supplier changed their punctuation.
--
-- Nothing is applied automatically. suggest_variant_groups() proposes, a
-- person looks, and apply_variant_groups() writes — because a wrong grouping
-- hides a real product behind another one's name, and that is not something
-- to discover from a customer.
-- ============================================================================

/**
 * spec_value gains one axis: a length, whatever shape it is written in.
 *
 * It already reads two, and neither can read the other's numbers. 'Crank
 * length' is three digits and an optional decimal, so it reads 172.5mm and
 * takes "000mm" out of a 1000mm wire. 'Wire length' is three or four digits
 * with no decimal, so it reads 1000mm and cannot see 172.5mm at all. Both are
 * right for the step they were written for and neither is right for labelling
 * a product whose length could be either.
 *
 * The existing axes are untouched: the groupset builder has been specifying
 * cranks with 'Crank length' since 0015 and must go on getting the same answer.
 */
create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Length' then
      -- Two to four digits and an optional decimal: 90mm, 172.5mm, 1000mm.
      nullif(regexp_replace(substring(p_name from '(\d{2,4}(?:\.\d+)?)\s*mm'),
                            '\s', '', 'g'), '') || 'mm'
    when 'Rotor size' then
      coalesce(
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

/**
 * The part of a name that is the model, with every measurement taken out.
 *
 * "C/SET D/Ace R9200 52/36 172.5mm" is the R9200 chainset; "52/36" and
 * "172.5mm" are which one. Strip both and what is left names the thing that
 * the sizes are sizes of.
 *
 * The patterns are spec_value's, deliberately: whatever that function can read
 * as a size is what this takes out, so a product can never end up in a group
 * whose name still contains the size that distinguishes it.
 */
create or replace function public.variant_model_key(p_name text)
returns text language sql immutable as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(
          -- A cassette range first: 11-34T would otherwise read as a chainring.
          regexp_replace(p_name, '\d{2}\s*-\s*\d{2}\s*T', '', 'gi'),
          -- Lengths and diameters: 160mm, 172.5mm, 1000mm.
          '\d{2,4}(\.\d+)?\s*mm', '', 'gi'),
        -- Chainrings, however they are punctuated.
        '\d{2}\s*[/-]\s*\d{2}', '', 'g'),
      '\s{2,}', ' ', 'g')),
    '');
$$;

/**
 * What distinguishes this product from the others of its model.
 *
 * Chainring before crank length, because that is the order a mechanic says
 * them in and the order the supplier writes them: "52/36 172.5mm".
 *
 * The length is asked for as a length rather than as a crank or a wire: a
 * chainset is 172.5mm and a wire is 1000mm, and the two older axes can each
 * read only one of those.
 *
 * A cassette is asked about first and on its own. "11-34T" is a hyphenated
 * pair of two-digit numbers, so the chainring rule matches it too — 0017 knew
 * that and relied on the two never appearing on one step. Here they can appear
 * on one product, and a cassette labelled "11/34 11-34T" is a label nobody
 * would recognise. Nothing is both, so the first answer wins outright.
 */
create or replace function public.variant_label_for(p_name text)
returns text language sql immutable as $$
  select nullif(
    coalesce(
      spec_value(p_name, 'Cassette'),
      concat_ws(' ',
        spec_value(p_name, 'Chainring'),
        spec_value(p_name, 'Length'))),
    '');
$$;

/**
 * Products that look like sizes of one thing, and what they would become.
 *
 * Four rules keep this conservative, because a wrong grouping hides a real
 * product behind another one's name:
 *
 *   * a product that already has a group is never touched, so the bikes that
 *     came in with their sizes stated keep them, and so does anything a person
 *     has grouped by hand;
 *   * a group needs at least two DIFFERENT sizes — a supplier's sheet listing
 *     the same part twice is a duplicate, not a range;
 *   * grouping never crosses a collection or a brand, so a 160mm rotor and a
 *     160mm chainset cannot land together on the strength of the measurement;
 *   * what is left after the sizes come out must still name something. Strip
 *     "140mm" from a product called "140mm" and there is no model underneath.
 */
create or replace function public.suggest_variant_groups()
returns table (
  product_id uuid, sku text, name text,
  model text, label text, members integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with candidate as (
    select p.id as pid, p.sku as psku, p.name as pname,
           -- The key a person will see. The category and brand are in the
           -- grouping but not in the name they read.
           variant_model_key(p.name)  as pmodel,
           variant_label_for(p.name)  as plabel,
           coalesce(p.category_id::text, '') as cat,
           coalesce(lower(trim(p.brand)), '') as brand
      from products p
     where p.variant_group is null
       and p.active
  ),
  usable as (
    select * from candidate
     where plabel is not null
       and pmodel is not null
       -- Two letters and three characters: "R9200" is a model, "T" is not.
       and length(pmodel) >= 3
       and pmodel ~ '[A-Za-z]{2}'
  ),
  grouped as (
    select pmodel, cat, brand,
           count(distinct plabel) as sizes,
           count(*)               as rows
      from usable
     group by pmodel, cat, brand
  )
  select u.pid, u.psku, u.pname, u.pmodel, u.plabel, g.rows::integer
    from usable u
    join grouped g
      on g.pmodel = u.pmodel and g.cat = u.cat and g.brand = u.brand
   where g.sizes >= 2
   order by u.pmodel, u.plabel, u.psku;
end $$;

/**
 * Writes the grouping suggest_variant_groups() proposes.
 *
 * The group key carries the collection and the brand as well as the model,
 * because those are what kept two unrelated 160mm things apart when the
 * suggestion was made; a key that dropped them could collide later with
 * something imported next quarter.
 *
 * Only the products still without a group are written, re-read inside the same
 * statement — so running it twice changes nothing the second time, and a
 * product grouped by hand between the preview and the apply is left alone.
 */
create or replace function public.apply_variant_groups()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  with proposed as (
    select s.product_id, s.model, s.label,
           coalesce(p.category_id::text, 'none') as cat,
           coalesce(lower(trim(p.brand)), 'none') as brand
      from suggest_variant_groups() s
      join products p on p.id = s.product_id
     where p.variant_group is null
  ),
  keyed as (
    select product_id, label,
           -- Readable rather than a hash: this key shows up in the import's
           -- Model column, and somebody will have to recognise it there.
           left(regexp_replace(upper(model || ' ' || brand || ' ' || cat),
                               '[^A-Z0-9]+', '-', 'g'), 120) as group_key
      from proposed
  ),
  -- The same size twice within one key would break the unique index and take
  -- the whole apply with it. Keep the first and leave the rest ungrouped.
  ranked as (
    select product_id, group_key, label,
           row_number() over (partition by group_key, lower(label)
                              order by product_id) as n
      from keyed
  )
  update products p
     set variant_group = r.group_key,
         variant_label = r.label
    from ranked r
   where p.id = r.product_id and r.n = 1;

  get diagnostics v_count = row_count;
  return v_count;
end $$;


-- ###########################################################################
-- 0031_brand_partners.sql
-- ###########################################################################

-- ============================================================================
-- 0031: the brands we sell for, looking at their own shelf.
--
-- Some of what IQ sells is not IQ's. A brand leaves stock here on consignment
-- and is paid when it sells; another has us take the order and ships it
-- themselves. Both want the same two things — what sold, and what they are
-- owed — and neither may see anything belonging to anyone else.
--
-- That last clause is the whole design. A partner is not a smaller member of
-- staff: they are an outsider with a login, and the interesting question is
-- not what they can be shown but what they cannot reach. So:
--
--   * a partner reads no table directly. Every figure comes from a function
--     that filters by the brands they are attached to, and there is no query
--     they can write that widens it;
--   * products_read, which until now let anyone signed in list the whole
--     catalogue, stops doing that for a partner;
--   * nothing anywhere hands a partner another client's prices. What sold and
--     for how much is theirs; who else buys what, at what discount, is not.
--
-- Brand is a text column on products and always has been, filled by whatever
-- the supplier's sheet said. Matching a partner to their stock on that text
-- would mean a typo silently showing one brand another's sales, so brands
-- become rows and products carry the id — kept in step by a trigger, so no
-- import has to know this happened.
-- ============================================================================

-- ADD VALUE commits on its own here (psql autocommits each statement), so the
-- policies below can refer to the new role.
alter type user_role add value if not exists 'partner';

create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  -- Normalised, so "DRAG", "Drag " and "drag" are one brand and not three.
  key         text not null unique,
  name        text not null,
  /** They leave stock with us and are paid as it sells. */
  consignment boolean not null default false,
  /**
   * Whether their portal shows what the goods sold for as well as what they
   * are owed. On consignment the two are inches apart and a partner can work
   * out the difference anyway, but it is a disclosure and so it is a choice.
   */
  shows_margin boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table products add column if not exists brand_id uuid references brands(id);
alter table products add column if not exists dropship boolean not null default false;

comment on column products.dropship is
  'The brand ships this themselves. An order for it notifies them.';

create index if not exists products_brand_idx on products (brand_id);

/**
 * Keeps products.brand_id in step with the brand somebody typed.
 *
 * A trigger rather than a change to the importer, because the brand arrives
 * from four different screens and a supplier's spreadsheet, and every one of
 * them would have to remember. Unknown brands are created rather than
 * rejected: the catalogue is the record of what we sell, and refusing a
 * product because nobody had set its brand up first would make an import fail
 * for a reason that has nothing to do with the import.
 */
create or replace function public.sync_product_brand()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  v_key := nullif(lower(trim(coalesce(new.brand, ''))), '');
  if v_key is null then
    new.brand_id := null;
    return new;
  end if;

  select id into v_id from brands where key = v_key;
  if v_id is null then
    insert into brands (key, name) values (v_key, trim(new.brand))
    on conflict (key) do update set key = excluded.key
    returning id into v_id;
  end if;

  new.brand_id := v_id;
  return new;
end $$;

drop trigger if exists products_brand_sync on products;
create trigger products_brand_sync
  before insert or update of brand on products
  for each row execute function public.sync_product_brand();

-- Everything already in the catalogue, filed under the brand it already had.
insert into brands (key, name)
select distinct lower(trim(brand)), trim(brand)
  from products
 where nullif(trim(coalesce(brand, '')), '') is not null
on conflict (key) do nothing;

update products p set brand_id = b.id
  from brands b
 where b.key = lower(trim(p.brand))
   and p.brand_id is distinct from b.id;

-- ── who a partner is ────────────────────────────────────────────────────────

create table if not exists brand_partners (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  -- Set on first sign-in, the way a client's is. Until then the address is
  -- the only thing linking the invitation to a person.
  auth_user_id uuid references auth.users(id) on delete set null,
  email        text not null,
  name         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists brand_partners_email_idx
  on brand_partners (brand_id, lower(email));
create index if not exists brand_partners_user_idx
  on brand_partners (auth_user_id) where auth_user_id is not null;

/** The brands this login speaks for. Empty for everyone who is not a partner. */
create or replace function public.my_brand_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select bp.brand_id from brand_partners bp
   where bp.auth_user_id = auth.uid() and bp.active;
$$;

create or replace function public.is_partner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role::text from profiles where id = auth.uid()) = 'partner', false);
$$;

/**
 * The brands a caller may ask about.
 *
 * A partner gets theirs and nothing else, whatever they pass. Staff may name
 * one, which is how somebody on the phone can see the screen a partner is
 * looking at; passing nothing as staff asks about every brand.
 */
create or replace function public.brands_in_scope(p_brand uuid default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id
    from brands b
   where (p_brand is null or b.id = p_brand)
     -- Definer, so brands' own policy is not what filters this: the condition
     -- is written out here where it can be read, and a partner naming another
     -- brand gets an empty set rather than an error they could probe with.
     and (is_staff() or b.id in (select my_brand_ids()));
$$;

-- ── a partner cannot list the catalogue ─────────────────────────────────────

-- Until now this was "anyone signed in". A partner signing in would have been
-- handed every SKU we stock, which is most of what a competitor would want.
drop policy if exists products_read on products;
create policy products_read on products for select using (
  auth.uid() is not null
  and (not is_partner() or brand_id in (select my_brand_ids()))
);

alter table brands enable row level security;
alter table brand_partners enable row level security;

drop policy if exists brands_staff on brands;
create policy brands_staff on brands for all using (is_staff()) with check (is_staff());
drop policy if exists brands_own on brands;
create policy brands_own on brands for select using (id in (select my_brand_ids()));

drop policy if exists brand_partners_staff on brand_partners;
create policy brand_partners_staff on brand_partners for all
  using (is_staff()) with check (is_staff());
drop policy if exists brand_partners_self on brand_partners;
create policy brand_partners_self on brand_partners for select
  using (auth_user_id = auth.uid());


-- ###########################################################################
-- 0032_partner_reporting.sql
-- ###########################################################################

-- ============================================================================
-- 0032: what a brand partner is shown.
--
-- Four questions, and no way to ask a fifth. Each of these is the only route
-- a partner has to a number, and each begins by narrowing to the brands they
-- speak for — so the shape of the answer cannot be changed by the asking.
--
-- What sold is measured the way the staff dashboard measures it: by order
-- date, cancelled orders excluded, and only lines we can cost. A consignment
-- settlement built on lines with no cost recorded would be a bill for an
-- amount nobody agreed, so those are left out and counted separately, exactly
-- as 0023 does for our own margin.
--
-- "Due to the brand" is what we recorded owing when the line was placed, not
-- what we would owe at today's cost. A price list that changes in October
-- must not change what September settled at.
-- ============================================================================

/**
 * The postcode area a delivery went to — "SL", "EH", "M".
 *
 * Addresses here are free text typed by whoever set the account up, so this
 * finds a UK postcode inside one rather than trusting a field. The area is as
 * far as it goes on purpose: a partner asking where their stock sells is
 * asking about regions, and the rest of the postcode identifies the shop.
 */
create or replace function public.postcode_area(p_address text)
returns text language sql immutable as $$
  select upper(substring(
    substring(upper(coalesce(p_address, ''))
              from '[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}')
    from '^[A-Z]{1,2}'));
$$;

/** Headline figures for a period, over one brand's goods. */
create or replace function public.partner_sales_totals(
  p_from date, p_to date, p_brand uuid default null
)
returns table (
  units integer, orders integer, sales numeric, due_to_brand numeric,
  distributor_margin numeric, excluded_lines integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with mine as (
    select l.qty, l.unit_price, c.unit_cost, o.id as order_id
      from order_lines l
      join orders o    on o.id = l.order_id
      join products p  on p.id = l.product_id
      left join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
  )
  select
    coalesce(sum(qty) filter (where unit_cost is not null), 0)::integer,
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer
  from mine;
end $$;

/** The same, a month at a time, with every month in the range returned. */
create or replace function public.partner_sales_by_month(
  p_from date, p_to date, p_brand uuid default null
)
returns table (
  month date, units integer, sales numeric, due_to_brand numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with months as (
    select generate_series(date_trunc('month', p_from::timestamp),
                           date_trunc('month', p_to::timestamp),
                           interval '1 month')::date as month
  ),
  sold as (
    select date_trunc('month', o.date::timestamp)::date as month,
           sum(l.qty)::integer                          as units,
           sum(l.qty * l.unit_price)                    as sales,
           sum(l.qty * c.unit_cost)                     as due
      from order_lines l
      join orders o   on o.id = l.order_id
      join products p on p.id = l.product_id
      join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
     group by 1
  )
  select m.month,
         coalesce(s.units, 0),
         coalesce(s.sales, 0)::numeric,
         coalesce(s.due, 0)::numeric
    from months m
    left join sold s on s.month = m.month
   order by m.month;
end $$;

/** Which of their products sold, best first. */
create or replace function public.partner_top_products(
  p_from date, p_to date, p_brand uuid default null, p_limit integer default 10
)
returns table (
  sku text, name text, units integer, sales numeric, due_to_brand numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  select p.sku, p.name,
         sum(l.qty)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * c.unit_cost)::numeric
    from order_lines l
    join orders o   on o.id = l.order_id
    join products p on p.id = l.product_id
    join order_line_costs c on c.order_line_id = l.id
   where p.brand_id in (select brands_in_scope(p_brand))
     and o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by p.sku, p.name
   order by 3 desc, 4 desc, p.sku
   limit greatest(1, coalesce(p_limit, 10));
end $$;

/**
 * Who is buying their goods, and where.
 *
 * Two kinds of answer in one table — the tier of trade customer, and the
 * postcode area the goods went to — because both are "who buys this" and a
 * partner reads them together.
 *
 * No client is named. A brand is entitled to know that a third of their stock
 * goes to clubs in the south east; they are not entitled to our customer list,
 * and a breakdown fine enough to identify one shop is our customer list with
 * extra steps. So a band holding fewer than three clients is folded into one
 * "elsewhere" row rather than shown.
 */
create or replace function public.partner_demographics(
  p_from date, p_to date, p_brand uuid default null
)
-- "buyers" rather than "clients": the table of that name is joined below, and
-- an output column sharing its name shadows it.
-- Output names deliberately unlike the CTE columns below: an OUT parameter
-- shadows anything of the same name inside the body, and "units" or "sales"
-- would be ambiguous in every aggregate that computes them.
returns table (kind text, label text, buyers integer, sold integer, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with mine as (
    select o.client_id, l.qty, l.unit_price,
           t.name as tier,
           coalesce(postcode_area(coalesce(o.ship_to, cl.address)), 'Not known') as area
      from order_lines l
      join orders o    on o.id = l.order_id
      join products p  on p.id = l.product_id
      join clients cl  on cl.id = o.client_id
      join tiers t     on t.id = cl.tier_id
      join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
  ),
  by_tier as (
    select 'tier'::text as kind, tier as label,
           count(distinct client_id)::integer as buyer_count,
           sum(qty)::integer as unit_count,
           sum(qty * unit_price)::numeric as money
      from mine group by tier
  ),
  by_area as (
    select 'area'::text as kind, area as label,
           count(distinct client_id)::integer as buyer_count,
           sum(qty)::integer as unit_count,
           sum(qty * unit_price)::numeric as money
      from mine group by area
  ),
  -- A region with one or two buyers in it names them to anybody who knows the
  -- trade, so the thin ones are added together instead.
  area_shown as (
    select * from by_area where buyer_count >= 3
  ),
  area_folded as (
    select 'area'::text, 'Elsewhere'::text,
           sum(buyer_count)::integer, sum(unit_count)::integer, sum(money)::numeric
      from by_area where buyer_count < 3
     having count(*) > 0
  )
  select * from by_tier
  union all select * from area_shown
  union all select * from area_folded
  order by 1, 5 desc, 2;
end $$;

-- ── dropshipping ────────────────────────────────────────────────────────────

/**
 * One row per brand per order that brand has to ship.
 *
 * A row rather than an email alone, because an email is not a record: a
 * partner needs a list of what is outstanding, we need to know whether they
 * were told, and somebody has to be able to say in March what was sent in
 * January. The email is sent from this row and its success recorded on it.
 */
create table if not exists dropship_notices (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  brand_id        uuid not null references brands(id) on delete cascade,
  created_at      timestamptz not null default now(),
  /** When we managed to tell them. Null means the email has not gone yet. */
  notified_at     timestamptz,
  shipped         boolean not null default false,
  shipped_at      timestamptz,
  carrier         text,
  tracking_number text,
  unique (order_id, brand_id)
);
create index if not exists dropship_notices_open_idx
  on dropship_notices (brand_id, created_at desc) where not shipped;

alter table dropship_notices enable row level security;
drop policy if exists dropship_notices_staff on dropship_notices;
create policy dropship_notices_staff on dropship_notices for all
  using (is_staff()) with check (is_staff());
-- Read only, and only their own. Marking one shipped goes through a function
-- so a partner cannot edit somebody else's row by guessing its id.
drop policy if exists dropship_notices_own on dropship_notices;
create policy dropship_notices_own on dropship_notices for select
  using (brand_id in (select my_brand_ids()));

/**
 * Raises a notice for every brand that has something to ship on this order.
 *
 * A statement-level trigger after the lines land, rather than a step inside
 * place_order: lines arrive one at a time and an order with three of a
 * brand's products is one notice, not three. Orders imported from a
 * spreadsheet raise notices too, which is right — a brand shipping a box does
 * not care how the order reached us.
 */
create or replace function public.raise_dropship_notices()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into dropship_notices (order_id, brand_id)
  select distinct l.order_id, p.brand_id
    from new_lines l
    join products p on p.id = l.product_id
   where p.dropship and p.brand_id is not null
  on conflict (order_id, brand_id) do nothing;
  return null;
end $$;

drop trigger if exists order_lines_dropship on order_lines;
create trigger order_lines_dropship
  after insert on order_lines
  referencing new table as new_lines
  for each statement execute function public.raise_dropship_notices();

/**
 * Orders a brand has to ship, and what is on them.
 *
 * The address and the goods, because that is a dispatch note. Not what the
 * customer paid for anything else on the order, not the rest of the order at
 * all, and not the client's account terms: a brand shipping one box needs to
 * know where it goes and what goes in it.
 */
create or replace function public.partner_dropship_orders(
  p_brand uuid default null, p_include_shipped boolean default false
)
returns table (
  notice_id uuid, order_id uuid, order_number text, order_date date,
  client_name text, ship_to text,
  shipped boolean, shipped_at timestamptz,
  carrier text, tracking_number text,
  lines jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  select n.id, o.id, o.number, o.date,
         cl.name, coalesce(o.ship_to, cl.address),
         n.shipped, n.shipped_at, n.carrier, n.tracking_number,
         (select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'qty', l.qty)
                           order by l.sku)
            from order_lines l
            join products p2 on p2.id = l.product_id
           where l.order_id = o.id and p2.brand_id = n.brand_id and p2.dropship)
    from dropship_notices n
    join orders o  on o.id = n.order_id
    join clients cl on cl.id = o.client_id
   where n.brand_id in (select brands_in_scope(p_brand))
     and o.status <> 'cancelled'
     and (p_include_shipped or not n.shipped)
   order by o.date desc, o.number desc;
end $$;

/** A partner marking their own box as gone. */
create or replace function public.mark_dropship_shipped(
  p_notice uuid, p_carrier text, p_tracking text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from dropship_notices n
     where n.id = p_notice
       and (is_staff() or n.brand_id in (select my_brand_ids()))
  ) then
    raise exception 'Not authorised';
  end if;

  update dropship_notices
     set shipped = true,
         shipped_at = coalesce(shipped_at, now()),
         carrier = nullif(trim(coalesce(p_carrier, '')), ''),
         tracking_number = nullif(trim(coalesce(p_tracking, '')), '')
   where id = p_notice;
end $$;


-- ###########################################################################
-- 0033_returns.sql
-- ###########################################################################

-- ============================================================================
-- 0033: goods coming back, for the two reasons we accept.
--
-- IQ does not take returns because somebody over-ordered or changed their
-- mind. Trade stock is bought to be sold on, a shop that has held a frame for
-- three weeks has not bought it on approval, and a policy that says otherwise
-- gets used. The two reasons we do accept are the two that are our fault:
--
--   faulty      — it arrived broken, or broke under warranty;
--   wrong_item  — we picked and sent something other than what was ordered.
--
-- That list is an enum, not a dropdown. A dropdown is a suggestion; an enum
-- means no screen, script or future import can record a return for any other
-- reason, and nobody has to remember the policy to enforce it.
--
-- The two reasons are not the same thing afterwards, either. A wrong item is
-- good stock that should never have left, so it goes back on the shelf when
-- it arrives. A faulty one does not, whatever it looks like. That difference
-- is in receive_return and is the main reason the reason sits on the line
-- rather than on the request: one parcel can hold both.
--
-- Nothing here refunds anybody by itself. A return is a request, then a
-- decision, then goods actually arriving, then a resolution — and the credit
-- note is raised by the same credit_invoice() 0018 already uses, so a refund
-- from a return and a refund typed in by hand are the same document.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'return_reason') then
    create type return_reason as enum ('faulty', 'wrong_item');
  end if;
  if not exists (select 1 from pg_type where typname = 'return_status') then
    create type return_status as enum
      ('requested', 'approved', 'declined', 'received', 'resolved', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'return_outcome') then
    create type return_outcome as enum ('refund', 'exchange');
  end if;
end $$;

alter type order_event_type add value if not exists 'return_requested';
alter type order_event_type add value if not exists 'return_decided';
alter type order_event_type add value if not exists 'return_resolved';

-- How long after dispatch we will look at one. A policy, so it lives where
-- the rest of the terms live rather than in a constant somebody has to find.
alter table settings add column if not exists returns_days integer not null default 30;
comment on column settings.returns_days is
  'Days after dispatch a client may still report a fault or a wrong item.';

-- Who hears about one. Seeded from whoever already fields trade applications,
-- because a returns queue nobody is told about is a returns queue nobody works.
alter table settings add column if not exists returns_recipients text[] not null default '{}';
update settings
   set returns_recipients = application_recipients
 where id = 1 and returns_recipients = '{}' and application_recipients <> '{}';

create table if not exists returns (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  client_id     uuid not null references clients(id),
  order_id      uuid not null references orders(id) on delete cascade,
  status        return_status not null default 'requested',
  /** What the client asked for. Staff may settle it the other way with a note. */
  wanted        return_outcome not null,
  raised_by     uuid references profiles(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references profiles(id),
  decision_note text,
  received_at   timestamptz,
  resolved_at   timestamptz,
  /** Whichever of these the resolution produced. */
  credit_id     uuid references invoices(id),
  replacement_order_id uuid references orders(id)
);
create index if not exists returns_client_idx on returns (client_id, created_at desc);
create index if not exists returns_open_idx on returns (status, created_at)
  where status in ('requested', 'approved', 'received');

create table if not exists return_lines (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns(id) on delete cascade,
  order_line_id uuid not null references order_lines(id),
  -- Snapshotted like an order line's, so a return still reads correctly when
  -- the catalogue moves on.
  sku           text not null,
  name          text not null,
  qty           integer not null check (qty > 0),
  /** Per line: one parcel can hold a faulty item and a wrongly-picked one. */
  reason        return_reason not null,
  note          text
);
create index if not exists return_lines_return_idx on return_lines (return_id);

alter table settings add column if not exists next_return integer not null default 1;

create or replace function public.next_return_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update settings set next_return = next_return + 1 where id = 1
    returning next_return - 1 into n;
  return 'RMA-' || lpad(n::text, 4, '0');
end $$;

-- ── who sees what ───────────────────────────────────────────────────────────

alter table returns enable row level security;
alter table return_lines enable row level security;

drop policy if exists returns_staff on returns;
create policy returns_staff on returns for all using (is_staff()) with check (is_staff());
drop policy if exists returns_client_read on returns;
create policy returns_client_read on returns for select using (client_id = my_client_id());

drop policy if exists return_lines_staff on return_lines;
create policy return_lines_staff on return_lines for all
  using (is_staff()) with check (is_staff());
drop policy if exists return_lines_client_read on return_lines;
create policy return_lines_client_read on return_lines for select using (
  exists (select 1 from returns r where r.id = return_id and r.client_id = my_client_id())
);

-- ── how much of a line is still returnable ──────────────────────────────────

/**
 * What is left to send back on an order line.
 *
 * Counts everything not declined or cancelled, so a request sitting unread
 * still holds its quantity: without that, a client clicking twice could ask
 * to return four of the two they bought and both requests would look valid
 * until somebody added them up.
 */
create or replace function public.returnable_qty(p_order_line uuid)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, l.qty - coalesce((
    select sum(rl.qty) from return_lines rl
      join returns r on r.id = rl.return_id
     where rl.order_line_id = l.id
       and r.status not in ('declined', 'cancelled')
  ), 0))::integer
    from order_lines l
   where l.id = p_order_line;
$$;

/**
 * Raises a return request.
 *
 * Called by the client, so every constraint is checked here and not on the
 * screen that called it: the order must be theirs, the lines must be on that
 * order, the quantity must be left to return, and the window must be open.
 *
 * The window runs from dispatch, not from the order date. An order that sat
 * on back order for five weeks has not used up its returns window sitting in
 * our warehouse.
 */
create or replace function public.request_return(
  p_order_id uuid, p_wanted return_outcome, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_return  uuid;
  v_line    jsonb;
  v_src     order_lines%rowtype;
  v_qty     integer;
  v_left    integer;
  v_days    integer;
  v_shipped date;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Unknown order'; end if;

  if not (is_staff() or v_order.client_id = my_client_id()) then
    raise exception 'Not authorised';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'That order was cancelled, so there is nothing to send back';
  end if;

  select returns_days into v_days from settings where id = 1;
  select max(i.shipped_at)::date into v_shipped
    from invoices i where i.order_id = p_order_id and i.shipped and not i.superseded;

  if v_shipped is null then
    raise exception 'Nothing on that order has been dispatched yet — '
                    'tell us what is wrong and we will amend it before it goes';
  end if;
  -- Staff can raise one outside the window; a client cannot. Somebody has to
  -- be able to do the right thing for a customer, and that somebody is a
  -- person with a reason, not a form.
  if not is_staff() and v_shipped + v_days < current_date then
    raise exception 'That order was dispatched more than % days ago', v_days;
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Say which items are coming back';
  end if;

  insert into returns (number, client_id, order_id, wanted, raised_by)
  values (next_return_number(), v_order.client_id, p_order_id, p_wanted, auth.uid())
  returning id into v_return;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_src from order_lines
     where id = (v_line->>'order_line_id')::uuid and order_id = p_order_id;
    if not found then raise exception 'That item is not on this order'; end if;

    v_qty  := greatest(1, (v_line->>'qty')::integer);
    v_left := returnable_qty(v_src.id);
    if v_qty > v_left then
      raise exception 'You can send back % of %, not %', v_left, v_src.sku, v_qty;
    end if;

    -- The cast is the policy: anything but 'faulty' or 'wrong_item' fails
    -- here, whatever screen or script is asking.
    insert into return_lines (return_id, order_line_id, sku, name, qty, reason, note)
    values (v_return, v_src.id, v_src.sku, v_src.name, v_qty,
            (v_line->>'reason')::return_reason,
            nullif(trim(coalesce(v_line->>'note', '')), ''));
  end loop;

  insert into order_events (order_id, type, meta)
  values (p_order_id, 'return_requested',
          jsonb_build_object('return', v_return, 'wanted', p_wanted));

  return v_return;
end $$;

/** Staff deciding. A declined return is over; an approved one waits for goods. */
create or replace function public.decide_return(
  p_return uuid, p_approve boolean, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ret returns%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'requested' then
    raise exception 'That return has already been %', v_ret.status;
  end if;

  update returns
     set status = case when p_approve then 'approved' else 'declined' end::return_status,
         decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_return;

  insert into order_events (order_id, type, meta)
  values (v_ret.order_id, 'return_decided',
          jsonb_build_object('return', p_return, 'approved', p_approve, 'note', p_note));
end $$;

/**
 * The goods are back on our counter.
 *
 * A wrongly-picked item is good stock that should never have left, so it goes
 * back on the shelf. A faulty one does not, whatever it looks like on the
 * counter: it is going back to the supplier or in the bin, and putting it
 * into stock would sell somebody else's fault to the next customer.
 */
create or replace function public.receive_return(
  p_return uuid, p_location uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ret      returns%rowtype;
  v_location uuid;
  v_restocked integer := 0;
  r          record;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'approved' then
    raise exception 'Only an approved return can be received — this one is %', v_ret.status;
  end if;

  select coalesce(p_location, o.fulfilment_location_id) into v_location
    from orders o where o.id = v_ret.order_id;

  for r in
    select rl.qty, l.product_id
      from return_lines rl
      join order_lines l on l.id = rl.order_line_id
     where rl.return_id = p_return
       and rl.reason = 'wrong_item'
       and l.product_id is not null
  loop
    insert into stock_levels (product_id, location_id, qty)
    values (r.product_id, v_location, r.qty)
    on conflict (product_id, location_id) do update
      set qty = stock_levels.qty + excluded.qty;
    v_restocked := v_restocked + r.qty;
  end loop;

  update returns set status = 'received', received_at = now() where id = p_return;
  return v_restocked;
end $$;

/**
 * Settling it: a credit note, or a replacement on its way.
 *
 * A refund credits the invoice the goods were billed on, through the same
 * function a hand-typed credit note uses, for the quantities actually coming
 * back — not the whole invoice, which is what somebody in a hurry would do.
 *
 * An exchange is recorded against an order staff have raised for the
 * replacement, rather than raised here. A replacement is picked, packed and
 * shipped like anything else and the order desk already does all of that;
 * inventing a second path would be a second thing to keep working.
 */
create or replace function public.resolve_return(
  p_return uuid, p_outcome return_outcome, p_replacement_order uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ret     returns%rowtype;
  v_invoice uuid;
  v_credit  uuid;
  v_lines   jsonb;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'received' then
    raise exception 'The goods have not been received yet';
  end if;

  if p_outcome = 'exchange' then
    if p_replacement_order is null then
      raise exception 'Say which order is the replacement';
    end if;
    update returns
       set status = 'resolved', resolved_at = now(),
           replacement_order_id = p_replacement_order
     where id = p_return;
  else
    -- The live invoice the goods were billed on. A superseded one was
    -- withdrawn and crediting it would credit a document owed by nobody.
    select i.id into v_invoice
      from invoices i
     where i.order_id = v_ret.order_id
       and not i.superseded and i.type in ('full', 'shipment', 'backorder')
     order by i.date, i.number
     limit 1;
    if v_invoice is null then
      raise exception 'There is no invoice on that order to credit';
    end if;

    select jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty))
      into v_lines from return_lines where return_id = p_return;

    v_credit := credit_invoice(v_invoice, v_lines,
                               'Return ' || v_ret.number);
    update returns
       set status = 'resolved', resolved_at = now(), credit_id = v_credit
     where id = p_return;
  end if;

  insert into order_events (order_id, type, meta)
  values (v_ret.order_id, 'return_resolved',
          jsonb_build_object('return', p_return, 'outcome', p_outcome,
                             'credit', v_credit, 'replacement', p_replacement_order));

  return coalesce(v_credit, p_replacement_order);
end $$;

/** A client thinking better of it, before anybody has looked. */
create or replace function public.cancel_return(p_return uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ret returns%rowtype;
begin
  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if not (is_staff() or v_ret.client_id = my_client_id()) then
    raise exception 'Not authorised';
  end if;
  if v_ret.status <> 'requested' then
    raise exception 'That return is already being dealt with';
  end if;
  update returns set status = 'cancelled' where id = p_return;
end $$;


-- ###########################################################################
-- 0034_agency_orders.sql
-- ###########################################################################

-- ============================================================================
-- 0034: the orders where IQ is not the seller.
--
-- Most of what IQ sells, IQ buys and sells on: it prices the goods, invoices
-- the customer, ships them and stands behind them. DRAG is not that. A DRAG
-- order is introduced: it goes to DRAG for confirmation, DRAG raises the
-- final invoice with shipping and taxes on it, DRAG ships and carries the
-- warranty and the product liability, and DRAG pays IQ a commission for the
-- introduction. IQ is an agent on those orders, and an agent that says
-- nothing looks exactly like a seller.
--
-- So the disclosure is not a sentence somebody remembered to type into a
-- template. It is a column on the brand, snapshotted onto the order when the
-- order is placed, and read by every surface that shows the order — the
-- basket, the confirmation, the portal, the emailed confirmation and the PDF.
-- One wording, in one place, on every document about that order.
--
-- Snapshotted rather than looked up, because these are terms, not a note
-- about pricing. If the arrangement with a brand changes next year, an order
-- placed today must still say what the customer was told when they placed it.
-- (Contrast products.price_note, which is deliberately live: that describes
-- how a supplier quotes, and a wrong one should be corrected everywhere.)
--
-- And an order is either an agency order or it is not. One invoice cannot be
-- a demand from a seller for half its lines and a note from an agent for the
-- other half, so mixing them is refused here rather than caught in reading.
-- The basket splits by brand before it ever gets this far; this is the wall
-- behind that, for every other way a line can reach an order.
-- ============================================================================

alter table brands add column if not exists agency boolean not null default false;
comment on column brands.agency is
  'We introduce this brand''s orders rather than selling their goods: they '
  'invoice the customer and carry shipping, warranty and product liability.';

alter table brands add column if not exists agency_terms text;
comment on column brands.agency_terms is
  'What the customer is told on an order for this brand. One statement per '
  'line. {brand} and {company} are filled in when it is shown.';

alter table orders add column if not exists agent_brand_id uuid references brands(id);
alter table orders add column if not exists agency_terms text;
comment on column orders.agency_terms is
  'The brand''s terms as they stood when this order was placed. Snapshotted, '
  'so a later change to the arrangement never rewrites what a customer was '
  'told at the time.';

create index if not exists orders_agent_brand_idx on orders (agent_brand_id)
  where agent_brand_id is not null;

/**
 * Stamps an order with the terms it was placed under.
 *
 * Runs per statement off the lines that landed, so every path into an order —
 * the portal basket, the counter, an amendment, a historic import — is
 * covered by the same rule, and none of them has to remember it.
 */
create or replace function public.snapshot_agency_terms()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select o.id as order_id,
           count(*) filter (where b.agency) as agency_lines,
           count(*) filter (where b.agency is not true) as own_lines,
           (array_agg(distinct b.id) filter (where b.agency))[1] as brand_id,
           count(distinct b.id) filter (where b.agency) as agency_brands
      from (select distinct order_id from new_lines) n
      join orders o on o.id = n.order_id
      join order_lines l on l.order_id = o.id
      left join products p on p.id = l.product_id
      left join brands b on b.id = p.brand_id
     group by o.id
  loop
    if r.agency_lines > 0 and r.own_lines > 0 then
      raise exception 'An order cannot hold both goods we sell and goods we only '
                      'introduce — they are invoiced by different companies. '
                      'Raise the introduced lines as their own order.';
    end if;
    if r.agency_brands > 1 then
      raise exception 'An order can only be introduced to one brand: each of them '
                      'invoices the customer separately.';
    end if;
    if r.agency_lines > 0 then
      update orders
         set agent_brand_id = r.brand_id,
             agency_terms = coalesce(
               orders.agency_terms,
               (select b2.agency_terms from brands b2 where b2.id = r.brand_id))
       where orders.id = r.order_id;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists order_lines_agency on order_lines;
create trigger order_lines_agency
  after insert on order_lines
  referencing new table as new_lines
  for each statement execute function public.snapshot_agency_terms();

/**
 * The agency brands, for a screen that has to warn about a basket.
 *
 * Definer, because a client cannot read `brands` and must not be able to —
 * that table carries the consignment arrangements. What comes back is only
 * what we intend to print on the customer's own order anyway, for the brands
 * we have chosen to disclose. Nothing here is commercial.
 */
create or replace function public.agency_brands()
returns table (key text, name text, terms text)
language sql stable security definer set search_path = public as $$
  select b.key, b.name, b.agency_terms
    from brands b
   where b.agency and auth.uid() is not null;
$$;

-- ── DRAG ────────────────────────────────────────────────────────────────────
--
-- Seeded rather than left for somebody to fill in, because the disclosure is
-- not optional and an empty one is the same as none. The brand row may not
-- exist yet on a database whose catalogue has not been imported; it will be
-- created by the product sync when it is, and this claims the key first so
-- the terms are already there when the first bike lands.
--
-- Existing terms are never overwritten: once staff have worded this
-- themselves, re-running the migration must not quietly put it back.
insert into brands (key, name, agency, agency_terms)
values ('drag', 'DRAG', true,
  'This order goes to {brand} for confirmation. {brand} raises the final ' ||
  'invoice, which includes shipping and any duty or taxes.' || E'\n' ||
  '{company} acts as an introducing agent on {brand} orders and is paid a ' ||
  'commission by {brand}. We are not the seller of these goods.' || E'\n' ||
  '{brand} is responsible for shipping, for warranty, and for product ' ||
  'liability.' || E'\n' ||
  'We are here to help with all of it — tell us what you need and we will ' ||
  'take it up with {brand} for you.')
on conflict (key) do update
   set agency = true,
       agency_terms = coalesce(brands.agency_terms, excluded.agency_terms);

-- Orders already placed for an agency brand get the terms too, so the PDFs
-- and the portal do not have a gap where the disclosure should be.
update orders o
   set agent_brand_id = b.id,
       agency_terms = coalesce(o.agency_terms, b.agency_terms)
  from brands b
 where b.agency
   and o.agent_brand_id is null
   and exists (
     select 1 from order_lines l join products p on p.id = l.product_id
      where l.order_id = o.id and p.brand_id = b.id)
   and not exists (
     select 1 from order_lines l
       left join products p2 on p2.id = l.product_id
       left join brands b2 on b2.id = p2.brand_id
      where l.order_id = o.id and b2.agency is not true);


-- ###########################################################################
-- 0035_agency_accounting.sql
-- ###########################################################################

-- ============================================================================
-- 0035: an introduced order is not a sale, so it stops behaving like one.
--
-- 0034 told the customer the truth: on a DRAG order, DRAG confirms it, DRAG
-- raises the final invoice with shipping and taxes, DRAG ships it, DRAG
-- carries the warranty, and IQ is paid a commission for the introduction.
-- The books had not caught up. The document behind such an order was still a
-- full invoice: 20% VAT added to a euro price DRAG will tax themselves, a
-- payment due date for money we are not collecting, a line in the sales
-- figures for goods we never sold, and a push to Xero as our own supply.
--
-- Every one of those is a different way of saying we are the seller, and a
-- customer who pays that invoice has paid the wrong company.
--
-- So an introduced order raises an acknowledgement instead. It has the goods
-- and the quantities on it, because the customer and the desk both need to
-- see what was ordered. It has no VAT, because we are supplying nothing. It
-- cannot be marked paid, pushed to Xero, or counted as revenue.
--
-- What we do earn is the commission, and it is recorded rather than dropped:
-- a rate on the brand, snapshotted onto the order like the terms are, so the
-- dashboard can show the introduced business as what it actually is. Without
-- that, switching the goods out of the sales figures would make the DRAG
-- business vanish from the accounts entirely, which is a different lie.
-- ============================================================================

-- ── what the brand pays us ──────────────────────────────────────────────────

alter table brands add column if not exists commission_rate numeric(5,2) not null default 0
  check (commission_rate >= 0 and commission_rate <= 100);
comment on column brands.commission_rate is
  'Percent of the goods value this brand pays us for introducing the order.';

-- Snapshotted with the terms, and for the same reason: renegotiating the rate
-- next year must not restate what we earned on an order placed today.
alter table orders add column if not exists commission_rate numeric(5,2);
comment on column orders.commission_rate is
  'The introducing commission rate in force when this order was placed.';

/**
 * Stamps the order with the terms and the rate it was placed under.
 *
 * Replaces 0034's version: same rule about mixing, one more column.
 */
create or replace function public.snapshot_agency_terms()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select o.id as order_id,
           count(*) filter (where b.agency) as agency_lines,
           count(*) filter (where b.agency is not true) as own_lines,
           (array_agg(distinct b.id) filter (where b.agency))[1] as brand_id,
           count(distinct b.id) filter (where b.agency) as agency_brands
      from (select distinct order_id from new_lines) n
      join orders o on o.id = n.order_id
      join order_lines l on l.order_id = o.id
      left join products p on p.id = l.product_id
      left join brands b on b.id = p.brand_id
     group by o.id
  loop
    if r.agency_lines > 0 and r.own_lines > 0 then
      raise exception 'An order cannot hold both goods we sell and goods we only '
                      'introduce — they are invoiced by different companies. '
                      'Raise the introduced lines as their own order.';
    end if;
    if r.agency_brands > 1 then
      raise exception 'An order can only be introduced to one brand: each of them '
                      'invoices the customer separately.';
    end if;
    if r.agency_lines > 0 then
      update orders
         set agent_brand_id = r.brand_id,
             agency_terms = coalesce(
               orders.agency_terms,
               (select b2.agency_terms from brands b2 where b2.id = r.brand_id)),
             commission_rate = coalesce(
               orders.commission_rate,
               (select b2.commission_rate from brands b2 where b2.id = r.brand_id))
       where orders.id = r.order_id;
    end if;
  end loop;
  return null;
end $$;

-- ── the document that is not a demand ───────────────────────────────────────

alter table invoices add column if not exists agency boolean not null default false;
comment on column invoices.agency is
  'This document acknowledges an order the brand will invoice. It asks for '
  'nothing, carries no VAT, is never paid here and is never a sale of ours.';

/**
 * Takes the currency and the agency standing from the order.
 *
 * Replaces 0027's currency-only version. Both are facts about the order that
 * every document raised against it must agree with, and reading them from one
 * place is the only way that stays true through splits, credits and reissues.
 *
 * The VAT and the due date follow from the standing rather than being set by
 * each caller: place_order, the invoice split and the historic import all
 * raise invoices, and a rule that has to be remembered in three places is a
 * rule that holds in two.
 */
create or replace function public.invoice_currency_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_agent uuid;
begin
  select currency, agent_brand_id into new.currency, v_agent
    from orders where id = new.order_id;

  new.agency := v_agent is not null;
  if new.agency then
    -- No supply by us, so no tax by us; and nothing to chase, so no date that
    -- reads as a deadline.
    new.vat_rate := 0;
    new.due_date := new.date;
  end if;
  return new;
end $$;

-- Anything already raised against an introduced order is one of these, and
-- was raised before this existed.
update invoices i
   set agency = true, vat_rate = 0, due_date = i.date
  from orders o
 where o.id = i.order_id
   and o.agent_brand_id is not null
   and not i.agency;

/**
 * Payment we are not owed cannot be recorded as received.
 *
 * Replaces 0019's version, which refused a proforma and a credit note for the
 * same reason: a document that asks for nothing must not be settleable. This
 * one matters more, because marking it paid would release the goods into the
 * packing queue as though we were shipping them.
 */
create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_paid_date  date default null,
  p_source     text default 'manual'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_date date; v_brand text;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.paid then return; end if;

  if v_inv.agency then
    select b.name into v_brand
      from orders o join brands b on b.id = o.agent_brand_id
     where o.id = v_inv.order_id;
    raise exception 'That order was introduced to %. They invoice the customer '
                    'and they collect — nothing on this document is owed to us',
                    coalesce(v_brand, 'the brand');
  end if;
  if v_inv.type = 'proforma' then
    raise exception 'A proforma asks for no payment. Raise the invoice first';
  end if;
  if v_inv.type = 'credit' then
    raise exception 'A credit note is money owed back, not a payment to receive';
  end if;
  if v_inv.superseded then
    raise exception 'That invoice has been superseded — pay the one that replaced it';
  end if;

  v_date := coalesce(p_paid_date, current_date);
  if v_date > current_date then
    raise exception 'That payment date is in the future';
  end if;
  if v_date < v_inv.date then
    raise exception 'That is before the invoice was raised on %', to_char(v_inv.date, 'DD Mon YYYY');
  end if;

  update invoices set paid = true, paid_date = v_date where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'payment_received',
          jsonb_build_object('invoice', v_inv.number, 'source', p_source, 'date', v_date));

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'mark_paid',
          jsonb_build_object('source', p_source, 'date', v_date));
end $$;

-- ── the figures ─────────────────────────────────────────────────────────────
--
-- Goods we introduced are not our revenue and their margin is not our margin,
-- so the three reports that answer "what did we sell" stop counting them.
-- They are not lost: agency_commission() below reports them as what they are.

create or replace function public.sales_totals(
  p_from date, p_to date, p_currency text default 'GBP'
)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric,
  excluded_lines integer, excluded_revenue numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with lines as (
    select o.id as order_id, l.qty, l.unit_price, c.unit_cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.agent_brand_id is null
       and o.currency = p_currency
       and o.date between p_from and p_to
  )
  select
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is null), 0)::numeric
  from lines;
end $$;

create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day', p_currency text default 'GBP'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  v_step := case p_grain
              when 'day'   then interval '1 day'
              when 'week'  then interval '1 week'
              when 'month' then interval '1 month'
            end;
  if v_step is null then
    raise exception 'Unknown grain % — day, week or month', p_grain;
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, p_to::timestamp),
             v_step)::date as bucket
  ),
  sold as (
    select date_trunc(p_grain, o.date::timestamp)::date as bucket,
           count(distinct o.id)::integer                as orders,
           sum(l.qty * l.unit_price)                    as revenue,
           sum(l.qty * c.unit_cost)                     as cost
      from orders o
      join order_lines l       on l.order_id = o.id
      join order_line_costs c  on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.agent_brand_id is null
       and o.currency = p_currency
       and o.date between p_from and p_to
     group by 1
  )
  select b.bucket,
         coalesce(s.orders, 0),
         coalesce(s.revenue, 0)::numeric,
         coalesce(s.cost, 0)::numeric,
         coalesce(s.revenue - s.cost, 0)::numeric
    from buckets b
    left join sold s on s.bucket = b.bucket
   order by b.bucket;
end $$;

create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5, p_currency text default 'GBP'
)
returns table (
  client_id uuid, client_name text, orders integer, revenue numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select cl.id, cl.name,
         count(distinct o.id)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * (l.unit_price - c.unit_cost))::numeric
    from orders o
    join clients cl         on cl.id = o.client_id
    join order_lines l      on l.order_id = o.id
    join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.agent_brand_id is null
     and o.currency = p_currency
     and o.date between p_from and p_to
   group by cl.id, cl.name
   order by 5 desc, 4 desc, cl.name
   limit greatest(1, coalesce(p_limit, 5));
end $$;

/**
 * What the introduced business was worth to us.
 *
 * The goods value is reported alongside the commission and never instead of
 * it: it is the number the brand will invoice and the number we would be
 * asked about, but it was never ours. A brand on a zero rate still appears,
 * with a commission of nothing — an arrangement nobody has priced yet is
 * something to see rather than something to hide.
 *
 * `rate` is null where the orders in the period were placed at more than one;
 * see below for why an average is not offered in its place.
 */
create or replace function public.agency_commission(
  p_from date, p_to date, p_currency text default 'GBP'
)
returns table (
  brand_id uuid, brand_name text, orders integer,
  goods numeric, rate numeric, commission numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with per_order as (
    select o.agent_brand_id as brand,
           o.id             as order_id,
           coalesce(o.commission_rate, 0) as rate,
           sum(l.qty * l.unit_price)      as goods
      from orders o
      join order_lines l on l.order_id = o.id
     where o.status <> 'cancelled'
       and o.agent_brand_id is not null
       and o.currency = p_currency
       and o.date between p_from and p_to
     group by o.id, o.agent_brand_id, o.commission_rate
  )
  select b.id, b.name,
         count(*)::integer,
         sum(p.goods)::numeric,
         /*
          * The rate, only where there is one.
          *
          * Where the rate changed mid-period there is no single number that
          * both describes the orders and reproduces the commission: a
          * weighted average rounded to two places multiplies back out to a
          * different figure, so the row would invite a hand-check it then
          * fails. Null says "several", which is the truth, and the goods and
          * the commission beside it are exact either way.
          */
         case when count(distinct p.rate) = 1 then max(p.rate) end::numeric,
         round(sum(p.goods * p.rate) / 100, 2)::numeric
    from per_order p
    join brands b on b.id = p.brand
   group by b.id, b.name
   order by 6 desc, b.name;
end $$;

-- DRAG's rate is not something this migration can know, so it is left at zero
-- and shows on the brands screen as an arrangement still to be priced.


-- ###########################################################################
-- 0036_series.sql
-- ###########################################################################

-- ============================================================================
-- 0036: the range a part belongs to.
--
-- "Shimano" is a brand and "FC-R9200" is a model, but the word a shop actually
-- uses is neither: they ask for a Dura-Ace chainset, or an Ultegra cassette.
-- That middle level — the series — was nowhere in the catalogue, so a screen
-- could show a customer eighteen Shimano chainsets and leave them to work out
-- from the part number which ones were the good ones.
--
-- It is a column rather than a category because a series cuts across
-- categories: Dura-Ace is a chainset and a cassette and a rotor and a
-- derailleur. Filing by series would break filing by what the thing is, and
-- the thing is what somebody browses by.
--
-- Nullable, and blank for most of the catalogue. A bottom bracket belongs to
-- no range, and a made-up one would be worse than none.
--
-- The rest of this file teaches the variant deriver about rotors. 0030 gave it
-- chainsets, cassettes and wires and left rotors out, because a rotor states
-- its size nowhere in its name — it is in the part number, where the same
-- letters also carry the lockring type. Two rotors of one size and different
-- lockrings are two products, so the label has to keep both.
-- ============================================================================

alter table products add column if not exists series text;
comment on column products.series is
  'The range this part belongs to — Dura-Ace, Ultegra, Di2. Blank where the '
  'product belongs to no range, which is most of a catalogue.';

create index if not exists products_series_idx on products (lower(series))
  where series is not null;

/**
 * A rotor's size and what else its part number says.
 *
 * RT-CL900-L is 203mm; RT-CL900-LE and RT-CL900-LI are also 203mm and are
 * different products. So the size is read out and whatever follows it is kept
 * in brackets rather than discarded: "203mm" and "203mm (E)" are two labels a
 * person can tell apart, and "203mm" twice is a unique-index violation and a
 * customer ordering the wrong disc.
 *
 * The letters are not decoded beyond the size. E and I are almost certainly
 * the lockring serration and J is something else again, but this file does
 * not know that, and a label that asserted it would be a guess printed in a
 * catalogue. The code is shown as the supplier writes it.
 */
create or replace function public.rotor_label_for(p_sku text)
returns text language sql immutable as $$
  with parts as (
    -- Two or three digits: the model number. A greedy run would swallow the
    -- 200 of RT-CL750-200E and leave nothing for the size to be read from.
    select substring(upper(coalesce(p_sku, '')) from '^(?:RTCL|SMRT)\d{2,3}(.*)$') as tail
  ),
  read as (
    select tail,
           case
             when tail ~ '^200' then '200mm'
             when tail ~ '^220' then '220mm'
             when tail ~ '^SS'  then '140mm'
             when tail ~ '^S'   then '160mm'
             when tail ~ '^M'   then '180mm'
             when tail ~ '^L'   then '203mm'
           end as size,
           -- As many characters as the size took: three for 200 and 220,
           -- two for SS, one for the rest. Reading SS as one character would
           -- leave an "S" in front of the lockring code.
           case
             when tail ~ '^(200|220)' then substring(tail from 4)
             when tail ~ '^SS'        then substring(tail from 3)
             when tail ~ '^[SML]'     then substring(tail from 2)
           end as rest
      from parts
  )
  select case
           when size is null then null
           when coalesce(rest, '') = '' then size
           else size || ' (' || rest || ')'
         end
    from read;
$$;

/**
 * The part of a rotor's name that is the model.
 *
 * Taken from the part number rather than the description, because the
 * description is the part number: "Shimano Disc Rotor RTCL900LJ". Strip the
 * size and lockring code off the end and RTCL900 is what is left, which is the
 * model every one of them is a size of.
 */
create or replace function public.rotor_model_for(p_sku text)
returns text language sql immutable as $$
  select substring(upper(coalesce(p_sku, '')) from '^((?:RTCL|SMRT)\d{2,3})');
$$;

-- 0030's take one argument and these take two with a default, so both would
-- answer a one-argument call and Postgres refuses to choose. The old pair goes
-- first; every caller is in this file or in the suites, and both are updated.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('variant_model_key', 'variant_label_for')
       and p.pronargs = 1
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

/**
 * What distinguishes this product from the others of its model.
 *
 * Replaces 0030's, which read cassettes, chainrings and lengths out of the
 * name. A rotor has none of those in its name, so the part number is asked
 * last — last, because a name that states its size is always the better
 * source, and only a rotor gets this far with nothing found.
 */
create or replace function public.variant_label_for(p_name text, p_sku text default null)
returns text language sql immutable as $$
  select nullif(
    coalesce(
      spec_value(p_name, 'Cassette'),
      nullif(concat_ws(' ',
        spec_value(p_name, 'Chainring'),
        spec_value(p_name, 'Length')), ''),
      rotor_label_for(p_sku)),
    '');
$$;

/**
 * The part of a name that is the model, with every measurement taken out.
 *
 * Replaces 0030's for the same reason: where the name carries no size, the
 * part number is what says which model this is one of.
 */
create or replace function public.variant_model_key(p_name text, p_sku text default null)
returns text language sql immutable as $$
  select coalesce(
    case when rotor_label_for(p_sku) is not null
         then rotor_model_for(p_sku) end,
    nullif(
      trim(regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(p_name, '\d{2}\s*-\s*\d{2}\s*T', '', 'gi'),
            '\d{2,4}(\.\d+)?\s*mm', '', 'gi'),
          '\d{2}\s*[/-]\s*\d{2}', '', 'g'),
        '\s{2,}', ' ', 'g')),
      ''));
$$;

/**
 * Products that look like sizes of one thing.
 *
 * Replaces 0030's. Same four rules, and one addition: a product whose label
 * came from its part number is grouped on a model key that also came from the
 * part number, so a rotor's model is never the description it shares with
 * every other rotor.
 *
 * The series joins the grouping. Two Dura-Ace and Ultegra power meters are
 * both called "Power 50 / 34 - double - 170 mm" — the same brand, the same
 * collection and, once the size is stripped out, the same model key. Without
 * the series they would land in one group and a shop buying a £355 Ultegra
 * chainset would be shown a £460 Dura-Ace one, or the other way about.
 */
create or replace function public.suggest_variant_groups()
returns table (
  product_id uuid, sku text, name text,
  model text, label text, members integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with candidate as (
    select p.id as pid, p.sku as psku, p.name as pname,
           variant_model_key(p.name, p.sku)  as pmodel,
           variant_label_for(p.name, p.sku)  as plabel,
           coalesce(p.category_id::text, '') as cat,
           coalesce(lower(trim(p.brand)), '') as brand,
           coalesce(lower(trim(p.series)), '') as series
      from products p
     where p.variant_group is null
       and p.active
  ),
  usable as (
    select * from candidate
     where plabel is not null
       and pmodel is not null
       and length(pmodel) >= 3
       and pmodel ~ '[A-Za-z]{2}'
  ),
  grouped as (
    select pmodel, cat, brand, series,
           count(distinct plabel) as sizes,
           count(*)               as rows
      from usable
     group by pmodel, cat, brand, series
  )
  select u.pid, u.psku, u.pname, u.pmodel, u.plabel, g.rows::integer
    from usable u
    join grouped g
      on g.pmodel = u.pmodel and g.cat = u.cat
     and g.brand = u.brand and g.series = u.series
   where g.sizes >= 2
   order by u.pmodel, u.plabel, u.psku;
end $$;

/**
 * Writes the grouping suggest_variant_groups() proposes.
 *
 * Replaces 0030's. The key carries the series as well, for the same reason the
 * grouping does: without it the two power meter ranges share a key.
 */
create or replace function public.apply_variant_groups()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  with proposed as (
    select s.product_id, s.model, s.label,
           coalesce(p.category_id::text, 'none') as cat,
           coalesce(lower(trim(p.brand)), 'none') as brand,
           coalesce(lower(trim(p.series)), 'none') as series
      from suggest_variant_groups() s
      join products p on p.id = s.product_id
     where p.variant_group is null
  ),
  keyed as (
    select product_id, label,
           left(regexp_replace(
                  upper(model || ' ' || brand || ' ' || series || ' ' || cat),
                  '[^A-Z0-9]+', '-', 'g'), 120) as group_key
      from proposed
  ),
  ranked as (
    select *, row_number() over (
             partition by group_key, lower(label) order by product_id) as rn
      from keyed
  ),
  written as (
    update products p
       set variant_group = r.group_key, variant_label = r.label
      from ranked r
     where p.id = r.product_id and r.rn = 1 and p.variant_group is null
    returning 1
  )
  select count(*)::integer into v_count from written;

  return v_count;
end $$;

-- ── the catalogue carries the series to the client ──────────────────────────
--
-- A column in the middle of the list, which CREATE OR REPLACE VIEW cannot do.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.series,
  p.image_url,
  p.currency,
  p.price_note,
  p.variant_group,
  p.variant_label,
  p.variant_sort,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.series,
       c.price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;


-- ###########################################################################
-- 0037_template_headers.sql
-- ###########################################################################

-- ============================================================================
-- 0037: a saved column layout must not outlive the sheet it was saved for.
--
-- The import remembers which column was which, so a quarterly price list is
-- drag-and-drop the second time. It remembered them as letters — sku is B,
-- Model is E — and applied them to whatever turned up next, in place of the
-- guess, without ever looking at the headers.
--
-- That holds exactly as long as the supplier's sheet keeps its shape. Insert
-- one column and every letter after it points at the wrong thing, and the
-- guess that would have read the new headers correctly is never consulted.
-- What came out was an import that read a Series column as the Size: a
-- hundred and eighteen products all claiming to be size "Dura-Ace", eighty-one
-- of them refused as duplicates of each other, and an error message about
-- duplicate sizes that pointed nowhere near the cause.
--
-- So the headers are saved with the layout. They match, the layout is used;
-- they do not, it is ignored and the columns are read afresh — and the screen
-- says which happened, because a layout silently not being used is its own
-- kind of surprise.
-- ============================================================================

alter table import_templates
  add column if not exists header_labels text[] not null default '{}';

comment on column import_templates.header_labels is
  'The header row this layout was saved against. A sheet whose headers differ '
  'is a different sheet, whatever its columns are called, and the saved '
  'letters no longer describe it.';

-- Every layout saved before this column existed was saved against headers
-- nobody recorded, so none of them can be checked. Emptied rather than
-- trusted: re-guessing a layout costs one glance at a screen, and using a
-- stale one costs an import that looks like it worked.
update import_templates set header_labels = '{}' where header_labels is null;


-- ###########################################################################
-- 0038_moq.sql
-- ###########################################################################

-- ============================================================================
-- 0038: the price on the sheet is the price by the outer, and now it says so.
--
-- Shimano sell by the carton. A shifter comes in tens, a charging cable in
-- hundreds, and the trade prices we publish are the prices at those
-- quantities — which was true before this migration and written down nowhere.
-- A shop ordering three of something that comes in tens was quoted the carton
-- price on the screen, and corrected afterwards by somebody who knew.
--
-- Two columns fix it. products.moq is the carton quantity. tier_prices gains a
-- second price beside the first: what one unit costs when fewer than an outer
-- are bought. Below the minimum the dearer price applies, at or above it the
-- advertised one does, and both are on the screen before anybody commits.
--
-- The break price lives on tier_prices rather than in a table of its own
-- because it is a price on a price sheet: it changes when the sheet changes,
-- it is superseded the same way, and a supplier's new list sets both figures
-- in one row. A separate table would let the two drift apart by a quarter,
-- which is exactly the failure this is here to stop.
-- ============================================================================

-- ── the carton ──────────────────────────────────────────────────────────────
-- One is the honest default and the common case: most of the catalogue is sold
-- in ones, and a product that has never been told otherwise should behave
-- exactly as it did before this migration existed.
alter table products
  add column if not exists moq integer not null default 1;

do $$ begin
  alter table products add constraint products_moq_positive check (moq >= 1);
exception when duplicate_object then null; end $$;

comment on column products.moq is
  'Minimum order quantity for the advertised price — the outer, or carton, '
  'the part ships in. Below it, tier_prices.break_price applies.';

-- ── the price below it ──────────────────────────────────────────────────────
alter table tier_prices
  add column if not exists break_price numeric(12,2);
alter table product_costs
  add column if not exists break_cost numeric(12,2);

/*
 * A break price below the outer price is a column swap, not a bargain.
 *
 * The two figures arrive side by side on an import, and reading them the wrong
 * way round sells every carton at the loose price and every loose unit at the
 * carton price. Nothing downstream would question it — both are plausible
 * numbers in a plausible column — so it is caught here, at the one point both
 * values are in the same row, and the import fails naming the SKU rather than
 * succeeding and costing a quarter of the margin on every line.
 *
 * Equal is allowed: a part the supplier prices the same either way is
 * ordinary, and so is one whose loose price we have not been given.
 */
do $$ begin
  alter table tier_prices add constraint tier_prices_break_dearer
    check (break_price is null or break_price >= price);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table product_costs add constraint product_costs_break_dearer
    check (break_cost is null or break_cost >= cost);
exception when duplicate_object then null; end $$;

comment on column tier_prices.break_price is
  'What one unit costs this tier below the product''s MOQ. Null means one '
  'price at any quantity.';

-- ── what a quantity actually costs ──────────────────────────────────────────
/**
 * The price this tier pays for p_qty of this product, as at a date.
 *
 * One function, called by the order desk, the portal and place_order, so the
 * quantity that decides the price on the screen is the same quantity that
 * decides it on the invoice. The alternative — each caller comparing a qty to
 * an moq for itself — is three chances to get the boundary wrong, and the
 * boundary is the whole feature.
 *
 * At the MOQ exactly, the advertised price applies. An outer of ten means ten
 * is enough, not eleven.
 */
create or replace function public.price_for_qty(
  p_product uuid, p_tier uuid, p_qty integer, p_on date default current_date
) returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when p_qty < coalesce(p.moq, 1) and tp.break_price is not null
             then tp.break_price
           else tp.price
         end
    from products p
    join lateral (
      select price, break_price from tier_prices
       where product_id = p.id and tier_id = p_tier and effective_from <= p_on
       order by effective_from desc
       limit 1
    ) tp on true
   where p.id = p_product;
$$;

-- ── the screens ─────────────────────────────────────────────────────────────
/*
 * Both of these gain a column rather than changing one, so every caller that
 * does not care about outers keeps working untouched. Dropped first because a
 * function's return type cannot be widened in place.
 */
drop function if exists public.current_tier_prices(uuid[], date);
create function public.current_tier_prices(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, tier_id uuid, price numeric, break_price numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (tp.product_id, tp.tier_id)
         tp.product_id, tp.tier_id, tp.price, tp.break_price
    from tier_prices tp
   where tp.product_id = any(p_products)
     and tp.effective_from <= p_on
   order by tp.product_id, tp.tier_id, tp.effective_from desc;
$$;

drop function if exists public.current_costs(uuid[], date);
create function public.current_costs(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, cost numeric, break_cost numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (pc.product_id)
         pc.product_id, pc.cost, pc.break_cost
    from product_costs pc
   where pc.product_id = any(p_products)
     and pc.effective_from <= p_on
   order by pc.product_id, pc.effective_from desc;
$$;

-- ── what a client sees ──────────────────────────────────────────────────────
-- Rebuilt rather than replaced: a new column cannot be added to the middle of
-- a view's column list, and client_group_options reads this one.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.series,
  p.image_url,
  p.currency,
  p.price_note,
  p.variant_group,
  p.variant_label,
  p.variant_sort,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  -- The two figures a customer needs to decide: how many make a carton, and
  -- what one costs if they do not want one.
  coalesce(p.moq, 1) as moq,
  tp.break_price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price, tp2.break_price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.series,
       c.price,
       c.moq,
       c.break_price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;

-- ── the invoice ─────────────────────────────────────────────────────────────
/*
 * The one that matters. Everything above is a screen; this is the money.
 *
 * The only change is which function prices the line: price_for_qty instead of
 * current_tier_price, so the quantity on the order decides the rate. A staff
 * override still wins, because a staff override is somebody deciding, and the
 * whole point of an override is to be allowed to disagree with the sheet.
 */
create or replace function public.place_order(
  p_client_id   uuid,
  p_location_id uuid,
  p_lines       jsonb,
  p_notes       text default null,
  p_address_id  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_client      clients%rowtype;
  v_settings    settings%rowtype;
  v_location    uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_invoice_id  uuid;
  v_invoice_no  text;
  v_line        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_price       numeric(12,2);
  v_stock       integer;
  v_alloc       integer;
  v_bo          integer;
  v_total_bo    integer := 0;
  v_vat         numeric(5,2);
  v_po_id       uuid;
  v_po_no       text;
  v_addr        client_addresses%rowtype;
  v_ship_to     text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'Not authorised'; end if;

  if v_role = 'client' and p_client_id is distinct from my_client_id() then
    raise exception 'Not authorised to order for this client';
  end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if not v_client.active then raise exception 'Client account is not active'; end if;

  select * into v_settings from settings where id = 1;

  v_location := coalesce(p_location_id, v_client.default_location_id);
  if v_location is null then raise exception 'No fulfilment location for this order'; end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Order has no lines';
  end if;

  -- The address must belong to the client being ordered for. Without this an
  -- id from another client's account would be accepted and their address
  -- printed on the packing list.
  if p_address_id is not null then
    select * into v_addr from client_addresses
     where id = p_address_id and client_id = p_client_id and active;
    if not found then raise exception 'That delivery address is not on this account'; end if;
  else
    select * into v_addr from client_addresses
     where client_id = p_client_id and active
     order by is_default desc, created_at
     limit 1;
  end if;

  v_ship_to := coalesce(
    case when v_addr.id is not null
         then concat_ws(E'\n', nullif(v_addr.recipient, ''), v_addr.address)
    end,
    v_client.address);

  v_order_no := next_order_number();
  insert into orders (number, client_id, date, fulfilment_location_id, placed_by, notes,
                      shipping_address_id, ship_to)
  values (v_order_no, p_client_id, current_date, v_location, auth.uid(), p_notes,
          v_addr.id, v_ship_to)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    if v_role = 'client' or v_line->>'unit_price' is null then
      -- The quantity on the line decides the rate: below the outer the
      -- break price, at or above it the advertised one.
      v_price := price_for_qty(v_product.id, v_client.tier_id, v_qty);
    else
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    if v_price is null then raise exception 'No price for % on this tier', v_product.sku; end if;

    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_location for update;
    v_stock := coalesce(v_stock, 0);

    v_alloc := least(v_qty, v_stock);
    v_bo    := v_qty - v_alloc;

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_location;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price, v_alloc, v_bo);

    v_total_bo := v_total_bo + v_bo;
  end loop;

  v_vat := case when v_client.vat_exempt then 0 else v_settings.vat_rate end;
  v_invoice_no := next_invoice_number();
  insert into invoices (number, order_id, client_id, type, date, due_date,
                        vat_rate, location_id, ready_to_pack)
  values (v_invoice_no, v_order_id, p_client_id, 'full', current_date,
          current_date + v_settings.payment_days, v_vat, v_location, v_total_bo = 0)
  returning id into v_invoice_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_invoice_id, sku, name, qty, unit_price from order_lines where order_id = v_order_id;

  insert into order_events (order_id, type, meta)
  values (v_order_id, 'placed', jsonb_build_object('number', v_order_no)),
         (v_order_id, 'invoice_sent', jsonb_build_object('invoice', v_invoice_no, 'invoice_id', v_invoice_id));

  if v_total_bo > 0 then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_location)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order_no, v_order_id
      from order_lines where order_id = v_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = v_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  perform refresh_invoice_readiness(v_order_id);
  return v_order_id;
end $$;


-- ###########################################################################
-- 0039_dropship.sql
-- ###########################################################################

-- ============================================================================
-- 0039: shipping direct to a shop's own customer, and who is responsible for
--       the address when we do.
--
-- A shop sells a groupset on a Tuesday and asks us to send it straight to the
-- buyer rather than to the shop. It saves a leg of carriage and a day, and it
-- moves one thing from us to them: we no longer know the address. They have
-- taken it from their customer, and they are the only ones who can tell us
-- whether it is right or whether anybody will be in.
--
-- So a dropship order carries three things a normal order does not: the fact
-- that it is one, the address it is going to — which belongs to nobody on our
-- system and so cannot be a client_addresses row — and a record that the
-- terms were accepted, with the wording that was on the screen at the time.
--
-- The wording is snapshotted rather than referenced, for the same reason the
-- agency terms are. Terms get edited. An order has to say what was agreed
-- when it was placed, not what the settings page says today, or the record is
-- worth nothing the first time it matters.
-- ============================================================================

-- The acceptance goes on the order's own timeline as well as in its columns,
-- because the timeline is where anybody looks first when a parcel has gone
-- wrong.
do $$ begin
  alter type order_event_type add value if not exists 'dropship_accepted';
end $$;

alter table orders
  add column if not exists dropship boolean not null default false;
alter table orders
  add column if not exists dropship_terms text;
alter table orders
  add column if not exists dropship_accepted_at timestamptz;
alter table orders
  add column if not exists dropship_accepted_by uuid references profiles(id);

comment on column orders.dropship is
  'Going direct to the client''s own customer rather than to the client. '
  'The address is theirs to get right and is not on our system.';
comment on column orders.dropship_terms is
  'The wording accepted when this order was placed, as it read then.';

/*
 * A dropship with no address, or none accepted, is not a dropship.
 *
 * Enforced here rather than trusted to the screen that raises it, because
 * this is the record somebody will be asked to produce when a parcel goes to
 * the wrong door — and "the checkbox was definitely there" is not a record.
 */
do $$ begin
  alter table orders add constraint orders_dropship_complete check (
    not dropship
    or (coalesce(btrim(ship_to), '') <> ''
        and coalesce(btrim(dropship_terms), '') <> ''
        and dropship_accepted_at is not null)
  );
exception when duplicate_object then null; end $$;

-- ── the wording ─────────────────────────────────────────────────────────────
-- In settings so it can be changed without a deploy, and defaulted to what it
-- has to say at a minimum: the address and the recipient being in are the
-- customer's to get right.
alter table settings add column if not exists dropship_terms text not null default
  'I am providing this delivery address on behalf of my own customer. '
  'I am responsible for the address being correct and complete, and for '
  'making sure someone is there to receive the delivery. Where a parcel is '
  'refused, returned or lost because the address was wrong or nobody was '
  'available, any redelivery or return carriage is chargeable to my account.';

comment on column settings.dropship_terms is
  'What a client accepts before we ship direct to their customer. Snapshotted '
  'on to each order, so editing this never rewrites what was already agreed.';

-- ── raising one ─────────────────────────────────────────────────────────────
/*
 * place_order, with three arguments on the end and one rule.
 *
 * They are on the end and defaulted, so every existing caller — the order
 * desk, the portal, the tests — keeps working untouched and keeps raising
 * ordinary orders.
 *
 * The rule: a dropship needs an address and an acceptance, and gets neither
 * from the client's address book. p_address_id is ignored outright, because a
 * saved address is the shop's own and using one would send a customer's
 * parcel to the shop it came from.
 */
/*
 * The five-argument version has to go before the eight-argument one arrives.
 *
 * The new arguments are defaulted so every existing caller keeps working —
 * but a default does not replace an overload, it competes with it, and
 * place_order(uuid, uuid, jsonb) then matches both. Postgres will not guess,
 * so every caller in the system fails at once with "function is not unique".
 *
 * The drop is guarded rather than unconditional because setup.sql is replayed
 * from the top: on a second run 0009 recreates the five-argument version, and
 * this has to take it away again before the replace below.
 */
do $$
declare v_old text;
begin
  select oid::regprocedure::text into v_old
    from pg_proc
   where proname = 'place_order'
     and pronamespace = 'public'::regnamespace
     and pronargs = 5;
  if v_old is not null then execute format('drop function %s', v_old); end if;
end $$;

create or replace function public.place_order(
  p_client_id     uuid,
  p_location_id   uuid,
  p_lines         jsonb,
  p_notes         text default null,
  p_address_id    uuid default null,
  p_dropship      boolean default false,
  p_ship_to       text default null,
  p_accept_terms  boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_client      clients%rowtype;
  v_settings    settings%rowtype;
  v_location    uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_invoice_id  uuid;
  v_invoice_no  text;
  v_line        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_price       numeric(12,2);
  v_stock       integer;
  v_alloc       integer;
  v_bo          integer;
  v_total_bo    integer := 0;
  v_vat         numeric(5,2);
  v_po_id       uuid;
  v_po_no       text;
  v_addr        client_addresses%rowtype;
  v_ship_to     text;
  v_terms       text;
  v_accepted    timestamptz;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'Not authorised'; end if;

  if v_role = 'client' and p_client_id is distinct from my_client_id() then
    raise exception 'Not authorised to order for this client';
  end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if not v_client.active then raise exception 'Client account is not active'; end if;

  select * into v_settings from settings where id = 1;

  v_location := coalesce(p_location_id, v_client.default_location_id);
  if v_location is null then raise exception 'No fulfilment location for this order'; end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Order has no lines';
  end if;

  if p_dropship then
    -- Their customer's address, typed for this order and kept on it. No
    -- client_addresses row: it is not the client's address and must not be
    -- offered back to them next time as though it were.
    if coalesce(btrim(p_ship_to), '') = '' then
      raise exception 'A direct delivery needs the address it is going to';
    end if;
    if not coalesce(p_accept_terms, false) then
      raise exception 'The delivery terms have to be accepted before we can ship direct';
    end if;
    v_ship_to  := btrim(p_ship_to);
    v_terms    := v_settings.dropship_terms;
    v_accepted := now();
    v_addr     := null;
  else
    -- The address must belong to the client being ordered for. Without this an
    -- id from another client's account would be accepted and their address
    -- printed on the packing list.
    if p_address_id is not null then
      select * into v_addr from client_addresses
       where id = p_address_id and client_id = p_client_id and active;
      if not found then raise exception 'That delivery address is not on this account'; end if;
    else
      select * into v_addr from client_addresses
       where client_id = p_client_id and active
       order by is_default desc, created_at
       limit 1;
    end if;

    v_ship_to := coalesce(
      case when v_addr.id is not null
           then concat_ws(E'\n', nullif(v_addr.recipient, ''), v_addr.address)
      end,
      v_client.address);
  end if;

  v_order_no := next_order_number();
  insert into orders (number, client_id, date, fulfilment_location_id, placed_by, notes,
                      shipping_address_id, ship_to,
                      dropship, dropship_terms, dropship_accepted_at, dropship_accepted_by)
  values (v_order_no, p_client_id, current_date, v_location, auth.uid(), p_notes,
          v_addr.id, v_ship_to,
          p_dropship, v_terms, v_accepted,
          case when p_dropship then auth.uid() end)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    if v_role = 'client' or v_line->>'unit_price' is null then
      -- The quantity on the line decides the rate: below the outer the
      -- break price, at or above it the advertised one.
      v_price := price_for_qty(v_product.id, v_client.tier_id, v_qty);
    else
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    if v_price is null then raise exception 'No price for % on this tier', v_product.sku; end if;

    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_location for update;
    v_stock := coalesce(v_stock, 0);

    v_alloc := least(v_qty, v_stock);
    v_bo    := v_qty - v_alloc;

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_location;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price, v_alloc, v_bo);

    v_total_bo := v_total_bo + v_bo;
  end loop;

  v_vat := case when v_client.vat_exempt then 0 else v_settings.vat_rate end;
  v_invoice_no := next_invoice_number();
  insert into invoices (number, order_id, client_id, type, date, due_date,
                        vat_rate, location_id, ready_to_pack)
  values (v_invoice_no, v_order_id, p_client_id, 'full', current_date,
          current_date + v_settings.payment_days, v_vat, v_location, v_total_bo = 0)
  returning id into v_invoice_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_invoice_id, sku, name, qty, unit_price from order_lines where order_id = v_order_id;

  insert into order_events (order_id, type, meta)
  values (v_order_id, 'placed', jsonb_build_object('number', v_order_no)),
         (v_order_id, 'invoice_sent', jsonb_build_object('invoice', v_invoice_no, 'invoice_id', v_invoice_id));

  -- Said on the order's own timeline, because the acceptance is the thing
  -- somebody will come looking for.
  if p_dropship then
    insert into order_events (order_id, type, meta)
    values (v_order_id, 'dropship_accepted',
            jsonb_build_object('ship_to', v_ship_to, 'terms', v_terms));
  end if;

  if v_total_bo > 0 then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_location)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order_no, v_order_id
      from order_lines where order_id = v_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = v_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  perform refresh_invoice_readiness(v_order_id);
  return v_order_id;
end $$;


-- ###########################################################################
-- 0040_builder_options.sql
-- ###########################################################################

-- ============================================================================
-- 0040: a builder step keeps its rule, and re-reads the catalogue.
--
-- The groupset builder's steps were filled by seed_group_step at migration
-- time: every active product matching a SKU pattern became an option, once.
-- The pattern lived in the call and nowhere else, so the options were a
-- photograph of the catalogue on the day the migration ran.
--
-- Which was fine until the catalogue grew. Madison's September list carries
-- fourteen EW-SD300 wire lengths — 150mm through 850mm — where the old sheet
-- had two, a 900 and a 1000. They imported, they are in the catalogue, they
-- are priced, and the builder offers none of them, because nothing re-ran the
-- rule that would have found them. The same is true of every chainset length,
-- cassette ratio and rotor size a supplier adds from here on.
--
-- So the rule moves on to the step, where it can be read back, and
-- refresh_group_options() re-runs it. The import calls that when it finishes,
-- which is the moment the answer can have changed.
-- ============================================================================

alter table product_group_steps add column if not exists sku_pattern text;
alter table product_group_steps add column if not exists sku_exclude text;
alter table product_group_steps add column if not exists spec text;
alter table product_group_steps add column if not exists spec_values text[];

comment on column product_group_steps.sku_pattern is
  'The SKU pattern whose products are this step''s options. Held here rather '
  'than in the migration that seeded it, so the step can be filled again when '
  'the catalogue changes.';

/**
 * Fills one step's options from the rule the step carries.
 *
 * The whole of what seed_group_step used to do inline, moved somewhere it can
 * be called again. A step with no pattern is left alone: its options were put
 * there by hand and are nobody's to take away.
 */
create or replace function public.apply_step_options(p_step uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st product_group_steps%rowtype;
begin
  select * into st from product_group_steps where id = p_step;
  if not found or st.sku_pattern is null then return; end if;

  -- Options that no longer answer the rule. Including the products that have
  -- since been withdrawn: a part nobody can buy must not sit on a build as
  -- though they could.
  delete from product_group_options o
   using products p
   where o.step_id = st.id and p.id = o.product_id
     and (not p.active
          or p.sku not like st.sku_pattern
          or (st.sku_exclude is not null and p.sku like st.sku_exclude)
          or (st.spec_values is not null
              and coalesce(spec_value(p.name, st.spec), '') <> all (st.spec_values))
          -- An option that cannot answer an axis the step names could never be
          -- picked from the controls, so it does not belong on the step.
          or (st.axis1_name is not null and spec_value(p.name, st.axis1_name) is null)
          or (st.axis2_name is not null and spec_value(p.name, st.axis2_name) is null));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select st.id, p.id,
         case
           when st.axis1_name is not null then
             concat_ws(' · ', spec_value(p.name, st.axis1_name), spec_value(p.name, st.axis2_name))
           when st.spec is not null then spec_value(p.name, st.spec)
           else p.name end,
         spec_value(p.name, st.axis1_name),
         spec_value(p.name, st.axis2_name),
         0
    from products p
   where p.active
     and p.sku like st.sku_pattern
     and (st.sku_exclude is null or p.sku not like st.sku_exclude)
     and (st.axis1_name is null or spec_value(p.name, st.axis1_name) is not null)
     and (st.axis2_name is null or spec_value(p.name, st.axis2_name) is not null)
     and (st.spec_values is null or spec_value(p.name, st.spec) = any (st.spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = st.id and o.product_id = p.id)
  on conflict do nothing;

  /*
   * Order recomputed over the whole step, not set on insert.
   *
   * By the number in the spec rather than its text, or a 1000mm wire lists
   * before a 900mm one — and now that a step can gain options long after it
   * was created, a newly imported 150mm wire would otherwise land at the
   * bottom of a list it belongs at the top of.
   */
  with ordered as (
    select o.id,
           row_number() over (order by
             nullif(regexp_replace(coalesce(spec_value(p.name, st.spec), ''),
                                   '[^0-9.]', '', 'g'), '')::numeric nulls last,
             p.sku) as n
      from product_group_options o
      join products p on p.id = o.product_id
     where o.step_id = st.id
  )
  update product_group_options o set sort = ordered.n
    from ordered where ordered.id = o.id;

  /*
   * Labels and axis values rebuilt for options already present.
   *
   * Not only for the ones just inserted: a step that gains the ability to read
   * a spec — or a product whose name the importer has since corrected — leaves
   * every option that was already there reading the old way. A chainset that
   * used to show with no chainring shows with one after this, and a wire whose
   * name gained its length reads as a length rather than as a part number.
   */
  update product_group_options o
     set label = case
                   when st.axis1_name is not null then
                     concat_ws(' · ', spec_value(p.name, st.axis1_name),
                               spec_value(p.name, st.axis2_name))
                   when st.spec is not null then spec_value(p.name, st.spec)
                   else p.name end,
         axis1_value = spec_value(p.name, st.axis1_name),
         axis2_value = spec_value(p.name, st.axis2_name)
    from products p
   where p.id = o.product_id and o.step_id = st.id;
end $$;

/**
 * Every step that carries a rule, filled again.
 *
 * Called at the end of a catalogue import, because that is when the answer
 * can have changed — a new wire length, a crank length the supplier has added,
 * a part withdrawn. Cheap enough to run unconditionally: there are a handful
 * of builds and a step's rule matches tens of products, not thousands.
 */
create or replace function public.refresh_group_options()
returns integer language plpgsql security definer set search_path = public as $$
declare v_step uuid; v_count integer := 0;
begin
  for v_step in
    select s.id from product_group_steps s
      join product_groups g on g.id = s.group_id
     where s.sku_pattern is not null and g.active
  loop
    perform apply_step_options(v_step);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── seeding, now that the rule is kept ──────────────────────────────────────
/*
 * seed_group_step records what it was told and then defers to the shared
 * filler, so a step seeded by a migration and a step refreshed after an import
 * are filled by the same code. Two implementations of "which products belong
 * on this step" is one of them being wrong.
 */
create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  p_spec        text default null,
  p_spec_values text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name,
       sku_pattern, sku_exclude, spec, spec_values)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2,
            p_pattern, p_exclude, p_spec, p_spec_values)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2,
           sku_pattern = p_pattern, sku_exclude = p_exclude,
           spec = p_spec, spec_values = p_spec_values
     where id = v_step;
  end if;

  perform apply_step_options(v_step);
end $$;

-- Re-run the four builds, which records the rule on every step they own and
-- fills them from the catalogue as it is now — fourteen wire lengths included.
select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');
select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');
select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);


-- ###########################################################################
-- 0041_rotor_size_from_name.sql
-- ###########################################################################

-- ============================================================================
-- 0041: a rotor's size is written on it now, so read that.
--
-- spec_value(name, 'Rotor size') decodes a Shimano part number found inside a
-- product name: RTCL900SI is a 160mm, RTCL900SSI a 140mm. That was the right
-- reader when it was written, because the converter could not decode a rotor
-- and named them "Shimano Disc Rotor RTCL900SI" — the part number, for want of
-- anything better.
--
-- 0036 taught the rebuild to read a rotor properly, and they have been called
-- "Dura-Ace RT-CL900 Disc Rotor 160mm (I)" ever since. The part number in that
-- is hyphenated, so the reader cannot see it, and the size is in plain words
-- it never learned to look at. It has returned null for every rotor in the
-- catalogue since that day.
--
-- Nothing showed it, because the builder's options were seeded once and never
-- re-checked. 0040 made them re-check after every import — which is correct,
-- and which turned a reader that quietly returned null into two rotor steps
-- with nothing on them. The fault is this function's; 0040 only stopped
-- hiding it.
-- ============================================================================

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Length' then
      -- Two to four digits and an optional decimal: 90mm, 172.5mm, 1000mm.
      nullif(regexp_replace(substring(p_name from '(\d{2,4}(?:\.\d+)?)\s*mm'),
                            '\s', '', 'g'), '') || 'mm'
    when 'Rotor size' then
      coalesce(
        -- What the name says, which is what it says now. Three digits covers
        -- every rotor Shimano make: 140, 160, 180, 200, 203, 220.
        substring(p_name from '(\d{3})\s*mm') || 'mm',
        -- And the part number, for the names written before a rotor could be
        -- read. Kept rather than replaced: a catalogue imported years ago
        -- still holds them, and a step that stopped recognising those would
        -- empty itself exactly as this one did.
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

-- Put them back. Every step that carries a rule is filled again from the
-- catalogue as it stands, which is what an import would have done — except
-- that nobody should have to run an import to get their rotors back.
select refresh_group_options();


-- ###########################################################################
-- verification — every row should say PASS
-- ###########################################################################

-- ============================================================================
-- Run this in the Supabase SQL editor AFTER applying 0001–0004.
-- Every row should say PASS. Anything else means that migration did not land.
-- ============================================================================

with checks as (
  -- Named rather than counted. A bare count of tables fails the day a
  -- migration adds one and nobody remembers to bump the number here, which
  -- teaches whoever pastes this file that a FAIL row is normal — and the next
  -- real FAIL is then read as normal too.
  select 'every table the app needs is present' as item,
         (select count(*) from unnest(array[
            'account_requests','audit_log','brand_partners','brands','categories',
            'client_addresses','clients','dropship_notices','email_log',
            'import_templates','invoice_lines','invoices','locations',
            'ops_locations','order_events','order_line_costs','order_lines',
            'orders','po_lines','price_imports','product_costs',
            'product_group_options','product_group_steps','product_groups',
            'products','profiles','purchase_orders','return_lines','returns',
            'settings','staff_invites','stock_levels','stock_transfer_lines',
            'stock_transfers','tier_prices','tiers','xero_connection'
          ]) t
          where not exists (
            select 1 from information_schema.tables
             where table_schema='public' and table_type='BASE TABLE'
               and table_name = t))::text || ' missing' as found,
         '0 missing' as expected

  union all
  select 'RLS enabled on every table',
         (select count(*)::text from pg_tables t
           join pg_class c on c.relname = t.tablename
           where t.schemaname='public' and not c.relrowsecurity),
         '0'

  union all
  select 'domain functions present',
         (select count(*)::text from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname in
            ('place_order','split_invoice','create_supplier_order','receive_po',
             'mark_invoice_paid','mark_invoice_packed','mark_invoice_shipped',
             'approve_account_request','receive_transfer','refresh_invoice_readiness',
             'next_order_number','next_invoice_number','next_po_number','next_transfer_number',
             'current_tier_price','product_in_stock','my_role','is_staff','is_admin',
             'my_client_id','my_location_ids','handle_new_user',
             'invite_staff','revoke_staff','delete_products',
             'spec_value','seed_group_step','seed_shimano_groupset',
             'edit_order','cancel_order','delete_order','credit_invoice',
             'proforma_for_backorder','import_historic_order')),
         '34'

  union all
  select 'signup trigger on auth.users',
         (select count(*)::text from pg_trigger
           where tgname='on_auth_user_created' and not tgisinternal),
         '1'

  union all
  select 'client catalogue view is security_invoker',
         (select case when reloptions::text like '%security_invoker=true%'
                 then 'yes' else 'no' end
            from pg_class where relname='client_catalogue'),
         'yes'

  union all
  select 'settings row seeded',
         (select count(*)::text from settings where id=1), '1'

  union all
  select 'next invoice number continues from 002',
         (select next_invoice::text from settings where id=1), '3'

  union all
  select 'pricing tiers seeded',
         (select count(*)::text from tiers), '4'

  union all
  select 'product categories seeded',
         (select count(*)::text from categories), '70'

  union all
  select 'products carry a category column',
         (select count(*)::text from information_schema.columns
           where table_name='products' and column_name='category_id'), '1'

  union all
  select 'every collection sits under a group',
         (select count(*)::text from categories c
           where c.parent_id is null
             and c.slug not in ('bicycles','frames','components','wheelsets',
                                'clothing','helmets','accessories','tools')), '0'

  union all
  select 'fulfilment locations seeded',
         (select count(*)::text from locations), '4'
)
select
  case when found = expected then 'PASS' else 'FAIL' end as result,
  item,
  found,
  expected
from checks
order by result, item;
