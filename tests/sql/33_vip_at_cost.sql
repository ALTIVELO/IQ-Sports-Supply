-- ============================================================================
-- 33: VIP, the tier that is our cost price.
--
-- The other four tiers are a number per product per date. VIP is not a number
-- at all — it is whatever the product costs us today — and the whole value of
-- doing it that way is that it cannot go stale. So the claim under test is not
-- "VIP is cheap". It is that VIP tracks the cost without anybody re-pricing
-- anything, that it is read as the cost everywhere a price is read, and that
-- making a customer's price out of a staff-only figure has not opened the
-- costs to anybody who should not see them.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','vip@teamsky.cc'),
  ('33333333-3333-3333-3333-333333333333','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='33333333-3333-3333-3333-333333333333' where name='MDI Ltd';

insert into clients (name, tier_id, email, address, default_location_id, auth_user_id)
select 'Team Sky VIP', (select id from tiers where name='VIP'), 'vip@teamsky.cc',
       'VIP address', (select id from locations where name='Slough'),
       '22222222-2222-2222-2222-222222222222';

-- What the catalogue costs us. Deliberately not a round fraction of any tier
-- price, so a VIP figure that happened to match one of them would be a
-- coincidence worth noticing rather than a pass.
insert into product_costs (product_id, cost, effective_from)
select id, 4.11, current_date - 30 from products where sku='BPB05SR25';
insert into product_costs (product_id, cost, effective_from)
select id, 3.07, current_date - 30 from products where sku='BPL05ARF25';

do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── A. The tier exists and says what it is ─────────'
do $$
declare t tiers%rowtype;
begin
  select * into t from tiers where name = 'VIP';
  perform assert_eq(t.at_cost, true, 'VIP is priced at cost rather than from a list');
  perform assert_eq(t.sort, 0, 'and leads the tiers, being the floor');
  perform assert_eq((select count(*)::int from tiers where at_cost), 1,
    'and it is the only one of its kind');
end $$;

\echo ''
\echo '───────── B. A VIP customer is quoted our cost ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select price from client_catalogue where sku='BPB05SR25'),
                    4.11::numeric, 'the price on their screen is what we paid');
  perform assert_eq((select price from client_catalogue where sku='BPL05ARF25'),
                    3.07::numeric, 'for every product we have costed');
  -- The tier they are on, so a screen can name it.
  perform assert_eq((select t.name from tiers t
                      join client_catalogue c on c.tier_id = t.id
                     where c.sku='BPB05SR25'), 'VIP', 'and the row says which tier that is');
end $$;

\echo ''
\echo '───────── C. A product we have never costed is not free ─────────'
-- The catalogue leaves out what nothing prices, because a missing price would
-- read as nothing to pay. On VIP that means a product with no cost recorded.
do $$
begin
  perform assert_eq((select count(*)::int from client_catalogue where sku='BBR9100B'), 0,
    'an uncosted product is out of the VIP catalogue, not in it at zero');
  perform assert_eq((select count(*)::int from client_catalogue), 2,
    'so a VIP sees only what we know the cost of');
end $$;
reset role;

\echo ''
\echo '───────── D. And charged our cost when they order ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select place_order(
  (select id from clients where name='Team Sky VIP'),
  null,
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',3,
    -- A price of their choosing, ignored exactly as it is on every other tier.
    'unit_price', 0.01))
) as vip_order \gset
do $$
begin
  perform assert_eq((select unit_price from order_lines
                      where order_id=(select id from orders order by created_at desc limit 1)),
                    4.11::numeric, 'the line is priced at cost, not at what was submitted');
end $$;
reset role;

\echo ''
\echo '───────── E. A cost that moves takes VIP with it ─────────'
-- The reason for the flag. Nobody re-prices anything; the next sheet lands and
-- VIP is already right.
insert into product_costs (product_id, cost, effective_from)
select id, 4.55, current_date from products where sku='BPB05SR25';
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select price from client_catalogue where sku='BPB05SR25'),
                    4.55::numeric, 'a new cost is the new VIP price, with nothing re-run');
