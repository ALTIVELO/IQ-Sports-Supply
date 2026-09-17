-- ============================================================================
-- 0028: one bike, several frames — and what a price does not include.
--
-- A bike is not one line on a price list. DRAG build the Ronin CF 7.0 in S, M,
-- L, XL and XXL, and a shop ordering one is ordering a size: the size is the
-- thing that gets picked, stocked, allocated and shipped, and two sizes of the
-- same bike are two different objects in a warehouse.
--
-- So each size is its own product, with its own SKU, its own cost and its own
-- stock — everything downstream of the catalogue already works that way and
-- needs no changes at all. What is added here is only the fact that a set of
-- products are sizes of one thing, so the catalogue can offer them as one
-- product with a size to pick rather than five lines that look like five
-- bikes.
--
-- Deliberately not the configurator from 0013. A groupset is specified over
-- several steps and the builder exists for that; a frame size is one choice
-- from a short list, and sending somebody to a multi-step builder to answer it
-- would be worse than the five lines.
--
-- price_note is the other half. DRAG quote ex-works in euros: no import duty,
-- no VAT. VAT the system already adds at checkout, duty it cannot know — so
-- the price carries a note saying so, and the note follows it onto every
-- screen a customer sees a price on, and onto the invoice.
-- ============================================================================

alter table products add column if not exists variant_group text;
alter table products add column if not exists variant_label text;
alter table products add column if not exists variant_sort  integer;
alter table products add column if not exists price_note    text;

comment on column products.variant_group is
  'Shared by every size of one bike. Null for a product sold as one thing.';
comment on column products.variant_label is
  'This product''s size, as the customer picks it: S, M, L, 440.';
comment on column products.variant_sort is
  'Where this size sits in the range. XS before S before M, not alphabetical.';
comment on column products.price_note is
  'What this price does not include, shown wherever a customer sees it.';

do $$
begin
  -- A group with no label would be a size nobody can name, and a label with no
  -- group is a size of nothing. Either on its own is a half-written import.
  if not exists (select 1 from pg_constraint where conname = 'products_variant_pair') then
    alter table products add constraint products_variant_pair check (
      (variant_group is null and variant_label is null)
      or (variant_group is not null and variant_label is not null)
    );
  end if;
end $$;

-- Two products claiming the same size of the same bike is a catalogue that
-- cannot say what was ordered. Case-insensitive, because "M" and "m" are one
-- size however the spreadsheet spelled them.
create unique index if not exists products_variant_unique
  on products (variant_group, lower(variant_label))
  where variant_group is not null;

create index if not exists products_variant_group_idx
  on products (variant_group) where variant_group is not null;

-- ── the catalogue carries both to the client ────────────────────────────────

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
  p.price_note,
  p.variant_group,
  p.variant_label,
  p.variant_sort,
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

-- Dropped by the cascade above. Unchanged from 0027.
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
