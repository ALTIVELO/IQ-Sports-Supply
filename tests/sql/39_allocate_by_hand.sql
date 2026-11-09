-- ============================================================================
-- 39: the tick that says the goods are here.
--
-- Everything is bought in for the order it is sold on, so an order owes all
-- of it until somebody can see the goods. Usually that is the supplier
-- receipt. This is the other way: a member of staff looking at the parts on
-- the bench, ticking the line in, and the packing queue following them.
--
-- What is worth holding down is the pair either side of the tick. Allocated
-- plus owed is always the quantity ordered — the invoice, the proforma, the
-- supplier screen and the packing queue all read one or the other, and a tick
-- that moved one without the other would show the same goods twice.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

create table ids (k text primary key, v uuid);

insert into stock_levels (product_id, location_id, qty)
select p.id, (select id from locations where name='Slough'), 50 from products p
on conflict (product_id, location_id) do update set qty = 50;

insert into ids (k, v) select 'order', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='BPB05SR25'),'qty',5),
    jsonb_build_object('product_id',(select id from products where sku='BBR9100B'),'qty',2)));
\set QUIET off

\echo ''
\echo '───────── A. Fifty on the shelf and the order still owes everything ─────────'
do $$
declare o uuid := (select v from ids where k='order'); l order_lines%rowtype;
begin
  select * into l from order_lines where order_id = o and sku='BPB05SR25';
  perform assert_eq(l.alloc_qty, 0, 'nothing is allocated when the order is taken');
  perform assert_eq(l.bo_qty, 5, 'the whole line is owed');
  perform assert_eq(l.po_qty, 5, 'and the whole of it is with the supplier');
  perform assert_eq((select qty from stock_levels s join products p on p.id = s.product_id
                      where p.sku='BPB05SR25'
                        and s.location_id=(select id from locations where name='Slough')),
                    50, 'the shelf is untouched');
  perform assert_eq((select ready_to_pack from invoices where order_id = o), false,
                    'and nothing is ready to pack');
end $$;

\echo ''
\echo '───────── B. Ticking part of a line ─────────'
do $$
declare o uuid := (select v from ids where k='order'); l order_lines%rowtype;
begin
  perform allocate_line('SO-001', 'BPB05SR25', 2);
  select * into l from order_lines where order_id = o and sku='BPB05SR25';
  perform assert_eq(l.alloc_qty, 2, 'two of the five are here');
  perform assert_eq(l.bo_qty, 3, 'three are still owed');
  perform assert_eq(l.alloc_qty + l.bo_qty, l.qty, 'and the two still add up to the order');
  perform assert_eq(l.po_qty, 3, 'the supplier is only still owed what is still owed');
  perform assert_eq((select qty from stock_levels s join products p on p.id = s.product_id
                      where p.sku='BPB05SR25'
                        and s.location_id=(select id from locations where name='Slough')),
                    50, 'the shelf is not what the tick is about, so it is left alone');
  perform assert_eq((select ready_to_pack from invoices where order_id = o), false,
                    'part of an order is not an order');
end $$;

\echo ''
\echo '───────── C. Ticking the rest of it releases the invoice ─────────'
do $$
declare o uuid := (select v from ids where k='order');
begin
  perform allocate_order('SO-001');
  perform assert_eq((select coalesce(sum(bo_qty),0)::int from order_lines where order_id=o), 0,
                    'nothing is owed any more');
  perform assert_eq((select coalesce(sum(po_qty),0)::int from order_lines where order_id=o), 0,
                    'and nothing is waiting on the supplier');
  perform assert_eq((select ready_to_pack from invoices where order_id=o), true,
                    'so the invoice is in the packing queue');
  perform assert_eq((select status::text from orders where id=o), 'complete',
                    'and the order reads as complete');
end $$;

\echo ''
\echo '───────── D. And unticking takes it straight back out ─────────'
do $$
declare o uuid := (select v from ids where k='order');
begin
  perform allocate_line('SO-001', 'BPB05SR25', 0);
  perform assert_eq((select bo_qty from order_lines where order_id=o and sku='BPB05SR25'), 5,
                    'the line is owed again');
  perform assert_eq((select ready_to_pack from invoices where order_id=o), false,
                    'the invoice leaves the packing queue');
  perform assert_eq((select status::text from orders where id=o), 'open',
                    'and the order is open again');
end $$;

\echo ''
\echo '───────── E. A quantity that cannot be meant is not taken literally ─────────'
do $$
declare o uuid := (select v from ids where k='order'); l order_lines%rowtype;
begin
  perform allocate_line('SO-001', 'BPB05SR25', 99);
  select * into l from order_lines where order_id=o and sku='BPB05SR25';
  perform assert_eq(l.alloc_qty, 5, 'more than was ordered is as many as were ordered');
  perform assert_eq(l.bo_qty, 0, 'and owes nothing');

  perform allocate_line('SO-001', 'BPB05SR25', -3);
  select * into l from order_lines where order_id=o and sku='BPB05SR25';
  perform assert_eq(l.alloc_qty, 0, 'less than none is none');
  perform assert_eq(l.bo_qty, 5, 'and the whole line is owed again');
end $$;

\echo ''
\echo '───────── F. It is written down ─────────'
do $$
declare d jsonb;
begin
  select detail into d from audit_log
   where entity='order_line' and action='allocate' order by created_at desc limit 1;
  perform assert_eq(d->>'order', 'SO-001', 'the audit says which order');
  perform assert_eq(d->>'sku', 'BPB05SR25', 'and which line');
  -- Cleared twice: once to take it out of the queue, once by asking for a
  -- quantity below nothing.
  perform assert_eq((select count(*)::int from audit_log
                      where entity='order_line' and action='unallocate'), 2,
                    'and clearing one is recorded as its own thing');
