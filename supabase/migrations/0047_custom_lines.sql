-- ============================================================================
-- 0047: a line that is not in the catalogue.
--
-- Everything sold so far has been a product: a row with a SKU, a price per
-- tier and a place on a shelf. Plenty of what a trade counter actually sells
-- is not — a wheel build, a frame brought in for one customer, a carriage
-- charge, a repair. Those were being handled by inventing a product nobody
-- else should ever see a price for, or not handled at all.
--
-- So an order line may now carry a description, a price and a quantity and
-- nothing else. It belongs to the order it was typed on and exists nowhere
-- else, which is the point: it does not enter the catalogue, it is not priced
-- per tier, and no other customer can find it.
--
-- Staff only, and not by omission. A customer's basket sends product ids; a
-- basket that could send a name and a price of its own would be a customer
-- deciding what they pay.
--
-- Three things fall out of a line with no product, and all three are already
-- half-handled elsewhere, which is why this is smaller than it looks:
--
--   * stock. There is no stock row for something that is not a product, so a
--     custom line allocates in full and back-orders nothing. Raising a
--     supplier order for a line with no part number would send the warehouse
--     looking for it;
--   * currency. 0027 already says a free-text line takes the order's currency
--     as it stands — true, except for an order that is nothing but custom
--     lines, which would keep the sterling default and put the wrong symbol on
--     a euro invoice. So the first such line may state it;
--   * amendment. edit_order deletes an order's lines and rebuilds them from
--     the catalogue, which would destroy a typed line the first time anybody
--     changed a quantity. They are kept aside and carried through by id.
-- ============================================================================

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
  v_custom_name text;
  v_custom_sku  text;
  v_custom_ccy  text;
  v_order_ccy   text;
  v_first_line  boolean;
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
    /*
     * A line that is not in the catalogue.
     *
     * A wheel build, a frame bought in for one customer, a carriage charge —
     * the things that are sold once and should not become a product everybody
     * can see a price for. The description, the price and the quantity are
     * typed, and that is the whole of it.
     *
     * Staff only, and not by omission: a client's basket sends product ids,
     * and a basket that sent a name and a price of its own would be a customer
     * setting what they pay.
     */
    if v_line->>'product_id' is null then
      if v_role = 'client' then
        raise exception 'Every line has to be something from the catalogue';
      end if;

      v_custom_name := btrim(coalesce(v_line->>'name', ''));
      if v_custom_name = '' then
        raise exception 'A custom line needs a description — it is all the customer will see';
      end if;
      if v_line->>'unit_price' is null then
        raise exception 'A custom line needs a price: there is no catalogue to read one from';
      end if;
      v_price := (v_line->>'unit_price')::numeric;
      if v_price < 0 then raise exception 'A line cannot be priced below nothing'; end if;
      v_qty := greatest(1, (v_line->>'qty')::integer);
      -- Something has to go in the SKU column; it is on the invoice and on the
      -- packing list, and a blank there reads as a fault rather than a choice.
      v_custom_sku := upper(nullif(btrim(coalesce(v_line->>'sku', '')), ''));

      /*
       * The currency, where this is the line that decides it.
       *
       * A product line sets the order's currency through its own trigger and a
       * custom line takes whatever the order already says. An order that is
       * nothing but custom lines therefore keeps the sterling default, which
       * would put the wrong symbol on a euro invoice — so the first line says
       * so, and any after it must agree.
       */
      v_custom_ccy := upper(nullif(btrim(coalesce(v_line->>'currency', '')), ''));
      if v_custom_ccy is not null then
        select exists (select 1 from order_lines where order_id = v_order_id)
          into v_first_line;
        select currency into v_order_ccy from orders where id = v_order_id;
        if not v_first_line then
          update orders set currency = v_custom_ccy where id = v_order_id;
        elsif v_order_ccy is distinct from v_custom_ccy then
          raise exception 'Order is in %, and this line is in % — an order cannot mix currencies',
            v_order_ccy, v_custom_ccy using errcode = 'check_violation';
        end if;
      end if;

      -- Nothing to allocate and nothing to back-order: there is no stock row
      -- for something that is not a product, and raising a supplier order for
      -- a line with no part number would send the warehouse looking for it.
      insert into order_lines (order_id, product_id, sku, name, qty, unit_price,
                               alloc_qty, bo_qty)
      values (v_order_id, null, coalesce(v_custom_sku, 'CUSTOM'), v_custom_name,
              v_qty, v_price, v_qty, 0);
      continue;
    end if;

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
  v_custom   record;
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

  /*
   * The custom lines, which cannot be looked up again.
   *
   * A product line survives an edit because the catalogue still holds it; a
   * line somebody typed exists only on this order, and the lines are deleted
   * and rebuilt. Without this they would be destroyed by any change of
   * quantity to anything else on the order — the wheel build quietly gone
   * from an order amended to add a tube.
   *
   * Kept by their own id, so the caller says which ones to carry through by
   * naming them, exactly as it names the products.
   */
  create temporary table if not exists _kept_custom (
    line_id uuid primary key, sku text, name text, unit_price numeric(12,2)
  ) on commit drop;
  delete from _kept_custom;
  insert into _kept_custom (line_id, sku, name, unit_price)
  select id, sku, name, unit_price
    from order_lines where order_id = p_order_id and product_id is null;

  perform release_order_stock(p_order_id);
  v_withdrawn := withdraw_from_supplier(p_order_id);
  delete from order_lines where order_id = p_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    -- A custom line carried through, named by the id it had before.
    if v_line->>'product_id' is null then
      select * into v_custom from _kept_custom
       where line_id = (v_line->>'line_id')::uuid;
      if not found then
        raise exception 'That typed line is not on this order';
      end if;
      v_qty := greatest(1, (v_line->>'qty')::integer);
      insert into order_lines (order_id, product_id, sku, name, qty, unit_price,
                               alloc_qty, bo_qty)
      values (p_order_id, null, v_custom.sku, v_custom.name, v_qty,
              coalesce((v_line->>'unit_price')::numeric, v_custom.unit_price),
              v_qty, 0);
      continue;
    end if;

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