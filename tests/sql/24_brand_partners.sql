-- ============================================================================
-- 24: a brand partner sees their own shelf and nothing else.
--
-- A partner is an outsider with a login. The useful tests are therefore not
-- "can they see their sales" — of course they can — but every way somebody
-- might try to see somebody else's: naming another brand, reading the tables
-- the functions read, listing the catalogue, editing a notice by guessing its
-- id. Each of those is a paragraph below.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','sales@dragbicycles.com'),
  ('44444444-4444-4444-4444-444444444444','sales@rivalbrand.test');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='partner' where id in
  ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

-- Two brands. DRAG ships its own; Rival leaves stock with us.
insert into products (sku, name, brand, active, dropship) values
  ('BP-DRAG-1','Drag gravel frame','DRAG',true,true),
  ('BP-DRAG-2','Drag bar tape','DRAG',true,false),
  ('BP-RIVAL-1','Rival wheelset','RivalBrand',true,false);

insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 500.00, current_date - 400 from products p, tiers t
   where p.sku like 'BP-%';
insert into product_costs (product_id, cost, effective_from)
  select id, 300.00, current_date - 400 from products where sku like 'BP-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 20 from products p, locations l where p.sku like 'BP-%';

insert into brand_partners (brand_id, auth_user_id, email)
select b.id, '33333333-3333-3333-3333-333333333333', 'sales@dragbicycles.com'
  from brands b where b.key = 'drag';
insert into brand_partners (brand_id, auth_user_id, email)
select b.id, '44444444-4444-4444-4444-444444444444', 'sales@rivalbrand.test'
  from brands b where b.key = 'rivalbrand';

-- A second client, so a demographic split has something to split.
insert into clients (name, tier_id, email, address, default_location_id)
select 'Cornwall Cycles', t.id, 'buy@cornwall.test', '2 Harbour Rd, Newquay TR7 1AA', l.id
  from tiers t, locations l where t.name='Club' and l.name='Slough';
update clients set address = '14 Trading Est, Slough SL1 4AB' where name = 'MDI Ltd';

-- Somewhere to keep an id a partner is not supposed to be able to read, so
-- the tests below can try one on. Without it they would be passing an
-- accidental null and proving nothing.
create table if not exists _leaked (what text primary key, id uuid);
grant select, insert, update on _leaked to app_user;
insert into _leaked values
  ('rival_brand', (select id from brands where key = 'rivalbrand'))
on conflict (what) do update set id = excluded.id;
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── Brands are rows, kept in step with what was typed ─────────'
do $$
begin
  perform assert_eq((select count(*)::integer from brands where key = 'drag'), 1,
    'the brand on a product becomes a brand');
  perform assert_eq(
    (select b.key from products p join brands b on b.id = p.brand_id
      where p.sku = 'BP-DRAG-1'), 'drag',
    'and the product points at it');

  -- The same brand typed three ways is one brand, not three.
  insert into products (sku, name, brand) values ('BP-CASE','Case test',' drag ');
  perform assert_eq(
    (select count(*)::integer from brands where key = 'drag'), 1,
    'spelling it differently does not make a second');
  perform assert_eq(
    (select b.key from products p join brands b on b.id = p.brand_id where p.sku='BP-CASE'),
    'drag', 'it lands on the same one');
  delete from products where sku = 'BP-CASE';
end $$;

\echo ''
\echo '───────── Three orders, two clients, both brands ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_corn uuid := (select id from clients where name='Cornwall Cycles');
begin
  perform import_historic_order(v_mdi, (current_date - 40)::date,
    jsonb_build_array(jsonb_build_object('sku','BP-DRAG-1','qty',2,'unit_price',500.00)),
    'BP-A', null);
  perform import_historic_order(v_corn, (current_date - 10)::date,
    jsonb_build_array(jsonb_build_object('sku','BP-DRAG-1','qty',3,'unit_price',500.00),
                      jsonb_build_object('sku','BP-RIVAL-1','qty',1,'unit_price',500.00)),
    'BP-B', null);
  perform import_historic_order(v_mdi, (current_date - 5)::date,
    jsonb_build_array(jsonb_build_object('sku','BP-RIVAL-1','qty',4,'unit_price',500.00)),
    'BP-C', null);
end $$;

\echo ''
\echo '───────── DRAG sees DRAG ─────────'
reset role;
set role app_user;
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
declare r record;
begin
  select * into r from partner_sales_totals((current_date - 90)::date, current_date);
  -- Five frames at 500, costing 300 each: theirs and nobody else's.
  perform assert_eq(r.units, 5, 'five units, which is what their frames sold');
  perform assert_eq(r.sales, 2500.00::numeric, 'the money those took');
  perform assert_eq(r.due_to_brand, 1500.00::numeric, 'and what we owe them for it');
  perform assert_eq(r.distributor_margin, 1000.00::numeric, 'the difference being ours');
  perform assert_eq(r.orders, 2, 'across two orders');
end $$;

\echo ''
\echo '───────── …and cannot see the other brand, however it asks ─────────'
do $$
-- Read from the table above, not from brands: this is a partner who has
-- learned another brand's id somewhere else and is trying it on.
declare v_rival uuid := (select id from _leaked where what = 'rival_brand');
        r record;
