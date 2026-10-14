-- ============================================================================
-- 34: a line that is not in the catalogue.
--
-- A wheel build, a frame brought in for one customer, a carriage charge. Typed
-- at the counter: a description, a price and a quantity, belonging to the
-- order it was typed on and to nothing else.
--
-- Four things worth holding down. That it is charged what was typed and
-- appears on the invoice. That it does not pretend to be stock — nothing
-- allocated out of a shelf it is not on, and no supplier order raised for a
-- part number that does not exist. That a customer cannot send one, because a
-- customer sending a name and a price of their own is a customer setting what
-- they pay. And that amending the order does not quietly delete it, which is
-- the failure that would be found months later on an invoice nobody could
-- explain.
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
-- The order ids are kept in a table rather than psql variables: psql does not
-- substitute inside a dollar-quoted body, which is where every one is read.
create table ids (k text primary key, v uuid);
grant select on ids to app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

\echo ''
\echo '───────── A. Typed, priced, and on the order ─────────'
insert into ids (k, v) select 'mixed', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('name','Hand-built wheel, Vision rim on DT240',
                       'sku','WHEELBUILD','qty',2,'unit_price',185.00),
    jsonb_build_object('product_id',(select id from products where sku='BPB05SR25'),
                       'qty',1))
);
do $$
declare l order_lines%rowtype;
begin
  select * into l from order_lines
   where order_id = (select v from ids where k='mixed') and product_id is null;

  perform assert_eq(l.name, 'Hand-built wheel, Vision rim on DT240',
    'the description is what was typed, and is what the customer reads');
  perform assert_eq(l.sku, 'WHEELBUILD', 'with the reference given for it');
  perform assert_eq(l.qty, 2, 'the quantity typed');
  perform assert_eq(l.unit_price, 185.00::numeric, 'at the price typed, per unit');
end $$;

\echo ''
\echo '───────── B. It is on the invoice, at that price ─────────'
do $$
declare v_inv uuid;
begin
  select id into v_inv from invoices where order_id = (select v from ids where k='mixed');
  perform assert_eq(
    (select unit_price from invoice_lines
      where invoice_id = v_inv and name like 'Hand-built%'),
    185.00::numeric, 'the invoice carries it at what was agreed');
  perform assert_eq(
    (select sum(qty * unit_price) from invoice_lines where invoice_id = v_inv),
    375.40::numeric, 'and the invoice totals both kinds of line together');
end $$;

\echo ''
\echo '───────── C. It does not pretend to be stock ─────────'
do $$
declare l order_lines%rowtype; n integer;
begin
  select * into l from order_lines
   where order_id = (select v from ids where k='mixed') and product_id is null;
  perform assert_eq(l.alloc_qty, 2, 'a typed line is satisfied in full');
  perform assert_eq(l.bo_qty, 0, 'and is never on back order');

  -- The thing that would send the warehouse looking for a part number that
  -- does not exist.
  select count(*)::int into n from po_lines where order_id = (select v from ids where k='mixed')
    and sku = 'WHEELBUILD';
  perform assert_eq(n, 0, 'and raises no supplier order for something with no part number');

  -- Nor did it take anything off a shelf it was never on.
  perform assert_eq((select count(*)::int from stock_levels where product_id is null), 0,
    'and no stock row was invented for it');
end $$;

\echo ''
\echo '───────── D. A description and a price are what make one ─────────'
do $$
declare v_client uuid := (select id from clients where name='MDI Ltd');
        v_loc uuid := (select id from locations where name='Slough');