end $$;
reset role;
do $$
begin
  -- And an order already placed keeps what it was placed at, as every order does.
  perform assert_eq((select unit_price from order_lines
                      where order_id=(select id from orders order by created_at desc limit 1)),
                    4.11::numeric, 'while an order already placed keeps yesterday''s cost');
end $$;

\echo ''
\echo '───────── F. The flag decides, not a stray price list ─────────'
-- Somebody types a VIP figure, or an old import left one. The tier means cost;
-- a tier that sometimes meant cost and sometimes a number would be worse than
-- either, so the row is ignored rather than preferred.
insert into tier_prices (product_id, tier_id, price, effective_from)
select p.id, (select id from tiers where name='VIP'), 999.00, current_date
  from products p where p.sku='BPB05SR25';
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select price from client_catalogue where sku='BPB05SR25'),
                    4.55::numeric, 'a VIP price row is not what VIP means');
end $$;
reset role;
do $$
begin
  perform assert_eq((select price from current_tier_prices(
                       array(select id from products where sku='BPB05SR25')) r
                      join tiers t on t.id = r.tier_id where t.name='VIP'),
                    4.55::numeric, 'and the staff screens are told the same thing');
end $$;

\echo ''
\echo '───────── G. Nobody else is affected ─────────'
set role app_user;
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
begin
  perform assert_eq((select price from client_catalogue where sku='BPB05SR25'),
                    5.40::numeric, 'a distributor still pays the distributor price');
  perform assert_eq((select count(*)::int from client_catalogue), 5,
    'and still sees everything priced on their tier, costed or not');
end $$;

\echo ''
\echo '───────── H. The cost is not readable by anybody else ─────────'
-- The point of the guard. Making a customer price out of a staff-only figure
-- must not make the figure public.
do $$
declare v numeric;
begin
  perform assert_eq((select count(*)::int from product_costs), 0,
    'a client cannot read the cost table at all');

  -- Asking the function about somebody else's tier answers nothing.
  select price into v from tier_rate(
    (select id from products where sku='BPB05SR25'),
    (select id from tiers where name='VIP'));
  perform assert_eq(v is null, true, 'nor the costs through a tier they are not on');

  select price into v from tier_rate(
    (select id from products where sku='BPB05SR25'),
    (select id from tiers where name='Retail'));
  perform assert_eq(v is null, true, 'nor any other tier''s price list');

  select price into v from tier_rate(
    (select id from products where sku='BPB05SR25'),
    (select id from tiers where name='Distributor'));
  perform assert_eq(v, 5.40::numeric, 'only the one they are actually on');
end $$;

\echo ''
\echo '───────── I. A VIP client cannot read beyond what they can buy ─────────'
-- Withdrawn by staff, which is who withdraws things: a client has no write on
-- products at all, and doing it under their role would have left the product
-- active and the assertion passing for the wrong reason.
reset role;
update products set active = false where sku = 'BPL05ARF25';
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v numeric;
begin
  perform assert_eq((select count(*)::int from client_catalogue where sku='BPL05ARF25'), 0,
    'a withdrawn product leaves the VIP catalogue');
  select price into v from tier_rate(
    (select id from products where sku='BPL05ARF25'),
    (select id from tiers where name='VIP'));
  perform assert_eq(v is null, true, 'and its cost is not theirs to ask for either');
end $$;
reset role;
update products set active = true where sku = 'BPL05ARF25';

\echo ''
\echo '───────── J. Staff see every tier, VIP among them ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare n integer;
begin
  select count(*)::int into n from current_tier_prices(
    array(select id from products where sku='BPB05SR25'));
  perform assert_eq(n, 5, 'all five tiers price the product on the staff screen');
  perform assert_eq(
    (select price from tier_rate((select id from products where sku='BPB05SR25'),
                                 (select id from tiers where name='VIP'))),
    4.55::numeric, 'and staff may ask about VIP directly');
end $$;
