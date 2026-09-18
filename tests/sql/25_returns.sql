-- ============================================================================
-- 25: goods coming back, for the two reasons we accept.
--
-- The policy is the point. "Faulty or wrongly sent" is easy to write on a
-- terms page and easy to erode one exception at a time, so the tests that
-- matter here are the refusals: another reason, somebody else's order, more
-- than was bought, twice over, too late, and before it has even been sent.
--
-- The other half is what happens to the goods. A wrongly-picked item is good
-- stock and goes back on the shelf; a faulty one does not, and selling it to
-- the next customer is the failure this guards against.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('55555555-5555-5555-5555-555555555555','someone@elsewhere.test');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

insert into clients (name, tier_id, email, default_location_id)
select 'Other Shop Ltd', t.id, 'buy@othershop.test', l.id
  from tiers t, locations l where t.name='Shop' and l.name='Slough';
update clients set auth_user_id='55555555-5555-5555-5555-555555555555'
 where name='Other Shop Ltd';

insert into products (sku, name, brand, active) values
  ('RET-1','Returnable widget','Test',true),
  ('RET-2','Second widget','Test',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100.00, current_date - 400 from products p, tiers t
   where p.sku like 'RET-%';
insert into product_costs (product_id, cost, effective_from)
  select id, 60.00, current_date - 400 from products where sku like 'RET-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 50 from products p, locations l where p.sku like 'RET-%';

create table if not exists _ids (what text primary key, id uuid);
grant select, insert, update on _ids to app_user;
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── An order, dispatched ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
        v_inv uuid;
begin
  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='RET-1'), 'qty', 3),
    jsonb_build_object('product_id', (select id from products where sku='RET-2'), 'qty', 2)
  ), null);
  insert into _ids values ('order', v_order) on conflict (what) do update set id = excluded.id;

  select id into v_inv from invoices where order_id = v_order and not superseded limit 1;
  update invoices set paid = true, ready_to_pack = true, packed = true,
                      shipped = true, shipped_at = now() - interval '2 days'
   where id = v_inv;
  perform assert_eq((select shipped from invoices where id = v_inv), true,
    'the goods have gone out');
end $$;

\echo ''
\echo '───────── The only two reasons we accept ─────────'
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_line uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
begin
  -- The enum is the policy. Not a dropdown, not a check on a screen.
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_line, 'qty', 1, 'reason', 'changed_mind'))),
    'a return because they changed their mind');
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_line, 'qty', 1, 'reason', 'over_ordered'))),
    'a return because they ordered too many');
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_line, 'qty', 1, 'reason', ''))),
    'a return with no reason at all');
end $$;

\echo ''
\echo '───────── A client raising one on their own order ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
        v_l2 uuid := (select id from order_lines where order_id = v_order and sku='RET-2');
        v_ret uuid;
begin
  -- One parcel, both reasons: which is exactly why the reason is on the line.
  v_ret := request_return(v_order, 'refund', jsonb_build_array(
    jsonb_build_object('order_line_id', v_l1, 'qty', 2, 'reason', 'faulty',
                       'note', 'Both arrived with bent hangers'),
    jsonb_build_object('order_line_id', v_l2, 'qty', 1, 'reason', 'wrong_item')));
  insert into _ids values ('return', v_ret) on conflict (what) do update set id = excluded.id;

  perform assert_eq((select status from returns where id = v_ret), 'requested',
    'it starts as a request, not an approval');
  perform assert_eq((select count(*)::integer from return_lines where return_id = v_ret), 2,
    'with both lines on it');
  perform assert_eq(
    (select number from returns where id = v_ret) like 'RMA-%', true,
    'and a number of its own');
end $$;

\echo ''
\echo '───────── Not more than was bought, and a pending one holds its place ─────────'
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
begin
  perform assert_eq(returnable_qty(v_l1), 1,
    'three bought, two already asked about, one left');
  -- The two already requested are not yet approved, and must still count:
  -- otherwise clicking twice asks to return four of three.
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_l1, 'qty', 2, 'reason', 'faulty'))),
    'asking for more than is left');
end $$;

\echo ''
\echo '───────── Somebody else''s order ─────────'
reset role;
set role app_user;
set session "test.user_id" = '55555555-5555-5555-5555-555555555555';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
begin
  perform assert_eq((select count(*)::integer from returns), 0,
    'another shop cannot see the return');
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', gen_random_uuid(), 'qty', 1, 'reason', 'faulty'))),
    'and cannot raise one against it');
end $$;

\echo ''
\echo '───────── Nothing that has not been sent, and nothing cancelled ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_fresh uuid;
        v_line uuid;
begin
  v_fresh := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='RET-1'), 'qty', 1)),
    null);
  v_line := (select id from order_lines where order_id = v_fresh);
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_fresh,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_line, 'qty', 1, 'reason', 'faulty'))),
    'a return for goods still on our shelf');
end $$;

