-- ============================================================================
-- 0032: what a brand partner is shown.
--
-- Four questions, and no way to ask a fifth. Each of these is the only route
-- a partner has to a number, and each begins by narrowing to the brands they
-- speak for — so the shape of the answer cannot be changed by the asking.
--
-- What sold is measured the way the staff dashboard measures it: by order
-- date, cancelled orders excluded, and only lines we can cost. A consignment
-- settlement built on lines with no cost recorded would be a bill for an
-- amount nobody agreed, so those are left out and counted separately, exactly
-- as 0023 does for our own margin.
--
-- "Due to the brand" is what we recorded owing when the line was placed, not
-- what we would owe at today's cost. A price list that changes in October
-- must not change what September settled at.
-- ============================================================================

/**
 * The postcode area a delivery went to — "SL", "EH", "M".
 *
 * Addresses here are free text typed by whoever set the account up, so this
 * finds a UK postcode inside one rather than trusting a field. The area is as
 * far as it goes on purpose: a partner asking where their stock sells is
 * asking about regions, and the rest of the postcode identifies the shop.
 */
create or replace function public.postcode_area(p_address text)
returns text language sql immutable as $$
  select upper(substring(
    substring(upper(coalesce(p_address, ''))
              from '[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}')
    from '^[A-Z]{1,2}'));
$$;

