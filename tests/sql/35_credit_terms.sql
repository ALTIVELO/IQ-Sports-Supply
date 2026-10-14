-- ============================================================================
-- 35: credit terms, and what a client owes.
--
-- Nothing has ever left the building unpaid. That is the right default and it
-- stays the default — what changes is that an account customer's goods go when
-- the stock is ready rather than when the money arrives.
--
-- The claims: that a client on terms packs unpaid and everybody else still
-- cannot; that the stock rule is untouched, because terms are about money and
-- not about whether the thing is on the shelf; that goods leaving against a
-- promise are written down; and that what they owe is a figure somebody can
-- actually rely on before releasing more.
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

insert into clients (name, tier_id, address, default_location_id)
select 'Cash Only Cycles', (select id from tiers where name='Shop'),
       'Cash address', (select id from locations where name='Slough');

-- Enough on the shelf that nothing here is ever waiting for stock: this suite
-- is about money, and a stock shortage would mask the thing being tested.
insert into stock_levels (product_id, location_id, qty)
select p.id, (select id from locations where name='Slough'), 500 from products p
on conflict (product_id, location_id) do update set qty = 500;

create table ids (k text primary key, v uuid);
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

\echo ''
\echo '───────── A. Without terms, nothing ships before payment ─────────'
insert into ids (k, v) select 'cash', place_order(
  (select id from clients where name='Cash Only Cycles'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',2)));
do $$
declare v_inv uuid;
begin
  select id into v_inv from invoices
   where order_id = (select v from ids where k='cash');
  perform assert_eq((select paid from invoices where id = v_inv), false,
    'the invoice is raised unpaid, as every invoice is');
  perform assert_fails(format('select mark_invoice_packed(%L)', v_inv),
    'and it cannot be packed, which is the rule that has always held');
end $$;

\echo ''
\echo '───────── B. On terms, the goods go and the money follows ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
begin
  -- Already on terms, because the migration put them there: they are the
  -- reason the arrangement exists.
  perform assert_eq((select credit_account from clients where id = v_mdi), true,
    'MDI arrive on terms');
  perform assert_eq(set_client_credit(v_mdi, true), false,
    'and setting what is already set is not a second decision');
  perform assert_eq(set_client_credit(v_mdi, false), true, 'they can be taken off');
  perform assert_eq(set_client_credit(v_mdi, true), true, 'and put back on');
end $$;

insert into ids (k, v) select 'mdi', place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='BPB05SR25'),'qty',10)));
do $$
declare v_inv invoices%rowtype;
begin
  select * into v_inv from invoices where order_id = (select v from ids where k='mdi');
  perform assert_eq(v_inv.paid, false, 'their invoice is unpaid like anybody else''s');
  perform mark_invoice_packed(v_inv.id);
  perform assert_eq((select packed from invoices where id = v_inv.id), true,
    'and it packs anyway, because the account carries the arrangement');
end $$;

\echo ''
\echo '───────── C. Terms are about money, not about the shelf ─────────'
-- An account customer still cannot have what we have not got.
do $$
declare v_inv uuid;
begin
  update stock_levels set qty = 0
   where location_id = (select id from locations where name='Slough');

  insert into ids (k, v) select 'short', place_order(
    (select id from clients where name='MDI Ltd'),
    (select id from locations where name='Slough'),
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where sku='BPB05SR25'),'qty',3)));

  select id into v_inv from invoices where order_id = (select v from ids where k='short');
  perform assert_eq((select ready_to_pack from invoices where id = v_inv), false,
    'nothing on the shelf, so nothing is ready');
  perform assert_fails(format('select mark_invoice_packed(%L)', v_inv),
    'and terms do not conjure stock out of the air');

  update stock_levels set qty = 500
   where location_id = (select id from locations where name='Slough');
end $$;

\echo ''
\echo '───────── D. Goods that left against a promise are written down ─────────'
do $$
declare v_inv invoices%rowtype; n integer; v_owed numeric;
begin
  select * into v_inv from invoices where order_id = (select v from ids where k='mdi');

  select count(*)::int into n from order_events
   where order_id = v_inv.order_id and type = 'packed'
     and (meta->>'on_account')::boolean;
  perform assert_eq(n, 1, 'the order''s own timeline says it went on account');

  select (meta->>'owed_after')::numeric into v_owed from order_events
   where order_id = v_inv.order_id and (meta->>'on_account')::boolean;
  perform assert_eq(v_owed > 0, true, 'with what was owed at the moment it went');

  select count(*)::int into n from audit_log
   where entity = 'invoice' and entity_id = v_inv.id and action = 'packed_on_account';
  perform assert_eq(n, 1, 'and the log has it under the name somebody would search for');
