-- ============================================================================
-- 14: amending, cancelling and crediting an order, and loading past ones.
--
-- These change an order after money and goods have been committed, so the
-- assertions that matter are the refusals: an order that has been paid, packed
-- or sent to a supplier must not be quietly rewritten, and an invoice number
-- that meant one thing must never come to mean another.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk'),
  ('33333333-3333-3333-3333-333333333333','packer@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='ops'   where id='33333333-3333-3333-3333-333333333333';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

insert into products (sku, name, brand, active) values
  ('OA-1','Widget One','Test',true), ('OA-2','Widget Two','Test',true),
  ('OA-3','Widget Three','Test',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 10.00, current_date from products p, tiers t where p.sku like 'OA-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, (select id from locations where name='Slough'), 5
    from products p where p.sku = 'OA-1';
create table placed (n serial primary key, id uuid);
grant select, insert, delete on placed to app_user;
grant usage on sequence placed_n_seq to app_user;
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
insert into placed (id) select place_order(
  (select id from clients where name='MDI Ltd'), null,
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='OA-1'),'qty',8,'unit_price',null),
    jsonb_build_object('product_id',(select id from products where sku='OA-2'),'qty',2,'unit_price',null)),
  null, null);

\echo ''
\echo '───────── Editing replaces the lines and reissues the invoice ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1); v_old text;
begin
  perform assert_eq((select count(*)::integer from order_lines where order_id=v_order), 2,
                    'the order starts with two lines');
  select number into v_old from invoices where order_id=v_order and not superseded;

  perform edit_order(v_order, jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='OA-1'),'qty',3),
    jsonb_build_object('product_id',(select id from products where sku='OA-3'),'qty',4)));

  perform assert_eq((select count(*)::integer from order_lines where order_id=v_order), 2,
                    'still two lines after the edit');
  perform assert_eq((select count(*)::integer from order_lines
                      where order_id=v_order and sku='OA-2'), 0,
                    'the line left out of the edit is gone');
  perform assert_eq((select qty from order_lines where order_id=v_order and sku='OA-1'), 3,
                    'and the one kept has its new quantity');
  -- A price already agreed is not quietly restated at today's list price.
  perform assert_eq((select unit_price from order_lines where order_id=v_order and sku='OA-1'),
                    10.00::numeric(12,2), 'at the price it was placed at');

  perform assert_eq((select count(*)::integer from invoices
                      where order_id=v_order and not superseded and type='full'), 1,
                    'exactly one live invoice');
  perform assert_eq((select number <> v_old from invoices
                      where order_id=v_order and not superseded and type='full'), true,
                    'and it is a new number, not the old one rewritten');
  perform assert_eq((select superseded from invoices where number=v_old), true,
                    'the old invoice is superseded, not deleted');
end $$;

\echo ''
\echo '───────── Stock follows the edit both ways ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1);
begin
  -- 5 on the shelf, 8 ordered, so 5 allocated. Edited down to 3, so 2 go back.
  perform assert_eq((select qty from stock_levels
                      where product_id=(select id from products where sku='OA-1')),
                    2, 'reducing a line puts the difference back on the shelf');
  perform assert_eq((select alloc_qty from order_lines where order_id=v_order and sku='OA-1'),
                    3, 'and the line holds what it needs');
  perform assert_eq((select bo_qty from order_lines where order_id=v_order and sku='OA-3'),
                    4, 'a line we hold none of is entirely on back order');
end $$;

\echo ''
\echo '───────── A proforma for the back order asks for no money ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1); v_pro uuid; v_inv invoices%rowtype;
begin
  v_pro := proforma_for_backorder(v_order);
  select * into v_inv from invoices where id=v_pro;
  perform assert_eq(v_inv.type::text, 'proforma', 'it is a proforma');
  perform assert_eq(v_inv.paid, false, 'not marked paid');
  perform assert_eq(v_inv.due_date, v_inv.date, 'and carries no payment term');
  perform assert_eq((select sum(qty)::integer from invoice_lines where invoice_id=v_pro), 4,
                    'covering exactly what is on back order');
  -- Raising another replaces it rather than leaving two live.
  perform proforma_for_backorder(v_order);
  perform assert_eq((select count(*)::integer from invoices
                      where order_id=v_order and type='proforma' and not superseded),
                    1, 'only ever one live proforma');
end $$;