/** Headline figures for a period, over one brand's goods. */
create or replace function public.partner_sales_totals(
  p_from date, p_to date, p_brand uuid default null
)
returns table (
  units integer, orders integer, sales numeric, due_to_brand numeric,
  distributor_margin numeric, excluded_lines integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with mine as (
    select l.qty, l.unit_price, c.unit_cost, o.id as order_id
      from order_lines l
      join orders o    on o.id = l.order_id
      join products p  on p.id = l.product_id
      left join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
  )
  select
    coalesce(sum(qty) filter (where unit_cost is not null), 0)::integer,
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer
  from mine;
end $$;

/** The same, a month at a time, with every month in the range returned. */
create or replace function public.partner_sales_by_month(
  p_from date, p_to date, p_brand uuid default null
)
returns table (
  month date, units integer, sales numeric, due_to_brand numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with months as (
    select generate_series(date_trunc('month', p_from::timestamp),
                           date_trunc('month', p_to::timestamp),
                           interval '1 month')::date as month
  ),
  sold as (
    select date_trunc('month', o.date::timestamp)::date as month,
           sum(l.qty)::integer                          as units,
           sum(l.qty * l.unit_price)                    as sales,
           sum(l.qty * c.unit_cost)                     as due
      from order_lines l
      join orders o   on o.id = l.order_id
      join products p on p.id = l.product_id
      join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
     group by 1
  )
  select m.month,
         coalesce(s.units, 0),
         coalesce(s.sales, 0)::numeric,
         coalesce(s.due, 0)::numeric
    from months m
    left join sold s on s.month = m.month
   order by m.month;
end $$;

/** Which of their products sold, best first. */
create or replace function public.partner_top_products(
  p_from date, p_to date, p_brand uuid default null, p_limit integer default 10
)
returns table (
  sku text, name text, units integer, sales numeric, due_to_brand numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  select p.sku, p.name,
         sum(l.qty)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * c.unit_cost)::numeric
    from order_lines l
    join orders o   on o.id = l.order_id
    join products p on p.id = l.product_id
    join order_line_costs c on c.order_line_id = l.id
   where p.brand_id in (select brands_in_scope(p_brand))
     and o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by p.sku, p.name
   order by 3 desc, 4 desc, p.sku
   limit greatest(1, coalesce(p_limit, 10));
end $$;

/**
 * Who is buying their goods, and where.
 *
 * Two kinds of answer in one table — the tier of trade customer, and the
 * postcode area the goods went to — because both are "who buys this" and a
 * partner reads them together.
 *
 * No client is named. A brand is entitled to know that a third of their stock
 * goes to clubs in the south east; they are not entitled to our customer list,
 * and a breakdown fine enough to identify one shop is our customer list with
 * extra steps. So a band holding fewer than three clients is folded into one
 * "elsewhere" row rather than shown.
 */
create or replace function public.partner_demographics(
  p_from date, p_to date, p_brand uuid default null
)
-- "buyers" rather than "clients": the table of that name is joined below, and
-- an output column sharing its name shadows it.
-- Output names deliberately unlike the CTE columns below: an OUT parameter
-- shadows anything of the same name inside the body, and "units" or "sales"
-- would be ambiguous in every aggregate that computes them.
returns table (kind text, label text, buyers integer, sold integer, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  with mine as (
    select o.client_id, l.qty, l.unit_price,
           t.name as tier,
           coalesce(postcode_area(coalesce(o.ship_to, cl.address)), 'Not known') as area
      from order_lines l
      join orders o    on o.id = l.order_id
      join products p  on p.id = l.product_id
      join clients cl  on cl.id = o.client_id
      join tiers t     on t.id = cl.tier_id
      join order_line_costs c on c.order_line_id = l.id
     where p.brand_id in (select brands_in_scope(p_brand))
       and o.status <> 'cancelled'
       and o.date between p_from and p_to
  ),
  by_tier as (
    select 'tier'::text as kind, tier as label,
           count(distinct client_id)::integer as buyer_count,
           sum(qty)::integer as unit_count,
           sum(qty * unit_price)::numeric as money
      from mine group by tier
  ),
  by_area as (
    select 'area'::text as kind, area as label,
           count(distinct client_id)::integer as buyer_count,
           sum(qty)::integer as unit_count,
           sum(qty * unit_price)::numeric as money
      from mine group by area
  ),
  -- A region with one or two buyers in it names them to anybody who knows the
  -- trade, so the thin ones are added together instead.
  area_shown as (
    select * from by_area where buyer_count >= 3
  ),
  area_folded as (
    select 'area'::text, 'Elsewhere'::text,
           sum(buyer_count)::integer, sum(unit_count)::integer, sum(money)::numeric
      from by_area where buyer_count < 3
     having count(*) > 0
  )
  select * from by_tier
  union all select * from area_shown
  union all select * from area_folded
  order by 1, 5 desc, 2;
end $$;

-- ── dropshipping ────────────────────────────────────────────────────────────

/**
 * One row per brand per order that brand has to ship.
 *
 * A row rather than an email alone, because an email is not a record: a
 * partner needs a list of what is outstanding, we need to know whether they
 * were told, and somebody has to be able to say in March what was sent in
 * January. The email is sent from this row and its success recorded on it.
 */
create table if not exists dropship_notices (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  brand_id        uuid not null references brands(id) on delete cascade,
  created_at      timestamptz not null default now(),
  /** When we managed to tell them. Null means the email has not gone yet. */
  notified_at     timestamptz,
  shipped         boolean not null default false,
  shipped_at      timestamptz,
  carrier         text,
  tracking_number text,
  unique (order_id, brand_id)
);
create index if not exists dropship_notices_open_idx
  on dropship_notices (brand_id, created_at desc) where not shipped;

alter table dropship_notices enable row level security;
drop policy if exists dropship_notices_staff on dropship_notices;
create policy dropship_notices_staff on dropship_notices for all
  using (is_staff()) with check (is_staff());
-- Read only, and only their own. Marking one shipped goes through a function
-- so a partner cannot edit somebody else's row by guessing its id.
drop policy if exists dropship_notices_own on dropship_notices;
create policy dropship_notices_own on dropship_notices for select
  using (brand_id in (select my_brand_ids()));

/**
 * Raises a notice for every brand that has something to ship on this order.
 *
 * A statement-level trigger after the lines land, rather than a step inside
 * place_order: lines arrive one at a time and an order with three of a
 * brand's products is one notice, not three. Orders imported from a
 * spreadsheet raise notices too, which is right — a brand shipping a box does
 * not care how the order reached us.
 */
create or replace function public.raise_dropship_notices()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into dropship_notices (order_id, brand_id)
  select distinct l.order_id, p.brand_id
    from new_lines l
    join products p on p.id = l.product_id
   where p.dropship and p.brand_id is not null
  on conflict (order_id, brand_id) do nothing;
  return null;
end $$;

drop trigger if exists order_lines_dropship on order_lines;
create trigger order_lines_dropship
  after insert on order_lines
  referencing new table as new_lines
  for each statement execute function public.raise_dropship_notices();

/**
 * Orders a brand has to ship, and what is on them.
 *
 * The address and the goods, because that is a dispatch note. Not what the
 * customer paid for anything else on the order, not the rest of the order at
 * all, and not the client's account terms: a brand shipping one box needs to
 * know where it goes and what goes in it.
 */
create or replace function public.partner_dropship_orders(
  p_brand uuid default null, p_include_shipped boolean default false
)
returns table (
  notice_id uuid, order_id uuid, order_number text, order_date date,
  client_name text, ship_to text,
  shipped boolean, shipped_at timestamptz,
  carrier text, tracking_number text,
  lines jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_partner()) then raise exception 'Not authorised'; end if;

  return query
  select n.id, o.id, o.number, o.date,
         cl.name, coalesce(o.ship_to, cl.address),
         n.shipped, n.shipped_at, n.carrier, n.tracking_number,
         (select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'qty', l.qty)
                           order by l.sku)
            from order_lines l
            join products p2 on p2.id = l.product_id
           where l.order_id = o.id and p2.brand_id = n.brand_id and p2.dropship)
    from dropship_notices n
    join orders o  on o.id = n.order_id
    join clients cl on cl.id = o.client_id
   where n.brand_id in (select brands_in_scope(p_brand))
     and o.status <> 'cancelled'
     and (p_include_shipped or not n.shipped)
   order by o.date desc, o.number desc;
end $$;

/** A partner marking their own box as gone. */
create or replace function public.mark_dropship_shipped(
  p_notice uuid, p_carrier text, p_tracking text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from dropship_notices n
     where n.id = p_notice
       and (is_staff() or n.brand_id in (select my_brand_ids()))
  ) then
    raise exception 'Not authorised';
  end if;

  update dropship_notices
     set shipped = true,
         shipped_at = coalesce(shipped_at, now()),
         carrier = nullif(trim(coalesce(p_carrier, '')), ''),
         tracking_number = nullif(trim(coalesce(p_tracking, '')), '')
   where id = p_notice;
end $$;
