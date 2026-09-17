-- ============================================================================
-- 0027: a price knows which money it is in.
--
-- Until now every figure in the system was sterling by assumption — the £ was
-- typed into the component that renders money, and nothing else in the schema
-- had an opinion. That held for as long as every supplier invoiced us in
-- pounds. DRAG's export list is in euros, and the trade prices we set off it
-- are in euros too, because that is what the customer pays and what we owe.
--
-- Converting on import was the cheaper option and the wrong one: it would bake
-- one morning's rate into a price list that stands for a year, and every
-- margin on the staff side would then be measured against a cost we never
-- actually paid. So the currency travels with the price instead.
--
-- Three rules make that safe rather than merely recorded:
--
--   * a product is priced in one currency — cost and every tier alike;
--   * an order is in one currency, enforced as lines are added, because a
--     total that sums euros and pounds is not a total;
--   * an invoice takes its currency from its order and cannot drift from it.
--
-- Reporting takes a currency rather than mixing them. The dashboard asks for
-- one at a time; summing across a rate we did not transact at would be the
-- same lie as converting on import, only later and larger.
-- ============================================================================

-- Two for now. An enum would need a migration to add a third anyway, and a
-- check constraint says the same thing where anyone reading the table sees it.
alter table products add column if not exists currency text not null default 'GBP';
alter table orders   add column if not exists currency text not null default 'GBP';
alter table invoices add column if not exists currency text not null default 'GBP';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_currency_check') then
    alter table products add constraint products_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table orders add constraint orders_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_currency_check') then
    alter table invoices add constraint invoices_currency_check
      check (currency in ('GBP', 'EUR'));
  end if;
end $$;

comment on column products.currency is
  'The money this product''s cost and every tier price are quoted in.';
comment on column orders.currency is
  'Taken from the first line placed. Every other line must agree.';
comment on column invoices.currency is
  'Copied from the order. Never set directly.';

-- ── one order, one currency ─────────────────────────────────────────────────

/**
 * Keeps an order to a single currency.
 *
 * The first line decides it — a basket does not announce its currency up
 * front, and defaulting every order to sterling would quietly mislabel a
 * euro one. Every line after that must agree, and a line that does not is
 * refused rather than converted: there is no rate here to convert at, and
 * inventing one would put a made-up number on an invoice.
 *
 * A line with no product_id is a free-text line typed by staff. It takes the
 * order's currency as it stands, because there is nothing to check it against.
 */
create or replace function public.enforce_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product  text;
  v_order    text;
  v_has_line boolean;
begin
  if new.product_id is null then return new; end if;

  select currency into v_product from products where id = new.product_id;
  if v_product is null then return new; end if;

  select currency into v_order from orders where id = new.order_id;

  select exists (
    select 1 from order_lines
     where order_id = new.order_id
       and (tg_op = 'INSERT' or id <> new.id)
  ) into v_has_line;

  if not v_has_line then
    update orders set currency = v_product where id = new.order_id;
    return new;
  end if;

  if v_order is distinct from v_product then
    raise exception
      'Order is in %, and % is priced in % — an order cannot mix currencies',
      v_order, new.sku, v_product
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists order_lines_currency on order_lines;
create trigger order_lines_currency
  before insert or update of product_id on order_lines
  for each row execute function public.enforce_order_currency();

/** An invoice is a demand for money in the currency the order was placed in. */
create or replace function public.invoice_currency_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select currency into new.currency from orders where id = new.order_id;
  return new;
end $$;

drop trigger if exists invoices_currency on invoices;
create trigger invoices_currency
  before insert or update of order_id on invoices
  for each row execute function public.invoice_currency_from_order();

-- Existing rows predate all of this and are all sterling, but the orders they
-- belong to are the authority from here on, so make the columns agree now
-- rather than leaving two sources of truth that happen to match.
update orders o set currency = p.currency
  from order_lines l
  join products p on p.id = l.product_id
 where l.order_id = o.id
   and o.currency is distinct from p.currency;

update invoices i set currency = o.currency
  from orders o
 where o.id = i.order_id
   and i.currency is distinct from o.currency;

-- ── the catalogue carries it to the client ──────────────────────────────────