\echo ''
\echo '───────── A credit note reverses an invoice, in part or whole ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1); v_inv uuid; v_credit uuid;
begin
  select id into v_inv from invoices
   where order_id=v_order and not superseded and type='full';

  v_credit := credit_invoice(v_inv, jsonb_build_array(
    jsonb_build_object('sku','OA-1','qty',1)), 'One arrived damaged');
  perform assert_eq((select type::text from invoices where id=v_credit), 'credit',
                    'a credit note is its own type');
  perform assert_eq((select credit_of from invoices where id=v_credit), v_inv,
                    'and says which invoice it reverses');
  perform assert_eq((select qty from invoice_lines where invoice_id=v_credit), 1,
                    'crediting just the one');
  perform assert_eq((select note from invoices where id=v_credit), 'One arrived damaged',
                    'with the reason kept');

  perform assert_fails(
    format($q$select credit_invoice(%L, jsonb_build_array(jsonb_build_object('sku','OA-1','qty',99)))$q$, v_inv),
    'crediting more than was invoiced is refused');
  perform assert_fails(
    format($q$select credit_invoice(%L)$q$, v_credit),
    'and a credit note cannot itself be credited');
end $$;

\echo ''
\echo '───────── Recording a payment, and what cannot be paid ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1); v_inv uuid; v_pro uuid;
begin
  select id into v_inv from invoices
   where order_id=v_order and not superseded and type='full';
  select id into v_pro from invoices
   where order_id=v_order and not superseded and type='proforma';

  -- A proforma asks for nothing, so settling one would record a payment
  -- against money never demanded — and the real invoice would still be chased.
  perform assert_fails(format($q$select mark_invoice_paid(%L)$q$, v_pro),
                       'a proforma cannot be marked paid');
  perform assert_fails(
    format($q$select mark_invoice_paid(%L, current_date + 1)$q$, v_inv),
    'nor can a payment be dated in the future');
  perform assert_fails(
    format($q$select mark_invoice_paid(%L, date '2020-01-01')$q$, v_inv),
    'nor before the invoice existed');

  -- The date it actually cleared, not the day someone got to the screen. The
  -- invoice is backdated first, because this guard is why it has to be.
  update invoices set date = current_date - 5, due_date = current_date + 25 where id = v_inv;
  perform mark_invoice_paid(v_inv, current_date - 2);
  perform assert_eq((select paid_date from invoices where id=v_inv), current_date - 2,
                    'the payment is recorded on the day it arrived, not today');
  perform assert_eq((select paid from invoices where id=v_inv), true, 'and it reads as paid');
  perform assert_eq((select count(*)::integer from order_events
                      where order_id=v_order and type='payment_received'), 1,
                    'with one payment event against the order');
end $$;

\echo ''
\echo '───────── An order that has moved on cannot be rewritten ─────────'
do $$
declare v_order uuid := (select id from placed order by n limit 1); v_inv uuid;
begin
  select id into v_inv from invoices
   where order_id=v_order and not superseded and type='full';

  perform assert_fails(
    format($q$select edit_order(%L, '[]'::jsonb)$q$, v_order),
    'a paid order cannot be edited');
  perform assert_fails(format($q$select cancel_order(%L)$q$, v_order),
    'nor cancelled — it must be credited instead');
  perform assert_fails(format($q$select delete_order(%L)$q$, v_order),
    'and certainly not deleted');
end $$;

\echo ''
\echo '───────── Cancelling puts the stock back and withdraws the invoices ─────────'
insert into placed (id) select place_order(
  (select id from clients where name='MDI Ltd'), null,
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='OA-1'),'qty',2,'unit_price',null)),
  null, null);
do $$
declare v_order uuid := (select id from placed order by n desc limit 1);
begin
  perform assert_eq((select qty from stock_levels
                      where product_id=(select id from products where sku='OA-1')),
                    0, 'the new order takes the last two off the shelf');
  perform cancel_order(v_order, 'Ordered in error');
  perform assert_eq((select status::text from orders where id=v_order), 'cancelled',
                    'the order is cancelled');
  perform assert_eq((select cancelled_reason from orders where id=v_order), 'Ordered in error',
                    'with the reason recorded');
  perform assert_eq((select qty from stock_levels
                      where product_id=(select id from products where sku='OA-1')),
                    2, 'and the stock is back');
  perform assert_eq((select count(*)::integer from invoices
                      where order_id=v_order and not superseded), 0,
                    'every invoice on it is withdrawn');
  perform assert_fails(format($q$select cancel_order(%L)$q$, v_order),
                       'and it cannot be cancelled twice');
