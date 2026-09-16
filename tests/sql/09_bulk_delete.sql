-- ============================================================================
-- 09: deleting products in bulk, without destroying what was sold.
--
-- The assertion that matters most is that a product on a past order survives
-- as an inactive row: an invoice must keep naming what was on it, so a bulk
-- delete has to withdraw those rather than remove them, and say so.
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

-- Three throwaway products; one of them gets ordered.
insert into products (sku, name, brand, active) values
  ('ZZ-KEEP','Sold Once Widget','Test',true),
  ('ZZ-GONE-1','Never Sold One','Test',true),
  ('ZZ-GONE-2','Never Sold Two','Test',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 9.99, current_date from products p, tiers t
   where p.sku in ('ZZ-KEEP','ZZ-GONE-1','ZZ-GONE-2');
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 5 from products p, locations l
   where p.sku in ('ZZ-KEEP','ZZ-GONE-1','ZZ-GONE-2');
\set QUIET off

set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select place_order(
  (select id from clients where name='MDI Ltd'), null,
  (select jsonb_build_array(jsonb_build_object(
     'product_id', id, 'qty', 1, 'unit_price', null))
     from products where sku='ZZ-KEEP'),
  null, null);

\echo ''
\echo '───────── Only an admin or accounts user may do this ─────────'
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
begin
  perform assert_fails(
    $q$select delete_products(array(select id from products where sku='ZZ-GONE-1'))$q$,
    'an ops user cannot empty the price list');
end $$;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_fails(
    $q$select delete_products(array(select id from products where sku='ZZ-GONE-1'))$q$,
    'and neither can a trade customer');
end $$;

\echo ''
\echo '───────── An empty selection is refused rather than silently doing nothing ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
begin
  perform assert_fails($q$select delete_products('{}'::uuid[])$q$,
                       'selecting nothing is refused');
  perform assert_fails($q$select delete_products(null)$q$,
                       'and so is passing nothing at all');
end $$;

\echo ''
\echo '───────── A mixed selection is split, not refused ─────────'
do $$
declare v jsonb;
begin
  select delete_products(array(
    select id from products where sku in ('ZZ-KEEP','ZZ-GONE-1','ZZ-GONE-2'))) into v;

  perform assert_eq((v->>'deleted')::integer, 2,
                    'the two never sold are gone');
  perform assert_eq(v->'withdrawn'->>0, 'ZZ-KEEP',
                    'and the one that was sold is named as withdrawn');

  perform assert_eq((select count(*)::integer from products where sku like 'ZZ-GONE-%'), 0,
                    'the deleted rows really are gone');
  perform assert_eq((select active from products where sku='ZZ-KEEP'), false,
                    'the sold one stays, withdrawn from the catalogue');
end $$;

\echo ''
\echo '───────── What was sold still reads correctly ─────────'
do $$
begin
  -- The whole reason for withdrawing rather than deleting.
  perform assert_eq(
    (select count(*)::integer from order_lines where sku = 'ZZ-KEEP'), 1,
    'the order line survives the bulk delete');
  perform assert_eq(
    (select ol.name from order_lines ol where ol.sku='ZZ-KEEP'), 'Sold Once Widget',
    'and still says what was bought');
  perform assert_eq(
    (select count(*)::integer from invoice_lines where sku='ZZ-KEEP'), 1,
    'so does the invoice it was billed on');
end $$;

\echo ''
\echo '───────── Deleting takes the prices and stock with it ─────────'
do $$
begin
  perform assert_eq((select count(*)::integer from tier_prices tp
                      where not exists (select 1 from products p where p.id = tp.product_id)),
                    0, 'no prices left pointing at a deleted product');
  perform assert_eq((select count(*)::integer from stock_levels sl
                      where not exists (select 1 from products p where p.id = sl.product_id)),
                    0, 'and no stock rows either');
end $$;

\echo ''
\echo '───────── A withdrawn product leaves the client catalogue ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from client_catalogue where sku='ZZ-KEEP'), 0,
                    'the client no longer sees it to order again');
end $$;
