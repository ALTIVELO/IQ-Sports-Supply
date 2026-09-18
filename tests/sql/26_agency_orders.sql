-- ============================================================================
-- 26: the orders where IQ is not the seller.
--
-- DRAG is introduced, not resold: DRAG confirms the order, raises the final
-- invoice with shipping and taxes on it, ships it, and carries the warranty
-- and the product liability. What has to be true is therefore not "a note is
-- printed somewhere" but that the note cannot go missing and cannot be wrong.
--
-- So: the terms are stamped on every order for such a brand, whatever raised
-- it; they are a snapshot, so re-wording the arrangement never rewrites what
-- a customer was already told; and an order can never hold both our goods and
-- an introduced brand's, because one invoice cannot come from two companies.
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

-- One bike we introduce, one component we sell. Both priced and in stock, so
-- nothing below can fail for a reason that has nothing to do with agency.
insert into products (sku, name, brand, currency, active) values
  ('AG-BIKE','Introduced road bike 56cm','DRAG','EUR',true),
  ('AG-BIKE2','Introduced road bike 54cm','DRAG','EUR',true),
  ('AG-PART','Our own bottom bracket','Test','EUR',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 1000.00, current_date - 400 from products p, tiers t
   where p.sku like 'AG-%';
insert into stock_levels (product_id, location_id, qty)
  select p.id, l.id, 20 from products p, locations l where p.sku like 'AG-%';

create table if not exists _ids (what text primary key, id uuid);
grant select, insert, update on _ids to app_user;
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── DRAG arrives already disclosed ─────────'
do $$
begin
  -- The brand row is created by the product sync when the catalogue is
  -- imported; the migration claims the key first so the terms are waiting.
  perform assert_eq((select agency from brands where key='drag'), true,
    'DRAG is a brand we introduce');
  perform assert_eq(
    (select agency_terms is not null and length(agency_terms) > 80
       from brands where key='drag'), true,
    'and it arrives with something to tell the customer');
  -- Every claim the arrangement rests on, present in the words themselves.
  perform assert_eq(
    (select agency_terms like '%final invoice%' from brands where key='drag'), true,
    'which says the final invoice is theirs');
  perform assert_eq(
    (select agency_terms like '%commission%' from brands where key='drag'), true,
    'that we are paid a commission');
  perform assert_eq(
    (select agency_terms like '%not the seller%' from brands where key='drag'), true,
    'that we are not the seller');
  perform assert_eq(
    (select agency_terms like '%product%liability%' from brands where key='drag'), true,
    'and that the liability is theirs');
  -- Our own brands are untouched by any of this.
  perform assert_eq((select agency from brands where key='shimano'), false,
    'a brand we actually sell is not marked as introduced');
end $$;

\echo ''
\echo '───────── An order for one is stamped with the terms ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
begin
  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 1)
  ), null);
  insert into _ids values ('drag_order', v_order) on conflict (what) do update set id = excluded.id;

  perform assert_eq(
    (select agent_brand_id = (select id from brands where key='drag')
       from orders where id = v_order), true,
    'the order knows whose it is');
  perform assert_eq(
    (select o.agency_terms = b.agency_terms
       from orders o, brands b where o.id = v_order and b.key='drag'), true,
    'and carries the wording, not a pointer to it');
end $$;

\echo ''
\echo '───────── An order for our own goods is stamped with nothing ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
begin
  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-PART'), 'qty', 1)
  ), null);
  perform assert_eq((select agency_terms is null from orders where id = v_order), true,
    'no disclosure on an order we are the seller of');
  perform assert_eq((select agent_brand_id is null from orders where id = v_order), true,
    'and nobody else is named on it');
end $$;

\echo ''
\echo '───────── One invoice cannot come from two companies ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
begin
  -- The wall behind the basket split. Whatever raised it — the desk, a
  -- script, psql — an order holding both is refused outright.
  perform assert_fails(format(
    $f$select place_order(%L, null, %L::jsonb, null)$f$, v_mdi,
    jsonb_build_array(
      jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 1),
      jsonb_build_object('product_id', (select id from products where sku='AG-PART'), 'qty', 1))),
    'an order mixing our goods with a brand we only introduce');

  -- And in the other order, because a rule that only holds one way round is
  -- a rule about which line happened to be keyed first.
  perform assert_fails(format(
    $f$select place_order(%L, null, %L::jsonb, null)$f$, v_mdi,
    jsonb_build_array(
      jsonb_build_object('product_id', (select id from products where sku='AG-PART'), 'qty', 1),
      jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 1))),
    'the same order keyed the other way round');
end $$;

