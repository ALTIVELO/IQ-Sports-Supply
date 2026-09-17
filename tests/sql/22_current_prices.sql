-- ============================================================================
-- 22: the price in force, and nothing else.
--
-- The screens used to read the whole of tier_prices and keep the newest row
-- per product in JavaScript. That works until the table outgrows the row cap
-- on a response, at which point the newest rows fill it on their own and every
-- older price silently disappears from the answer — which is how a catalogue
-- loses a year of sterling prices the day a few hundred euro ones are imported.
--
-- So the thing worth proving here is not just "returns the right number" but
-- "returns one row per product per tier, whatever the history behind it".
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
  ('CP-1','Repriced widget','Test',true),
  ('CP-2','Never repriced','Test',true),
  ('CP-3','Priced on one tier only','Test',true);

-- CP-1 has been repriced every quarter for three years on every tier: the
-- shape that made the old approach fall over.
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100 + n, (current_date - (n * 90))::date
    from products p, tiers t, generate_series(0, 11) as n
   where p.sku = 'CP-1';
-- And one price dated next quarter, which is not yet in force.
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 999.99, (current_date + 30)::date
    from products p, tiers t where p.sku = 'CP-1';

insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 50.00, (current_date - 400)::date
    from products p, tiers t where p.sku = 'CP-2';

insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 77.00, (current_date - 10)::date
    from products p, tiers t where p.sku = 'CP-3' and t.name = 'Shop';

insert into product_costs (product_id, cost, effective_from)
  select id, 40.00, (current_date - 400)::date from products where sku = 'CP-1';
insert into product_costs (product_id, cost, effective_from)
  select id, 45.00, (current_date - 5)::date from products where sku = 'CP-1';
insert into product_costs (product_id, cost, effective_from)
  select id, 99.00, (current_date + 5)::date from products where sku = 'CP-1';
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── One row per product per tier, however long the history ─────────'
do $$
declare v_all uuid[] := (select array_agg(id) from products where sku like 'CP-%');
        v_tiers integer := (select count(*)::integer from tiers);
        v_history integer;
begin
  select count(*)::integer into v_history from tier_prices tp
    join products p on p.id = tp.product_id where p.sku = 'CP-1';
  perform assert_eq(v_history, v_tiers * 13, 'CP-1 really does have that much history');

  -- Two priced on every tier, one priced on a single tier.
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(v_all)),
    v_tiers * 2 + 1,
    'and the answer is one row per product per tier, not one per price ever set');
end $$;

\echo ''
\echo '───────── The newest price that has actually come into force ─────────'
do $$
declare v_cp1 uuid := (select id from products where sku = 'CP-1');
        v_shop uuid := (select id from tiers where name = 'Shop');
begin
  perform assert_eq(
    (select price from current_tier_prices(array[v_cp1]) where tier_id = v_shop),
    100.00::numeric, 'the quarter in force, not the oldest');
  -- 999.99 is dated next month. A price agreed for next quarter must not be
  -- charged this one.
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(array[v_cp1]) where price > 900),
    0, 'and never a price that starts in the future');

  -- Asked about a past date, it answers for that date: an invoice reprinted
  -- next year has to show what was charged, not what is charged now.
  perform assert_eq(
    (select price from current_tier_prices(array[v_cp1], (current_date - 100)::date)
      where tier_id = v_shop),
    102.00::numeric, 'as at a past date, the price in force then');
end $$;

\echo ''
\echo '───────── No price is no row, not a row saying zero ─────────'
do $$
declare v_cp3 uuid := (select id from products where sku = 'CP-3');
begin
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(array[v_cp3])), 1,
    'a product priced on one tier has one row');
  perform assert_eq(
    (select name from tiers t join current_tier_prices(array[v_cp3]) c on c.tier_id = t.id),
    'Shop', 'and it is the tier that prices it');
  -- The distinction the order desk now depends on.
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(array[v_cp3]) where price = 0),
    0, 'the tiers that do not price it are absent, not zero');
end $$;

\echo ''
\echo '───────── Asking about nothing, and about products that do not exist ─────────'
do $$
begin
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(array[]::uuid[])), 0,
    'an empty list asks nothing and returns nothing');
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(
       array['00000000-0000-0000-0000-000000000000'::uuid])), 0,
    'and an unknown product returns nothing rather than failing');
end $$;

\echo ''
\echo '───────── Costs, the same way ─────────'
do $$
declare v_cp1 uuid := (select id from products where sku = 'CP-1');
        v_cp2 uuid := (select id from products where sku = 'CP-2');
begin
  perform assert_eq(
    (select cost from current_costs(array[v_cp1])), 45.00::numeric,
    'the cost in force, not the first nor the future one');
  perform assert_eq(
    (select count(*)::integer from current_costs(array[v_cp1, v_cp2])), 1,
    'a product we have never costed has no row');
  perform assert_eq(
    (select cost from current_costs(array[v_cp1], (current_date - 10)::date)),
    40.00::numeric, 'and as at a past date, what it cost then');
end $$;

\echo ''
\echo '───────── A client sees their own tier and no other ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_cp1 uuid := (select id from products where sku = 'CP-1');
        v_mine uuid := (select tier_id from clients where name = 'MDI Ltd');
begin
  -- Security invoker on purpose: tier_prices' own policy does the work, so
  -- this cannot become a way to read every tier's price.
  perform assert_eq(
    (select count(*)::integer from current_tier_prices(array[v_cp1])), 1,
    'one row, for the tier they are on');
  perform assert_eq(
    (select tier_id from current_tier_prices(array[v_cp1])), v_mine,
    'and it is theirs');
  perform assert_eq(
    (select count(*)::integer from current_costs(array[v_cp1])), 0,
    'and what it costs us is none of their business');
end $$;
