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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
