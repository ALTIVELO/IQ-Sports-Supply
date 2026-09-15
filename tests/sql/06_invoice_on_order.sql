-- ============================================================================
-- 06: placing an order raises the invoice, and that invoice carries everything
--     the PDF needs.
--
-- The invoice is not a separate step a person has to remember — place_order()
-- raises it in the same transaction as the order, so an order without an
-- invoice is impossible rather than merely unlikely.
--
-- The second half of this suite is the contract invoiceDocData() relies on.
-- That query embeds orders, clients, locations and invoice_lines and reads
-- settings row 1; if any of those is missing or null the PDF route has nothing
-- to render, which is exactly the blank-tab failure this pins down.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iq.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';

do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
-- Held in a table rather than a psql variable: psql does not interpolate
-- :'name' inside a dollar-quoted block, so the do blocks below could not see it.
create table placed (id uuid);
grant select, insert on placed to app_user;
\set QUIET off

\echo ''
\echo '───────── Ordering raises the invoice in the same breath ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';

insert into placed
select place_order(
  (select id from clients where name = 'MDI Ltd'),
  null,
  (select jsonb_agg(jsonb_build_object('product_id', id, 'qty', 3, 'unit_price', null))
     from (select id from products order by sku limit 2) p),
  null, null);

do $$
declare v_order uuid := (select id from placed); v_inv invoices%rowtype; v_days integer;
begin
  select * into v_inv from invoices where order_id = v_order;
  perform assert_eq(found, true, 'placing an order created an invoice');
  perform assert_eq(v_inv.number is not null, true,
                    'the invoice has a number (' || coalesce(v_inv.number,'—') || ')');
  perform assert_eq(v_inv.type::text, 'full', 'raised as a full invoice');
  perform assert_eq(v_inv.paid, false, 'and is unpaid until payment reaches us');

  select payment_days into v_days from settings where id = 1;
  perform assert_eq(v_inv.due_date, current_date + v_days,
                    'due ' || v_days || ' days out (' || v_inv.due_date || ')');

  perform assert_eq(
    (select count(*)::integer from invoice_lines where invoice_id = v_inv.id), 2,
    'every ordered line is on the invoice');

  -- The client must never be billed at a price the browser sent.
  -- invoice_lines carry the sku rather than a product reference, so that
  -- reprinting an old invoice never picks up a renamed or repriced product.
  perform assert_eq(
    (select bool_and(il.unit_price = current_tier_price(p.id, c.tier_id))
       from invoice_lines il
       join products p on p.sku = il.sku
       join clients c on c.name = 'MDI Ltd'
      where il.invoice_id = v_inv.id),
    true, 'billed at tier price, not a price sent from the browser');
end $$;

\echo ''
\echo '───────── The invoice carries everything the PDF reads ─────────'
set role none;
do $$
declare v_order uuid := (select id from placed); r record;
begin
  -- Mirrors the embed in invoiceDocData(): invoices → orders, clients,
  -- locations, invoice_lines, plus settings row 1.
  select i.number, i.type, i.date, i.due_date, i.vat_rate, i.paid,
         o.number as order_number, c.name as client_name, l.name as location_name,
         s.company, s.company_address,
         (select count(*) from invoice_lines il where il.invoice_id = i.id) as lines
    into r
    from invoices i
    join orders o    on o.id = i.order_id
    join clients c   on c.id = i.client_id
    join locations l on l.id = i.location_id
    cross join settings s
   where i.order_id = v_order and s.id = 1;

  perform assert_eq(found, true, 'the whole document query returns a row');
  perform assert_eq(r.order_number is not null, true,
                    'order number for the header (' || r.order_number || ')');
  perform assert_eq(r.client_name is not null, true,
                    'client name to bill (' || r.client_name || ')');
  perform assert_eq(r.location_name is not null, true,
                    'fulfilment site (' || r.location_name || ')');
  perform assert_eq(r.company is not null, true,
                    'our own letterhead (' || r.company || ')');
  perform assert_eq(r.company_address is not null, true, 'and our address');
  perform assert_eq(r.vat_rate is not null, true, 'a VAT rate to total with');
  perform assert_eq(r.lines > 0, true, 'and at least one line to print');
end $$;

\echo ''
\echo '───────── A second order gets its own invoice ─────────'
set role app_user;
select place_order(
  (select id from clients where name = 'MDI Ltd'), null,
  (select jsonb_agg(jsonb_build_object('product_id', id, 'qty', 1, 'unit_price', null))
     from (select id from products order by sku limit 1) p),
  null, null);

do $$
begin
  perform assert_eq((select count(distinct number)::integer from invoices), 2,
                    'two orders, two distinctly numbered invoices');
end $$;
