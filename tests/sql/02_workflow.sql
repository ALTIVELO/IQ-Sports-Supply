\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'james@iqsportssupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

\echo ''
\echo '───────── A. Placement: allocation, invoice, supplier order ─────────'
select place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='BPB05SR25'), 'qty',5),
    jsonb_build_object('product_id',(select id from products where sku='FCR9200C26'),'qty',5),
    jsonb_build_object('product_id',(select id from products where sku='BBR9100B'),  'qty',4))
) as oid \gset

do $$
declare o uuid := (select id from orders where number='SO-001');
begin
  perform assert_eq((select alloc_qty from order_lines where order_id=o and sku='BPB05SR25'), 5, 'in-stock line fully allocated');
  perform assert_eq((select bo_qty    from order_lines where order_id=o and sku='FCR9200C26'), 3, 'partial line backorders the shortfall');
  perform assert_eq((select alloc_qty from order_lines where order_id=o and sku='FCR9200C26'), 2, 'partial line allocates what exists');
  perform assert_eq((select bo_qty    from order_lines where order_id=o and sku='BBR9100B'), 4, 'zero-stock line fully backorders');
  perform assert_eq((select qty from stock_levels sl join products p on p.id=sl.product_id
                      join locations l on l.id=sl.location_id
                      where p.sku='BPB05SR25' and l.name='Slough'), 15, 'stock decremented at that location');
  perform assert_eq((select number from invoices where order_id=o), 'IQ-2026-003', 'invoice numbering continues from 002');
  perform assert_eq((select count(*)::int from invoice_lines
                      where invoice_id=(select id from invoices where order_id=o)), 3, 'full order invoiced at placement');
  perform assert_eq((select ready_to_pack from invoices where order_id=o), false, 'invoice not packable while short');
  perform assert_eq((select count(*)::int from po_lines where so_reference='SO-001'), 2, 'supplier order raised for the shortfall');
  perform assert_eq((select bool_and(so_reference is not null) from po_lines), true, 'every supplier line carries its SO reference');
end $$;

\echo ''
\echo '───────── B. Supplier order carries no prices or client identity ─────────'
do $$
declare cols text[];
begin
  select array_agg(column_name::text) into cols from information_schema.columns
   where table_name in ('purchase_orders','po_lines');
  perform assert_eq((select bool_or(c ~* 'price|cost|amount|client|customer') from unnest(cols) c),
                    false, 'no price or client column exists on the PO tables');
end $$;

\echo ''
\echo '───────── C. Payment gates dispatch ─────────'
do $$
declare inv uuid := (select id from invoices where number='IQ-2026-003');
begin
  perform assert_fails(format('select mark_invoice_packed(%L)', inv), 'unpaid invoice cannot be packed');
  perform mark_invoice_paid(inv, null, 'manual');
  perform assert_eq((select paid from invoices where id=inv), true, 'invoice marked paid');
  perform assert_fails(format('select mark_invoice_packed(%L)', inv), 'paid but short invoice still cannot be packed');
  perform assert_fails(format('select mark_invoice_shipped(%L, %L, %L, null)', inv, 'DPD', '123'),
                       'unpacked invoice cannot be shipped');
end $$;

\echo ''
\echo '───────── D. Receiving matches by SO reference, surplus to stock ─────────'
select receive_po(
  (select id from purchase_orders where number='PO-001'),
  (select jsonb_agg(jsonb_build_object('po_line_id', id,
           'qty', case when sku='BBR9100B' then 3 else 5 end))
     from po_lines where po_id=(select id from purchase_orders where number='PO-001')),
  '2026-09-20');

do $$
declare o uuid := (select id from orders where number='SO-001');
begin
  perform assert_eq((select bo_qty from order_lines where order_id=o and sku='FCR9200C26'), 0, 'referenced backorder filled');
  perform assert_eq((select alloc_qty from order_lines where order_id=o and sku='FCR9200C26'), 5, 'allocation raised to ordered qty');
  perform assert_eq((select qty from stock_levels sl join products p on p.id=sl.product_id
                      join locations l on l.id=sl.location_id
                      where p.sku='FCR9200C26' and l.name='Slough'), 2, 'surplus became free stock');
  perform assert_eq((select bo_qty from order_lines where order_id=o and sku='BBR9100B'), 1, 'short receipt leaves the remainder on back order');
  perform assert_eq((select received from purchase_orders where number='PO-001'), false, 'PO not complete while a line is short');
  perform assert_eq((select ready_to_pack from invoices where order_id=o), false, 'invoice still held while short');
end $$;

\echo ''
\echo '───────── E. Final receipt releases the order ─────────'
select receive_po(
  (select id from purchase_orders where number='PO-001'),
  (select jsonb_agg(jsonb_build_object('po_line_id', id, 'qty', 1))
     from po_lines where po_id=(select id from purchase_orders where number='PO-001') and sku='BBR9100B'),
  '2026-09-22');

do $$
declare o uuid := (select id from orders where number='SO-001');
        inv uuid := (select id from invoices where number='IQ-2026-003');
begin
  perform assert_eq((select coalesce(sum(bo_qty),0)::int from order_lines where order_id=o), 0, 'nothing left on back order');
  perform assert_eq((select received from purchase_orders where number='PO-001'), true, 'PO now fully received');
  perform assert_eq((select ready_to_pack from invoices where id=inv), true, 'invoice released to the packing queue');
  perform assert_eq((select status::text from orders where id=o), 'complete', 'order marked complete');
  perform mark_invoice_packed(inv);
  perform mark_invoice_shipped(inv, 'DPD', '1234567890', 'https://track.dpd.co.uk/search?reference=1234567890');
  perform assert_eq((select shipped from invoices where id=inv), true, 'shipped with tracking');
end $$;

\echo ''
\echo '───────── F. Client timeline, in order ─────────'
select string_agg(type::text, ' → ' order by created_at, id) as timeline
  from (select distinct on (type) type, created_at, id from order_events
         where order_id=(select id from orders where number='SO-001')
         order by type, created_at) t;
