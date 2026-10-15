-- ============================================================================
-- 0051: an admin can remove an order or an invoice, whatever state it is in.
--
-- delete_order already existed and refused almost everything: assert_order_
-- amendable turns away a paid order, a packed or shipped one, a cancelled
-- one, and one with stock already in from the supplier — and then it refused
-- again for good measure. Which is right as a default, and is exactly wrong
-- for the job it is needed for. The orders anybody actually wants rid of are
-- the ones with history: the rehearsals that were paid, packed and shipped to
-- prove that paying, packing and shipping worked.
--
-- So an admin may now remove one whatever state it is in, and the screen stops
-- hiding the button on precisely the orders it is wanted on. The guards that
-- remain are not about state at all — they are about leaving the data
-- truthful afterwards, which is a different question and the one that
-- survives.
--
-- What was learned building the purge applies here, because it is the same
-- act one row at a time, and both go through the same code now:
--
--   * stock does not come back on its own. Deleting an order leaves the shelf
--     exactly as low as placing it made it, silently and for ever;
--   * a supplier order outlives it. An unreceived line goes; a received one
--     is unhooked rather than deleted, because goods that arrived did arrive
--     and the paperwork behind stock on a shelf is not a rehearsal.
-- ============================================================================

/**
 * Removes a set of orders, and leaves what is left true.
 *
 * The whole of it in one place, because the purge and the delete button are
 * the same act at different scales, and two implementations of "take an order
 * out" is one of them being wrong about the stock.
 */
create or replace function public.remove_orders(p_ids uuid[], p_release_stock boolean)
returns table (orders bigint, stock bigint, po_lines_removed bigint,
               po_lines_unhooked bigint, pos_removed bigint)
language plpgsql security definer set search_path = public as $$
declare v_orders bigint; v_stock bigint := 0; v_rm bigint; v_un bigint; v_pos bigint;
        v_blocked integer;
begin
  select count(*) into v_orders from orders where id = any(p_ids);
  if v_orders = 0 then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  -- A return on an order that is staying, tied to one that is going: the
  -- delete would stop half way, so it is named rather than hit.
  select count(*)::int into v_blocked from returns r
   where (r.replacement_order_id = any(p_ids)
          or r.credit_id in (select id from invoices where order_id = any(p_ids)))
     and not (r.order_id = any(p_ids));
  if v_blocked > 0 then
    raise exception 'A return on an order you are keeping is tied to this one — '
                    'resolve that return first';
  end if;

  if p_release_stock then
    with back as (
      select l.product_id, o.fulfilment_location_id as location_id, sum(l.alloc_qty) as qty
        from order_lines l
        join orders o on o.id = l.order_id
       where l.order_id = any(p_ids) and l.alloc_qty > 0 and l.product_id is not null
       group by 1, 2
    )
    insert into stock_levels (product_id, location_id, qty)
    select product_id, location_id, qty from back
    on conflict (product_id, location_id)
      do update set qty = stock_levels.qty + excluded.qty;

    select coalesce(sum(l.alloc_qty), 0) into v_stock from order_lines l
     where l.order_id = any(p_ids) and l.alloc_qty > 0;
  end if;

  -- Never asked for: a line the supplier has already delivered against.
  delete from po_lines where order_id = any(p_ids) and received_qty = 0;
  get diagnostics v_rm = row_count;
  update po_lines set order_id = null where order_id = any(p_ids);
  get diagnostics v_un = row_count;

  delete from purchase_orders po
   where not po.received
     and not exists (select 1 from po_lines l where l.po_id = po.id);
  get diagnostics v_pos = row_count;

  delete from orders where id = any(p_ids);

  return query select v_orders, v_stock, v_rm, v_un, v_pos;
end $$;

-- ── one order, from the screen ──────────────────────────────────────────────
/*
 * The old signature goes first.
 *
 * Adding defaulted arguments to a function makes a second one beside it, not
 * a new version of it, and then every call that matched the old arity matches
 * both and fails.
 */
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname = 'delete_order' and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

/**
 * Removes one order and everything that hangs off it.
 *
 * Whatever state it is in. Paid, packed, shipped, delivered, cancelled — none
 * of those are an objection any more, because the orders somebody wants rid
 * of are exactly the ones that have been through all of it.
 *
 * The reason is kept, not for the order — that is gone — but in the log,
 * where the question "what happened to SO-014" gets asked.
 */
