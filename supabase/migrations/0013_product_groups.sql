-- ============================================================================
-- 0013: variants and build-your-own kits.
--
-- A tyre in five sizes, and a groupset the customer specs themselves, look
-- like different features but are the same shape underneath — and neither
-- needs a new kind of product. Every size and every component is already a
-- real SKU on the price list, with its own tier price and its own stock; what
-- is missing is a way to present them as one thing to choose from.
--
-- So a group holds ordered steps, and each step offers options that point at
-- products that already exist:
--
--   Continental GP5000     → one step  "Size"     → 700x25 / 700x28 / 700x32
--   Dura-Ace R9200 build   → steps     "Chainset" → 170mm 52-36 / 172.5mm …
--                                      "Cassette" → 11-30 / 11-34
--                                      "Rotors"   → 140mm / 160mm
--
-- One step reads as a variant picker, several read as a builder. There is no
-- kind column deciding which: the number of steps already says it, and a flag
-- that could disagree with the steps is a state worth not having.
--
-- Nothing here holds a price. Pricing stays in tier_prices against the real
-- product, so a group can never quote a figure the catalogue would not honour.
-- ============================================================================

create table if not exists product_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  brand       text,
  description text,
  category_id uuid references categories(id) on delete set null,
  image_url   text,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint product_groups_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists product_groups_category_idx
  on product_groups (category_id) where active;

create table if not exists product_group_steps (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references product_groups(id) on delete cascade,
  name     text not null,
  hint     text,
  -- How many of the chosen option one kit needs: two rotors, one cassette.
  qty      integer not null default 1 check (qty > 0),
  -- A step nobody has to answer, such as an optional power meter.
  required boolean not null default true,
  sort     integer not null default 0
);
create index if not exists product_group_steps_group_idx
  on product_group_steps (group_id, sort);

create table if not exists product_group_options (
  id      uuid primary key default gen_random_uuid(),
  step_id uuid not null references product_group_steps(id) on delete cascade,
  -- Cascade: a product deleted from the catalogue must not leave an option
  -- pointing at nothing for a customer to pick.
  product_id uuid not null references products(id) on delete cascade,
  -- What the customer sees on the button. Falls back to the product name.
  label   text,
  sort    integer not null default 0,
  unique (step_id, product_id)
);
create index if not exists product_group_options_step_idx
  on product_group_options (step_id, sort);

-- ── who sees what ───────────────────────────────────────────────────────────
alter table product_groups       enable row level security;
alter table product_group_steps  enable row level security;
alter table product_group_options enable row level security;

-- Read by anyone signed in, exactly like products and categories: the group
-- carries no price, so there is nothing tier-specific to leak. Writes are
-- staff-only, as with the rest of the catalogue.
drop policy if exists product_groups_read on product_groups;
create policy product_groups_read on product_groups for select
  using (active or is_staff());
drop policy if exists product_groups_staff_write on product_groups;
create policy product_groups_staff_write on product_groups for all
  using (is_staff()) with check (is_staff());

drop policy if exists product_group_steps_read on product_group_steps;
create policy product_group_steps_read on product_group_steps for select using (true);
drop policy if exists product_group_steps_staff_write on product_group_steps;
create policy product_group_steps_staff_write on product_group_steps for all
  using (is_staff()) with check (is_staff());

drop policy if exists product_group_options_read on product_group_options;
create policy product_group_options_read on product_group_options for select using (true);
drop policy if exists product_group_options_staff_write on product_group_options;
create policy product_group_options_staff_write on product_group_options for all
  using (is_staff()) with check (is_staff());

-- ── what a client may actually choose ───────────────────────────────────────
-- An option is only offerable if the product behind it is still active and
-- carries a price on the asking client's tier. Without this a build could show
-- a step whose every option prices at nothing, and place_order would then bill
-- a line the catalogue never quoted.
--
-- security_invoker so client_catalogue's own RLS decides the rows, which is
-- what pins each client to their own tier.
create or replace view client_group_options
with (security_invoker = true) as
select o.id           as option_id,
       s.group_id,
       o.step_id,
       o.product_id,
       coalesce(nullif(trim(o.label), ''), c.name) as label,
       o.sort,
       c.sku,
       c.name         as product_name,
       c.price,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;
