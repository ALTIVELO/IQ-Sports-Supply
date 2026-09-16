-- ============================================================================
-- 10: variants and build-your-own kits.
--
-- The property worth proving is that a group cannot quote a price the
-- catalogue would not honour. Groups hold no prices of their own — every
-- figure comes from the asking client's tier — so the assertions here are
-- mostly about two clients seeing the same build at their own prices, and
-- about an option disappearing the moment the product behind it does.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','rival@othershop.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';

-- A second client on a different tier, to prove pricing follows the asker.
insert into clients (name, tier_id, email, address, default_location_id, auth_user_id)
select 'Rival Cycles', (select id from tiers where name='Retail'), 'rival@othershop.co.uk',
       'Rival address', (select id from locations where name='Slough'),
       '33333333-3333-3333-3333-333333333333';

do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

-- Two tyre sizes and two cassettes, priced on both tiers.
insert into products (sku, name, brand, active) values
  ('GP-700x25','Continental GP5000 700x25','Continental',true),
  ('GP-700x28','Continental GP5000 700x28','Continental',true),
  ('CS-1130','Shimano CS-R8100 11-30T','Shimano',true),
  ('CS-1134','Shimano CS-R8100 11-34T','Shimano',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id,
         case when t.name='Distributor' then 30.00 else 45.00 end,
         current_date
    from products p, tiers t
   where p.sku in ('GP-700x25','GP-700x28','CS-1130','CS-1134');
insert into stock_levels (product_id, location_id, qty)
  select p.id, (select id from locations where name='Slough'), 10
    from products p where p.sku in ('GP-700x25','GP-700x28','CS-1130');

insert into product_groups (slug, name, brand) values
  ('gp5000','Continental GP5000','Continental'),
  ('ultegra-build','Ultegra R8100 build','Shimano');

insert into product_group_steps (group_id, name, qty, sort)
  select id, 'Size', 1, 0 from product_groups where slug='gp5000';
insert into product_group_steps (group_id, name, qty, sort)
  select id, 'Cassette', 1, 0 from product_groups where slug='ultegra-build';
insert into product_group_steps (group_id, name, qty, sort)
  select id, 'Tyres', 2, 1 from product_groups where slug='ultegra-build';

insert into product_group_options (step_id, product_id, label, sort)
  select s.id, p.id, '700x25', 0 from product_group_steps s, products p
   where s.name='Size' and p.sku='GP-700x25';
insert into product_group_options (step_id, product_id, label, sort)
  select s.id, p.id, '700x28', 1 from product_group_steps s, products p
   where s.name='Size' and p.sku='GP-700x28';
insert into product_group_options (step_id, product_id, sort)
  select s.id, p.id, 0 from product_group_steps s, products p
   where s.name='Cassette' and p.sku='CS-1130';
insert into product_group_options (step_id, product_id, sort)
  select s.id, p.id, 1 from product_group_steps s, products p
   where s.name='Cassette' and p.sku='CS-1134';
insert into product_group_options (step_id, product_id, sort)
  select s.id, p.id, 0 from product_group_steps s, products p
   where s.name='Tyres' and p.sku='GP-700x25';
\set QUIET off

set role app_user;

\echo ''
\echo '───────── A client sees the options at their own tier price ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from client_group_options
                      where group_id = (select id from product_groups where slug='gp5000')),
                    2, 'both tyre sizes are offered');
  perform assert_eq((select price from client_group_options
                      where sku='GP-700x25'
                        and group_id=(select id from product_groups where slug='gp5000')),
                    30.00::numeric(12,2), 'priced on the Distributor tier MDI is on');
  perform assert_eq((select label from client_group_options
                      where sku='GP-700x25'
                        and group_id=(select id from product_groups where slug='gp5000')),
                    '700x25', 'and labelled as the size, not the full product name');
  -- No label given, so it falls back to something a customer can read.
  perform assert_eq((select label from client_group_options where sku='CS-1130'),
                    'Shimano CS-R8100 11-30T', 'an unlabelled option reads as the product');
end $$;

\echo ''
\echo '───────── A different tier sees different money, same build ─────────'
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
begin
  perform assert_eq((select price from client_group_options
                      where sku='GP-700x25'
                        and group_id=(select id from product_groups where slug='gp5000')),
                    45.00::numeric(12,2), 'the Retail client sees Retail pricing');
  perform assert_eq((select count(*)::integer from client_group_options
                      where group_id = (select id from product_groups where slug='gp5000')),
                    2, 'from exactly the same group');
end $$;

\echo ''
\echo '───────── Stock is per option, so a size can be out while others are in ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select in_stock from client_group_options
                      where sku='GP-700x25'
                        and group_id=(select id from product_groups where slug='gp5000')),
                    true, 'a stocked size shows as in stock');
  perform assert_eq((select in_stock from client_group_options where sku='CS-1134'), false,
                    'and one we hold none of does not');
end $$;

\echo ''
\echo '───────── One SKU can belong to several groups ─────────'
do $$
begin
  -- The 700x25 tyre is both a size of the tyre group and a component of the
  -- build; nothing should force a product to belong to only one.
  perform assert_eq((select count(distinct group_id)::integer
                       from client_group_options where sku='GP-700x25'),
                    2, 'the same tyre is offered by two different groups');
end $$;

\echo ''
\echo '───────── A build step can need more than one of a thing ─────────'
do $$
begin
  perform assert_eq((select qty from product_group_steps where name='Tyres'), 2,
                    'the build asks for two tyres');
  perform assert_eq(
    (select count(*)::integer from product_group_steps
      where group_id = (select id from product_groups where slug='ultegra-build')),
    2, 'and has two steps, so it reads as a builder rather than a size picker');
end $$;

\echo ''
\echo '───────── An option cannot outlive the product behind it ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
select delete_products(array(select id from products where sku='GP-700x28'));
do $$
begin
  perform assert_eq((select count(*)::integer from product_group_options o
                      join products p on p.id = o.product_id where p.sku='GP-700x28'),
                    0, 'deleting a product takes its option with it');
end $$;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from client_group_options
                      where group_id = (select id from product_groups where slug='gp5000')),
                    1, 'so the customer is not offered a size that no longer exists');
end $$;

\echo ''
\echo '───────── A withdrawn product stops being offerable ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
update products set active = false where sku = 'CS-1130';
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from client_group_options where sku='CS-1130'), 0,
                    'an inactive product drops out of the build');
end $$;

\echo ''
\echo '───────── Only staff may define groups ─────────'
do $$
begin
  perform assert_fails(
    $q$insert into product_groups (slug, name) values ('sneaky','Mine')$q$,
    'a client cannot invent a group');
  -- RLS filters the rows an UPDATE can see rather than raising, so a blocked
  -- write reports success having touched nothing. The value is the assertion.
  update product_group_steps set qty = 99 where name = 'Tyres';
  perform assert_eq((select qty from product_group_steps where name = 'Tyres'), 2,
                    'and cannot change how many of something a build needs');
  update product_group_options set label = 'Free' where label = '700x25';
  perform assert_eq((select count(*)::integer from product_group_options
                      where label = 'Free'), 0,
                    'nor relabel an option to something we never said');
end $$;
