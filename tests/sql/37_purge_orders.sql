-- ============================================================================
-- 37: removing the orders that were only ever tests.
--
-- The first seventeen orders were placed while the system was being built.
-- Deleting them is the one operation here with no undo, so what is tested is
-- not mainly that the right rows go — it is that the rows either side of the
-- line are untouched, that the shelf and the supplier screen are left
-- truthful, and that it refuses rather than half-finishes.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','warehouse@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='ops'   where id='22222222-2222-2222-2222-222222222222';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

insert into stock_levels (product_id, location_id, qty)
select p.id, (select id from locations where name='Slough'), 400 from products p
on conflict (product_id, location_id) do update set qty = 400;

-- Twenty orders: seventeen rehearsals and three real ones.
do $$
declare i integer; v_client uuid; v_loc uuid; v_prod uuid;
begin
  select id into v_client from clients where name='MDI Ltd';
  select id into v_loc from locations where name='Slough';
  select id into v_prod from products where sku='BPB05SR25';
  for i in 1..20 loop
    perform place_order(v_client, v_loc, jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'qty', 2)));
  end loop;
end $$;
\set QUIET off

\echo ''
\echo '───────── A. Looking does not touch anything ─────────'
do $$
declare r record; v_before integer;
begin
  select count(*)::int into v_before from orders;
  select * into r from orders_purge_preview('SO-017') where item = 'Orders removed';
  perform assert_eq(r.count::int, 17, 'seventeen would go');
  perform assert_eq(r.detail, 'SO-001 to SO-017', 'and it says which');

  select * into r from orders_purge_preview('SO-017') where item = 'Orders kept';
  perform assert_eq(r.count::int, 3, 'three would stay');
  perform assert_eq(r.detail, 'SO-018 onwards', 'from the one the line was drawn at');

  perform assert_eq((select count(*)::int from orders), v_before,
    'and looking removed nothing at all');
end $$;

\echo ''
\echo '───────── B. It will not go off on a mis-click ─────────'
do $$
begin
  perform assert_fails(
    'select * from purge_orders_through(''SO-017'', true, null)',
    'without the confirmation it does nothing');
  perform assert_fails(
    'select * from purge_orders_through(''SO-017'', true, ''SO-18'')',
    'and a confirmation that does not match is not a confirmation');
  perform assert_eq((select count(*)::int from orders), 20, 'so all twenty are still here');
end $$;

\echo ''
\echo '───────── C. Nor for anyone but an admin ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_fails(
    'select * from purge_orders_through(''SO-017'', true, ''SO-017'')',
    'the warehouse cannot empty the order book');
  perform assert_fails(
    'select * from orders_purge_preview(''SO-017'')',
    'nor look at what it would take');
end $$;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── D. What the kept orders looked like before ─────────'
\set QUIET on
create table kept_before as
  select o.number, o.date, o.status, o.client_id,
         (select count(*) from order_lines l where l.order_id = o.id) as lines,
         (select sum(l.qty * l.unit_price) from order_lines l where l.order_id = o.id) as net,
         (select count(*) from invoices i where i.order_id = o.id) as invoices,
         (select count(*) from order_events e where e.order_id = o.id) as events
    from orders o where order_seq(o.number) > 17;
\set QUIET off

\echo ''
\echo '───────── E. The purge ─────────'
do $$
declare r record; v_stock_before integer; v_stock_after integer;
begin
  select qty into v_stock_before from stock_levels s
    join products p on p.id = s.product_id
   where p.sku = 'BPB05SR25' and s.location_id = (select id from locations where name='Slough');

  select * into r from purge_orders_through('SO-017', true, 'SO-017')
   where item = 'Orders removed';
  perform assert_eq(r.count::int, 17, 'seventeen orders removed');

  perform assert_eq((select count(*)::int from orders), 3, 'three left');
  perform assert_eq((select min(number) from orders), 'SO-018', 'starting at SO-018');

  -- Seventeen orders of two units each, back on the shelf.
  select qty into v_stock_after from stock_levels s
    join products p on p.id = s.product_id
   where p.sku = 'BPB05SR25' and s.location_id = (select id from locations where name='Slough');
  perform assert_eq(v_stock_after - v_stock_before, 34,
    'and the stock they held is back on the shelf');
