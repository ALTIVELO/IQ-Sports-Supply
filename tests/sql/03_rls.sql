\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportssupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','rival@othershop.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';

-- Two client accounts on different tiers.
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
insert into clients (name, tier_id, email, address, default_location_id, auth_user_id)
select 'Rival Cycles', (select id from tiers where name='Retail'), 'rival@othershop.co.uk',
       'Somewhere', (select id from locations where name='Slough'),
       '33333333-3333-3333-3333-333333333333';

-- An order for MDI only.
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
select place_order((select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object('product_id',(select id from products where sku='BPB05SR25'),'qty',2)));

-- RLS is bypassed for the table owner, so test as a non-superuser role.
drop owned by app_user; -- no-op when the role does not exist yet
drop role if exists app_user;
create role app_user nologin;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant usage on schema auth to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── RLS: a client sees only their own data ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';

do $$
begin
  perform assert_eq((select count(*)::int from clients), 1, 'client sees only their own client record');
  perform assert_eq((select name from clients), 'MDI Ltd', 'and it is theirs');
  perform assert_eq((select count(*)::int from orders), 1, 'client sees only their own orders');
  perform assert_eq((select count(*)::int from invoices), 1, 'client sees only their own invoices');
  perform assert_eq((select count(*)::int from stock_levels), 0, 'client cannot read stock levels at all');
  perform assert_eq((select count(*)::int from purchase_orders), 0, 'client cannot see supplier orders');
  perform assert_eq((select count(*)::int from po_lines), 0, 'client cannot see supplier order lines');
  perform assert_eq((select count(*)::int from email_log), 0, 'client cannot read the outbox');
  perform assert_eq((select count(*)::int from account_requests), 0, 'client cannot read applications');
  perform assert_eq((select count(distinct tier_id)::int from tier_prices), 1, 'client sees exactly one tier of prices');
  perform assert_eq((select t.name from tier_prices tp join tiers t on t.id=tp.tier_id limit 1),
                    'Distributor', 'and it is their own tier');
end $$;

\echo ''
\echo '───────── A client cannot forge an order for someone else ─────────'
do $$
declare rival uuid;
begin
  reset role;
  select id into rival from clients where name='Rival Cycles';
  set local role app_user;
  perform assert_fails(
    format('select place_order(%L, %L, %L::jsonb)', rival,
           (select id from locations limit 1),
           '[{"product_id":"00000000-0000-0000-0000-000000000000","qty":1}]'),
    'client cannot place an order for another client');
end $$;

\echo ''
\echo '───────── A client cannot self-serve a price override ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select place_order(
  (select id from clients where auth_user_id='22222222-2222-2222-2222-222222222222'),
  null,
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',1,'unit_price',0.01))
) as forged \gset
do $$
begin
  perform assert_eq((select unit_price from order_lines
                      where order_id=(select id from orders order by number desc limit 1)),
                    5.40::numeric(12,2), 'submitted price ignored; tier price used');
end $$;

\echo ''
\echo '───────── The client catalogue view exposes availability, never counts ─────────'
do $$
begin
  perform assert_eq((select count(*)::int from client_catalogue), 5, 'catalogue visible to the client');
  perform assert_eq((select in_stock from client_catalogue where sku='BPB05SR25'), true, 'in-stock flag true');
  perform assert_eq((select in_stock from client_catalogue where sku='BBR9100B'), false, 'back-order flag false');
  perform assert_eq((select price from client_catalogue where sku='BPB05SR25'), 5.40::numeric(12,2), 'their tier price only');
end $$;
reset role;
