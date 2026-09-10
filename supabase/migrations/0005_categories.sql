-- ============================================================================
-- 0005: product categories.
--
-- Price sheets carry a SKU, a description and a price — never a category — so
-- categories are derived from the description when a sheet is imported. The
-- rules live in src/lib/catalogue/categories.ts; this migration holds the
-- categories themselves and the column that points at them.
-- ============================================================================

create table if not exists categories (
  id   uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort integer not null default 0
);

alter table products add column if not exists category_id uuid references categories(id);
create index if not exists products_category_idx on products (category_id) where active;

alter table categories enable row level security;

-- Any signed-in user may read the category list; a client needs it to filter
-- their catalogue. Only staff may change it.
drop policy if exists categories_read on categories;
create policy categories_read on categories for select using (auth.uid() is not null);

drop policy if exists categories_staff_write on categories;
create policy categories_staff_write on categories for all
  using (is_staff()) with check (is_staff());

-- Keep these in step with CATEGORIES in src/lib/catalogue/categories.ts.
insert into categories (slug, name, sort) values
  ('brake-pads',      'Brake pads',              10),
  ('rotors',          'Disc rotors',             20),
  ('brakes',          'Brakes & levers',         30),
  ('chains',          'Chains',                  40),
  ('chainsets',       'Chainsets & cranks',      50),
  ('chainrings',      'Chainrings',              60),
  ('cassettes',       'Cassettes & sprockets',   70),
  ('derailleurs',     'Derailleurs',             80),
  ('shifters',        'Shifters',                90),
  ('bottom-brackets', 'Bottom brackets',        100),
  ('pulleys',         'Pulleys & jockey wheels',110),
  ('bearings',        'Bearings',               120),
  ('headsets',        'Headsets',               130),
  ('hubs',            'Hubs',                   140),
  ('wheels',          'Wheels & rims',          150),
  ('spokes',          'Spokes & nipples',       160),
  ('tyres',           'Tyres',                  170),
  ('tubes',           'Inner tubes',            180),
  ('pedals',          'Pedals & cleats',        190),
  ('handlebars',      'Handlebars & tape',      200),
  ('stems',           'Stems',                  210),
  ('seatposts',       'Seatposts',              220),
  ('saddles',         'Saddles',                230),
  ('cables',          'Cables & housing',       240),
  ('tools',           'Tools',                  250),
  ('lubricants',      'Lubricants & care',      260)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- The client-facing view gains the category, so the portal can filter on it.
--
-- The tier is pinned to the signed-in client's own tier rather than left to
-- RLS to narrow. Both work for a real client, but relying on RLS alone means
-- any caller it does not filter — the service role, a future admin tool — gets
-- an arbitrary tier's prices back, silently and plausibly. Naming the tier
-- makes the view correct on its own, with RLS as a second line rather than the
-- only one. Availability is still only ever a boolean.
drop view if exists client_catalogue;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  c.slug as category_slug,
  c.name as category_name,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c.tier_id from clients c where c.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;