end $$;

\echo ''
\echo '───────── E. What they owe, and what is late ─────────'
do $$
declare r record; v_mdi uuid := (select id from clients where name='MDI Ltd');
begin
  select * into r from client_balances(array[v_mdi]);
  -- Thirteen brake pads over two orders at the distributor price, plus VAT at
  -- twenty: (10 + 3) x 5.40 x 1.2.
  perform assert_eq(r.due, 84.24::numeric, 'the balance is every open invoice, gross');
  perform assert_eq(r.currency, 'GBP', 'in the currency it was invoiced in');
  perform assert_eq(r.invoices, 2, 'counted over the invoices still open');
  perform assert_eq(r.overdue, 0.00::numeric, 'and nothing is late yet');

  -- Thirty days on, the same invoice is late.
  update invoices set due_date = current_date - 1 where client_id = v_mdi and not paid;
  select * into r from client_balances(array[v_mdi]);
  perform assert_eq(r.overdue, r.due, 'once past its date, all of it is late');
end $$;

\echo ''
\echo '───────── F. Paying it clears it ─────────'
do $$
declare v_inv uuid; n integer;
begin
  select id into v_inv from invoices where order_id = (select v from ids where k='mdi');
  update invoices set paid = true, paid_date = current_date where id = v_inv;
  select count(*)::int into n from client_balances(
    array[(select id from clients where name='MDI Ltd')]);
  -- The short order is still open and unpaid, so they still owe for that one.
  perform assert_eq(n, 1, 'a settled invoice is off the account');
  perform assert_eq(
    (select due from client_balances(array[(select id from clients where name='MDI Ltd')])),
    19.44::numeric, 'leaving what is genuinely still outstanding');
end $$;

\echo ''
\echo '───────── G. A credit against an open invoice reduces it ─────────'
do $$
declare v_inv uuid; v_due numeric;
begin
  select id into v_inv from invoices
   where order_id = (select v from ids where k='short') and type <> 'credit';
  -- One of the three credited back.
  perform credit_invoice(v_inv, jsonb_build_array(
    jsonb_build_object('sku','BPB05SR25','qty',1)), 'One short on delivery');

  select due into v_due from client_balances(
    array[(select id from clients where name='MDI Ltd')]);
  perform assert_eq(v_due, 12.96::numeric,
    'what they owe is the invoice less the credit, not the invoice');
end $$;

\echo ''
\echo '───────── H. An agency acknowledgement is not money owed to us ─────────'
-- The brand invoices that customer themselves. Counting it here would show an
-- exposure we do not have and withhold goods over it.
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd'); v_before numeric;
begin
  select due into v_before from client_balances(array[v_mdi]);
  update invoices set agency = true
   where client_id = v_mdi and not paid and type <> 'credit';
  perform assert_eq((select count(*)::int from client_balances(array[v_mdi])), 0,
    'an introduced order is owed to the brand, not to us');
  update invoices set agency = false where client_id = v_mdi and type <> 'credit';
  perform assert_eq((select due from client_balances(array[v_mdi])), v_before,
    'and the figure comes back when it is ours again');
end $$;

\echo ''
\echo '───────── I. Who may put a client on terms ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
begin
  perform assert_fails(
    format('select set_client_credit(%L, false)', v_mdi),
    'the warehouse does not decide who is good for it');
  perform assert_eq((select credit_account from clients where id = v_mdi), true,
    'and the arrangement stands');
end $$;

\echo ''
\echo '───────── J. A client sees their own account and nobody else''s ─────────'
\set QUIET on
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off
set role app_user;
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
declare n integer;
begin
  select count(*)::int into n from client_balances();
  perform assert_eq(n, 1, 'asked about everybody, a client is told about themselves');
  perform assert_eq(
    (select client_id from client_balances()),
    (select id from clients where name='MDI Ltd'), 'and it is their own account');

  select count(*)::int into n from client_balances(
    array[(select id from clients where name='Cash Only Cycles')]);
  perform assert_eq(n, 0, 'another customer''s balance is not theirs to read');
end $$;
reset role;
