-- ============================================================================
-- 0036: the range a part belongs to.
--
-- "Shimano" is a brand and "FC-R9200" is a model, but the word a shop actually
-- uses is neither: they ask for a Dura-Ace chainset, or an Ultegra cassette.
-- That middle level — the series — was nowhere in the catalogue, so a screen
-- could show a customer eighteen Shimano chainsets and leave them to work out
-- from the part number which ones were the good ones.
--
-- It is a column rather than a category because a series cuts across
-- categories: Dura-Ace is a chainset and a cassette and a rotor and a
-- derailleur. Filing by series would break filing by what the thing is, and
-- the thing is what somebody browses by.
--
-- Nullable, and blank for most of the catalogue. A bottom bracket belongs to
-- no range, and a made-up one would be worse than none.
--
-- The rest of this file teaches the variant deriver about rotors. 0030 gave it
-- chainsets, cassettes and wires and left rotors out, because a rotor states
-- its size nowhere in its name — it is in the part number, where the same
-- letters also carry the lockring type. Two rotors of one size and different
-- lockrings are two products, so the label has to keep both.
-- ============================================================================

alter table products add column if not exists series text;
comment on column products.series is
  'The range this part belongs to — Dura-Ace, Ultegra, Di2. Blank where the '
  'product belongs to no range, which is most of a catalogue.';

create index if not exists products_series_idx on products (lower(series))
  where series is not null;

/**
 * A rotor's size and what else its part number says.
 *
 * RT-CL900-L is 203mm; RT-CL900-LE and RT-CL900-LI are also 203mm and are
 * different products. So the size is read out and whatever follows it is kept
 * in brackets rather than discarded: "203mm" and "203mm (E)" are two labels a
 * person can tell apart, and "203mm" twice is a unique-index violation and a
 * customer ordering the wrong disc.
 *
 * The letters are not decoded beyond the size. E and I are almost certainly
 * the lockring serration and J is something else again, but this file does
 * not know that, and a label that asserted it would be a guess printed in a
 * catalogue. The code is shown as the supplier writes it.
 */
create or replace function public.rotor_label_for(p_sku text)
returns text language sql immutable as $$
  with parts as (
    -- Two or three digits: the model number. A greedy run would swallow the
    -- 200 of RT-CL750-200E and leave nothing for the size to be read from.
    select substring(upper(coalesce(p_sku, '')) from '^(?:RTCL|SMRT)\d{2,3}(.*)$') as tail
  ),
  read as (
    select tail,
           case
             when tail ~ '^200' then '200mm'
             when tail ~ '^220' then '220mm'
             when tail ~ '^SS'  then '140mm'
             when tail ~ '^S'   then '160mm'
             when tail ~ '^M'   then '180mm'
             when tail ~ '^L'   then '203mm'
           end as size,
           -- As many characters as the size took: three for 200 and 220,
           -- two for SS, one for the rest. Reading SS as one character would
           -- leave an "S" in front of the lockring code.
           case
             when tail ~ '^(200|220)' then substring(tail from 4)
             when tail ~ '^SS'        then substring(tail from 3)
             when tail ~ '^[SML]'     then substring(tail from 2)
           end as rest
      from parts
  )
  select case
           when size is null then null
           when coalesce(rest, '') = '' then size
           else size || ' (' || rest || ')'
         end
    from read;
$$;

/**
 * The part of a rotor's name that is the model.
 *
 * Taken from the part number rather than the description, because the
 * description is the part number: "Shimano Disc Rotor RTCL900LJ". Strip the
 * size and lockring code off the end and RTCL900 is what is left, which is the
 * model every one of them is a size of.
 */
create or replace function public.rotor_model_for(p_sku text)
returns text language sql immutable as $$
  select substring(upper(coalesce(p_sku, '')) from '^((?:RTCL|SMRT)\d{2,3})');
$$;

-- 0030's take one argument and these take two with a default, so both would
-- answer a one-argument call and Postgres refuses to choose. The old pair goes
-- first; every caller is in this file or in the suites, and both are updated.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('variant_model_key', 'variant_label_for')
       and p.pronargs = 1
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

/**
 * What distinguishes this product from the others of its model.
 *
 * Replaces 0030's, which read cassettes, chainrings and lengths out of the
 * name. A rotor has none of those in its name, so the part number is asked
 * last — last, because a name that states its size is always the better
 * source, and only a rotor gets this far with nothing found.
 */
