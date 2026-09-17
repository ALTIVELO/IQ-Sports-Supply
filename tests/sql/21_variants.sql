-- ============================================================================
-- 21: one bike, several frames.
--
-- Each size is its own product, so everything downstream — stock, allocation,
-- costing, invoicing — works on it unchanged. The only new claims are about
-- what a size is allowed to be, and the ones worth pinning down are the ones
-- that would corrupt an order rather than merely look wrong: two products
-- claiming one size of one bike, and a size belonging to nothing.
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

insert into products (sku, name, brand, active, currency, variant_group, variant_label,
                      variant_sort, price_note)
values
  ('DRAG-STORM-7-0-S','28 Storm 7.0 — S','DRAG',true,'EUR','DRAG-STORM-7-0','S',null,
   'Prices exclude import duty and VAT'),
  ('DRAG-STORM-7-0-M','28 Storm 7.0 — M','DRAG',true,'EUR','DRAG-STORM-7-0','M',null,
   'Prices exclude import duty and VAT'),
  ('DRAG-STORM-7-0-L','28 Storm 7.0 — L','DRAG',true,'EUR','DRAG-STORM-7-0','L',null,
   'Prices exclude import duty and VAT'),
  ('PLAIN-1','A thing sold as one thing','Test',true,'GBP',null,null,null,null);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 1000.00, current_date - 30 from products p, tiers t
   where p.sku like 'DRAG-STORM-%' or p.sku = 'PLAIN-1';
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 4 from products p, locations l where p.sku = 'DRAG-STORM-7-0-M';
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── A size of nothing, and a bike with no size ─────────'
select assert_fails(
  $$insert into products (sku, name, variant_group) values ('BAD-1','No size','G')$$,
  'a model with no size against it');
select assert_fails(
  $$insert into products (sku, name, variant_label) values ('BAD-2','Orphan size','M')$$,
  'a size belonging to no model');

\echo ''
\echo '───────── Two products cannot be the same size of one bike ─────────'
select assert_fails(
  $$insert into products (sku, name, variant_group, variant_label)
    values ('DRAG-STORM-7-0-M2','Storm 7.0 M again','DRAG-STORM-7-0','M')$$,
  'a second M of the same bike');
-- Case is not a distinction: "m" and "M" are one frame however it was typed.
select assert_fails(
  $$insert into products (sku, name, variant_group, variant_label)
    values ('DRAG-STORM-7-0-M3','Storm 7.0 m','DRAG-STORM-7-0','m')$$,
  'the same size in lower case');

\echo ''
\echo '───────── A different bike may of course have an M ─────────'
do $$
begin
  insert into products (sku, name, variant_group, variant_label, currency)
  values ('DRAG-STORM-3-0-M','28 Storm 3.0 — M','DRAG-STORM-3-0','M','EUR');
  perform assert_eq(
    (select count(*)::integer from products where variant_label = 'M'), 2,
    'two bikes, each with an M');
end $$;

\echo ''
\echo '───────── A size is an ordinary product in every other way ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_m uuid := (select id from products where sku='DRAG-STORM-7-0-M');
        v_order uuid;
        v_line record;
begin
  v_order := place_order(v_mdi, null,
    jsonb_build_array(jsonb_build_object('product_id', v_m, 'qty', 2)), null);

  select * into v_line from order_lines where order_id = v_order;
  -- The SKU on the order is the size's SKU, not the bike's: what was ordered
  -- is a frame, and a picker cannot ship "a Storm 7.0".
  perform assert_eq(v_line.sku, 'DRAG-STORM-7-0-M', 'the size is what was ordered');
  perform assert_eq(v_line.alloc_qty, 2, 'and it allocated from that size''s own stock');
  perform assert_eq((select currency from orders where id = v_order), 'EUR',
    'in the currency the size is priced in');
end $$;

\echo ''
\echo '───────── Stock is per size, not per bike ─────────'
do $$
begin
  perform assert_eq(product_in_stock(
    (select id from products where sku='DRAG-STORM-7-0-M')), true,
    'the M is on the shelf');
  perform assert_eq(product_in_stock(
    (select id from products where sku='DRAG-STORM-7-0-L')), false,
    'which says nothing about the L');
end $$;

\echo ''
\echo '───────── The client sees the sizes and what the price excludes ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq(
    (select count(*)::integer from client_catalogue where variant_group = 'DRAG-STORM-7-0'),
    3, 'all three frames reach the portal');
  perform assert_eq(
    (select variant_label from client_catalogue where sku = 'DRAG-STORM-7-0-L'), 'L',
    'each one named by its size');
  perform assert_eq(
    (select price_note from client_catalogue where sku = 'DRAG-STORM-7-0-S'),
    'Prices exclude import duty and VAT',
    'and the note travels with the price');
  perform assert_eq(
    (select price_note from client_catalogue where sku = 'PLAIN-1'), null,
    'while a product with nothing to say says nothing');
end $$;
