-- ============================================================================
-- 0020: what a product costs us, and what an order earns.
--
-- Cost gets its own table rather than a column, for two reasons.
--
-- It is dated, exactly like a sell price. A margin worked out for a March
-- order should use March's cost and must not move when the supplier reprices
-- in June, so the history is kept and nothing is ever overwritten.
--
-- And it is ours alone. RLS is row-level: a cost column on products or on
-- order_lines — both of which a signed-in client reads — would hand every
-- customer our buying price and our margin. A separate table can simply have
-- no client policy at all, which is a much shorter thing to get right.
-- ============================================================================

create table if not exists product_costs (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  cost           numeric(12,2) not null check (cost >= 0),
  -- Who we buy it from, where a price list says. Free text for now: there is
  -- one supplier, and inventing a supplier table before there are two of them
  -- buys nothing.
  supplier       text,
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  unique (product_id, effective_from)
);
create index if not exists product_costs_lookup_idx
  on product_costs (product_id, effective_from desc);

-- What a line of an order cost us, fixed at the moment it was placed.
--
-- Kept beside order_lines rather than on it, because a client may read their
-- own order lines and may never read this.
create table if not exists order_line_costs (
  order_line_id uuid primary key references order_lines(id) on delete cascade,
  unit_cost     numeric(12,2) not null check (unit_cost >= 0)
);

alter table product_costs    enable row level security;
alter table order_line_costs enable row level security;

drop policy if exists product_costs_staff on product_costs;
create policy product_costs_staff on product_costs
  for all using (is_staff()) with check (is_staff());

drop policy if exists order_line_costs_staff on order_line_costs;
create policy order_line_costs_staff on order_line_costs
  for all using (is_staff()) with check (is_staff());

-- No client policy on either table, deliberately. RLS denies by default, so
-- the absence of a policy is the rule.

/**
 * What a product cost us on a given day, or null if we never recorded it.
 *
 * Security INVOKER, unlike current_tier_price beside it. A client is entitled
 * to be told their own price and calls that one directly; nobody outside the
 * company is entitled to this, so it runs under the caller's own permissions
 * and RLS returns them nothing.
 */
create or replace function public.current_cost(
  p_product uuid, p_on date default current_date
) returns numeric
language sql stable security invoker set search_path = public as $$
  select cost from product_costs
   where product_id = p_product and effective_from <= p_on
   order by effective_from desc
   limit 1;
$$;

/**
 * Records what a line cost us, as the line is created.
 *
 * A trigger rather than a step inside place_order, because order lines are
 * also written by edit_order and by import_historic_order, and a margin that
 * depends on three functions each remembering to do the same thing is a
 * margin that will one day be wrong. Runs as definer: the client placing the
 * order cannot read product_costs, but the line still has to be priced.
 */
create or replace function public.snapshot_order_line_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_on date; v_cost numeric;
begin
  if new.product_id is null then return new; end if;

  select date into v_on from orders where id = new.order_id;

  select cost into v_cost from product_costs
   where product_id = new.product_id
     and effective_from <= coalesce(v_on, current_date)
   order by effective_from desc
   limit 1;

  -- Nothing recorded for this product yet. The line stands; refill_order_line_costs
  -- fills it in once a cost is imported.
  if v_cost is null then return new; end if;

  insert into order_line_costs (order_line_id, unit_cost)
  values (new.id, v_cost)
  on conflict (order_line_id) do update set unit_cost = excluded.unit_cost;

  return new;
end $$;

drop trigger if exists order_lines_cost_snapshot on order_lines;
create trigger order_lines_cost_snapshot
  after insert on order_lines
  for each row execute function snapshot_order_line_cost();

/**
 * Fills in the cost of order lines that have none, from the cost in force on
 * the day the order was placed.
 *
 * Costs usually arrive after the orders do — the first price list is imported
 * over a system that has already been selling. This catches those up, and
 * never touches a line that already has a cost: once recorded, what a sale
 * cost us is history and does not get revised.
 */
create or replace function public.refill_order_line_costs()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  insert into order_line_costs (order_line_id, unit_cost)
  select l.id, c.cost
    from order_lines l
    join orders o on o.id = l.order_id
    join lateral (
      select pc.cost from product_costs pc
       where pc.product_id = l.product_id and pc.effective_from <= o.date
       order by pc.effective_from desc
       limit 1
    ) c on true
   where l.product_id is not null
     and not exists (select 1 from order_line_costs x where x.order_line_id = l.id);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- A price import now carries cost as well as sell prices, so the audit row
-- says how much of each it moved.
alter table price_imports add column if not exists costs_changed integer not null default 0;

-- ── saved import layouts ────────────────────────────────────────────────────
-- A price file now describes every tier at once, so its saved column mapping
-- is no longer per tier: it is keyed (scope, null).
--
-- Which exposes a constraint that never worked. Postgres counts nulls as
-- distinct by default, so `unique (scope, tier_id)` never fired for the scopes
-- that always had a null tier — saving a mapping twice quietly left two rows,
-- and the screen picked whichever came back first.
delete from import_templates a
 using import_templates b
 where a.scope = b.scope
   and a.tier_id is not distinct from b.tier_id
   and a.updated_at < b.updated_at;

-- A layout still keyed to a tier is from before, and its mapping names a
-- single "price" column that no longer means anything.
delete from import_templates where scope = 'prices' and tier_id is not null;

alter table import_templates drop constraint if exists import_templates_scope_tier_id_key;
create unique index if not exists import_templates_scope_tier_idx
  on import_templates (scope, tier_id) nulls not distinct;