create or replace function public.variant_label_for(p_name text, p_sku text default null)
returns text language sql immutable as $$
  select nullif(
    coalesce(
      spec_value(p_name, 'Cassette'),
      nullif(concat_ws(' ',
        spec_value(p_name, 'Chainring'),
        spec_value(p_name, 'Length')), ''),
      rotor_label_for(p_sku)),
    '');
$$;

/**
 * The part of a name that is the model, with every measurement taken out.
 *
 * Replaces 0030's for the same reason: where the name carries no size, the
 * part number is what says which model this is one of.
 */
create or replace function public.variant_model_key(p_name text, p_sku text default null)
returns text language sql immutable as $$
  select coalesce(
    case when rotor_label_for(p_sku) is not null
         then rotor_model_for(p_sku) end,
    nullif(
      trim(regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(p_name, '\d{2}\s*-\s*\d{2}\s*T', '', 'gi'),
            '\d{2,4}(\.\d+)?\s*mm', '', 'gi'),
          '\d{2}\s*[/-]\s*\d{2}', '', 'g'),
        '\s{2,}', ' ', 'g')),
      ''));
$$;

/**
 * Products that look like sizes of one thing.
 *
 * Replaces 0030's. Same four rules, and one addition: a product whose label
 * came from its part number is grouped on a model key that also came from the
 * part number, so a rotor's model is never the description it shares with
 * every other rotor.
 *
 * The series joins the grouping. Two Dura-Ace and Ultegra power meters are
 * both called "Power 50 / 34 - double - 170 mm" — the same brand, the same
 * collection and, once the size is stripped out, the same model key. Without
 * the series they would land in one group and a shop buying a £355 Ultegra
 * chainset would be shown a £460 Dura-Ace one, or the other way about.
 */
create or replace function public.suggest_variant_groups()
returns table (
  product_id uuid, sku text, name text,
  model text, label text, members integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  return query
  with candidate as (
    select p.id as pid, p.sku as psku, p.name as pname,
           variant_model_key(p.name, p.sku)  as pmodel,
           variant_label_for(p.name, p.sku)  as plabel,
           coalesce(p.category_id::text, '') as cat,
           coalesce(lower(trim(p.brand)), '') as brand,
           coalesce(lower(trim(p.series)), '') as series
      from products p
     where p.variant_group is null
       and p.active
  ),
  usable as (
    select * from candidate
     where plabel is not null
       and pmodel is not null
       and length(pmodel) >= 3
       and pmodel ~ '[A-Za-z]{2}'
  ),
  grouped as (
    select pmodel, cat, brand, series,
           count(distinct plabel) as sizes,
           count(*)               as rows
      from usable
     group by pmodel, cat, brand, series
  )
  select u.pid, u.psku, u.pname, u.pmodel, u.plabel, g.rows::integer
    from usable u
    join grouped g
      on g.pmodel = u.pmodel and g.cat = u.cat
     and g.brand = u.brand and g.series = u.series
   where g.sizes >= 2
   order by u.pmodel, u.plabel, u.psku;
end $$;

/**
 * Writes the grouping suggest_variant_groups() proposes.
 *
 * Replaces 0030's. The key carries the series as well, for the same reason the
 * grouping does: without it the two power meter ranges share a key.
 */
create or replace function public.apply_variant_groups()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  with proposed as (
    select s.product_id, s.model, s.label,
           coalesce(p.category_id::text, 'none') as cat,
           coalesce(lower(trim(p.brand)), 'none') as brand,
           coalesce(lower(trim(p.series)), 'none') as series
      from suggest_variant_groups() s
      join products p on p.id = s.product_id
     where p.variant_group is null
  ),
  keyed as (
    select product_id, label,
           left(regexp_replace(
                  upper(model || ' ' || brand || ' ' || series || ' ' || cat),
                  '[^A-Z0-9]+', '-', 'g'), 120) as group_key
      from proposed
  ),
  ranked as (
    select *, row_number() over (
             partition by group_key, lower(label) order by product_id) as rn
      from keyed
  ),
  written as (
    update products p
       set variant_group = r.group_key, variant_label = r.label
      from ranked r
     where p.id = r.product_id and r.rn = 1 and p.variant_group is null
    returning 1
  )
  select count(*)::integer into v_count from written;

  return v_count;
end $$;

-- ── the catalogue carries the series to the client ──────────────────────────
--
-- A column in the middle of the list, which CREATE OR REPLACE VIEW cannot do.
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
       c.currency,
       c.in_stock,
       c.image_url
  from product_group_options o
  join product_group_steps s on s.id = o.step_id
  join client_catalogue c    on c.id = o.product_id;
