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
