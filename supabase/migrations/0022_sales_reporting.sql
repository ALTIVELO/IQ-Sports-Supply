-- ============================================================================
-- 0022: what the business did, over a period.
--
-- Three functions, all staff-only, all reading the same thing: an order's own
-- lines at the price they were sold and the cost recorded against them when
-- they were placed. Revenue is net of VAT, because VAT was never ours.
--
-- Revenue is recognised on the order date rather than the invoice or payment
-- date. This is an order book: the question a trade counter asks is "what did
-- we sell in March", and an order placed in March that settles in April was
-- still March's work. Cancelled orders are not sales and are excluded
-- entirely — not shown at zero, not counted as an order.
--
-- A line with no recorded cost counts as costing nothing, which flatters the
-- margin. That cannot be silently true, so the totals carry the count of such
-- lines and the screen says so.
-- ============================================================================

-- Dropped by name first. 0023 changes what sales_totals returns, and CREATE OR
-- REPLACE cannot change a return type — so re-applying the whole migration set
-- over a database that already has 0023 would stop here without this.
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

/** Headline figures for a period. One row, always. */
create or replace function public.sales_totals(p_from date, p_to date)
returns table (
  orders integer, revenue numeric, cost numeric, profit numeric, uncosted_lines integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  select coalesce(count(distinct o.id), 0)::integer,
         coalesce(sum(l.qty * l.unit_price), 0)::numeric,
         coalesce(sum(l.qty * coalesce(c.unit_cost, 0)), 0)::numeric,
         coalesce(sum(l.qty * (l.unit_price - coalesce(c.unit_cost, 0))), 0)::numeric,
         coalesce(count(*) filter (where c.unit_cost is null), 0)::integer
    from orders o
    join order_lines l on l.order_id = o.id
    left join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to;
end $$;

/**
 * The same figures a bucket at a time.
 *
 * Every bucket in the range comes back, including the ones that sold nothing:
 * a quiet Tuesday is a fact about the week, and a chart that simply omits it
 * draws a line straight over the gap.
 */
create or replace function public.sales_over_time(
  p_from date, p_to date, p_grain text default 'day'
)
returns table (
  bucket date, orders integer, revenue numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_step interval;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  -- Named rather than interpolated: p_grain reaches date_trunc, and the set of
  -- grains this reports on is three.
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
           sum(l.qty * coalesce(c.unit_cost, 0))        as cost
      from orders o
      join order_lines l on l.order_id = o.id
      left join order_line_costs c on c.order_line_id = l.id
     where o.status <> 'cancelled'
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

/** Who the period's money came from, best first. */
create or replace function public.top_clients(
  p_from date, p_to date, p_limit integer default 5
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
         sum(l.qty * (l.unit_price - coalesce(c.unit_cost, 0)))::numeric
    from orders o
    join clients cl     on cl.id = o.client_id
    join order_lines l  on l.order_id = o.id
    left join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by cl.id, cl.name
   order by 5 desc, 4 desc
   limit greatest(1, coalesce(p_limit, 5));
end $$;
