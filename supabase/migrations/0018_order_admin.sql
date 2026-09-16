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