begin
  perform assert_fails(format(
    'select place_order(%L, %L, jsonb_build_array('
    || 'jsonb_build_object(''qty'',1,''unit_price'',10)))',
    v_client, v_loc), 'a line with nothing written on it is refused');

  perform assert_fails(format(
    'select place_order(%L, %L, jsonb_build_array('
    || 'jsonb_build_object(''name'',''A thing'',''qty'',1)))',
    v_client, v_loc), 'and one with no price, because there is no catalogue to read one from');

  perform assert_fails(format(
    'select place_order(%L, %L, jsonb_build_array(jsonb_build_object('
    || '''name'',''A thing'',''qty'',1,''unit_price'',-5)))',
    v_client, v_loc), 'nor can a line be priced below nothing');
end $$;

\echo ''
\echo '───────── E. Nothing at all is a price somebody might mean ─────────'
-- A replacement sent out at no charge still belongs on the order and on the
-- invoice, at zero. That is not the same as leaving the price blank.
insert into ids (k, v) select 'freebie', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'name','Replacement cage bolt, goodwill','qty',1,'unit_price',0)));
do $$
begin
  perform assert_eq((select unit_price from order_lines where order_id = (select v from ids where k='freebie')),
                    0.00::numeric, 'a line at no charge is a line, not an error');
end $$;

\echo ''
\echo '───────── F. A customer cannot type their own price ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_client uuid := (select id from clients where name='MDI Ltd');
begin
  perform assert_fails(format(
    'select place_order(%L, null, jsonb_build_array(jsonb_build_object('
    || '''name'',''A frame, I reckon'',''qty'',1,''unit_price'',1.00)))',
    v_client), 'a basket cannot send a line of its own invention');
end $$;
reset role;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── G. An order of nothing but typed lines ─────────'
-- The case that would have kept the sterling default and put the wrong symbol
-- on a euro invoice, because no product line was there to set it.
insert into ids (k, v) select 'euros', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'name','Carriage, Italy','qty',1,'unit_price',60.00,'currency','EUR')));
do $$
begin
  perform assert_eq((select currency from orders where id = (select v from ids where k='euros')), 'EUR',
    'the first typed line says what the order is in');
  perform assert_eq((select currency from invoices where order_id = (select v from ids where k='euros')), 'EUR',
    'and the invoice is a demand in that currency');
end $$;

\echo ''
\echo '───────── H. Amending the order does not delete it ─────────'
-- The failure that would surface months later, on an invoice nobody could
-- explain: a wheel build gone from an order amended to change a tube.
do $$
declare v_line uuid; v_prod uuid; n integer;
begin
  select id into v_line from order_lines
   where order_id = (select v from ids where k='mixed') and product_id is null;
  select id into v_prod from products where sku='BPB05SR25';

  perform edit_order((select v from ids where k='mixed'), jsonb_build_array(
    jsonb_build_object('product_id', v_prod, 'qty', 4),
    jsonb_build_object('line_id', v_line, 'qty', 2)));

  select count(*)::int into n from order_lines
   where order_id = (select v from ids where k='mixed') and product_id is null;
  perform assert_eq(n, 1, 'the typed line is still on the order after an edit');
  perform assert_eq(
    (select name from order_lines where order_id = (select v from ids where k='mixed') and product_id is null),
    'Hand-built wheel, Vision rim on DT240', 'with the description it was given');
  perform assert_eq(
    (select unit_price from order_lines where order_id = (select v from ids where k='mixed') and product_id is null),
    185.00::numeric, 'and the price that was agreed, not re-read from anywhere');
  perform assert_eq(
    (select qty from order_lines where order_id = (select v from ids where k='mixed') and product_id = v_prod),
    4, 'while the catalogue line took the change that was asked for');
end $$;

\echo ''
\echo '───────── I. And it can be taken off, like any other line ─────────'
do $$
declare v_prod uuid := (select id from products where sku='BPB05SR25');
        n integer;
begin
  perform edit_order((select v from ids where k='mixed'), jsonb_build_array(
    jsonb_build_object('product_id', v_prod, 'qty', 4)));
  select count(*)::int into n from order_lines
   where order_id = (select v from ids where k='mixed') and product_id is null;
  perform assert_eq(n, 0, 'left out of the edit, it is off the order');

  -- And a line that is not on this order cannot be smuggled on to it.
  perform assert_fails(format(
    'select edit_order(%L, jsonb_build_array(jsonb_build_object(''line_id'', %L, ''qty'', 1)))',
    (select v from ids where k='mixed'), gen_random_uuid()),
    'an id that is not a line of this order is refused');
end $$;
