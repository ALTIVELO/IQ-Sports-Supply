-- ============================================================================
-- 0035: an introduced order is not a sale, so it stops behaving like one.
--
-- 0034 told the customer the truth: on a DRAG order, DRAG confirms it, DRAG
-- raises the final invoice with shipping and taxes, DRAG ships it, DRAG
-- carries the warranty, and IQ is paid a commission for the introduction.
-- The books had not caught up. The document behind such an order was still a
-- full invoice: 20% VAT added to a euro price DRAG will tax themselves, a
-- payment due date for money we are not collecting, a line in the sales
-- figures for goods we never sold, and a push to Xero as our own supply.
--
-- Every one of those is a different way of saying we are the seller, and a
-- customer who pays that invoice has paid the wrong company.
--
-- So an introduced order raises an acknowledgement instead. It has the goods
-- and the quantities on it, because the customer and the desk both need to
-- see what was ordered. It has no VAT, because we are supplying nothing. It
-- cannot be marked paid, pushed to Xero, or counted as revenue.
--
-- What we do earn is the commission, and it is recorded rather than dropped:
-- a rate on the brand, snapshotted onto the order like the terms are, so the
-- dashboard can show the introduced business as what it actually is. Without
-- that, switching the goods out of the sales figures would make the DRAG
-- business vanish from the accounts entirely, which is a different lie.
-- ============================================================================

-- ── what the brand pays us ──────────────────────────────────────────────────

alter table brands add column if not exists commission_rate numeric(5,2) not null default 0
  check (commission_rate >= 0 and commission_rate <= 100);
comment on column brands.commission_rate is
  'Percent of the goods value this brand pays us for introducing the order.';

-- Snapshotted with the terms, and for the same reason: renegotiating the rate
-- next year must not restate what we earned on an order placed today.
alter table orders add column if not exists commission_rate numeric(5,2);
comment on column orders.commission_rate is
  'The introducing commission rate in force when this order was placed.';

/**
 * Stamps the order with the terms and the rate it was placed under.
 *
 * Replaces 0034's version: same rule about mixing, one more column.
 */
create or replace function public.snapshot_agency_terms()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select o.id as order_id,
           count(*) filter (where b.agency) as agency_lines,
           count(*) filter (where b.agency is not true) as own_lines,
           (array_agg(distinct b.id) filter (where b.agency))[1] as brand_id,
           count(distinct b.id) filter (where b.agency) as agency_brands
      from (select distinct order_id from new_lines) n
      join orders o on o.id = n.order_id
      join order_lines l on l.order_id = o.id
      left join products p on p.id = l.product_id
      left join brands b on b.id = p.brand_id
     group by o.id
  loop
    if r.agency_lines > 0 and r.own_lines > 0 then
      raise exception 'An order cannot hold both goods we sell and goods we only '
                      'introduce — they are invoiced by different companies. '
                      'Raise the introduced lines as their own order.';
    end if;
    if r.agency_brands > 1 then
      raise exception 'An order can only be introduced to one brand: each of them '
                      'invoices the customer separately.';
    end if;
    if r.agency_lines > 0 then
      update orders
         set agent_brand_id = r.brand_id,
             agency_terms = coalesce(
               orders.agency_terms,
               (select b2.agency_terms from brands b2 where b2.id = r.brand_id)),
             commission_rate = coalesce(
               orders.commission_rate,
               (select b2.commission_rate from brands b2 where b2.id = r.brand_id))
       where orders.id = r.order_id;
    end if;
  end loop;
  return null;
end $$;

-- ── the document that is not a demand ───────────────────────────────────────

alter table invoices add column if not exists agency boolean not null default false;
comment on column invoices.agency is
  'This document acknowledges an order the brand will invoice. It asks for '
  'nothing, carries no VAT, is never paid here and is never a sale of ours.';

/**
 * Takes the currency and the agency standing from the order.
 *
 * Replaces 0027's currency-only version. Both are facts about the order that
 * every document raised against it must agree with, and reading them from one
 * place is the only way that stays true through splits, credits and reissues.
 *
 * The VAT and the due date follow from the standing rather than being set by
 * each caller: place_order, the invoice split and the historic import all
 * raise invoices, and a rule that has to be remembered in three places is a
 * rule that holds in two.
 */
create or replace function public.invoice_currency_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_agent uuid;
begin
  select currency, agent_brand_id into new.currency, v_agent
    from orders where id = new.order_id;

  new.agency := v_agent is not null;
  if new.agency then
    -- No supply by us, so no tax by us; and nothing to chase, so no date that
    -- reads as a deadline.
    new.vat_rate := 0;
    new.due_date := new.date;
  end if;
  return new;
