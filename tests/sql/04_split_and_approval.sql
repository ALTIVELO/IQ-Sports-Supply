\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id,email) values ('11111111-1111-1111-1111-111111111111','james@iq.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
select place_order((select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='BPB05SR25'),'qty',5),
    jsonb_build_object('product_id',(select id from products where sku='FCR9200C26'),'qty',5)));
\set QUIET off

\echo ''
\echo '───────── Invoice split: shipment now, back order dated to availability ─────────'
select split_invoice((select id from orders where number='SO-001'), '2026-10-15');

select number, type, date, due_date, superseded, ready_to_pack from invoices order by number;

do $$
declare o uuid := (select id from orders where number='SO-001');
begin
  perform assert_eq((select superseded from invoices where type='full' and order_id=o), true,
                    'the original full invoice is superseded');
  perform assert_eq((select count(*)::int from invoice_lines
                      where invoice_id=(select id from invoices where type='shipment' and order_id=o)), 2,
                    'shipment invoice covers the allocated lines');
  perform assert_eq((select qty from invoice_lines
                      where invoice_id=(select id from invoices where type='shipment' and order_id=o)
                        and sku='FCR9200C26'), 2, 'shipment invoice bills only what was allocated');
  perform assert_eq((select qty from invoice_lines
                      where invoice_id=(select id from invoices where type='backorder' and order_id=o)
                        and sku='FCR9200C26'), 3, 'backorder invoice bills the shortfall');
  perform assert_eq((select date from invoices where type='backorder' and order_id=o), '2026-10-15'::date,
                    'backorder invoice dated to stock availability');
  perform assert_eq((select due_date from invoices where type='backorder' and order_id=o), '2026-11-14'::date,
                    'and its payment terms run from that date');
  perform assert_eq((select ready_to_pack from invoices where type='shipment' and order_id=o), true,
                    'shipment invoice is immediately packable once paid');
  perform assert_eq((select ready_to_pack from invoices where type='backorder' and order_id=o), false,
                    'backorder invoice waits for stock');
  perform assert_fails(format('select split_invoice(%L, null)', o), 'an order cannot be split twice');
end $$;

\echo ''
\echo '───────── Receiving re-dates the backorder invoice to the actual date ─────────'
select receive_po((select id from purchase_orders where number='PO-001'),
  (select jsonb_agg(jsonb_build_object('po_line_id',id,'qty',3))
     from po_lines where po_id=(select id from purchase_orders where number='PO-001')),
  '2026-10-02');
do $$
declare o uuid := (select id from orders where number='SO-001');
begin
  perform assert_eq((select date from invoices where type='backorder' and order_id=o), '2026-10-02'::date,
                    'backorder invoice re-dated to when stock actually landed');
  perform assert_eq((select ready_to_pack from invoices where type='backorder' and order_id=o), true,
                    'and released for packing');
end $$;

\echo ''
\echo '───────── Trade account approval is the only route to access ─────────'
\set QUIET on
insert into account_requests (company_name, contact_name, email, business_type)
values ('New Bike Shop Ltd','Sam Rider','sam@newbikeshop.co.uk','shop');
\set QUIET off
select approve_account_request(
  (select id from account_requests where company_name='New Bike Shop Ltd'),
  (select id from tiers where name='Shop'),
  (select id from locations where name='Slough'), 'Verified by phone') as new_client \gset

do $$
begin
  perform assert_eq((select status::text from account_requests where company_name='New Bike Shop Ltd'),
                    'approved', 'application marked approved');
  perform assert_eq((select t.name from clients c join tiers t on t.id=c.tier_id
                      where c.name='New Bike Shop Ltd'), 'Shop', 'client created on the chosen tier');
  perform assert_eq((select l.name from clients c join locations l on l.id=c.default_location_id
                      where c.name='New Bike Shop Ltd'), 'Slough', 'with the chosen default site');
  perform assert_eq((select auth_user_id is null from clients where name='New Bike Shop Ltd'), true,
                    'no portal access until they actually sign in');
  perform assert_fails(
    format('select approve_account_request(%L,%L,%L,null)',
      (select id from account_requests where company_name='New Bike Shop Ltd'),
      (select id from tiers limit 1), (select id from locations limit 1)),
    'an application cannot be approved twice');
end $$;

\echo ''
\echo '───────── Signing up links the approved client automatically ─────────'
\set QUIET on
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','sam@newbikeshop.co.uk');
\set QUIET off
do $$
begin
  perform assert_eq((select auth_user_id from clients where name='New Bike Shop Ltd'),
                    '44444444-4444-4444-4444-444444444444'::uuid, 'client linked to their auth user on signup');
  perform assert_eq((select role::text from profiles where id='44444444-4444-4444-4444-444444444444'),
                    'client', 'new users default to the client role');
end $$;
