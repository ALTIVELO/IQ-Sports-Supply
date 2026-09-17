-- ============================================================================
-- 20: a price knows which money it is in.
--
-- The whole point of holding a currency rather than converting on import is
-- that nothing anywhere silently adds euros to pounds. That is a claim about
-- edges, so these are the edges: an order that tries to mix, an invoice that
-- tries to disagree with its order, a report asked for one currency, and the
-- default every row already in the system has to keep.
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

-- One sterling product and one euro one, priced and costed the same figures,
-- so anything that confuses the two shows up as a wrong total and not as a
-- wrong-looking number.
insert into products (sku, name, brand, active, currency) values
  ('CUR-GBP','Sterling widget','Test',true,'GBP'),
  ('CUR-EUR','Euro widget','Test',true,'EUR');
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100.00, current_date - 400 from products p, tiers t
   where p.sku like 'CUR-%';
insert into product_costs (product_id, cost, effective_from)
  select id, 60.00, current_date - 400 from products where sku like 'CUR-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 100 from products p, locations l where p.sku like 'CUR-%';
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── Everything that was here before is sterling ─────────'
do $$
begin
  perform assert_eq(
    (select count(*)::integer from products where currency <> 'GBP' and sku not like 'CUR-%'),
    0, 'no product acquired a currency it never asked for');
  perform assert_eq(
    (select currency from products where sku = 'CUR-GBP'), 'GBP',
    'and the default is the one every price list already assumed');
end $$;

\echo ''
\echo '───────── Nothing but the two currencies we hold ─────────'
select assert_fails(
  $$update products set currency = 'USD' where sku = 'CUR-GBP'$$,
  'a currency we do not trade in');

\echo ''
\echo '───────── The first line decides what the order is in ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_eur uuid := (select id from products where sku='CUR-EUR');
        v_order uuid;
begin
  v_order := place_order(v_mdi, null,
    jsonb_build_array(jsonb_build_object('product_id', v_eur, 'qty', 2)), null);
  perform assert_eq((select currency from orders where id = v_order), 'EUR',
    'a euro product makes a euro order');
  perform assert_eq(
    (select currency from invoices where order_id = v_order and not superseded limit 1),
    'EUR', 'and the invoice raised with it demands euros');
end $$;

\echo ''
\echo '───────── An order cannot hold two currencies at once ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_eur uuid := (select id from products where sku='CUR-EUR');
        v_gbp uuid := (select id from products where sku='CUR-GBP');
begin
  perform assert_fails(format(
    $f$select place_order(%L, null, %L::jsonb, null)$f$,
    v_mdi,
    jsonb_build_array(
      jsonb_build_object('product_id', v_eur, 'qty', 1),
      jsonb_build_object('product_id', v_gbp, 'qty', 1))),
    'a basket holding both');
end $$;

-- The refusal has to be a refusal, not a half-placed order: place_order runs
-- in one transaction, and an order left behind with one of its two lines on it
-- would be worse than the mixed one it refused.
do $$
begin
  perform assert_eq(
    (select count(*)::integer from orders o
      join order_lines l on l.order_id = o.id
     where l.sku = 'CUR-GBP'),
    0, 'and nothing of it survived the refusal');
end $$;

\echo ''
\echo '───────── Nor can one be smuggled in afterwards ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_eur uuid := (select id from products where sku='CUR-EUR');
        v_gbp uuid := (select id from products where sku='CUR-GBP');
        v_order uuid;
begin
  v_order := place_order(v_mdi, null,
    jsonb_build_array(jsonb_build_object('product_id', v_gbp, 'qty', 1)), null);
  perform assert_eq((select currency from orders where id = v_order), 'GBP',
    'the order starts in sterling');

  perform assert_fails(format(
    $f$insert into order_lines (order_id, product_id, sku, name, qty, unit_price)
       values (%L, %L, 'CUR-EUR', 'Euro widget', 1, 100.00)$f$, v_order, v_eur),
    'a euro line added to a sterling order');

  perform assert_eq(
    (select count(*)::integer from order_lines where order_id = v_order), 1,
    'and the order still holds only its own line');
end $$;

\echo ''
\echo '───────── An invoice cannot disagree with its order ─────────'
do $$
declare v_order uuid := (select o.id from orders o
                          join order_lines l on l.order_id = o.id
                         where l.sku = 'CUR-EUR' limit 1);
        v_inv uuid;
begin
  -- Set directly, the way a careless backfill would. The trigger takes the
  -- order's answer regardless of what was asked for.
  insert into invoices (number, order_id, client_id, due_date, location_id, currency)
  select 'CUR-TEST-1', o.id, o.client_id, current_date + 30, o.fulfilment_location_id, 'GBP'
    from orders o where o.id = v_order
  returning id into v_inv;

  perform assert_eq((select currency from invoices where id = v_inv), 'EUR',
    'the order decides, not whoever wrote the row');
end $$;

\echo ''
\echo '───────── A report is asked for one currency at a time ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_eur uuid := (select id from products where sku='CUR-EUR');
        v_gbp uuid := (select id from products where sku='CUR-GBP');
        r record;
begin
  -- Two more orders today so each currency has something to report on: three
  -- euro units and four sterling ones, all at 100 costing 60.
  perform place_order(v_mdi, null,
    jsonb_build_array(jsonb_build_object('product_id', v_eur, 'qty', 1)), null);
  perform place_order(v_mdi, null,
    jsonb_build_array(jsonb_build_object('product_id', v_gbp, 'qty', 3)), null);

  select * into r from sales_totals((current_date - 30)::date, current_date, 'EUR');
  perform assert_eq(r.revenue, 300.00::numeric, 'euro revenue is the euro sales');
  perform assert_eq(r.cost, 180.00::numeric, 'and the euro cost of them');
  perform assert_eq(r.profit, 120.00::numeric, 'leaving the euro profit');

  select * into r from sales_totals((current_date - 30)::date, current_date, 'GBP');
  perform assert_eq(r.revenue, 400.00::numeric, 'sterling revenue is the sterling sales');
  perform assert_eq(r.profit, 160.00::numeric, 'and none of the euro profit is in it');

  -- The whole point: neither figure is the sum of both.
  perform assert_eq(
    (select revenue from sales_totals((current_date - 30)::date, current_date, 'GBP')),
    400.00::numeric, 'nothing anywhere reports 700');
end $$;

\echo ''
\echo '───────── Every report agrees about which currency it is in ─────────'
do $$
declare v_sum numeric;
begin
  select sum(revenue) into v_sum
    from sales_over_time((current_date - 30)::date, current_date, 'day', 'EUR');
  perform assert_eq(v_sum, 300.00::numeric, 'the buckets hold the euro sales only');

  perform assert_eq(
    (select revenue from top_clients((current_date - 30)::date, current_date, 5, 'EUR')
      limit 1),
    300.00::numeric, 'and so does the client table');

  perform assert_eq(
    (select count(*)::integer from sold_currencies()), 2,
    'both currencies are offered, because both were sold in');
  perform assert_eq(
    (select currency from sold_currencies() order by orders desc, currency limit 1),
    'EUR', 'commonest first — two euro orders against one sterling');
end $$;

\echo ''
\echo '───────── A client sees their own prices in their own money ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq(
    (select currency from client_catalogue where sku = 'CUR-EUR'), 'EUR',
    'the catalogue carries it to the portal');
  perform assert_eq(
    (select currency from client_catalogue where sku = 'CUR-GBP'), 'GBP',
    'and does not make everything the same');
end $$;