end $$;

-- Anything already raised against an introduced order is one of these, and
-- was raised before this existed.
update invoices i
   set agency = true, vat_rate = 0, due_date = i.date
  from orders o
 where o.id = i.order_id
   and o.agent_brand_id is not null
   and not i.agency;

/**
 * Payment we are not owed cannot be recorded as received.
 *
 * Replaces 0019's version, which refused a proforma and a credit note for the
 * same reason: a document that asks for nothing must not be settleable. This
 * one matters more, because marking it paid would release the goods into the
 * packing queue as though we were shipping them.
 */
create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_paid_date  date default null,
  p_source     text default 'manual'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_date date; v_brand text;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.paid then return; end if;

  if v_inv.agency then
    select b.name into v_brand
      from orders o join brands b on b.id = o.agent_brand_id
     where o.id = v_inv.order_id;
    raise exception 'That order was introduced to %. They invoice the customer '
                    'and they collect — nothing on this document is owed to us',
                    coalesce(v_brand, 'the brand');
  end if;
  if v_inv.type = 'proforma' then
    raise exception 'A proforma asks for no payment. Raise the invoice first';
  end if;
  if v_inv.type = 'credit' then
    raise exception 'A credit note is money owed back, not a payment to receive';
  end if;
  if v_inv.superseded then
    raise exception 'That invoice has been superseded — pay the one that replaced it';
  end if;

  v_date := coalesce(p_paid_date, current_date);
  if v_date > current_date then
    raise exception 'That payment date is in the future';
  end if;
  if v_date < v_inv.date then
    raise exception 'That is before the invoice was raised on %', to_char(v_inv.date, 'DD Mon YYYY');
  end if;

  update invoices set paid = true, paid_date = v_date where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'payment_received',
          jsonb_build_object('invoice', v_inv.number, 'source', p_source, 'date', v_date));

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'mark_paid',
          jsonb_build_object('source', p_source, 'date', v_date));
end $$;

-- ── the figures ─────────────────────────────────────────────────────────────
--
-- Goods we introduced are not our revenue and their margin is not our margin,
-- so the three reports that answer "what did we sell" stop counting them.
-- They are not lost: agency_commission() below reports them as what they are.

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
       and o.agent_brand_id is null
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
      join order_line_costs c  on c.order_line_id = l.id
     where o.status <> 'cancelled'
       and o.agent_brand_id is null
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
     and o.agent_brand_id is null
     and o.currency = p_currency
     and o.date between p_from and p_to
   group by cl.id, cl.name
   order by 5 desc, 4 desc, cl.name
   limit greatest(1, coalesce(p_limit, 5));
end $$;

/**
 * What the introduced business was worth to us.
 *
 * The goods value is reported alongside the commission and never instead of
 * it: it is the number the brand will invoice and the number we would be
 * asked about, but it was never ours. A brand on a zero rate still appears,
 * with a commission of nothing — an arrangement nobody has priced yet is
 * something to see rather than something to hide.
 *
 * `rate` is null where the orders in the period were placed at more than one;
 * see below for why an average is not offered in its place.
 */
create or replace function public.agency_commission(
  p_from date, p_to date, p_currency text default 'GBP'
)
returns table (
  brand_id uuid, brand_name text, orders integer,
  goods numeric, rate numeric, commission numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with per_order as (
    select o.agent_brand_id as brand,
           o.id             as order_id,
           coalesce(o.commission_rate, 0) as rate,
           sum(l.qty * l.unit_price)      as goods
      from orders o
      join order_lines l on l.order_id = o.id
     where o.status <> 'cancelled'
       and o.agent_brand_id is not null
       and o.currency = p_currency
       and o.date between p_from and p_to
     group by o.id, o.agent_brand_id, o.commission_rate
  )
  select b.id, b.name,
         count(*)::integer,
         sum(p.goods)::numeric,
         /*
          * The rate, only where there is one.
          *
          * Where the rate changed mid-period there is no single number that
          * both describes the orders and reproduces the commission: a
          * weighted average rounded to two places multiplies back out to a
          * different figure, so the row would invite a hand-check it then
          * fails. Null says "several", which is the truth, and the goods and
          * the commission beside it are exact either way.
          */
         case when count(distinct p.rate) = 1 then max(p.rate) end::numeric,
         round(sum(p.goods * p.rate) / 100, 2)::numeric
    from per_order p
    join brands b on b.id = p.brand
   group by b.id, b.name
   order by 6 desc, b.name;
end $$;

-- DRAG's rate is not something this migration can know, so it is left at zero
-- and shows on the brands screen as an arrangement still to be priced.
