-- ============================================================================
-- 17: what the business did, over a period.
--
-- The figures on a dashboard get quoted in meetings, so the things worth
-- pinning down are the edges: which orders count, which day an order belongs
-- to, what an empty bucket looks like, and what a line with no recorded cost
-- does to the margin.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','packer@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='ops'   where id='33333333-3333-3333-3333-333333333333';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

insert into clients (name, tier_id, email, default_location_id)
select 'Second Shop Ltd', t.id, 'buyer@secondshop.test', l.id
  from tiers t, locations l where t.name='Shop' and l.name='Slough';

insert into products (sku, name, brand, active) values
  ('RP-1','Reported widget','Test',true),
  ('RP-2','Uncosted widget','Test',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100.00, current_date - 400 from products p, tiers t where p.sku like 'RP-%';
-- RP-1 costs us 60. RP-2 has never been costed at all.
insert into product_costs (product_id, cost, effective_from)
  select id, 60.00, current_date - 400 from products where sku = 'RP-1';
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── Three orders on three days, and one of them cancelled ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_two uuid := (select id from clients where name='Second Shop Ltd');
        v_rp1 uuid := (select id from products where sku='RP-1');
        v_doomed uuid;
begin
  -- Ten days ago: 2 × £100, costing £60 each.
  perform import_historic_order(v_mdi, (current_date - 10)::date,
    jsonb_build_array(jsonb_build_object('sku','RP-1','qty',2,'unit_price',100.00)),
    'REP-A', null);
  -- Three days ago, the other client: 5 × £100.
  perform import_historic_order(v_two, (current_date - 3)::date,
    jsonb_build_array(jsonb_build_object('sku','RP-1','qty',5,'unit_price',100.00)),
    'REP-B', null);
  -- Also three days ago, then cancelled. It is not a sale.
  v_doomed := import_historic_order(v_mdi, (current_date - 3)::date,
    jsonb_build_array(jsonb_build_object('sku','RP-1','qty',99,'unit_price',100.00)),
    'REP-C', null);
  update orders set status = 'cancelled' where id = v_doomed;
end $$;

do $$
declare r record;
begin
  select * into r from sales_totals((current_date - 30)::date, current_date);
  perform assert_eq(r.orders, 2, 'the cancelled order is not counted');
  perform assert_eq(r.revenue, 700.00::numeric, 'revenue is the seven units sold');
  perform assert_eq(r.cost, 420.00::numeric, 'against what those seven cost us');
  perform assert_eq(r.profit, 280.00::numeric, 'leaving the difference');
  perform assert_eq(r.uncosted_lines, 0, 'and every line was costed');
end $$;

\echo ''
\echo '───────── A period that ends before an order does not include it ─────────'
do $$
declare r record;
begin
  select * into r from sales_totals((current_date - 30)::date, (current_date - 5)::date);
  perform assert_eq(r.orders, 1, 'only the older order is in range');
  perform assert_eq(r.revenue, 200.00::numeric, 'and only its revenue');

  select * into r from sales_totals((current_date - 2)::date, current_date);
  perform assert_eq(r.orders, 0, 'a period with nothing in it reports nothing');
  perform assert_eq(r.revenue, 0::numeric, 'not null, which no arithmetic survives');
  perform assert_eq(r.profit, 0::numeric, 'nor a null profit');
end $$;

\echo ''
\echo '───────── A quiet day is a fact, not a missing row ─────────'
do $$
declare v_rows integer; v_zero integer; r record;
begin
  select count(*)::integer into v_rows
    from sales_over_time((current_date - 6)::date, current_date, 'day');
  perform assert_eq(v_rows, 7, 'seven days asked for, seven days returned');

  select count(*)::integer into v_zero
    from sales_over_time((current_date - 6)::date, current_date, 'day')
   where orders = 0;
  perform assert_eq(v_zero, 6, 'six of them sold nothing, and say so');

  select * into r from sales_over_time((current_date - 6)::date, current_date, 'day')
   where bucket = (current_date - 3)::date;
  perform assert_eq(r.orders, 1, 'the day that did sell is the right one');
  perform assert_eq(r.revenue, 500.00::numeric, 'with the right revenue');
  perform assert_eq(r.profit, 200.00::numeric, 'and the right profit');
end $$;

\echo ''
\echo '───────── Buckets roll up, and the parts add to the whole ─────────'
do $$
declare v_sum numeric; r record;
begin
  select sum(revenue) into v_sum
    from sales_over_time((current_date - 30)::date, current_date, 'day');
  select * into r from sales_totals((current_date - 30)::date, current_date);
  perform assert_eq(v_sum, r.revenue, 'the daily buckets add up to the total');

  select sum(revenue) into v_sum
    from sales_over_time((current_date - 30)::date, current_date, 'week');
  perform assert_eq(v_sum, r.revenue, 'and so do the weekly ones');

  perform assert_eq(
    (select count(*)::integer from sales_over_time(
       (date_trunc('month', current_date) - interval '2 months')::date, current_date, 'month')),
    3, 'three months asked for, three months returned');
end $$;

select assert_fails($$ select * from sales_over_time(current_date, current_date, 'fortnight') $$,
                    'a grain this does not report on is refused');

\echo ''
\echo '───────── A line nobody has costed flatters the margin, and says so ─────────'
do $$
declare r record;
begin
  perform import_historic_order(
    (select id from clients where name='MDI Ltd'), (current_date - 1)::date,
    jsonb_build_array(jsonb_build_object('sku','RP-2','qty',1,'unit_price',100.00)),
    'REP-D', null);

  select * into r from sales_totals((current_date - 30)::date, current_date);
  perform assert_eq(r.revenue, 800.00::numeric, 'the sale counts towards revenue');
  perform assert_eq(r.cost, 420.00::numeric, 'but adds nothing to cost, having none');
  perform assert_eq(r.profit, 380.00::numeric, 'so it all reads as profit');
  perform assert_eq(r.uncosted_lines, 1,
                    'which is why the count of uncosted lines comes back too');
end $$;

\echo ''
\echo '───────── Best clients, by what they left behind ─────────'
do $$
declare r record; v_rows integer;
begin
  select count(*)::integer into v_rows
    from top_clients((current_date - 30)::date, current_date, 5);
  perform assert_eq(v_rows, 2, 'both clients bought something');

  select * into r from top_clients((current_date - 30)::date, current_date, 5) limit 1;
  perform assert_eq(r.client_name, 'Second Shop Ltd', 'the best one leads');
  perform assert_eq(r.profit, 200.00::numeric, 'with the profit it left');
  perform assert_eq(r.revenue, 500.00::numeric, 'and what it spent');

  perform assert_eq(
    (select count(*)::integer from top_clients((current_date - 30)::date, current_date, 1)),
    1, 'and the limit is honoured');
end $$;

\echo ''
\echo '───────── None of this is for customers, or for the packing bench ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select assert_fails($$ select * from sales_totals(current_date - 30, current_date) $$,
                    'a client cannot read the takings');
select assert_fails($$ select * from sales_over_time(current_date - 30, current_date, 'day') $$,
                    'nor the history behind them');
select assert_fails($$ select * from top_clients(current_date - 30, current_date, 5) $$,
                    'nor who else we sell to');

set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
declare r record;
begin
  -- An ops user works the packing bench. They are staff, so the reporting is
  -- open to them; the screen is what limits it to admin and accounts.
  select * into r from sales_totals((current_date - 30)::date, current_date);
  perform assert_eq(r.orders, 3, 'an ops user is staff, and these functions say so');
end $$;

\echo ''
\echo '───────── done ─────────'