\echo ''
\echo '───────── The window, which staff may step outside and a client may not ─────────'
reset role;
set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
begin
  update invoices set shipped_at = now() - interval '200 days'
   where order_id = v_order and not superseded;
end $$;

reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
begin
  perform assert_fails(format(
    $f$select request_return(%L, 'refund', %L::jsonb)$f$, v_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_id', v_l1, 'qty', 1, 'reason', 'faulty'))),
    'a client reporting a fault seven months later');
end $$;

reset role;
set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
        v_ret uuid;
begin
  -- Somebody has to be able to do the right thing for a customer, and that
  -- somebody is a person with a reason rather than a form.
  v_ret := request_return(v_order, 'refund', jsonb_build_array(
    jsonb_build_object('order_line_id', v_l1, 'qty', 1, 'reason', 'faulty')));
  perform assert_eq((select status from returns where id = v_ret), 'requested',
    'staff can take one outside the window');
  perform cancel_return(v_ret);
  update invoices set shipped_at = now() - interval '2 days'
   where order_id = v_order and not superseded;
end $$;

\echo ''
\echo '───────── Deciding, receiving, and what goes back on the shelf ─────────'
do $$
declare v_ret uuid := (select id from _ids where what = 'return');
        v_order uuid := (select id from _ids where what = 'order');
        v_loc uuid := (select fulfilment_location_id from orders
                        where id = (select id from _ids where what = 'order'));
        v_before integer;
        v_after integer;
        v_faulty_before integer;
        v_faulty_after integer;
        v_restocked integer;
begin
  perform assert_fails(format($f$select receive_return(%L)$f$, v_ret),
    'receiving a return nobody has approved');

  perform decide_return(v_ret, true, 'Photos look right');
  perform assert_eq((select status from returns where id = v_ret), 'approved',
    'approved once somebody has looked');
  perform assert_fails(format($f$select decide_return(%L, true)$f$, v_ret),
    'deciding the same return twice');

  select qty into v_before from stock_levels
   where product_id = (select id from products where sku='RET-2') and location_id = v_loc;
  select qty into v_faulty_before from stock_levels
   where product_id = (select id from products where sku='RET-1') and location_id = v_loc;

  v_restocked := receive_return(v_ret);
  -- One wrongly-sent widget goes back; two faulty ones do not.
  perform assert_eq(v_restocked, 1, 'only the wrongly-sent item returns to stock');

  select qty into v_after from stock_levels
   where product_id = (select id from products where sku='RET-2') and location_id = v_loc;
  perform assert_eq(v_after - v_before, 1, 'and the shelf has it again');

  -- The claim itself, rather than an arithmetic coincidence: receiving two
  -- faulty widgets left the shelf exactly as it was.
  select qty into v_faulty_after from stock_levels
   where product_id = (select id from products where sku='RET-1') and location_id = v_loc;
  perform assert_eq(v_faulty_after - v_faulty_before, 0,
    'while the faulty ones are not put back on sale');
end $$;

\echo ''
\echo '───────── Settling it with a credit note ─────────'
do $$
declare v_ret uuid := (select id from _ids where what = 'return');
        v_order uuid := (select id from _ids where what = 'order');
        v_credit uuid;
        v_net numeric;
begin
  v_credit := resolve_return(v_ret, 'refund');
  perform assert_eq((select status from returns where id = v_ret), 'resolved',
    'the return is settled');
  perform assert_eq((select type::text from invoices where id = v_credit), 'credit',
    'with a credit note');

  -- Two at 100 plus one at 100: the quantities coming back, not the whole
  -- invoice, which is what somebody in a hurry would credit.
  select sum(qty * unit_price) into v_net from invoice_lines where invoice_id = v_credit;
  perform assert_eq(v_net, 300.00::numeric, 'for what is actually coming back');

  perform assert_eq(
    (select count(*)::integer from order_events
      where order_id = v_order and type = 'return_resolved'), 1,
    'and the order says so');
end $$;

\echo ''
\echo '───────── A client may withdraw one, until somebody has looked ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
        v_ret uuid;
begin
  v_ret := request_return(v_order, 'exchange', jsonb_build_array(
    jsonb_build_object('order_line_id', v_l1, 'qty', 1, 'reason', 'faulty')));
  perform cancel_return(v_ret);
  perform assert_eq((select status from returns where id = v_ret), 'cancelled',
    'withdrawn before anybody looked');
  -- And a cancelled one gives its quantity back.
  perform assert_eq(returnable_qty(v_l1), 1, 'the quantity is free again');
end $$;

reset role;
set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_order uuid := (select id from _ids where what = 'order');
        v_l1 uuid := (select id from order_lines where order_id = v_order and sku='RET-1');
        v_ret uuid;
begin
  v_ret := request_return(v_order, 'refund', jsonb_build_array(
    jsonb_build_object('order_line_id', v_l1, 'qty', 1, 'reason', 'faulty')));
  perform decide_return(v_ret, true);
  perform assert_fails(format($f$select cancel_return(%L)$f$, v_ret),
    'withdrawing one that is already being dealt with');
end $$;
