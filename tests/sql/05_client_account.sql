\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iq.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','rival@othershop.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
insert into clients (name, tier_id, email, address, default_location_id, auth_user_id)
select 'Rival Cycles', (select id from tiers where name='Retail'), 'rival@othershop.co.uk',
       'Rival address', (select id from locations where name='Slough'),
       '33333333-3333-3333-3333-333333333333';
insert into client_addresses (client_id, label, address, is_default)
select id, 'Rival warehouse', 'Somewhere else', true from clients where name='Rival Cycles';

do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── A client may correct their own details ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select update_my_client_details('MDI Ltd','Mike Dixon Imports','Dave Dixon',
  'dave@mikedixonimports.co.uk','01253 123456','618 6837 06','04729183',
  'GB618683706000','Unit 4 Wellington Point','Accounts, PO Box 12');
do $$
begin
  perform assert_eq((select trading_name from clients where name='MDI Ltd'),
                    'Mike Dixon Imports', 'trading name saved');
  perform assert_eq((select eori_no from clients where name='MDI Ltd'),
                    'GB618683706000', 'EORI saved');
  perform assert_eq((select invoicing_address from clients where name='MDI Ltd'),
                    'Accounts, PO Box 12', 'invoicing address saved');
end $$;

\echo ''
\echo '───────── …but not the things that decide what they pay ─────────'
-- Row level security filters an UPDATE rather than refusing it, so a blocked
-- write reports success having changed nothing. The assertion has to be about
-- the value afterwards, not about whether the statement raised.
do $$
declare mdi uuid; tier_before uuid; tier_after uuid; vat_after boolean; name_after text;
begin
  reset role;
  select id, tier_id into mdi, tier_before from clients where name='MDI Ltd';
  set local role app_user;

  -- tier_id alone decides every price this client sees, so this is the write
  -- that matters most.
  update clients set tier_id = (select id from tiers where name='Retail') where id = mdi;
  update clients set vat_exempt = true where id = mdi;
  update clients set active = false, name = 'hijacked' where id = mdi;

  reset role;
  select tier_id, vat_exempt, name into tier_after, vat_after, name_after
    from clients where id = mdi;
  set local role app_user;

  perform assert_eq(tier_after, tier_before, 'pricing tier unchanged by a direct write');
  perform assert_eq(vat_after, false,        'VAT exemption unchanged by a direct write');
  perform assert_eq(name_after, 'MDI Ltd',   'the row was not written at all');
end $$;

\echo ''
\echo '───────── Shipping addresses are per account ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
insert into client_addresses (client_id, label, address, is_default)
values (my_client_id(), 'Shop', '1 High Street', true);
insert into client_addresses (client_id, label, address)
values (my_client_id(), 'Warehouse', 'Unit 9 Trading Estate');

do $$
begin
  perform assert_eq((select count(*)::int from client_addresses), 3,
                    'sees their own addresses and the seeded one, not the rival''s');
  perform assert_eq((select count(*)::int from client_addresses where is_default), 1,
                    'exactly one default');
  perform assert_eq((select label from client_addresses where is_default), 'Shop',
                    'the newest default won, the old one was cleared');
end $$;

\echo ''
\echo '───────── An order cannot be shipped to another account''s address ─────────'
do $$
declare rival_addr uuid; mdi uuid; prod uuid; loc uuid;
begin
  reset role;
  select id into rival_addr from client_addresses where label='Rival warehouse';
  select id into mdi from clients where name='MDI Ltd';
  select id into prod from products where sku='BPB05SR25';
  select id into loc from locations where name='Slough';
  set local role app_user;
  perform assert_fails(
    format('select place_order(%L,%L,%L::jsonb,null,%L)', mdi, loc,
           format('[{"product_id":"%s","qty":1}]', prod), rival_addr),
    'an address belonging to another client is refused');
end $$;

\echo ''
\echo '───────── The chosen address is snapshotted onto the order ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
select place_order(
  my_client_id(),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',2)),
  null,
  (select id from client_addresses where label='Warehouse'));

do $$
declare o orders%rowtype;
begin
  select * into o from orders order by number desc limit 1;
  perform assert_eq(o.ship_to, 'Unit 9 Trading Estate', 'order records where it is going');
  perform assert_eq((select label from client_addresses where id = o.shipping_address_id),
                    'Warehouse', 'and which address was chosen');
end $$;

\echo ''
\echo '───────── Editing the address later does not rewrite past orders ─────────'
update client_addresses set address = 'Unit 12 New Estate' where label='Warehouse';
do $$
begin
  perform assert_eq((select ship_to from orders order by number desc limit 1),
                    'Unit 9 Trading Estate',
                    'the despatched order still shows where it actually went');
end $$;
reset role;
