-- ============================================================================
-- 36: a parcel each, and a tracking number that can be corrected.
--
-- An invoice carried one carrier and one number, written once and never again.
-- Three wheels and a groupset is three parcels, and a number typed at the
-- counter is typed by a person.
--
-- What has to hold: the parcels are a list; the invoice's own three columns go
-- on meaning the first of them, because everything written before today reads
-- those; an admin can correct one and the old value survives in the log; and
-- nobody can leave a shipped invoice with no tracking number at all.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','warehouse@iqsportsupply.com'),
  ('33333333-3333-3333-3333-333333333333','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='ops'   where id='22222222-2222-2222-2222-222222222222';
update clients set auth_user_id='33333333-3333-3333-3333-333333333333' where name='MDI Ltd';
insert into stock_levels (product_id, location_id, qty)
select p.id, (select id from locations where name='Slough'), 500 from products p
on conflict (product_id, location_id) do update set qty = 500;
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

create table ids (k text primary key, v uuid);
grant select on ids to app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

insert into ids (k, v) select 'order', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',3)));
insert into ids (k, v)
select 'inv', id from invoices where order_id = (select v from ids where k='order');
\set QUIET off

\echo ''
\echo '───────── A. The first parcel is what ships the invoice ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv'); r invoices%rowtype;
begin
  perform mark_invoice_packed(v_inv);
  perform mark_invoice_shipped(v_inv, 'DPD', '15501234567890', 'https://track/1');

  select * into r from invoices where id = v_inv;
  perform assert_eq(r.shipped, true, 'the invoice has shipped');
  perform assert_eq(r.tracking_number, '15501234567890',
    'and its own column still carries the number the email quoted');
  perform assert_eq(r.carrier, 'DPD', 'and the carrier');
  perform assert_eq((select count(*)::int from shipments where invoice_id = v_inv), 1,
    'as one parcel on the list');
end $$;

\echo ''
\echo '───────── B. A second box, and a third ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv'); n integer; r invoices%rowtype;
begin
  perform add_shipment(v_inv, 'DPD', '15501234567891', 'https://track/2');
  perform add_shipment(v_inv, 'Parcelforce', 'PF998877', null);

  select count(*)::int into n from shipments where invoice_id = v_inv;
  perform assert_eq(n, 3, 'three parcels on one invoice');

  -- The thing that stops every older screen and email breaking.
  select * into r from invoices where id = v_inv;
  perform assert_eq(r.tracking_number, '15501234567890',
    'and the invoice still points at the first of them, not the latest');

  perform assert_eq(
    (select array_agg(tracking_number order by shipped_at, seq)
       from shipments where invoice_id = v_inv),
    array['15501234567890','15501234567891','PF998877'],
    'listed in the order they went');
end $$;

