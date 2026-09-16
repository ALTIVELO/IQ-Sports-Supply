-- ============================================================================
-- 0017: chainrings written with a hyphen, and a choice of Di2 wire length.
--
-- Two things, both found by looking at what a Dura-Ace build actually offers.
--
-- 52/36 at 170mm — the commonest road setup there is — was missing from the
-- standard build. Not because the SKU is absent but because it is described
-- "Crankset 170mm 52-36", with a hyphen, where every other line uses a slash.
-- The reader only knew about slashes, so that one chainset came through with
-- no chainring at all: present on the step, unreachable from the controls,
-- and invisible in a list of what is on offer. A chainring is now read either
-- way and always stored as a slash, so the two spellings land on one value.
--
-- Guarding against the same shape of fault: an option that cannot supply a
-- value for an axis the step names is no longer added at all. It could never
-- be chosen, and a step is easier to trust when everything on it is reachable.
--
-- And the Di2 wires were two fixed parts, a 900 and a 1000, included without
-- being asked about. Which lengths a frame needs is the mechanic's call, so
-- both are now chosen. The build still takes two, which is what the supplier's
-- own bundle price is built on.
-- ============================================================================

do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      -- "52/36", "52 / 36" and "52-36" are the same pair written three ways.
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      -- A cassette range is also hyphenated, so it is matched before the
      -- chainring rule could ever see it; the two never share a step.
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      -- Three or four digits: a 900mm wire and a 1000mm one.
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
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

create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  p_spec        text default null,
  p_spec_values text[] default null
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

  delete from product_group_options o
   using products p
   where o.step_id = v_step and p.id = o.product_id
     and (p.sku not like p_pattern
          or (p_exclude is not null and p.sku like p_exclude)
          or (p_spec_values is not null
              and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values))
          -- An option that cannot answer an axis the step names could never be
          -- picked from the controls, so it does not belong on the step.
          or (p_axis1 is not null and spec_value(p.name, p_axis1) is null)
          or (p_axis2 is not null and spec_value(p.name, p_axis2) is null));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           when p_spec is not null then spec_value(p.name, p_spec)
           else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         -- Ordered by the number in the spec, not its text, or a 1000mm wire
         -- would list before a 900mm one.
         row_number() over (order by
           nullif(regexp_replace(coalesce(spec_value(p.name, p_spec), ''),
                                 '[^0-9.]', '', 'g'), '')::numeric nulls last,
           p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and (p_axis2 is null or spec_value(p.name, p_axis2) is not null)
     and (p_spec_values is null or spec_value(p.name, p_spec) = any (p_spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;

  -- Order is recomputed, not just set on first insert: options added before a
  -- step knew how to read a spec kept the order they were found in, which is
  -- how the rotors came to list 160 before 140.
  with ordered as (
    select o.id,
           row_number() over (order by
             nullif(regexp_replace(coalesce(spec_value(p.name, p_spec), ''),
                                   '[^0-9.]', '', 'g'), '')::numeric nulls last,
             p.sku) as rn
      from product_group_options o
      join products p on p.id = o.product_id
     where o.step_id = v_step)
  update product_group_options o set sort = ordered.rn
    from ordered where ordered.id = o.id;

  -- Labels and axis values are rebuilt for options already present, so a
  -- chainset that used to read with no chainring now reads with one.
  update product_group_options o
     set label = case
                   when p_axis1 is not null then
                     concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
                   when p_spec is not null then spec_value(p.name, p_spec)
                   else p.name end,
         axis1_value = spec_value(p.name, p_axis1),
         axis2_value = spec_value(p.name, p_axis2)
    from products p
   where p.id = o.product_id and o.step_id = v_step;
end $$;

create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text, p_series text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_wire_a text default 'EWSD300IL090', p_wire_b text default 'EWSD300IL100',
  p_power boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_wires text := 'EWSD300%';
begin
  insert into product_groups (slug, name, brand, description, category_id, sort)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, Di2 wire lengths, '
         || 'and rotors front and rear or none at all. Every part is ordered as '
         || 'its own line at its own price, so you can adjust anything before you '
         || 'check out.'
         || case when p_power then
              E'\n\nThis build uses the power-meter chainset. The same groupset '
              || 'without one is listed separately.'
            else '' end,
         (select id from categories where slug = 'groupsets'),
         case when p_power then 1 else 0 end
  on conflict (slug) do update
    set name = excluded.name, description = excluded.description, sort = excluded.sort;

  select id into v_group from product_groups where slug = p_slug;

  -- The wires used to be two fixed parts named for their length. They are a
  -- choice now, so the old steps go rather than sitting alongside the new ones.
  delete from product_group_steps
   where group_id = v_group and name in ('Di2 wire 900mm', 'Di2 wire 1000mm');

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  if p_power then
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset || 'P%', true, 1,
      'Crank length', 'Chainring', 'Power-meter chainset');
  else
    perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
      'Crank length', 'Chainring', 'Standard chainset — the power-meter build is listed separately',
      p_chainset || 'P%');
  end if;

  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  perform seed_group_step(p_slug, 'Front rotor', 7, p_rotor, false, 1,
    null, null, 'Choose 160mm or 140mm, or leave out if the wheels already have rotors',
    null, 'Rotor size', array['140mm','160mm']);
  perform seed_group_step(p_slug, 'Rear rotor', 8, p_rotor, false, 1,
    null, null, 'Often a size smaller than the front',
    null, 'Rotor size', array['140mm','160mm']);

  perform seed_group_step(p_slug, 'Battery',  9, p_battery);
  perform seed_group_step(p_slug, 'Charger', 10, p_charger);

  -- Two wires, each a length. Which lengths a frame needs is the mechanic's
  -- call; the supplier's bundle happens to be a 900 and a 1000.
  perform seed_group_step(p_slug, 'First Di2 wire',  11, v_wires, true, 1,
    null, null, 'Choose the length this frame needs', null, 'Wire length');
  perform seed_group_step(p_slug, 'Second Di2 wire', 12, v_wires, true, 1,
    null, null, 'The second run, often a different length', null, 'Wire length');
end $$;

select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');
select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');
select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
