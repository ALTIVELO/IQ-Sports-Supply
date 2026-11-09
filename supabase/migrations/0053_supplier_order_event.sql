-- create_supplier_order() has never worked.
--
-- It ends by writing a supplier_ordered event for each order it covered, and
-- it writes it with INSERT ... SELECT. In a VALUES list Postgres resolves a
-- bare quoted literal against the column it is going into; in a SELECT it
-- types it as text first and then finds it has nothing to assign it to:
--
--   column "type" is of type order_event_type but expression is of type text
--
-- The statement is planned whether or not the unnest yields a row, so this
-- failed on every call — a back order placed by hand from the Supplier
-- screen, a stock top-up, anything. The exception comes at the very end, so
-- the whole function rolls back and nothing is left behind to notice: the
-- screen showed an error about a column type and no purchase order appeared.
--
-- Nothing in the suite called it. It was found by the Orders screen's new
-- "Send to James", which raises the purchase order the same way, and the
-- test that found it is in 39_allocate_by_hand.sql.
--
-- The cast is the whole fix.

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
  select distinct o, 'supplier_ordered'::order_event_type,
         jsonb_build_object('po', v_po_no, 'po_id', v_po_id)
    from unnest(v_orders) as o;

  return v_po_id;
end $$;
