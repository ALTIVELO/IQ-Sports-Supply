-- ============================================================================
-- 0050: removing the orders that were only ever tests.
--
-- SO-001 to SO-017 were placed while the system was being built. They are not
-- history, they are rehearsal, and they sit at the top of every list a
-- customer and a member of staff reads.
--
-- A plain "delete from orders where ..." would do most of it, because the
-- lines, invoices, events, shipments and dropship notices all cascade. It
-- would also leave two things wrong, and both were measured rather than
-- guessed:
--
--   * the stock never comes back. Placing an order takes the allocation off
--     the shelf; deleting the order does not put it back, because nothing is
--     listening. Ten units went out on two test orders and the shelf still
--     read zero after both were deleted. On a live catalogue that is a
--     permanent, invisible shortfall;
--
--   * the supplier orders survive. A back-ordered test line raises a PO, and
--     po_lines.order_id is ON DELETE SET NULL — so the PO stays on the
--     supplier screen claiming goods for an order that no longer exists.
--
-- So this is a function rather than a statement, and it comes in two halves:
-- one that only looks, and one that does it. Look first. There is no undo.
-- ============================================================================

/**
 * The numeric part of an order number, for comparing them.
 *
 * Not the text: the numbers are zero-padded to three, so 'SO-018' > 'SO-017'
 * reads correctly as text right up to SO-999 and then silently stops —
 * 'SO-1000' sorts before 'SO-999'. Comparing the number as a number is the
 * same answer today and the right one afterwards.
 */
create or replace function public.order_seq(p_number text)
returns integer language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '')::integer;
$$;

/**
 * What purging up to and including an order number would take with it.
 *
 * Read-only, and the thing to run first. Every count here is a row that will
 * be gone, or a figure that will move, and all of it is irreversible.
 */
create or replace function public.orders_purge_preview(p_through text)
returns table (item text, count bigint, detail text)
language plpgsql stable security definer set search_path = public as $$
declare v_to integer := order_seq(p_through);
begin
  perform assert_admin();
  if v_to is null then raise exception 'Give an order number, like SO-017'; end if;

  return query
  with doomed as (
    select o.id, o.number, o.fulfilment_location_id from orders o
     where order_seq(o.number) <= v_to
  ),
  kept as (select o.id from orders o where order_seq(o.number) > v_to)
  select * from (
    values
      ('Orders removed',
       (select count(*) from doomed),
       (select coalesce(min(number) || ' to ' || max(number), 'none') from doomed)),
      ('Orders kept',
       (select count(*) from orders where order_seq(number) > v_to),
       (select coalesce(min(number) || ' onwards', 'none') from orders
         where order_seq(number) > v_to)),
      ('Invoices removed',
       (select count(*) from invoices where order_id in (select id from doomed)),
       'including their lines, credit notes and parcels'),
      ('Stock put back',
       (select coalesce(sum(l.alloc_qty), 0) from order_lines l
         where l.order_id in (select id from doomed) and l.alloc_qty > 0),
       'units, if you ask for it — otherwise the shelf stays as it is'),
      ('Supplier order lines removed',
       (select count(*) from po_lines where order_id in (select id from doomed)),
       'raised by back orders on these'),
      ('Returns removed',
       (select count(*) from returns where order_id in (select id from doomed)),
       'and their lines'),
      ('Emails already sent',
       (select count(*) from email_log where order_id in (select id from doomed)),
       'kept as a record, with the link to the order cleared'),
      -- The two that would stop the delete rather than be done by it.
      ('BLOCKED: kept returns pointing at these orders',
       (select count(*) from returns r
         where r.replacement_order_id in (select id from doomed)
           and r.order_id in (select id from kept)),
       'a return on an order you are keeping was replaced by one of these'),
      ('BLOCKED: kept returns credited by these invoices',
       (select count(*) from returns r
         where r.credit_id in (select id from invoices where order_id in (select id from doomed))
           and r.order_id in (select id from kept)),
       'a return on an order you are keeping was credited against one of these')
  ) as t(item, count, detail);