\echo ''
\echo '───────── C. The same number twice is a slip, not a parcel ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv');
begin
  perform assert_fails(
    format('select add_shipment(%L, ''DPD'', ''15501234567891'')', v_inv),
    'the same tracking number cannot go on twice');
  perform assert_fails(
    format('select add_shipment(%L, ''DPD'', ''   '')', v_inv),
    'and a parcel needs a number, not a space');
  perform assert_fails(
    format('select add_shipment(%L, '''', ''ABC123'')', v_inv),
    'and a carrier');
end $$;

\echo ''
\echo '───────── D. An admin corrects one, and the old value survives ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv'); v_s uuid; n integer;
begin
  select id into v_s from shipments
   where invoice_id = v_inv and tracking_number = 'PF998877';
  perform update_shipment(v_s, 'Parcelforce', 'PF998878', 'https://pf/998878');

  perform assert_eq((select tracking_number from shipments where id = v_s), 'PF998878',
    'the number is corrected');

  select count(*)::int into n from audit_log
   where entity = 'invoice' and entity_id = v_inv and action = 'tracking_changed'
     and detail->>'was' = 'PF998877' and detail->>'now' = 'PF998878';
  perform assert_eq(n, 1, 'and what it used to be is in the log, which is the point');

  select count(*)::int into n from order_events
   where order_id = (select v from ids where k='order') and type = 'tracking_changed'
     and meta->>'was' = 'PF998877';
  perform assert_eq(n, 1, 'and on the order, where somebody answering the phone looks');
end $$;

\echo ''
\echo '───────── E. Correcting the first one moves what the invoice says ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv'); v_s uuid;
begin
  select id into v_s from shipments
   where invoice_id = v_inv and tracking_number = '15501234567890';
  perform update_shipment(v_s, 'DPD', '15509999999999', 'https://track/fixed');

  perform assert_eq((select tracking_number from invoices where id = v_inv),
    '15509999999999', 'a typo in the first parcel is fixed everywhere it is read');
  perform assert_eq((select tracking_url from invoices where id = v_inv),
    'https://track/fixed', 'link and all');
end $$;

\echo ''
\echo '───────── F. A parcel added in error comes off ─────────'
do $$
declare v_inv uuid := (select v from ids where k='inv'); v_s uuid; n integer;
begin
  select id into v_s from shipments where invoice_id = v_inv and tracking_number = 'PF998878';
  perform remove_shipment(v_s);
  select count(*)::int into n from shipments where invoice_id = v_inv;
  perform assert_eq(n, 2, 'and the list is shorter');
end $$;

\echo ''
\echo '───────── G. But never the last one ─────────'
-- A shipped invoice with no tracking number at all is a worse record than one
-- with the wrong number, and the wrong number is a button away from right.
do $$
declare v_inv uuid := (select v from ids where k='inv'); v_s uuid;
begin
  select id into v_s from shipments where invoice_id = v_inv and tracking_number <> '15509999999999';
  perform remove_shipment(v_s);
  select id into v_s from shipments where invoice_id = v_inv;
  perform assert_fails(format('select remove_shipment(%L)', v_s),
    'the only tracking number on a shipped invoice cannot be taken off');
  perform assert_eq((select count(*)::int from shipments where invoice_id = v_inv), 1,
    'so it is still there');
end $$;

\echo ''
\echo '───────── H. Who may do what ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_inv uuid := (select v from ids where k='inv'); v_s uuid;
begin
  -- Adding a parcel is shipping, and shipping is what the warehouse does.
  perform add_shipment(v_inv, 'Evri', 'H00OPS001');
  perform assert_eq((select count(*)::int from shipments where invoice_id = v_inv), 2,
    'the warehouse can put another box on an order');

  select id into v_s from shipments where tracking_number = 'H00OPS001';
  perform assert_fails(
    format('select update_shipment(%L, ''Evri'', ''H00OPS002'')', v_s),
    'but changing a number a customer has been given is an admin''s');
  perform assert_fails(format('select remove_shipment(%L)', v_s),
    'and so is taking one off');
end $$;

\echo ''
\echo '───────── I. The customer sees every parcel, and only their own ─────────'
set role app_user;
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
declare n integer;
begin
  select count(*)::int into n from shipments;
  perform assert_eq(n, 2, 'both parcels of their own order are theirs to see');
end $$;
reset role;
-- Back to the admin: resetting the role leaves the session still naming the
-- customer, and a customer cannot place an order for somebody else.
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

do $$
declare v_other uuid; n integer;
begin
  -- Somebody else's invoice, with a parcel on it.
  insert into clients (name, tier_id, address, default_location_id)
  select 'Other Cycles', (select id from tiers where name='Shop'), 'Elsewhere',
         (select id from locations where name='Slough');
  insert into ids (k, v) select 'other', place_order(
    (select id from clients where name='Other Cycles'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',1)));
  select id into v_other from invoices where order_id = (select v from ids where k='other');
  -- Not on terms, so they pay before anything moves — which is still the rule.
  update invoices set paid = true, paid_date = current_date where id = v_other;
  perform mark_invoice_packed(v_other);
  perform mark_invoice_shipped(v_other, 'DHL', 'DHL123456');
end $$;

set role app_user;
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
begin
  perform assert_eq((select count(*)::int from shipments), 2,
    'and another customer''s parcels are not');
end $$;
reset role;
