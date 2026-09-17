-- ============================================================================
-- 0031: the brands we sell for, looking at their own shelf.
--
-- Some of what IQ sells is not IQ's. A brand leaves stock here on consignment
-- and is paid when it sells; another has us take the order and ships it
-- themselves. Both want the same two things — what sold, and what they are
-- owed — and neither may see anything belonging to anyone else.
--
-- That last clause is the whole design. A partner is not a smaller member of
-- staff: they are an outsider with a login, and the interesting question is
-- not what they can be shown but what they cannot reach. So:
--
--   * a partner reads no table directly. Every figure comes from a function
--     that filters by the brands they are attached to, and there is no query
--     they can write that widens it;
--   * products_read, which until now let anyone signed in list the whole
--     catalogue, stops doing that for a partner;
--   * nothing anywhere hands a partner another client's prices. What sold and
--     for how much is theirs; who else buys what, at what discount, is not.
--
-- Brand is a text column on products and always has been, filled by whatever
-- the supplier's sheet said. Matching a partner to their stock on that text
-- would mean a typo silently showing one brand another's sales, so brands
-- become rows and products carry the id — kept in step by a trigger, so no
-- import has to know this happened.
-- ============================================================================

-- ADD VALUE commits on its own here (psql autocommits each statement), so the
-- policies below can refer to the new role.
alter type user_role add value if not exists 'partner';

create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  -- Normalised, so "DRAG", "Drag " and "drag" are one brand and not three.
  key         text not null unique,
  name        text not null,
  /** They leave stock with us and are paid as it sells. */
  consignment boolean not null default false,
  /**
   * Whether their portal shows what the goods sold for as well as what they
   * are owed. On consignment the two are inches apart and a partner can work
   * out the difference anyway, but it is a disclosure and so it is a choice.
   */
  shows_margin boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table products add column if not exists brand_id uuid references brands(id);
alter table products add column if not exists dropship boolean not null default false;

comment on column products.dropship is
  'The brand ships this themselves. An order for it notifies them.';

create index if not exists products_brand_idx on products (brand_id);

/**
 * Keeps products.brand_id in step with the brand somebody typed.
 *
 * A trigger rather than a change to the importer, because the brand arrives
 * from four different screens and a supplier's spreadsheet, and every one of
 * them would have to remember. Unknown brands are created rather than
 * rejected: the catalogue is the record of what we sell, and refusing a
 * product because nobody had set its brand up first would make an import fail
 * for a reason that has nothing to do with the import.
 */
create or replace function public.sync_product_brand()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  v_key := nullif(lower(trim(coalesce(new.brand, ''))), '');
  if v_key is null then
    new.brand_id := null;
    return new;
  end if;

  select id into v_id from brands where key = v_key;
  if v_id is null then
    insert into brands (key, name) values (v_key, trim(new.brand))
    on conflict (key) do update set key = excluded.key
    returning id into v_id;
  end if;

  new.brand_id := v_id;
  return new;
end $$;

drop trigger if exists products_brand_sync on products;
create trigger products_brand_sync
  before insert or update of brand on products
  for each row execute function public.sync_product_brand();

-- Everything already in the catalogue, filed under the brand it already had.
insert into brands (key, name)
select distinct lower(trim(brand)), trim(brand)
  from products
 where nullif(trim(coalesce(brand, '')), '') is not null
on conflict (key) do nothing;

update products p set brand_id = b.id
  from brands b
 where b.key = lower(trim(p.brand))
   and p.brand_id is distinct from b.id;

-- ── who a partner is ────────────────────────────────────────────────────────

create table if not exists brand_partners (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  -- Set on first sign-in, the way a client's is. Until then the address is
  -- the only thing linking the invitation to a person.
  auth_user_id uuid references auth.users(id) on delete set null,
  email        text not null,
  name         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists brand_partners_email_idx
  on brand_partners (brand_id, lower(email));
create index if not exists brand_partners_user_idx
  on brand_partners (auth_user_id) where auth_user_id is not null;

/** The brands this login speaks for. Empty for everyone who is not a partner. */
create or replace function public.my_brand_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select bp.brand_id from brand_partners bp
   where bp.auth_user_id = auth.uid() and bp.active;
$$;

create or replace function public.is_partner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role::text from profiles where id = auth.uid()) = 'partner', false);
$$;

/**
 * The brands a caller may ask about.
 *
 * A partner gets theirs and nothing else, whatever they pass. Staff may name
 * one, which is how somebody on the phone can see the screen a partner is
 * looking at; passing nothing as staff asks about every brand.
 */
create or replace function public.brands_in_scope(p_brand uuid default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id
    from brands b
   where (p_brand is null or b.id = p_brand)
     -- Definer, so brands' own policy is not what filters this: the condition
     -- is written out here where it can be read, and a partner naming another
     -- brand gets an empty set rather than an error they could probe with.
     and (is_staff() or b.id in (select my_brand_ids()));
$$;

-- ── a partner cannot list the catalogue ─────────────────────────────────────

-- Until now this was "anyone signed in". A partner signing in would have been
-- handed every SKU we stock, which is most of what a competitor would want.
drop policy if exists products_read on products;
create policy products_read on products for select using (
  auth.uid() is not null
  and (not is_partner() or brand_id in (select my_brand_ids()))
);

alter table brands enable row level security;
alter table brand_partners enable row level security;

drop policy if exists brands_staff on brands;
create policy brands_staff on brands for all using (is_staff()) with check (is_staff());
drop policy if exists brands_own on brands;
create policy brands_own on brands for select using (id in (select my_brand_ids()));

drop policy if exists brand_partners_staff on brand_partners;
create policy brand_partners_staff on brand_partners for all
  using (is_staff()) with check (is_staff());
drop policy if exists brand_partners_self on brand_partners;
create policy brand_partners_self on brand_partners for select
  using (auth_user_id = auth.uid());
