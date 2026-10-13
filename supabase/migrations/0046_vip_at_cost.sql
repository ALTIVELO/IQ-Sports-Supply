-- ============================================================================
-- 0046: VIP — a tier that is our cost price.
--
-- The four tiers are each a number per product per date, typed in or imported.
-- VIP is not that. It is the cost itself, and the difference matters: a VIP
-- price list that was copied out of the costs on the day it was made is wrong
-- the next time Madison reprice, and nobody would notice, because a stale
-- number looks exactly like a current one.
--
-- So the tier carries a flag rather than a price list, and every place a price
-- is read asks for the cost when the flag is set. Import a sheet, and VIP has
-- moved with it. There is nothing to re-run and nothing to forget.
--
-- What this means commercially, stated plainly because the schema cannot say
-- it: a client on VIP is charged exactly what we paid, so the margin on their
-- orders is zero, and the figures they read in the portal and on their invoice
-- are our buy prices. That is what was asked for. It is not a discount band —
-- it is the floor, and there is nothing underneath it.
--
-- Costs are staff-only under RLS, which is the reason this is a function with
-- a guard on it rather than a join in a view. A VIP client may read the cost
-- of what they can buy; nobody may read anybody else's tier, and a client on
-- another tier learns nothing at all.
-- ============================================================================

alter table tiers add column if not exists at_cost boolean not null default false;

comment on column tiers.at_cost is
  'When true the tier has no price list: its price is whatever the product '
  'costs us on the day, and any tier_prices rows against it are ignored.';

insert into tiers (name, sort, at_cost) values ('VIP', 0, true)
on conflict (name) do update set at_cost = excluded.at_cost, sort = excluded.sort;

/**
 * What one product costs one tier, on one day.
 *
 * The single place that knows a tier can be priced at cost, so the catalogue,
 * the order and the staff screens cannot drift apart on what VIP means.
 *
 * Definer, because the cost lives in a table only staff may read and a VIP
 * customer has to be able to see their own prices. Guarded, because that is
 * the whole of what definer buys: staff may ask about any tier, and anybody
 * else only about the tier they are on, for something they could buy anyway.
 */
create or replace function public.tier_rate(
  p_product uuid, p_tier uuid, p_on date default current_date
) returns table (price numeric, break_price numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_at_cost boolean;
begin
  select t.at_cost into v_at_cost from tiers t where t.id = p_tier;
  if v_at_cost is null then return; end if;

  if not is_staff() then
    if p_tier is distinct from (select c.tier_id from clients c where c.id = my_client_id())
       or not exists (select 1 from products p where p.id = p_product and p.active) then
      return;
    end if;
  end if;

  if v_at_cost then
    /*
     * The carton price is not a different cost.
     *
     * break_cost is almost always null, and deliberately: we buy by the outer
     * and ship loose units out of a carton already paid for, so what a part
     * costs us does not move with how many a customer takes. A VIP buying one
     * therefore pays the same as a VIP buying ten, which is the honest answer
     * when the price is the cost.
     */
    return query
      select pc.cost, pc.break_cost
        from product_costs pc
       where pc.product_id = p_product and pc.effective_from <= p_on
       order by pc.effective_from desc
       limit 1;
  else
    return query
      select tp.price, tp.break_price
        from tier_prices tp
       where tp.product_id = p_product and tp.tier_id = p_tier
         and tp.effective_from <= p_on
       order by tp.effective_from desc
       limit 1;
  end if;
end $$;

-- ── what a customer is charged ──────────────────────────────────────────────
-- Unchanged in shape: the quantity still decides between the two figures. Only
-- where the two figures come from has moved.
create or replace function public.price_for_qty(
  p_product uuid, p_tier uuid, p_qty integer, p_on date default current_date
) returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when p_qty < coalesce(p.moq, 1) and r.break_price is not null
             then r.break_price
           else r.price
         end
    from products p
    join lateral tier_rate(p.id, p_tier, p_on) r on true
   where p.id = p_product;
$$;

-- ── what the staff screens read ─────────────────────────────────────────────
/*
 * A tier priced at cost has no rows of its own, so they are made here.
 *
 * Its own tier_prices rows are left out rather than preferred: if somebody
 * once typed or imported a VIP figure, the flag is what decides, and a tier
 * that sometimes meant cost and sometimes meant a number would be worse than
 * either.
 */
create or replace function public.current_tier_prices(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, tier_id uuid, price numeric, break_price numeric)
language sql stable security invoker set search_path = public as $$
  -- Parenthesised: the ORDER BY belongs to the DISTINCT ON above it, not to
  -- the union, and unbracketed Postgres reads it as the union's.
  (select distinct on (tp.product_id, tp.tier_id)
          tp.product_id, tp.tier_id, tp.price, tp.break_price
     from tier_prices tp
     join tiers t on t.id = tp.tier_id and not t.at_cost
    where tp.product_id = any(p_products)
      and tp.effective_from <= p_on
    order by tp.product_id, tp.tier_id, tp.effective_from desc)
  union all
  (select c.product_id, t.id, c.cost, c.break_cost
     from tiers t
     cross join lateral (select * from current_costs(p_products, p_on)) c
    where t.at_cost);
$$;

-- ── what a customer sees ────────────────────────────────────────────────────
-- Rebuilt because the lateral that prices it has changed. client_group_options
-- reads this view, so it goes with it and comes back unchanged.
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
  coalesce(p.moq, 1) as moq,
  tp.break_price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select cl.tier_id, r.price, r.break_price
    from clients cl
    join lateral tier_rate(p.id, cl.tier_id) r on true
   where cl.id = my_client_id()
     -- Still an inner join in effect: a product nothing prices on this tier is
     -- not in the catalogue, because a product with no price would read as
     -- free. For VIP that means a product we have never costed.
     and r.price is not null
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
