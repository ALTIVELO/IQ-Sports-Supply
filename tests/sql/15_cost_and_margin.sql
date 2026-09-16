-- ============================================================================
-- 15: cost prices, and the margin they let us see.
--
-- Two things have to hold. What a sale cost us is fixed on the day it happened
-- and does not move when the supplier reprices — otherwise last quarter's
-- profit changes every time a price list is loaded. And none of it is ever
-- readable by a customer: a client who can see our cost can see our margin.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

insert into products (sku, name, brand, active) values
  ('CM-1','Costed Widget','Test',true),
  ('CM-2','Later Costed Widget','Test',true),
  ('CM-3','Never Costed Widget','Test',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100.00, current_date - 400 from products p, tiers t where p.sku like 'CM-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, (select id from locations where name='Slough'), 50
    from products p where p.sku like 'CM-%';

-- CM-1 cost us 60 a year ago and 70 since last month.
insert into product_costs (product_id, cost, supplier, effective_from) values
  ((select id from products where sku='CM-1'), 60.00, 'JMM', current_date - 365),
  ((select id from products where sku='CM-1'), 70.00, 'JMM', current_date - 30);

create table placed (n serial primary key, id uuid);
grant select, insert, delete on placed to app_user;
grant usage on sequence placed_n_seq to app_user;
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── A line records what it cost us, as it is placed ─────────'
insert into placed (id) select place_order(
  (select id from clients where name='MDI Ltd'), null,
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='CM-1'),'qty',3),
    jsonb_build_object('product_id',(select id from products where sku='CM-3'),'qty',2)),
  null, null);

do $$
declare v_order uuid := (select id from placed order by n limit 1);
begin
  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = v_order and l.sku='CM-1'),
    70.00::numeric(12,2),
    'the cost in force today, not the one from a year ago');

  -- A product we have never costed does not block the order; it simply has
  -- no margin until someone imports a price list that covers it.
  perform assert_eq(
    (select count(*)::integer from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = v_order and l.sku='CM-3'),
    0, 'a product with no recorded cost gets no snapshot');

  perform assert_eq(
    (select sum(l.qty * (l.unit_price - coalesce(c.unit_cost,0)))
       from order_lines l left join order_line_costs c on c.order_line_id = l.id
      where l.order_id = v_order),
    (3*(100.00-70.00) + 2*100.00)::numeric,
    'and the profit reads as the lines we can cost, plus the rest at full');
end $$;

\echo ''
\echo '───────── Repricing the supplier does not rewrite last week ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1);
begin
  insert into product_costs (product_id, cost, effective_from)
  values ((select id from products where sku='CM-1'), 85.00, current_date);

  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = v_order and l.sku='CM-1'),
    70.00::numeric(12,2),
    'the order already placed still cost what it cost');

  perform assert_eq(current_cost((select id from products where sku='CM-1')),
                    85.00::numeric, 'while today''s cost is the new one');
  perform assert_eq(current_cost((select id from products where sku='CM-1'),
                                 current_date - 100),
                    60.00::numeric, 'and a date in the past reads the old one');
end $$;

\echo ''
\echo '───────── A cost dated ahead is not in force yet ─────────'
do $$
begin
  insert into product_costs (product_id, cost, effective_from)
  values ((select id from products where sku='CM-2'), 40.00, current_date + 30);

  perform assert_eq(current_cost((select id from products where sku='CM-2')),
                    null::numeric, 'a cost starting next month is not today''s');
end $$;

\echo ''
\echo '───────── Costs arriving after the orders they explain ─────────'
do $$
declare v_order uuid; v_filled integer;
begin
  -- Placed before CM-2 was ever costed.
  v_order := place_order((select id from clients where name='MDI Ltd'), null,
    jsonb_build_array(
      jsonb_build_object('product_id',(select id from products where sku='CM-2'),'qty',4)),
    null, null);
  insert into placed (id) values (v_order);

  perform assert_eq(
    (select count(*)::integer from order_line_costs c
       join order_lines l on l.id = c.order_line_id where l.order_id = v_order),
    0, 'the line starts with no cost against it');

  -- Now the price list lands, backdated to before the order.
  insert into product_costs (product_id, cost, effective_from)
  values ((select id from products where sku='CM-2'), 45.00, current_date - 7);

  v_filled := refill_order_line_costs();
  perform assert_eq(v_filled, 1, 'one line was waiting to be costed');
  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id where l.order_id = v_order),
    45.00::numeric(12,2), 'and it takes the cost in force on the order date');

  -- CM-1 is already costed and CM-3 still has no cost at all, so a second
  -- pass finds nothing: a recorded cost is history and is never revised.
  perform assert_eq(refill_order_line_costs(), 0, 'a second pass changes nothing');
  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = (select id from placed order by n limit 1) and l.sku='CM-1'),
    70.00::numeric(12,2), 'and the first order still reads 70');
end $$;

\echo ''
\echo '───────── Amending an order re-costs the lines it creates ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1);
begin
  perform edit_order(v_order, jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='CM-1'),'qty',1),
    jsonb_build_object('product_id',(select id from products where sku='CM-2'),'qty',1)));

  -- edit_order replaces the lines, so these are new rows costed at today's
  -- price. The order was placed today, so 85 is right for CM-1.
  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = v_order and l.sku='CM-1'),
    85.00::numeric(12,2), 'the replacement line is costed when it is written');
  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id
      where l.order_id = v_order and l.sku='CM-2'),
    45.00::numeric(12,2), 'and so is the line the edit added');
  perform assert_eq(
    (select count(*)::integer from order_line_costs c
      where not exists (select 1 from order_lines l where l.id = c.order_line_id)),
    0, 'and the costs of the lines it removed went with them');
end $$;

\echo ''
\echo '───────── A past order is costed as at the day it happened ─────────'
do $$
declare v_order uuid;
begin
  v_order := import_historic_order(
    (select id from clients where name='MDI Ltd'),
    (current_date - 200)::date,
    jsonb_build_array(jsonb_build_object(
      'sku','CM-1','name','Costed Widget','qty',2,'unit_price',95.00)),
    'OLD-CM-1', null);

  perform assert_eq(
    (select c.unit_cost from order_line_costs c
       join order_lines l on l.id = c.order_line_id where l.order_id = v_order),
    60.00::numeric(12,2),
    'two hundred days ago it cost us sixty, not what it costs now');
end $$;

\echo ''
\echo '───────── None of this is the customer''s business ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_line uuid;
begin
  perform assert_eq((select count(*)::integer from product_costs), 0,
                    'a client sees no cost prices at all');
  perform assert_eq((select count(*)::integer from order_line_costs), 0,
                    'nor what any line of their own order cost us');
  perform assert_eq(current_cost((select id from products where sku='CM-1')),
                    null::numeric, 'and current_cost tells them nothing');

  -- They can still read the order itself. It is the cost beside it that is ours.
  perform assert_eq((select count(*)::integer > 0 from order_lines), true,
                    'while their own order lines are still theirs to read');
end $$;

select assert_fails($$ select refill_order_line_costs() $$,
                    'a client cannot run the cost backfill');
do $$
begin
  -- RLS filters the write rather than raising, so the proof is that nothing
  -- landed, not that anything complained.
  begin
    insert into product_costs (product_id, cost, effective_from)
    values ((select id from products where sku='CM-3'), 1.00, current_date);
  exception when others then null;
  end;
  reset role;
  -- Five: three for CM-1, two for CM-2, and nothing the client added.
  perform assert_eq((select count(*)::integer from product_costs), 5,
                    'and a cost they tried to write is not there');
end $$;

\echo ''
\echo '───────── done ─────────'
