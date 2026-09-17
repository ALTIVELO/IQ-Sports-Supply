-- ============================================================================
-- 0021: collections you configure rather than pick from.
--
-- A groupset is specified, not chosen off a shelf: crank length, chainring,
-- cassette, rotors, wires. The builder does that, and does it properly.
--
-- The supplier's own price list also carries half a dozen fixed-spec bundle
-- SKUs, which import and file themselves under Groupsets like any other
-- product. Beside four builders they are worse than redundant — they offer a
-- customer a groupset they cannot spec, at a price the builder would have
-- matched anyway, and the obvious reading of two lists on one page is that
-- they are different things.
--
-- So a category can say that it is served by its builders. The products stay
-- in the catalogue — staff price them, cost them and margin them like anything
-- else, and the bundle price is what the builder's total is checked against —
-- they simply stop being offered loose.
-- ============================================================================

alter table categories
  add column if not exists configurator_only boolean not null default false;

comment on column categories.configurator_only is
  'Clients see this collection''s configurators, not its loose products. '
  'Staff see everything, always: this changes what is offered, not what exists.';

update categories set configurator_only = true where slug = 'groupsets';

-- The flag has to reach the client, so it joins the catalogue view. It is a
-- column rather than a filter on purpose: client_group_options is built on
-- this view, and filtering here would delete from every builder any option
-- that happened to be filed in a configured collection.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
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

-- Dropped by the cascade above, and unchanged from 0014.
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
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;
