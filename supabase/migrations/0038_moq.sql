-- ============================================================================
-- 0038: the price on the sheet is the price by the outer, and now it says so.
--
-- Shimano sell by the carton. A shifter comes in tens, a charging cable in
-- hundreds, and the trade prices we publish are the prices at those
-- quantities — which was true before this migration and written down nowhere.
-- A shop ordering three of something that comes in tens was quoted the carton
-- price on the screen, and corrected afterwards by somebody who knew.
--
-- Two columns fix it. products.moq is the carton quantity. tier_prices gains a
-- second price beside the first: what one unit costs when fewer than an outer
-- are bought. Below the minimum the dearer price applies, at or above it the
-- advertised one does, and both are on the screen before anybody commits.
--
-- The break price lives on tier_prices rather than in a table of its own
-- because it is a price on a price sheet: it changes when the sheet changes,
-- it is superseded the same way, and a supplier's new list sets both figures
-- in one row. A separate table would let the two drift apart by a quarter,
-- which is exactly the failure this is here to stop.
-- ============================================================================

-- ── the carton ──────────────────────────────────────────────────────────────
-- One is the honest default and the common case: most of the catalogue is sold
-- in ones, and a product that has never been told otherwise should behave
-- exactly as it did before this migration existed.
alter table products
  add column if not exists moq integer not null default 1;

do $$ begin
  alter table products add constraint products_moq_positive check (moq >= 1);
exception when duplicate_object then null; end $$;

comment on column products.moq is
  'Minimum order quantity for the advertised price — the outer, or carton, '
  'the part ships in. Below it, tier_prices.break_price applies.';

-- ── the price below it ──────────────────────────────────────────────────────
alter table tier_prices
  add column if not exists break_price numeric(12,2);
alter table product_costs
  add column if not exists break_cost numeric(12,2);

/*
 * A break price below the outer price is a column swap, not a bargain.
 *
 * The two figures arrive side by side on an import, and reading them the wrong
 * way round sells every carton at the loose price and every loose unit at the
 * carton price. Nothing downstream would question it — both are plausible
 * numbers in a plausible column — so it is caught here, at the one point both
 * values are in the same row, and the import fails naming the SKU rather than
 * succeeding and costing a quarter of the margin on every line.
 *
 * Equal is allowed: a part the supplier prices the same either way is
 * ordinary, and so is one whose loose price we have not been given.
 */
do $$ begin
  alter table tier_prices add constraint tier_prices_break_dearer
    check (break_price is null or break_price >= price);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table product_costs add constraint product_costs_break_dearer
    check (break_cost is null or break_cost >= cost);
exception when duplicate_object then null; end $$;

comment on column tier_prices.break_price is
  'What one unit costs this tier below the product''s MOQ. Null means one '
  'price at any quantity.';

-- ── what a quantity actually costs ──────────────────────────────────────────
/**
 * The price this tier pays for p_qty of this product, as at a date.
 *
 * One function, called by the order desk, the portal and place_order, so the
 * quantity that decides the price on the screen is the same quantity that
 * decides it on the invoice. The alternative — each caller comparing a qty to
 * an moq for itself — is three chances to get the boundary wrong, and the
 * boundary is the whole feature.
 *
 * At the MOQ exactly, the advertised price applies. An outer of ten means ten
 * is enough, not eleven.
 */
create or replace function public.price_for_qty(
  p_product uuid, p_tier uuid, p_qty integer, p_on date default current_date
) returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when p_qty < coalesce(p.moq, 1) and tp.break_price is not null
             then tp.break_price
           else tp.price
         end
    from products p
    join lateral (
      select price, break_price from tier_prices
       where product_id = p.id and tier_id = p_tier and effective_from <= p_on
       order by effective_from desc
       limit 1
    ) tp on true
   where p.id = p_product;
$$;

-- ── the screens ─────────────────────────────────────────────────────────────
/*
 * Both of these gain a column rather than changing one, so every caller that
 * does not care about outers keeps working untouched. Dropped first because a
 * function's return type cannot be widened in place.
 */
