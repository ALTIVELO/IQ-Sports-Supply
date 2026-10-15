-- ============================================================================
-- 38: an admin removes an order or an invoice, whatever state it is in.
--
-- delete_order used to refuse anything with history, which is right as a
-- default and exactly wrong for the job: the orders somebody wants rid of are
-- the ones that were paid, packed and shipped to prove that paying, packing
-- and shipping worked.
--
-- So state is no longer an objection. What is tested is what replaced it —
-- that the shelf and the supplier screen are left truthful, that the record
-- of what was deleted survives the deletion, and that the one structural rule
-- holds: an order is never left billed by nothing.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','accounts@iqsportsupply.com');
update profiles set role='admin'    where id='11111111-1111-1111-1111-111111111111';
update profiles set role='accounts' where id='22222222-2222-2222-2222-222222222222';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
insert into stock_levels (product_id, location_id, qty)
select p.id, (select id from locations where name='Slough'), 100 from products p
on conflict (product_id, location_id) do update set qty = 100;
create table ids (k text primary key, v uuid);
\set QUIET off

\echo ''
\echo '───────── A. An order that went all the way through ─────────'
-- Paid, packed, shipped, delivered. The shape the old guards existed to
-- protect, and the shape that actually needs removing.
insert into ids (k, v) select 'done', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',5)));
do $$
declare v_inv uuid; v_stock integer;
begin
  select id into v_inv from invoices where order_id = (select v from ids where k='done');
  update invoices set paid = true, paid_date = current_date where id = v_inv;
  perform mark_invoice_packed(v_inv);
  perform mark_invoice_shipped(v_inv, 'DPD', 'TRACK-A');
  perform mark_invoice_delivered(v_inv);

  select qty into v_stock from stock_levels s join products p on p.id = s.product_id
   where p.sku='BPB05SR25' and s.location_id = (select id from locations where name='Slough');
  perform assert_eq(v_stock, 95, 'the five it took are off the shelf');

  perform delete_order((select v from ids where k='done'), true, 'Test order from the build');

  perform assert_eq((select count(*)::int from orders
                      where id = (select v from ids where k='done')), 0,
    'a paid, shipped, delivered order comes off');

  select qty into v_stock from stock_levels s join products p on p.id = s.product_id
   where p.sku='BPB05SR25' and s.location_id = (select id from locations where name='Slough');
  perform assert_eq(v_stock, 100, 'and the five are back on the shelf');
end $$;

\echo ''
\echo '───────── B. What it was survives the deleting of it ─────────'
-- "What happened to SO-002" is a question asked after the row has gone, so
-- the answer cannot live on the row.
do $$
declare a audit_log%rowtype;
begin
  select * into a from audit_log
   where entity = 'order' and action = 'delete'
   order by created_at desc limit 1;

  perform assert_eq(a.detail->>'client', 'MDI Ltd', 'the log says whose it was');
  perform assert_eq((a.detail->>'was_paid')::boolean, true, 'that it had been paid');
  perform assert_eq((a.detail->>'was_shipped')::boolean, true, 'and shipped');
  perform assert_eq(a.detail->>'reason', 'Test order from the build',
    'and why it was removed');
  perform assert_eq(a.detail->'invoices' is not null, true,
    'with the invoice numbers that went with it');
end $$;

\echo ''
\echo '───────── C. Leaving the shelf alone is still an answer ─────────'
insert into ids (k, v) select 'keepstock', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',4)));
do $$
declare v_stock integer;
begin
  perform delete_order((select v from ids where k='keepstock'), false, 'Counted since');
  select qty into v_stock from stock_levels s join products p on p.id = s.product_id
   where p.sku='BPB05SR25' and s.location_id = (select id from locations where name='Slough');
  perform assert_eq(v_stock, 96, 'asked not to, it leaves the shelf as it reads');
end $$;

