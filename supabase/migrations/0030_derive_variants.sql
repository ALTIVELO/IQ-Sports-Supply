-- ============================================================================
-- 0030: the sizes that were already in the names.
--
-- A Dura-Ace chainset is one model in eighteen shapes: three chainrings across
-- six crank lengths. A cassette is one model in two ratios, a rotor in four
-- sizes, a Di2 wire in two lengths. Every one of those is a separate SKU on
-- the supplier's sheet, which is right — the warehouse picks a 172.5mm 52/36,
-- not "a chainset" — but a catalogue that lists eighteen chainsets is a
-- catalogue nobody can read.
--
-- 0028 gave products a variant_group and a variant_label, and the DRAG bikes
-- arrived with theirs in the file. Shimano's did not: the size is written into
-- the description and nowhere else. So this reads it out.
--
-- It reads it out with spec_value, the same function the groupset builder has
-- used since 0015 to tell a 170mm crank from a 172.5mm one. Writing a second
-- parser here would be writing something that can disagree with the builder
-- about what a product is, and the two would drift apart the first time a
-- supplier changed their punctuation.
--
-- Nothing is applied automatically. suggest_variant_groups() proposes, a
-- person looks, and apply_variant_groups() writes — because a wrong grouping
-- hides a real product behind another one's name, and that is not something
-- to discover from a customer.
-- ============================================================================

/**
 * spec_value gains one axis: a length, whatever shape it is written in.
 *
 * It already reads two, and neither can read the other's numbers. 'Crank
 * length' is three digits and an optional decimal, so it reads 172.5mm and
 * takes "000mm" out of a 1000mm wire. 'Wire length' is three or four digits
 * with no decimal, so it reads 1000mm and cannot see 172.5mm at all. Both are
 * right for the step they were written for and neither is right for labelling
 * a product whose length could be either.
 *
 * The existing axes are untouched: the groupset builder has been specifying
 * cranks with 'Crank length' since 0015 and must go on getting the same answer.
 */
create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Length' then
      -- Two to four digits and an optional decimal: 90mm, 172.5mm, 1000mm.
      nullif(regexp_replace(substring(p_name from '(\d{2,4}(?:\.\d+)?)\s*mm'),
                            '\s', '', 'g'), '') || 'mm'
    when 'Rotor size' then
      coalesce(
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

/**
 * The part of a name that is the model, with every measurement taken out.
 *
 * "C/SET D/Ace R9200 52/36 172.5mm" is the R9200 chainset; "52/36" and
 * "172.5mm" are which one. Strip both and what is left names the thing that
 * the sizes are sizes of.
 *
 * The patterns are spec_value's, deliberately: whatever that function can read
 * as a size is what this takes out, so a product can never end up in a group
 * whose name still contains the size that distinguishes it.
 */
create or replace function public.variant_model_key(p_name text)
returns text language sql immutable as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(
          -- A cassette range first: 11-34T would otherwise read as a chainring.
          regexp_replace(p_name, '\d{2}\s*-\s*\d{2}\s*T', '', 'gi'),
          -- Lengths and diameters: 160mm, 172.5mm, 1000mm.
          '\d{2,4}(\.\d+)?\s*mm', '', 'gi'),
        -- Chainrings, however they are punctuated.
        '\d{2}\s*[/-]\s*\d{2}', '', 'g'),
      '\s{2,}', ' ', 'g')),
    '');
$$;

/**
 * What distinguishes this product from the others of its model.
 *
 * Chainring before crank length, because that is the order a mechanic says
 * them in and the order the supplier writes them: "52/36 172.5mm".
 *
 * The length is asked for as a length rather than as a crank or a wire: a
 * chainset is 172.5mm and a wire is 1000mm, and the two older axes can each
 * read only one of those.
 *
 * A cassette is asked about first and on its own. "11-34T" is a hyphenated
 * pair of two-digit numbers, so the chainring rule matches it too — 0017 knew
 * that and relied on the two never appearing on one step. Here they can appear
 * on one product, and a cassette labelled "11/34 11-34T" is a label nobody
 * would recognise. Nothing is both, so the first answer wins outright.
 */
create or replace function public.variant_label_for(p_name text)
returns text language sql immutable as $$
  select nullif(
    coalesce(
      spec_value(p_name, 'Cassette'),
      concat_ws(' ',
        spec_value(p_name, 'Chainring'),
        spec_value(p_name, 'Length'))),
    '');
$$;

/**
 * Products that look like sizes of one thing, and what they would become.
 *
 * Four rules keep this conservative, because a wrong grouping hides a real
 * product behind another one's name:
 *
 *   * a product that already has a group is never touched, so the bikes that
 *     came in with their sizes stated keep them, and so does anything a person
 *     has grouped by hand;
 *   * a group needs at least two DIFFERENT sizes — a supplier's sheet listing
 *     the same part twice is a duplicate, not a range;
 *   * grouping never crosses a collection or a brand, so a 160mm rotor and a
 *     160mm chainset cannot land together on the strength of the measurement;
 *   * what is left after the sizes come out must still name something. Strip
 *     "140mm" from a product called "140mm" and there is no model underneath.
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
           -- The key a person will see. The category and brand are in the
           -- grouping but not in the name they read.
           variant_model_key(p.name)  as pmodel,
           variant_label_for(p.name)  as plabel,
           coalesce(p.category_id::text, '') as cat,
           coalesce(lower(trim(p.brand)), '') as brand
      from products p
     where p.variant_group is null
       and p.active
  ),
  usable as (
    select * from candidate
     where plabel is not null
       and pmodel is not null
       -- Two letters and three characters: "R9200" is a model, "T" is not.
       and length(pmodel) >= 3
       and pmodel ~ '[A-Za-z]{2}'
  ),
  grouped as (
    select pmodel, cat, brand,
           count(distinct plabel) as sizes,
           count(*)               as rows
      from usable
     group by pmodel, cat, brand
  )
  select u.pid, u.psku, u.pname, u.pmodel, u.plabel, g.rows::integer
    from usable u
    join grouped g
      on g.pmodel = u.pmodel and g.cat = u.cat and g.brand = u.brand
   where g.sizes >= 2
   order by u.pmodel, u.plabel, u.psku;
end $$;

/**
 * Writes the grouping suggest_variant_groups() proposes.
 *
 * The group key carries the collection and the brand as well as the model,
 * because those are what kept two unrelated 160mm things apart when the
 * suggestion was made; a key that dropped them could collide later with
 * something imported next quarter.
 *
 * Only the products still without a group are written, re-read inside the same
 * statement — so running it twice changes nothing the second time, and a
 * product grouped by hand between the preview and the apply is left alone.
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
           coalesce(lower(trim(p.brand)), 'none') as brand
      from suggest_variant_groups() s
      join products p on p.id = s.product_id
     where p.variant_group is null
  ),
  keyed as (
    select product_id, label,
           -- Readable rather than a hash: this key shows up in the import's
           -- Model column, and somebody will have to recognise it there.
           left(regexp_replace(upper(model || ' ' || brand || ' ' || cat),
                               '[^A-Z0-9]+', '-', 'g'), 120) as group_key
      from proposed
  ),
  -- The same size twice within one key would break the unique index and take
  -- the whole apply with it. Keep the first and leave the rest ungrouped.
  ranked as (
    select product_id, group_key, label,
           row_number() over (partition by group_key, lower(label)
                              order by product_id) as n
      from keyed
  )
  update products p
     set variant_group = r.group_key,
         variant_label = r.label
    from ranked r
   where p.id = r.product_id and r.n = 1;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