end $$;

\echo ''
\echo '───────── F. The kept orders are exactly as they were ─────────'
-- The claim the whole thing rests on. Not "three orders remain" — the same
-- three, with the same lines, the same money and the same history.
do $$
declare n integer;
begin
  select count(*)::int into n from kept_before b
    join orders o on o.number = b.number
   where o.date = b.date and o.status = b.status and o.client_id = b.client_id
     and (select count(*) from order_lines l where l.order_id = o.id) = b.lines
     and (select sum(l.qty * l.unit_price) from order_lines l where l.order_id = o.id) = b.net
     and (select count(*) from invoices i where i.order_id = o.id) = b.invoices
     and (select count(*) from order_events e where e.order_id = o.id) = b.events;
  perform assert_eq(n, 3, 'every kept order is unchanged, line for line');

  perform assert_eq((select count(*)::int from invoice_lines il
                      join invoices i on i.id = il.invoice_id), 3,
    'and only their invoice lines are left');
end $$;

\echo ''
\echo '───────── G. Nothing of the removed ones is left behind ─────────'
do $$
begin
  perform assert_eq((select count(*)::int from order_lines l
                      where not exists (select 1 from orders o where o.id = l.order_id)), 0,
    'no orphan order lines');
  perform assert_eq((select count(*)::int from invoices i
                      where not exists (select 1 from orders o where o.id = i.order_id)), 0,
    'no orphan invoices');
  perform assert_eq((select count(*)::int from order_events e
                      where not exists (select 1 from orders o where o.id = e.order_id)), 0,
    'no orphan events');
  -- The one a plain delete leaves: a supplier order still claiming goods for
  -- an order that is gone.
  perform assert_eq((select count(*)::int from po_lines where order_id is null), 0,
    'and no supplier line pointing at nothing');
end $$;

\echo ''
\echo '───────── H. Numbering carries on, it does not go back ─────────'
-- The counter is in settings, not in the rows, so the next order is the next
-- one — and never a number a deleted order already used.
do $$
declare v_next text;
begin
  v_next := next_order_number();
  perform assert_eq(order_seq(v_next) > 20, true,
    'the next order number is past every one that has existed');
end $$;

\echo ''
\echo '───────── I. Leaving the shelf alone is also an answer ─────────'
-- Where the shelves have been counted since, the figures are already true and
-- putting the rehearsals back would make them wrong the other way.
do $$
declare v_before integer; v_after integer; r record;
begin
  select qty into v_before from stock_levels s join products p on p.id = s.product_id
   where p.sku='BPB05SR25' and s.location_id = (select id from locations where name='Slough');

  select * into r from purge_orders_through('SO-019', false, 'SO-019')
   where item = 'Stock units put back';
  perform assert_eq(r.count::int, 0, 'asked not to, it puts nothing back');

  select qty into v_after from stock_levels s join products p on p.id = s.product_id
   where p.sku='BPB05SR25' and s.location_id = (select id from locations where name='Slough');
  perform assert_eq(v_after, v_before, 'and the shelf reads what it read');
  perform assert_eq((select count(*)::int from orders), 1, 'while the orders still went');
end $$;

\echo ''
\echo '───────── J. Asking twice is not asking for more ─────────'
do $$
declare r record;
begin
  select * into r from purge_orders_through('SO-019', true, 'SO-019');
  perform assert_eq(r.item, 'Nothing to remove', 'the second run has nothing to do');
  perform assert_eq((select count(*)::int from orders), 1, 'and SO-020 is still there');
end $$;