\echo ''
\echo '───────── Two of the same brand are one order ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
begin
  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 1),
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE2'), 'qty', 1)
  ), null);
  perform assert_eq((select count(*)::integer from order_lines where order_id = v_order), 2,
    'two bikes from one brand sit on one order');
  perform assert_eq((select agency_terms is not null from orders where id = v_order), true,
    'still disclosed');
end $$;

\echo ''
\echo '───────── Amending an agency order cannot smuggle our goods onto it ─────────'
do $$
declare v_order uuid := (select id from _ids where what = 'drag_order');
begin
  perform assert_fails(format(
    $f$insert into order_lines (order_id, product_id, sku, name, qty, unit_price,
                                alloc_qty, bo_qty)
       select %L, id, sku, name, 1, 10, 0, 1 from products where sku = 'AG-PART'$f$,
    v_order),
    'adding one of our own lines to an introduced order');
end $$;

\echo ''
\echo '───────── Re-wording the arrangement never rewrites an old order ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_old uuid := (select id from _ids where what = 'drag_order');
        v_new uuid;
begin
  update brands set agency_terms = 'Everything about this has changed.'
   where key = 'drag';

  perform assert_eq(
    (select agency_terms like 'Everything about this%' from orders where id = v_old), false,
    'an order placed under the old terms still says the old terms');

  v_new := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 1)
  ), null);
  perform assert_eq(
    (select agency_terms from orders where id = v_new), 'Everything about this has changed.',
    'while the next order placed gets the new ones');
end $$;

\echo ''
\echo '───────── What a client may read about it ─────────'
reset role;
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  -- The basket has to warn before anything is placed, and a client cannot
  -- read the brands table: it holds the consignment arrangements. RLS hides
  -- the rows rather than refusing the query, so the claim to test is that
  -- nothing comes back, not that it errors.
  perform assert_eq((select count(*)::integer from brands), 0,
    'a client reading the brands table sees no brand at all');
  perform assert_eq((select count(*)::integer from agency_brands()), 1,
    'but they can be told which brands we only introduce');
  perform assert_eq((select name from agency_brands()), 'DRAG',
    'by name');
  perform assert_eq(
    (select terms = 'Everything about this has changed.' from agency_brands()), true,
    'with the wording they will be shown');
end $$;

\echo ''
\echo '───────── The document behind one asks for nothing ─────────'
reset role;
set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
        v_inv invoices%rowtype;
begin
  update brands set commission_rate = 7.5 where key = 'drag';

  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE'), 'qty', 2)
  ), null);
  insert into _ids values ('acct_order', v_order) on conflict (what) do update set id = excluded.id;

  select * into v_inv from invoices where order_id = v_order and not superseded;

  perform assert_eq(v_inv.agency, true,
    'the invoice knows it is not a sale of ours');
  -- 20% on a euro price DRAG will tax themselves is the customer being asked
  -- for a tax twice by two companies.
  perform assert_eq(v_inv.vat_rate, 0::numeric(5,2),
    'no VAT, because we supply nothing');
  perform assert_eq(v_inv.due_date = v_inv.date, true,
    'and no due date that reads as a deadline');
  perform assert_eq(v_inv.paid, false, 'nothing is paid on it');

  -- The rate is snapshotted like the terms are.
  perform assert_eq((select commission_rate from orders where id = v_order), 7.5::numeric(5,2),
    'the order carries the commission rate it was placed under');
end $$;

\echo ''
\echo '───────── And cannot be settled ─────────'
do $$
declare v_inv uuid := (select id from invoices
                        where order_id = (select id from _ids where what='acct_order')
                          and not superseded);
begin
  -- Marking it paid would also release the goods into our packing queue, for
  -- a parcel the brand is sending.
  perform assert_fails(format($f$select mark_invoice_paid(%L, null, 'manual')$f$, v_inv),
    'recording a payment on an order the brand invoices');
  perform assert_eq((select paid from invoices where id = v_inv), false,
    'so it is still unpaid, and always will be');
end $$;

\echo ''
\echo '───────── Ordinary invoices are untouched by any of it ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        v_order uuid;
        v_inv invoices%rowtype;
begin
  v_order := place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-PART'), 'qty', 1)
  ), null);
  select * into v_inv from invoices where order_id = v_order and not superseded;

  perform assert_eq(v_inv.agency, false, 'our own order raises a real invoice');
  perform assert_eq(v_inv.vat_rate > 0, true, 'with VAT on it');
  perform assert_eq(v_inv.due_date > v_inv.date, true, 'and something to pay by');

  perform mark_invoice_paid(v_inv.id, null, 'manual');
  perform assert_eq((select paid from invoices where id = v_inv.id), true,
    'and it can still be marked paid');
end $$;