create or replace function public.delete_order(
  p_order_id uuid, p_release_stock boolean default true, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_o orders%rowtype; v_client text; r record;
begin
  if not is_admin() then
    raise exception 'Only an admin can delete an order. Cancelling keeps the record';
  end if;

  select * into v_o from orders where id = p_order_id;
  if not found then raise exception 'Unknown order'; end if;
  select name into v_client from clients where id = v_o.client_id;

  -- Written before it goes, because afterwards there is nothing to point at.
  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'order', p_order_id, 'delete',
          jsonb_build_object(
            'number', v_o.number, 'client', v_client, 'date', v_o.date,
            'status', v_o.status,
            'invoices', (select array_agg(number) from invoices where order_id = p_order_id),
            'was_paid', (select bool_or(paid) from invoices where order_id = p_order_id),
            'was_shipped', (select bool_or(shipped) from invoices where order_id = p_order_id),
            'released_stock', p_release_stock,
            'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  select * into r from remove_orders(array[p_order_id], p_release_stock);
end $$;

-- ── one invoice ─────────────────────────────────────────────────────────────
/**
 * Removes one invoice, whatever state it is in.
 *
 * The one thing it will not do is leave an order billed by nothing. An order
 * exists to be invoiced; an order with no invoice against it is not a tidier
 * record, it is a hole — so the last document asking for money goes only with
 * the order it belongs to, and the message says so.
 *
 * A credit note or a superseded invoice has no such duty and comes off freely,
 * which is most of why this is wanted.
 */
create or replace function public.delete_invoice(
  p_invoice_id uuid, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_i invoices%rowtype; v_order text; v_left integer;
begin
  if not is_admin() then
    raise exception 'Only an admin can delete an invoice';
  end if;

  select * into v_i from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  select number into v_order from orders where id = v_i.order_id;

  if v_i.type in ('full','shipment','backorder') and not v_i.superseded then
    select count(*)::int into v_left from invoices
     where order_id = v_i.order_id and id <> p_invoice_id
       and type in ('full','shipment','backorder') and not superseded;
    if v_left = 0 then
      raise exception 'That is the only invoice billing %, so removing it would leave '
                      'the order asking for nothing. Delete the order instead', v_order;
    end if;
  end if;

  -- A credit note names the invoice it is against; removing the invoice under
  -- it would leave the credit pointing at nothing, so they go together.
  delete from invoices where credit_of = p_invoice_id;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'delete',
          jsonb_build_object('number', v_i.number, 'order', v_order, 'type', v_i.type,
                             'was_paid', v_i.paid, 'was_shipped', v_i.shipped,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  delete from invoices where id = p_invoice_id;
end $$;

-- The purge now goes through the shared remover too, so the two cannot drift
-- on what "take an order out" leaves behind.
create or replace function public.purge_orders_through(
  p_through text, p_release_stock boolean, p_confirm text
) returns table (item text, count bigint)
language plpgsql security definer set search_path = public as $$
declare v_to integer := order_seq(p_through); v_ids uuid[]; r record;
begin
  perform assert_admin();
  if v_to is null then raise exception 'Give an order number, like SO-017'; end if;
  if coalesce(p_confirm, '') is distinct from p_through then
    raise exception 'To purge through %, pass it again as the confirmation', p_through;
  end if;

  select array_agg(id) into v_ids from orders where order_seq(number) <= v_to;
  if v_ids is null then
    return query select 'Nothing to remove'::text, 0::bigint;
    return;
  end if;

  select * into r from remove_orders(v_ids, p_release_stock);

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'order', null, 'purged',
          jsonb_build_object('through', p_through, 'orders', r.orders,
                             'stock_released', case when p_release_stock then r.stock end));

  return query select * from (values
    ('Orders removed'::text, r.orders),
    ('Supplier order lines removed', r.po_lines_removed),
    ('Supplier lines already delivered, unhooked', r.po_lines_unhooked),
    ('Empty supplier orders removed', r.pos_removed),
    ('Stock units put back', r.stock)
  ) as t(item, count);
end $$;
