-- ============================================================================
-- 0014: choosing a part by two things at once, and real groupset builds.
--
-- A chainset is one SKU that fixes both the crank length and the chainring
-- pair: FCR9200C26 is 170mm and 52/36, and there are fifteen of them per
-- groupset. Presenting that as a flat list of fifteen radio buttons asks the
-- customer to scan for a combination rather than state one, which is not how
-- anybody specs a bike.
--
-- So a step may name up to two axes. When it does, the builder offers one
-- control per axis and resolves the pair to the single SKU that matches. A
-- step with no axes is unchanged — a plain list, which is right for a cassette
-- or a rotor.
--
-- The axis values are read out of the product name rather than the part code:
-- the supplier writes "C/SET D/Ace R9200 50/34 170mm", which states both
-- plainly, where the code says C26 and would have to be decoded from a
-- convention we would be guessing at.
-- ============================================================================

alter table product_group_steps
  add column if not exists axis1_name text,
  add column if not exists axis2_name text;

alter table product_group_options
  add column if not exists axis1_value text,
  add column if not exists axis2_value text;

create index if not exists product_group_options_axes_idx
  on product_group_options (step_id, axis1_value, axis2_value);

-- Two options on the same step must not claim the same pair, or the controls
-- would resolve to whichever row came back first.
create unique index if not exists product_group_options_axis_unique
  on product_group_options (step_id, axis1_value, axis2_value)
  where axis1_value is not null;

-- The client view carries the axes through, so the builder can group by them.
-- Dropped rather than replaced: CREATE OR REPLACE cannot add a column in the
-- middle of an existing view's column list.
drop view if exists client_group_options;
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

-- ── reading a spec out of a supplier's description ──────────────────────────
-- "C/SET D/Ace R9200 50/34 170mm"        → 50/34, 170mm
-- "Power 50 / 34 - double - 172.5 mm"    → 50/34, 172.5mm
-- "CASS D/Ace R9200 12 spd 11-30T"       → 11-30T
create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(substring(p_name from '(\d{2}\s*/\s*\d{2})'), ' ', '')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    else null
  end;
$$;

/**
 * Adds one step to a group and attaches every catalogue SKU matching a
 * pattern. Re-runnable: the step is matched by name, and an option already
 * present is left alone, so this can be applied again after a price list
 * import brings new SKUs in.
 */
create or replace function public.seed_group_step(
  p_group_slug text,
  p_step_name  text,
  p_sort       integer,
  p_pattern    text,
  p_required   boolean default true,
  p_qty        integer default 1,
  p_axis1      text default null,
  p_axis2      text default null,
  p_hint       text default null,
  p_exclude    text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2
     where id = v_step;
  end if;

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         -- Where the axes say it all, the label repeats them rather than the
         -- supplier's whole shorthand line.
         case when p_axis1 is not null then
           concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
         else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         row_number() over (order by p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     -- A step with axes can only offer SKUs whose spec we could actually read.
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;
end $$;

/** Builds one Shimano Di2 groupset out of whatever of it is in the catalogue. */
-- Dropped before being recreated: CREATE OR REPLACE with extra defaulted
-- parameters makes an overload rather than a replacement, and the calls below
-- would keep resolving to the older, shorter version — which is exactly how the
-- Di2 parts went missing the first time.
drop function if exists public.seed_shimano_groupset(
  text, text, text, text, text, text, text, text, text, text, text);

create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into product_groups (slug, name, brand, description, category_id)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, and rotors front '
         || 'and rear or none at all. Every part is ordered as its own line at '
         || 'its own price, so you can adjust anything before you check out.',
         (select id from categories where slug = 'groupsets')
  on conflict (slug) do update set name = excluded.name;

  -- The parts that make it that groupset. One option each, so they are simply
  -- shown as included rather than asked about.
  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  -- The specification.
  perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
    'Crank length', 'Chainring', 'Standard chainset — power meter versions are listed separately',
    p_chainset || 'P%');
  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  -- The Di2 electronics. Included rather than asked about, and the reason the
  -- configured build comes to exactly the price the supplier publishes for the
  -- standard bundle: the seven parts above total £1,122.62 on Dura-Ace, and
  -- these four bring it to £1,209.87, which is their own bundle price.
  perform seed_group_step(p_slug, 'Battery',        9, p_battery);
  perform seed_group_step(p_slug, 'Charger',       10, p_charger);
  perform seed_group_step(p_slug, 'Di2 wire 900mm',  11, p_wire_a);
  perform seed_group_step(p_slug, 'Di2 wire 1000mm', 12, p_wire_b);

  -- Rotors: chosen independently front and rear, or left off entirely.
  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Leave out if the wheels already have rotors');
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front');
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');

select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');