end $$;

\echo ''
\echo '───────── Only an admin may delete, and only an untouched order ─────────'
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
insert into placed (id) select place_order(
  (select id from clients where name='MDI Ltd'), null,
  jsonb_build_array(jsonb_build_object(
    'product_id',(select id from products where sku='OA-2'),'qty',1,'unit_price',null)),
  null, null);
do $$
declare v_order uuid := (select id from placed order by n desc limit 1);
begin
  perform assert_fails(format($q$select delete_order(%L)$q$, v_order),
                       'an ops user cannot delete an order');
end $$;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_order uuid := (select id from placed order by n desc limit 1); v_n text;
begin
  select number into v_n from orders where id=v_order;
  perform delete_order(v_order);
  perform assert_eq((select count(*)::integer from orders where id=v_order), 0,
                    'an admin can delete one that never became anything');
  perform assert_eq((select count(*)::integer from audit_log
                      where entity='order' and action='delete' and detail->>'number'=v_n),
                    1, 'and the number it had is recorded before it goes');
end $$;

\echo ''
\echo '───────── A historic order lands settled, and touches nothing ─────────'
do $$
declare v_order uuid; v_before integer;
begin
  select qty into v_before from stock_levels
   where product_id=(select id from products where sku='OA-1');

  v_order := import_historic_order(
    (select id from clients where name='MDI Ltd'), date '2025-03-14',
    jsonb_build_array(
      jsonb_build_object('sku','OA-1','qty',3,'unit_price',9.50),
      jsonb_build_object('sku','GONE-99','name','Something we no longer list','qty',1,'unit_price',4.00)),
    'LEGACY-4471', 'Imported from the old spreadsheet');

  perform assert_eq((select date from orders where id=v_order), date '2025-03-14',
                    'it keeps the date it actually happened');
  perform assert_eq((select number from orders where id=v_order), 'LEGACY-4471',
                    'and their own reference');
  perform assert_eq((select status::text from orders where id=v_order), 'complete',
                    'landing complete, not open');
  perform assert_eq((select paid from invoices where order_id=v_order), true,
                    'with its invoice already settled');
  perform assert_eq((select date from invoices where order_id=v_order), date '2025-03-14',
                    'dated when it happened, not today');
  perform assert_eq((select sum(bo_qty)::integer from order_lines where order_id=v_order), 0,
                    'nothing on back order, so no supplier order follows');

  perform assert_eq((select qty from stock_levels
                      where product_id=(select id from products where sku='OA-1')),
                    v_before, 'and the shelf is untouched — this already shipped');

  perform assert_eq((select product_id is not null from order_lines
                      where order_id=v_order and sku='OA-1'), true,
                    'a SKU we still list is linked to the catalogue');
  perform assert_eq((select name from order_lines where order_id=v_order and sku='GONE-99'),
                    'Something we no longer list',
                    'and one we do not is still recorded by name');
  perform assert_eq((select unit_price from order_lines where order_id=v_order and sku='OA-1'),
                    9.50::numeric(12,2), 'at what was actually charged, not today''s price');
end $$;

\echo ''
\echo '───────── A historic order is checked before it is taken ─────────'
do $$
declare v_client uuid := (select id from clients where name='MDI Ltd');
begin
  perform assert_fails(
    format($q$select import_historic_order(%L, current_date + 1,
      jsonb_build_array(jsonb_build_object('sku','OA-1','qty',1,'unit_price',1)))$q$, v_client),
    'a date in the future is refused');
  perform assert_fails(
    format($q$select import_historic_order(%L, date '2025-01-01', '[]'::jsonb)$q$, v_client),
    'and an order with no lines');
  perform assert_fails(
    format($q$select import_historic_order(%L, date '2025-01-01',
      jsonb_build_array(jsonb_build_object('sku','OA-1','qty',1)))$q$, v_client),
    'and a line that does not say what was charged');
end $$;

\echo ''
\echo '───────── A client cannot do any of it ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_order uuid := (select id from placed order by n limit 1);
begin
  perform assert_fails(format($q$select cancel_order(%L)$q$, v_order),
                       'a client cannot cancel their own order');
  perform assert_fails(
    format($q$select import_historic_order(%L, date '2025-01-01',
      jsonb_build_array(jsonb_build_object('sku','OA-1','qty',1,'unit_price',0.01)))$q$,
      (select id from clients where name='MDI Ltd')),
    'nor invent history on their account');
end $$;