end $$;

\echo ''
\echo '───────── G. A typed line has no supplier, so there is nothing to tick ─────────'
\set QUIET on
insert into ids (k, v) select 'custom', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'name','Wheel build, hand', 'qty',1, 'unit_price',85.00)));
\set QUIET off
do $$
declare l order_lines%rowtype;
begin
  select * into l from order_lines where order_id = (select v from ids where k='custom');
  perform assert_eq(l.alloc_qty, 1, 'a typed line is allocated the moment it is typed');
  perform assert_eq(l.bo_qty, 0, 'because there is nobody to be waiting for');
  perform assert_fails(format('select set_line_allocation(%L, 0)', l.id),
                       'and it cannot be put on back order');
end $$;

\echo ''
\echo '───────── G2. Ordering an order that is marked as here ─────────'
-- The override behind the Send to James button: the tick was wrong, or the
-- goods turned out to be damaged when somebody went to pack them. Holding
-- them and waiting for them cannot both be true, so the line goes back on
-- back order and that is what makes a purchase order for it possible.
\set QUIET on
insert into ids (k, v) select 'here', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BBR9100B'),'qty',6)));
\set QUIET off
do $$
declare o uuid := (select v from ids where k='here'); l order_lines%rowtype; v_po uuid;
begin
  perform allocate_order_id(o);
  perform assert_eq((select ready_to_pack from invoices where order_id=o), true,
                    'ticked in, it is ready to pack');

  select * into l from order_lines where order_id = o;
  -- What the send does, in the order it does it.
  perform set_line_allocation(l.id, 0);
  v_po := create_supplier_order(
    (select fulfilment_location_id from orders where id = o),
    jsonb_build_array(jsonb_build_object('order_line_id', l.id, 'qty', 6)),
    '[]'::jsonb);

  perform assert_eq((select ready_to_pack from invoices where order_id=o), false,
                    'sending it takes it out of the packing queue');
  perform assert_eq((select bo_qty from order_lines where id = l.id), 6,
                    'the whole line is owed again');
  perform assert_eq((select po_qty from order_lines where id = l.id), 6,
                    'and all of it is with the supplier');
  perform assert_eq((select count(*)::int from po_lines where po_id = v_po), 1,
                    'one line on the purchase order');
  perform assert_eq((select so_reference from po_lines where po_id = v_po),
                    (select number from orders where id = o),
                    'carrying the order it is for, so it books back to it');
  -- And it cannot be ordered a second time by pressing the button twice: the
  -- line owes six and six are already with the supplier.
  perform assert_fails(format(
    'select create_supplier_order(%L, %L::jsonb, ''[]''::jsonb)',
    (select fulfilment_location_id from orders where id = o),
    jsonb_build_array(jsonb_build_object('order_line_id', l.id, 'qty', 6))::text),
    'and pressing it again orders nothing');
end $$;

\echo ''
\echo '───────── G3. A supplier order for nobody in particular ─────────'
-- Topping up the shelf, with no customer order behind it. Worth its own
-- assertion because it is the path with no order lines at all, and the bug
-- that stopped the one above stopped this too: the event insert is planned
-- whether or not there is an order to write an event for.
do $$
declare v_po uuid;
begin
  v_po := create_supplier_order(
    (select id from locations where name='Slough'),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('sku','BPB05SR25','name','Brake pads','qty',20)));
  perform assert_eq((select qty from po_lines where po_id = v_po), 20,
                    'a stock top-up raises a purchase order of its own');
  perform assert_eq((select so_reference is null from po_lines where po_id = v_po), true,
                    'with no client reference on it, because there is no client');
  perform assert_fails(format(
    'select create_supplier_order(%L, ''[]''::jsonb, ''[]''::jsonb)',
    (select id from locations where name='Slough')),
    'and one with nothing on it is refused');
end $$;

\echo ''
\echo '───────── H. What has gone out is not moved ─────────'
do $$
declare o uuid := (select v from ids where k='order'); v_inv uuid; l uuid;
begin
  perform allocate_order('SO-001');
  select id into v_inv from invoices where order_id=o and not superseded;
  update invoices set paid = true, paid_date = current_date where id = v_inv;
  perform mark_invoice_packed(v_inv);

  select id into l from order_lines where order_id=o and sku='BPB05SR25';
  perform assert_fails(format('select set_line_allocation(%L, 0)', l),
                       'a packed order cannot be put back on back order');
end $$;

\echo ''
\echo '───────── I. Nor is a cancelled one ─────────'
\set QUIET on
insert into ids (k, v) select 'dead', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',1)));
\set QUIET off
do $$
declare l uuid;
begin
  perform cancel_order((select v from ids where k='dead'), 'Ordered in error');
  select id into l from order_lines where order_id = (select v from ids where k='dead');
  perform assert_fails(format('select set_line_allocation(%L, 1)', l),
                       'a cancelled order holds nothing, and cannot be told otherwise');
end $$;

\echo ''
\echo '───────── J. And the customer does not get to say the goods are in ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare l uuid := (select ol.id from order_lines ol join orders o on o.id=ol.order_id
                    where o.number='SO-002' limit 1);
begin
  perform assert_fails(format('select set_line_allocation(%L, 1)', l),
                       'a client cannot allocate their own order');
end $$;
