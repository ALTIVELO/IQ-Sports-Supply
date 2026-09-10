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
  email_from         text not null default 'IQ Sports Supply <orders@iqsportssupply.com>'
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
drop view if exists client_catalogue;
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
-- verification — every row should say PASS
-- ###########################################################################

-- ============================================================================
-- Run this in the Supabase SQL editor AFTER applying 0001–0004.
-- Every row should say PASS. Anything else means that migration did not land.
-- ============================================================================

with checks as (
  select 'tables created' as item,
         (select count(*) from information_schema.tables
           where table_schema='public' and table_type='BASE TABLE')::text as found,
         '24' as expected

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
             'my_client_id','my_location_ids','handle_new_user')),
         '22'

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
