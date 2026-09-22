-- ============================================================================
-- 28: the price on the sheet is the price by the outer.
--
-- Shimano sell by the carton. A shifter comes in tens and the trade price we
-- publish is the price at ten; below it the part costs more. That was true
-- before this suite and enforced by whoever happened to notice, which is to
-- say a shop could order three at the price of ten and find out at invoice
-- time.
--
-- The claims worth testing are all at the boundary. Ten is enough, nine is
-- not, and the number on the invoice is the number the screen showed — which
-- only holds if one function answers for both, so that is the one tested.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

-- A part that comes in tens at 189.20, or one at a time at 230 — the real
-- figures for a Dura-Ace shifter, because a boundary is easier to read with
-- prices somebody would recognise.
insert into products (sku, name, brand, moq)
values ('T-MOQ-SHIFTER', 'Shifter, boxed in tens', 'Shimano', 10),
       ('T-MOQ-SINGLE',  'Sold one at a time',     'Shimano', 1),
       ('T-MOQ-NOLOOSE', 'Boxed in eights, no loose price', 'Shimano', 8);

insert into tier_prices (product_id, tier_id, price, break_price, effective_from)
select p.id, t.id, v.price, v.brk, current_date
  from (values
    ('T-MOQ-SHIFTER', 'Distributor', 204.34, 248.40),
    ('T-MOQ-SHIFTER', 'Shop',        211.91, 257.61),
    ('T-MOQ-SINGLE',  'Distributor',   5.71, null::numeric),
    ('T-MOQ-NOLOOSE', 'Distributor', 496.80, null::numeric)
  ) as v(sku, tier, price, brk)
  join products p on p.sku = v.sku
  join tiers t on t.name = v.tier;

\echo ''
\echo '───────── A. Ten is enough, nine is not ─────────'
do $$
declare
  d uuid := (select id from tiers where name='Distributor');
  p uuid := (select id from products where sku='T-MOQ-SHIFTER');
begin
  perform assert_eq(price_for_qty(p, d, 10), 204.34,
    'at the outer exactly, the advertised price');
  perform assert_eq(price_for_qty(p, d, 11), 204.34,
    'and above it too');
  perform assert_eq(price_for_qty(p, d, 40), 204.34,
    'four cartons is still the carton price');
  perform assert_eq(price_for_qty(p, d, 9), 248.40,
    'one short of a carton is the loose price');
  perform assert_eq(price_for_qty(p, d, 1), 248.40,
    'and so is one');
  -- The difference is the whole point: 21% on a line nobody was checking.
  perform assert_eq(round((248.40 - 204.34) / 204.34 * 100)::int, 22,
    'which is 22% more, on every unit');
end $$;

\echo ''
\echo '───────── B. Every tier has its own break ─────────'
do $$
declare
  s uuid := (select id from tiers where name='Shop');
  p uuid := (select id from products where sku='T-MOQ-SHIFTER');
begin
  perform assert_eq(price_for_qty(p, s, 10), 211.91, 'a shop buying a carton');
  perform assert_eq(price_for_qty(p, s, 2),  257.61, 'and a shop buying two');
end $$;

\echo ''
\echo '───────── C. A part sold in ones behaves as it always did ─────────'
do $$
declare
  d uuid := (select id from tiers where name='Distributor');
begin
  perform assert_eq(price_for_qty((select id from products where sku='T-MOQ-SINGLE'), d, 1),
    5.71, 'one of a part sold in ones is the price');
  perform assert_eq(price_for_qty((select id from products where sku='T-MOQ-SINGLE'), d, 500),
    5.71, 'and so are five hundred');
  -- An MOQ with no price to go with it cannot invent one. It sells at the
  -- advertised price whatever the quantity, which is what happened before.
  perform assert_eq(price_for_qty((select id from products where sku='T-MOQ-NOLOOSE'), d, 1),
    496.80, 'an outer with no loose price still sells below the outer');
  perform assert_eq(price_for_qty((select id from products where sku='T-MOQ-NOLOOSE'), d, 8),
    496.80, 'at the same price as a full one');
end $$;

\echo ''
\echo '───────── D. A break cheaper than the outer is a swapped column ─────────'
do $$
declare
  d uuid := (select id from tiers where name='Distributor');
  p uuid := (select id from products where sku='T-MOQ-SINGLE');
  ok boolean := false;
begin
  /*
   * The two figures arrive side by side on an import and reading them the
   * wrong way round sells every carton at the loose price. Both numbers are
   * plausible in either column, so nothing downstream would catch it.
   */
  begin
    insert into tier_prices (product_id, tier_id, price, break_price, effective_from)
    values (p, d, 100.00, 80.00, current_date + 1);
  exception when check_violation then ok := true;
  end;
  perform assert_eq(ok, true, 'a loose price under the carton price is refused');

  -- Equal is ordinary: a supplier who charges the same either way.
  insert into tier_prices (product_id, tier_id, price, break_price, effective_from)
  values (p, d, 100.00, 100.00, current_date + 2);
  perform assert_eq(
    price_for_qty(p, d, 1, current_date + 2), 100.00,
    'and the same price either way is allowed');
end $$;

\echo ''
\echo '───────── E. The invoice charges what the screen showed ─────────'
-- The claim that matters. Two orders for the same part, one above the outer
-- and one below, priced by place_order rather than by the test.
select place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='T-MOQ-SHIFTER'),'qty',10)));

select place_order(
  (select id from clients where name='MDI Ltd'),
  (select id from locations where name='Slough'),
  jsonb_build_array(
    jsonb_build_object('product_id',(select id from products where sku='T-MOQ-SHIFTER'),'qty',3)));

do $$
declare
  tier text := (select t.name from clients c join tiers t on t.id=c.tier_id where c.name='MDI Ltd');
  -- Found by their quantity rather than by an order id carried out of the
  -- statement above: psql leaves its own variables alone inside a block like
  -- this one, and a :name here reaches the server as a colon.
  big   uuid := (select order_id from order_lines where sku='T-MOQ-SHIFTER' and qty=10);
  small uuid := (select order_id from order_lines where sku='T-MOQ-SHIFTER' and qty=3);
begin
  perform assert_eq(tier, 'Distributor', 'the client under test is on Distributor');
  perform assert_eq(
    (select unit_price from order_lines where order_id = big and sku='T-MOQ-SHIFTER'),
    204.34, 'a carton is invoiced at the carton price');
  perform assert_eq(
    (select unit_price from order_lines where order_id = small and sku='T-MOQ-SHIFTER'),
    248.40, 'three are invoiced at the loose price');
  -- Order line and invoice line must agree, or the customer is shown one
  -- number and charged another.
  perform assert_eq(
    (select il.unit_price from invoice_lines il
       join invoices i on i.id = il.invoice_id
      where i.order_id = small and il.sku='T-MOQ-SHIFTER'),
    248.40, 'and the invoice says the same');
end $$;

\echo ''
\echo '───────── F. What the screens read ─────────'
do $$
declare r record;
begin
  select * into r from current_tier_prices(
    array[(select id from products where sku='T-MOQ-SHIFTER')]) x
   where x.tier_id = (select id from tiers where name='Distributor');
  perform assert_eq(r.price, 204.34, 'the catalogue reads the advertised price');
  perform assert_eq(r.break_price, 248.40, 'and the one beside it');
  perform assert_eq(
    (select moq from products where sku='T-MOQ-SHIFTER'), 10,
    'and the quantity that decides between them');
end $$;