\echo ''
\echo '───────── D. Goods the supplier actually delivered are not erased ─────────'
-- An unreceived line goes with the order. A received one is unhooked and
-- left: the goods arrived and are on a shelf, and the paperwork behind stock
-- we are holding is not a rehearsal.
do $$
declare v_po uuid; v_line uuid; n integer;
begin
  insert into ids (k, v) select 'bo', place_order(
    (select id from clients where name='MDI Ltd'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',500)));

  select id into v_line from po_lines where order_id = (select v from ids where k='bo');
  perform assert_eq(v_line is not null, true, 'the back order raised a supplier line');
  update po_lines set received_qty = 10 where id = v_line;

  perform delete_order((select v from ids where k='bo'), false, 'Rehearsal');

  select count(*)::int into n from po_lines where id = v_line;
  perform assert_eq(n, 1, 'a line already delivered against is still there');
  perform assert_eq((select order_id from po_lines where id = v_line) is null, true,
    'unhooked from the order that has gone');
end $$;

\echo ''
\echo '───────── E. And an undelivered one goes with it ─────────'
do $$
declare n integer; v_pos_before integer; v_pos_after integer;
begin
  select count(*)::int into v_pos_before from purchase_orders;
  insert into ids (k, v) select 'bo2', place_order(
    (select id from clients where name='MDI Ltd'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',500)));
  perform delete_order((select v from ids where k='bo2'), false, 'Rehearsal');

  select count(*)::int into n from po_lines where order_id is null and received_qty = 0;
  perform assert_eq(n, 0, 'nothing is left claiming goods for an order that has gone');
  select count(*)::int into v_pos_after from purchase_orders;
  perform assert_eq(v_pos_after, v_pos_before,
    'and the empty supplier order went with its only line');
end $$;

\echo ''
\echo '───────── F. Only an admin ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_id uuid;
begin
  insert into ids (k, v) select 'acct', place_order(
    (select id from clients where name='MDI Ltd'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',1)));
  select v into v_id from ids where k='acct';
  perform assert_fails(format('select delete_order(%L)', v_id),
    'accounts can cancel an order but not erase one');
  perform assert_eq((select count(*)::int from orders where id = v_id), 1, 'so it is still there');
end $$;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── G. An order is never left billed by nothing ─────────'
do $$
declare v_inv uuid; v_order uuid := (select v from ids where k='acct');
begin
  select id into v_inv from invoices where order_id = v_order;
  perform assert_fails(format('select delete_invoice(%L)', v_inv),
    'the only invoice billing an order cannot be taken off on its own');
  perform assert_eq((select count(*)::int from invoices where id = v_inv), 1,
    'and it is still there');
end $$;

\echo ''
\echo '───────── H. A credit note comes off freely ─────────'
-- Which is most of why this is wanted: one raised in error, against an
-- invoice that is otherwise right.
do $$
declare v_inv uuid := (select id from invoices where order_id = (select v from ids where k='acct'));
        v_credit uuid; n integer;
begin
  v_credit := credit_invoice(v_inv, null, 'Raised by mistake');
  perform assert_eq((select count(*)::int from invoices where order_id = (select v from ids where k='acct')), 2,
    'the credit is there');

  perform delete_invoice(v_credit, 'Raised by mistake');
  select count(*)::int into n from invoices where id = v_credit;
  perform assert_eq(n, 0, 'and comes off on its own');
  perform assert_eq((select count(*)::int from invoices where id = v_inv), 1,
    'leaving the invoice it was against');
end $$;

\echo ''
\echo '───────── I. Removing an invoice takes its credits with it ─────────'
-- A credit names the invoice it is against. Left behind it would point at
-- nothing, which is a worse record than either document on its own.
do $$
declare v_order uuid; v_full uuid; v_second uuid; v_credit uuid;
begin
  insert into ids (k, v) select 'two', place_order(
    (select id from clients where name='MDI Ltd'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',2)));
  select v into v_order from ids where k='two';
  select id into v_full from invoices where order_id = v_order;

  -- A second document billing the same order, so the first is not the only one.
  insert into invoices (number, order_id, client_id, type, date, due_date, vat_rate, location_id)
  select next_invoice_number(), v_order, o.client_id, 'shipment', current_date,
         current_date, 20, o.fulfilment_location_id
    from orders o where o.id = v_order
  returning id into v_second;

  v_credit := credit_invoice(v_full, null, 'Goodwill');
  perform delete_invoice(v_full, 'Rehearsal');

  perform assert_eq((select count(*)::int from invoices where id = v_credit), 0,
    'the credit against it went too');
  perform assert_eq((select count(*)::int from invoices where id = v_second), 1,
    'and the other document billing the order is untouched');
end $$;

\echo ''
\echo '───────── J. Deleting the order takes every invoice on it ─────────'
do $$
declare v_order uuid := (select v from ids where k='two');
begin
  perform delete_order(v_order, true, 'Rehearsal');
  perform assert_eq((select count(*)::int from invoices where order_id = v_order), 0,
    'nothing is left billing an order that has gone');
  perform assert_eq((select count(*)::int from order_lines
                      where not exists (select 1 from orders o where o.id = order_id)), 0,
    'and no lines either');
end $$;