drop function if exists public.current_tier_prices(uuid[], date);
create function public.current_tier_prices(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, tier_id uuid, price numeric, break_price numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (tp.product_id, tp.tier_id)
         tp.product_id, tp.tier_id, tp.price, tp.break_price
    from tier_prices tp
   where tp.product_id = any(p_products)
     and tp.effective_from <= p_on
   order by tp.product_id, tp.tier_id, tp.effective_from desc;
$$;

drop function if exists public.current_costs(uuid[], date);
create function public.current_costs(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, cost numeric, break_cost numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (pc.product_id)
         pc.product_id, pc.cost, pc.break_cost
    from product_costs pc
   where pc.product_id = any(p_products)
     and pc.effective_from <= p_on
   order by pc.product_id, pc.effective_from desc;
$$;

-- ── what a client sees ──────────────────────────────────────────────────────
-- Rebuilt rather than replaced: a new column cannot be added to the middle of
-- a view's column list, and client_group_options reads this one.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.series,
  p.image_url,
  p.currency,
  p.price_note,
  p.variant_group,
  p.variant_label,
  p.variant_sort,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  -- The two figures a customer needs to decide: how many make a carton, and
  -- what one costs if they do not want one.
  coalesce(p.moq, 1) as moq,
  tp.break_price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price, tp2.break_price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

create view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.axis1_value,
       o.axis2_value,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.series,
       c.price,
       c.moq,
       c.break_price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;

-- ── the invoice ─────────────────────────────────────────────────────────────
/*
 * The one that matters. Everything above is a screen; this is the money.
 *
 * The only change is which function prices the line: price_for_qty instead of
 * current_tier_price, so the quantity on the order decides the rate. A staff
 * override still wins, because a staff override is somebody deciding, and the
 * whole point of an override is to be allowed to disagree with the sheet.
 */
create or replace function public.place_order(
  p_client_id   uuid,
  p_location_id uuid,
  p_lines       jsonb,
  p_notes       text default null,
  p_address_id  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_client      clients%rowtype;
  v_settings    settings%rowtype;
  v_location    uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_invoice_id  uuid;
  v_invoice_no  text;
  v_line        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_price       numeric(12,2);
  v_stock       integer;
  v_alloc       integer;
  v_bo          integer;
  v_total_bo    integer := 0;
  v_vat         numeric(5,2);
  v_po_id       uuid;
  v_po_no       text;
  v_addr        client_addresses%rowtype;
  v_ship_to     text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'Not authorised'; end if;

  if v_role = 'client' and p_client_id is distinct from my_client_id() then
    raise exception 'Not authorised to order for this client';
  end if;

  select * into v_client from clients where id = p_client_id;
  if not found then raise exception 'Unknown client'; end if;
  if not v_client.active then raise exception 'Client account is not active'; end if;

  select * into v_settings from settings where id = 1;

  v_location := coalesce(p_location_id, v_client.default_location_id);
  if v_location is null then raise exception 'No fulfilment location for this order'; end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Order has no lines';
  end if;

  -- The address must belong to the client being ordered for. Without this an
  -- id from another client's account would be accepted and their address
  -- printed on the packing list.
  if p_address_id is not null then
    select * into v_addr from client_addresses
     where id = p_address_id and client_id = p_client_id and active;
    if not found then raise exception 'That delivery address is not on this account'; end if;
  else
    select * into v_addr from client_addresses
     where client_id = p_client_id and active
     order by is_default desc, created_at
     limit 1;
  end if;

  v_ship_to := coalesce(
    case when v_addr.id is not null
         then concat_ws(E'\n', nullif(v_addr.recipient, ''), v_addr.address)
    end,
    v_client.address);

  v_order_no := next_order_number();
  insert into orders (number, client_id, date, fulfilment_location_id, placed_by, notes,
                      shipping_address_id, ship_to)
  values (v_order_no, p_client_id, current_date, v_location, auth.uid(), p_notes,
          v_addr.id, v_ship_to)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;

    v_qty := greatest(1, (v_line->>'qty')::integer);

    if v_role = 'client' or v_line->>'unit_price' is null then
      -- The quantity on the line decides the rate: below the outer the
      -- break price, at or above it the advertised one.
      v_price := price_for_qty(v_product.id, v_client.tier_id, v_qty);
    else
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    if v_price is null then raise exception 'No price for % on this tier', v_product.sku; end if;

    select qty into v_stock from stock_levels
     where product_id = v_product.id and location_id = v_location for update;
    v_stock := coalesce(v_stock, 0);

    v_alloc := least(v_qty, v_stock);
    v_bo    := v_qty - v_alloc;

    if v_alloc > 0 then
      update stock_levels set qty = qty - v_alloc
       where product_id = v_product.id and location_id = v_location;
    end if;

    insert into order_lines (order_id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_price, v_alloc, v_bo);

    v_total_bo := v_total_bo + v_bo;
  end loop;

  v_vat := case when v_client.vat_exempt then 0 else v_settings.vat_rate end;
  v_invoice_no := next_invoice_number();
  insert into invoices (number, order_id, client_id, type, date, due_date,
                        vat_rate, location_id, ready_to_pack)
  values (v_invoice_no, v_order_id, p_client_id, 'full', current_date,
          current_date + v_settings.payment_days, v_vat, v_location, v_total_bo = 0)
  returning id into v_invoice_id;

  insert into invoice_lines (invoice_id, sku, name, qty, unit_price)
  select v_invoice_id, sku, name, qty, unit_price from order_lines where order_id = v_order_id;

  insert into order_events (order_id, type, meta)
  values (v_order_id, 'placed', jsonb_build_object('number', v_order_no)),
         (v_order_id, 'invoice_sent', jsonb_build_object('invoice', v_invoice_no, 'invoice_id', v_invoice_id));

  if v_total_bo > 0 then
    v_po_no := next_po_number();
    insert into purchase_orders (number, date, receive_location_id)
    values (v_po_no, current_date, v_location)
    returning id into v_po_id;

    insert into po_lines (po_id, sku, name, qty, so_reference, order_id)
    select v_po_id, sku, name, bo_qty, v_order_no, v_order_id
      from order_lines where order_id = v_order_id and bo_qty > 0;

    update order_lines set po_qty = bo_qty where order_id = v_order_id and bo_qty > 0;

    insert into order_events (order_id, type, meta)
    values (v_order_id, 'supplier_ordered', jsonb_build_object('po', v_po_no, 'po_id', v_po_id));
  end if;

  perform refresh_invoice_readiness(v_order_id);
  return v_order_id;
end $$;