begin
  perform assert_eq(v_rival is not null, true,
    'the id being tried really is the other brand''s');
  -- Naming somebody else's brand outright.
  select * into r from partner_sales_totals((current_date - 90)::date, current_date, v_rival);
  perform assert_eq(r.units, 0, 'asking about another brand by id returns nothing');
  perform assert_eq(r.sales, 0::numeric, 'not their revenue');
  perform assert_eq(r.due_to_brand, 0::numeric, 'nor what we owe them');

  perform assert_eq(
    (select count(*)::integer from partner_top_products(
       (current_date - 90)::date, current_date, v_rival, 50)), 0,
    'and no sight of their products');

  -- Passing nothing gets their own brands, never every brand.
  perform assert_eq(
    (select sum(units)::integer from partner_top_products(
       (current_date - 90)::date, current_date, null, 50)), 5,
    'asking about nothing in particular asks about their own');
end $$;

\echo ''
\echo '───────── Nor by reading the tables underneath ─────────'
do $$
begin
  -- The catalogue used to be readable by anyone signed in.
  perform assert_eq(
    (select count(*)::integer from products where sku like 'BP-%'), 2,
    'a partner sees their own two products and not the third');
  perform assert_eq(
    (select count(*)::integer from products where sku = 'BP-RIVAL-1'), 0,
    'the other brand''s product is not there to be found');
  perform assert_eq(
    (select count(*)::integer from brands), 1,
    'and they can see one brand: their own');
  -- Order lines, costs and prices are staff-only and stay that way.
  perform assert_eq((select count(*)::integer from order_lines), 0,
    'order lines are not readable at all');
  perform assert_eq((select count(*)::integer from product_costs), 0,
    'nor what anything costs us');
  perform assert_eq((select count(*)::integer from clients), 0,
    'nor who our customers are');
end $$;

\echo ''
\echo '───────── Where their stock goes, without naming who bought it ─────────'
do $$
begin
  perform assert_eq(
    (select sold from partner_demographics((current_date - 90)::date, current_date)
      where kind = 'tier' and label = 'Distributor'), 2,
    'two went to a distributor');
  perform assert_eq(
    (select sold from partner_demographics((current_date - 90)::date, current_date)
      where kind = 'tier' and label = 'Club'), 3,
    'and three to a club');
  -- One client per area here, so both areas fold together rather than
  -- naming a shop to anyone who knows the trade.
  perform assert_eq(
    (select count(*)::integer from partner_demographics(
       (current_date - 90)::date, current_date) where kind = 'area' and label <> 'Elsewhere'),
    0, 'a region with fewer than three buyers is not shown on its own');
  perform assert_eq(
    (select sold from partner_demographics((current_date - 90)::date, current_date)
      where kind = 'area' and label = 'Elsewhere'), 5,
    'they are added together instead');
end $$;

\echo ''
\echo '───────── A month at a time ─────────'
do $$
declare v_months integer;
begin
  select count(*)::integer into v_months
    from partner_sales_by_month((current_date - 90)::date, current_date);
  perform assert_eq(v_months >= 3, true, 'every month in the range comes back');
  perform assert_eq(
    (select sum(units)::integer from partner_sales_by_month(
       (current_date - 90)::date, current_date)), 5,
    'and the months add up to the total');
end $$;

\echo ''
\echo '───────── Dropshipping ─────────'
do $$
declare v_notice uuid;
begin
  -- BP-DRAG-1 ships from the brand; BP-DRAG-2 and the Rival wheels do not.
  perform assert_eq(
    (select count(*)::integer from partner_dropship_orders()), 2,
    'both orders carrying their drop-shipped frame raise a notice');
  perform assert_eq(
    (select jsonb_array_length(lines) from partner_dropship_orders()
      order by order_date desc limit 1), 1,
    'and the notice lists only the line they ship');
  -- The Rival wheels were on that same order and must not appear on it.
  perform assert_eq(
    (select count(*)::integer from partner_dropship_orders()
      where lines::text like '%RIVAL%'), 0,
    'nothing of the other brand rides along on a shared order');

  select notice_id into v_notice from partner_dropship_orders() limit 1;
  perform mark_dropship_shipped(v_notice, 'DPD', '1234');
  perform assert_eq(
    (select count(*)::integer from partner_dropship_orders()), 1,
    'marking one shipped takes it off the list');
  perform assert_eq(
    (select count(*)::integer from partner_dropship_orders(null, true)), 2,
    'and it is still there when asked for');
end $$;

\echo ''
\echo '───────── The other brand cannot touch that notice ─────────'
reset role;
set role app_user;
set session "test.user_id" = '44444444-4444-4444-4444-444444444444';
do $$
begin
  perform assert_eq(
    (select count(*)::integer from partner_dropship_orders()), 0,
    'a brand that ships nothing has nothing to ship');
  perform assert_eq(
    (select count(*)::integer from dropship_notices), 0,
    'and cannot read a notice belonging to another brand');
end $$;

reset role;
set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_notice uuid := (select id from dropship_notices where not shipped limit 1);
begin
  perform assert_eq(v_notice is not null, true, 'staff can see the notice');
  insert into _leaked values ('drag_notice', v_notice)
  on conflict (what) do update set id = excluded.id;
end $$;

reset role;
set role app_user;
set session "test.user_id" = '44444444-4444-4444-4444-444444444444';
select assert_fails(
  format($$select mark_dropship_shipped(%L, 'X', 'Y')$$,
         (select id from _leaked where what = 'drag_notice')),
  'marking another brand''s box as shipped, knowing its id');

\echo ''
\echo '───────── A signed-in stranger is not a partner ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from my_brand_ids()), 0,
    'a client speaks for no brand');
  perform assert_eq(is_partner(), false, 'and is not a partner');
end $$;
select assert_fails($$select * from partner_sales_totals(current_date, current_date)$$,
  'a client asking a partner question');