-- A column in the middle of the list, which CREATE OR REPLACE VIEW cannot do.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  p.currency,
  c.slug as category_slug,
  c.name as category_name,
  coalesce(c.configurator_only, false) as configurator_only,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;

-- Dropped by the cascade above. Unchanged from 0021 but for the currency.
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
       c.price,
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;

-- ── reporting is per currency ───────────────────────────────────────────────

-- Signatures change, and an older overload left behind would be chosen over
-- this one by argument count alone.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('sales_totals', 'sales_over_time', 'top_clients')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

/**
 * Headline figures for a period, in one currency, over the sales we can cost.
 *
 * excluded_lines and excluded_revenue are the ones left out for want of a
 * cost. Orders in another currency are not "excluded" in that sense — they
 * belong to a different report, not a gap in this one — so they are simply
 * not here, and the screen offers the other currency instead.
 */
create or replace function public.sales_totals(
  p_from date, p_to date, p_currency text default 'GBP'
)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric,
  excluded_lines integer, excluded_revenue numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with lines as (
    select o.id as order_id, l.qty, l.unit_price, c.unit_cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.currency = p_currency
       and o.date between p_from and p_to
  )
  select
    coalesce(count(distinct order_id) filter (where unit_cost is not null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * unit_cost) filter (where unit_cost is not null), 0)::numeric,
    coalesce(sum(qty * (unit_price - unit_cost)) filter (where unit_cost is not null), 0)::numeric,
    coalesce(count(*) filter (where unit_cost is null), 0)::integer,
    coalesce(sum(qty * unit_price) filter (where unit_cost is null), 0)::numeric
  from lines;
end $$;

/** The same figures a bucket at a time, in one currency. */
create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day', p_currency text default 'GBP'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  v_step := case p_grain
              when 'day'   then interval '1 day'
              when 'week'  then interval '1 week'
              when 'month' then interval '1 month'
            end;
  if v_step is null then
    raise exception 'Unknown grain % — day, week or month', p_grain;
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, p_to::timestamp),
             v_step)::date as bucket
  ),
  sold as (
    select date_trunc(p_grain, o.date::timestamp)::date as bucket,
           count(distinct o.id)::integer                as orders,
           sum(l.qty * l.unit_price)                    as revenue,
           sum(l.qty * c.unit_cost)                     as cost
      from orders o
      join order_lines l       on l.order_id = o.id
      -- Inner: a line we cannot cost is not a line this report knows about.
      join order_line_costs c  on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.currency = p_currency
       and o.date between p_from and p_to
     group by 1
  )
  select b.bucket,
         coalesce(s.orders, 0),
         coalesce(s.revenue, 0)::numeric,
         coalesce(s.cost, 0)::numeric,
         coalesce(s.revenue - s.cost, 0)::numeric
    from buckets b
    left join sold s on s.bucket = b.bucket
   order by b.bucket;
end $$;

/** Who the period's money came from, best first, in one currency. */
create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5, p_currency text default 'GBP'
)
returns table (
  client_id uuid, client_name text, orders integer, revenue numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select cl.id, cl.name,
         count(distinct o.id)::integer,
         sum(l.qty * l.unit_price)::numeric,
         sum(l.qty * (l.unit_price - c.unit_cost))::numeric
    from orders o
    join clients cl         on cl.id = o.client_id
    join order_lines l      on l.order_id = o.id
    join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.currency = p_currency
     and o.date between p_from and p_to
   group by cl.id, cl.name
   -- Name last, so two clients level on both figures keep a stable order
   -- rather than swapping places between one page load and the next.
   order by 5 desc, 4 desc, cl.name
   limit greatest(1, coalesce(p_limit, 5));
end $$;

/**
 * Which currencies there is anything to report on, commonest first.
 *
 * The dashboard only offers a second currency once a second one exists, so a
 * sterling-only distributor never sees a control that would do nothing.
 */
create or replace function public.sold_currencies()
returns table (currency text, orders integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select o.currency, count(*)::integer
    from orders o
   where o.status <> 'cancelled'
   group by o.currency
   order by 2 desc, 1;
end $$;