\echo ''
\echo '───────── Introduced goods are not our revenue ─────────'
do $$
declare r record; v_goods numeric;
begin
  -- Two bikes at 1000 each, on the introduced order placed above.
  select sum(l.qty * l.unit_price) into v_goods
    from order_lines l where l.order_id = (select id from _ids where what='acct_order');
  perform assert_eq(v_goods, 2000.00::numeric, 'the introduced order came to 2000');

  select * into r from sales_totals(current_date - 1, current_date + 1, 'EUR');
  perform assert_eq(coalesce(r.revenue, 0) = 0 or r.revenue < v_goods, true,
    'and none of it is in the euro sales figures');
  perform assert_eq((select coalesce(sum(revenue), 0)
                       from sales_over_time(current_date - 1, current_date + 1, 'day', 'EUR')
                      ) < v_goods, true,
    'nor in the series the chart draws');
  perform assert_eq((select count(*)::integer
                       from top_clients(current_date - 1, current_date + 1, 10, 'EUR')
                      where revenue >= v_goods), 0,
    'nor attributed to the client who ordered it');
end $$;

\echo ''
\echo '───────── It is reported as the commission it is ─────────'
do $$
declare r record;
begin
  select * into r from agency_commission(current_date - 1, current_date + 1, 'EUR');
  perform assert_eq(r.brand_name, 'DRAG', 'the introduced business is reported by brand');
  perform assert_eq(r.goods >= 2000.00, true, 'with the goods the brand invoiced');

  -- Only the order placed after the rate was agreed earns anything: the ones
  -- before it were placed under no arrangement and carry a rate of nothing.
  -- 7.5% of that order's 2000 is 150, and not a penny of the goods themselves.
  perform assert_eq(r.commission, 150.00::numeric,
    'and the commission is worked out from the order that had a rate');

  -- Orders at 7.5% and orders at nothing, so there is no single rate to
  -- name. An average rounded to two places would multiply back out to a
  -- different figure and invite a hand-check that fails.
  perform assert_eq(r.rate is null, true,
    'and no single rate is claimed where the orders had two');
  perform assert_eq(r.commission < r.goods, true,
    'the commission is a fraction of the business, never the business');
end $$;

\echo ''
\echo '───────── A rate nobody has set reports as nothing, not as hidden ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        r record;
begin
  update brands set commission_rate = 0 where key = 'drag';
  perform place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-BIKE2'), 'qty', 1)
  ), null);

  select * into r from agency_commission(current_date - 1, current_date + 1, 'EUR');
  perform assert_eq(r.brand_name, 'DRAG', 'the brand still appears');
  perform assert_eq(r.goods >= 3000.00, true, 'with every order on it');
  -- The goods grow; the commission does not, because the new order earns
  -- nothing. That is the figure worth seeing.
  perform assert_eq(r.commission, 150.00::numeric,
    'and a rate of nothing adds nothing to the commission');
end $$;

\echo ''
\echo '───────── Where every order shared a rate, the rate is named ─────────'
do $$
declare v_mdi uuid := (select id from clients where name='MDI Ltd');
        r record;
begin
  -- A second brand, every one of whose orders is at the same rate: this is
  -- the ordinary case, and it must show the rate rather than "several".
  insert into products (sku, name, brand, currency, active)
  values ('AG-VELO','Velocorsa frameset','Velocorsa','EUR',true);
  insert into tier_prices (product_id, tier_id, price, effective_from)
    select p.id, t.id, 500.00, current_date - 400 from products p, tiers t
     where p.sku = 'AG-VELO';
  insert into stock_levels (product_id, location_id, qty)
    select p.id, l.id, 10 from products p, locations l where p.sku = 'AG-VELO';
  update brands set agency = true, agency_terms = 'Velocorsa invoices you.',
                    commission_rate = 12.00
   where key = 'velocorsa';

  perform place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-VELO'), 'qty', 2)
  ), null);
  perform place_order(v_mdi, null, jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='AG-VELO'), 'qty', 1)
  ), null);

  select * into r from agency_commission(current_date - 1, current_date + 1, 'EUR')
   where brand_name = 'Velocorsa';
  perform assert_eq(r.orders, 2, 'both orders are counted');
  perform assert_eq(r.goods, 1500.00::numeric, 'and all the goods on them');
  perform assert_eq(r.rate, 12.00::numeric, 'the one rate they shared is named');
  perform assert_eq(r.commission, 180.00::numeric, 'and the commission is that rate of it');
  -- The check a person would do on the row, and it comes out right.
  perform assert_eq(r.commission, round(r.goods * r.rate / 100, 2),
    'the row reconciles by hand');

  -- Two brands, two rows, and never one row adding them together.
  perform assert_eq(
    (select count(*)::integer from agency_commission(current_date - 1, current_date + 1, 'EUR')),
    2, 'each brand is reported on its own');
end $$;
