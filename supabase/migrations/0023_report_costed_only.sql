-- ============================================================================
-- 0023: a sale we cannot cost is not reported on.
--
-- 0022 counted a line with no recorded cost as costing nothing, which put its
-- whole price into profit. The screen said so, but a caveat under a number is
-- not the same as a number you can trust: the figure still got quoted, and it
-- was still wrong in the flattering direction.
--
-- So an order line is now reported only if we know what it cost us. No cost,
-- no revenue, no profit, no margin — it is not in the report at all. What is
-- left is a smaller set of sales with a true margin, which is worth more than
-- a complete set with a false one.
--
-- Revenue therefore no longer matches the order book, and that must not be a
-- surprise. sales_totals returns what it left out, in lines and in money, and
-- the screen says so above the figures.
--
-- The rule is per line rather than per order. An order of eleven lines with
-- one new SKU on it is ten lines of real margin, and throwing those away to
-- punish the eleventh would lose far more than it protects.
-- ============================================================================

-- The return type gains columns, which CREATE OR REPLACE cannot do, and a
-- second signature left behind would be picked over this one at random.
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
 * Headline figures for a period, over the sales we can cost.
 *
 * excluded_lines and excluded_revenue are the ones left out: the report is
 * honest about being partial rather than quietly smaller than the order book.
 */
create or replace function public.sales_totals(p_from date, p_to date)
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

/**
 * The same figures a bucket at a time.
 *
 * Every bucket in the range comes back, including the ones with nothing left
 * in them: a period whose only sales could not be costed reads as zero here,
 * and the count of what was excluded sits above the chart to explain it.
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

/** Who the period's money came from, best first, over the sales we can cost. */
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
         sum(l.qty * (l.unit_price - c.unit_cost))::numeric
    from orders o
    join clients cl         on cl.id = o.client_id
    join order_lines l      on l.order_id = o.id
    join order_line_costs c on c.order_line_id = l.id
   where o.status <> 'cancelled'
     and o.date between p_from and p_to
   group by cl.id, cl.name
   order by 5 desc, 4 desc
   limit greatest(1, coalesce(p_limit, 5));
end $$;
