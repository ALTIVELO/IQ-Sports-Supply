-- ============================================================================
-- 29: shipping direct to a shop's own customer.
--
-- A shop sells a groupset and asks us to send it straight to the buyer. It
-- saves a leg of carriage and moves one thing from us to them: we no longer
-- know the address, and nobody here can check it.
--
-- So the claims worth testing are about the record rather than the parcel.
-- A dropship that got as far as being raised must carry the address it is
-- going to, the wording that was accepted, and when — because the moment any
-- of this matters is the moment a parcel is at the wrong door, and "the
-- checkbox was definitely there" is not a record.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

insert into products (sku, name, brand) values ('T-DS-PART', 'A part', 'Shimano');
insert into tier_prices (product_id, tier_id, price, effective_from)
select p.id, t.id, 100.00, current_date
  from products p, tiers t where p.sku = 'T-DS-PART' and t.name = 'Distributor';
insert into stock_levels (product_id, location_id, qty)
select p.id, l.id, 50 from products p, locations l
 where p.sku = 'T-DS-PART' and l.name = 'Slough';

\echo ''
\echo '───────── A. An ordinary order is untouched ─────────'
-- The new arguments are defaulted, so every caller that knew nothing about
-- dropshipping keeps raising the orders it always did.
select place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from products where sku='T-DS-PART'), 'qty', 1)));

do $$
declare o orders%rowtype;
begin
  select * into o from orders order by created_at desc limit 1;
  perform assert_eq(o.dropship, false, 'an order nobody asked to dropship is not one');
  perform assert_eq(o.dropship_terms is null, true, 'and accepts nothing');
  perform assert_eq(o.ship_to is not null, true, 'and still goes somewhere');
end $$;

\echo ''
\echo '───────── B. A direct delivery needs an address and an acceptance ─────────'
do $$
declare
  c uuid := (select id from clients where name='MDI Ltd');
  l uuid := (select id from locations where name='Slough');
  line jsonb := jsonb_build_array(jsonb_build_object(
    'product_id', (select id from products where sku='T-DS-PART'), 'qty', 1));
  before integer := (select count(*)::int from orders);
  said text;
begin
  -- No address. The client's own address book must not be fallen back on:
  -- a saved address is the shop's, and using one would send their customer's
  -- parcel to the shop it came from.
  begin
    perform place_order(c, l, line, null, null, true, null, true);
    said := 'no error';
  exception when others then said := SQLERRM;
  end;
  perform assert_eq(said, 'A direct delivery needs the address it is going to',
    'a direct delivery with no address is refused');

  -- Address, but nothing accepted.
  begin
    perform place_order(c, l, line, null, null, true, E'Ms A Rider\n1 The Street', false);
    said := 'no error';
  exception when others then said := SQLERRM;
  end;
  perform assert_eq(said,
    'The delivery terms have to be accepted before we can ship direct',
    'and one nobody accepted the terms for is refused too');

  perform assert_eq((select count(*)::int from orders), before,
    'neither of them raised an order');
end $$;

\echo ''
\echo '───────── C. One that does carries the whole record ─────────'
select place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from products where sku='T-DS-PART'), 'qty', 2)),
  null, null,
  true,
  E'Ms A Rider\n14 Cavendish Road\nLondon SW12 0BQ',
  true);

do $$
declare
  o orders%rowtype;
  wording text := (select dropship_terms from settings where id = 1);
begin
  select * into o from orders where dropship order by created_at desc limit 1;
  perform assert_eq(o.dropship, true, 'the order says it is a direct delivery');
  perform assert_eq(o.ship_to, E'Ms A Rider\n14 Cavendish Road\nLondon SW12 0BQ',
    'and where it is going');
  perform assert_eq(o.dropship_accepted_at is not null, true, 'and when it was accepted');
  perform assert_eq(o.dropship_accepted_by, '11111111-1111-1111-1111-111111111111',
    'and by whom');
  perform assert_eq(o.dropship_terms, wording, 'and what was accepted, in full');

  -- Not a saved address, and never offered back as one.
  perform assert_eq(o.shipping_address_id is null, true,
    'a customer address is not filed on the shop''s account');
  perform assert_eq(
    (select count(*)::int from client_addresses
      where address like '%Cavendish%'), 0,
    'nor added to their address book');

  -- The timeline is where anybody looks first when a parcel has gone wrong.
  perform assert_eq(
    (select count(*)::int from order_events
      where order_id = o.id and type = 'dropship_accepted'), 1,
    'and the acceptance is on the order''s own timeline');
end $$;

\echo ''
\echo '───────── D. The wording is what was on the screen, not what it says now ─────────'
do $$
declare
  o uuid := (select id from orders where dropship order by created_at desc limit 1);
  was text := (select dropship_terms from orders where id = o);
begin
  update settings set dropship_terms = 'Completely different terms.' where id = 1;
  perform assert_eq((select dropship_terms from orders where id = o), was,
    'editing the terms does not rewrite an order that was already agreed');
  perform assert_eq((select dropship_terms from settings where id = 1),
    'Completely different terms.', 'though the next one will get the new wording');
end $$;

\echo ''
\echo '───────── E. The columns cannot be half filled in ─────────'
do $$
declare ok boolean := false;
begin
  -- Straight at the table, not through place_order: the constraint is what
  -- holds when somebody writes a migration or a fix-up script later.
  begin
    insert into orders (number, client_id, date, fulfilment_location_id, dropship)
    values ('SO-DS-BAD', (select id from clients where name='MDI Ltd'),
            current_date, (select id from locations where name='Slough'), true);
  exception when check_violation then ok := true;
  end;
  perform assert_eq(ok, true, 'a dropship with no address or acceptance cannot exist');
end $$;
