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