end $$;

/**
 * Removes every order up to and including one number, and what hangs off it.
 *
 * p_release_stock is the question only somebody who knows the warehouse can
 * answer. An order that was a rehearsal took stock off the shelf that was
 * never actually picked, so putting it back is usually right — but if the
 * shelves have been counted since, the figures are already true and adding to
 * them would make them wrong in the other direction.
 *
 * p_confirm has to be the number being purged through, typed again. Not
 * ceremony: this is the one function here with no undo, and a mis-click on a
 * screen or a half-finished line in a console should not be able to empty the
 * order book.
 */
create or replace function public.purge_orders_through(
  p_through text, p_release_stock boolean, p_confirm text
) returns table (item text, count bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_to      integer := order_seq(p_through);
  v_orders  integer;
  v_stock   integer := 0;
  v_polines integer;
  v_pos     integer;
  v_blocked integer;
begin
  perform assert_admin();
  if v_to is null then raise exception 'Give an order number, like SO-017'; end if;
  if coalesce(p_confirm, '') is distinct from p_through then
    raise exception 'To purge through %, pass it again as the confirmation', p_through;
  end if;

  create temporary table _doomed on commit drop as
    select o.id, o.number, o.fulfilment_location_id
      from orders o where order_seq(o.number) <= v_to;

  select count(*)::int into v_orders from _doomed;
  if v_orders = 0 then
    return query select 'Nothing to remove'::text, 0::bigint;
    return;
  end if;

  -- The cross-links that would stop the delete half way. Named rather than
  -- hit, so nobody is left wondering which order refused.
  select count(*)::int into v_blocked from returns r
   where (r.replacement_order_id in (select id from _doomed)
          or r.credit_id in (select id from invoices
                              where order_id in (select id from _doomed)))
     and r.order_id not in (select id from _doomed);
  if v_blocked > 0 then
    raise exception 'An order you are keeping has a return tied to one of these — '
                    '% of them. Run orders_purge_preview first; those have to be '
                    'resolved by hand', v_blocked;
  end if;

  /*
   * The shelf, before the rows go.
   *
   * Placing an order took the allocation off; nothing puts it back when the
   * order is deleted, so it is put back here or not at all.
   */
  if p_release_stock then
    with back as (
      select l.product_id, d.fulfilment_location_id as location_id,
             sum(l.alloc_qty) as qty
        from order_lines l
        join _doomed d on d.id = l.order_id
       where l.alloc_qty > 0 and l.product_id is not null
       group by 1, 2
    )
    insert into stock_levels (product_id, location_id, qty)
    select product_id, location_id, qty from back
    on conflict (product_id, location_id)
      do update set qty = stock_levels.qty + excluded.qty;

    select coalesce(sum(l.alloc_qty), 0)::int into v_stock from order_lines l
     where l.order_id in (select id from _doomed) and l.alloc_qty > 0;
  end if;

  -- The supplier side, which would otherwise be left claiming goods for an
  -- order that no longer exists.
  delete from po_lines where order_id in (select id from _doomed);
  get diagnostics v_polines = row_count;
  /*
   * The now-empty supplier orders, except any that was received.
   *
   * A received PO is a record of goods that actually turned up and were booked
   * on to a shelf. The order that caused it being a rehearsal does not make
   * the delivery one, so it stays, empty, rather than quietly removing the
   * paperwork behind stock we are holding.
   */
  delete from purchase_orders po
   where not po.received
     and not exists (select 1 from po_lines l where l.po_id = po.id);
  get diagnostics v_pos = row_count;

  delete from orders where id in (select id from _doomed);

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'order', null, 'purged',
          jsonb_build_object('through', p_through, 'orders', v_orders,
                             'stock_released', case when p_release_stock then v_stock end));

  return query
  select * from (values
    ('Orders removed'::text, v_orders::bigint),
    ('Supplier order lines removed', v_polines::bigint),
    ('Empty supplier orders removed', v_pos::bigint),
    ('Stock units put back', v_stock::bigint)
  ) as t(item, count);
end $$;
