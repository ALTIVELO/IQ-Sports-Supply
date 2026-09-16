-- ============================================================================
-- 0016: the power-meter groupsets.
--
-- A power-meter build is the standard build with the power chainset in place
-- of the standard one, and the supplier's own arithmetic says exactly that:
-- Dura-Ace at 1209.87 less the 177.88 chainset plus the 496.80 power chainset
-- is 1528.79, which is their published bundle price to the penny, and Ultegra
-- works out the same way at 994.16.
--
-- So this adds a flag to the seeding rather than a second list of steps. The
-- two builds are separate groups because that is how they are sold — the
-- difference is £319 on Dura-Ace, which is a choice made before speccing
-- rather than during it — but nothing about the parts list is duplicated.
--
-- The power chainsets carry the same crank length and chainring axes: the
-- supplier writes them as "Power 50 / 34 - double - 172.5 mm", which states
-- both just as plainly as the standard line does.
-- ============================================================================

-- Same reason as 0014 and 0015: p_power is a new parameter, and a re-run of
-- setup.sql would otherwise leave the older signature alongside this one.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname in ('seed_group_step', 'seed_shimano_groupset')
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

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

  -- Anything no longer matching this step's pattern is cleared out, so a step
  -- that is narrowed — or switched from standard to power chainsets — actually
  -- changes rather than accumulating both.
  delete from product_group_options o
   using products p
   where o.step_id = v_step and p.id = o.product_id
     and (p.sku not like p_pattern
          or (p_exclude is not null and p.sku like p_exclude)
          or (p_spec_values is not null
              and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values)));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           when p_spec is not null then spec_value(p.name, p_spec)
           else p.name end,
         spec_value(p.name, p_axis1),
         spec_value(p.name, p_axis2),
         row_number() over (order by spec_value(p.name, p_spec) nulls last, p.sku)
    from products p
   where p.active
     and p.sku like p_pattern
     and (p_exclude is null or p.sku not like p_exclude)
     and (p_axis1 is null or spec_value(p.name, p_axis1) is not null)
     and (p_spec_values is null or spec_value(p.name, p_spec) = any (p_spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = v_step and o.product_id = p.id)
  on conflict do nothing;

  if p_spec is not null then
    update product_group_options o
       set label = spec_value(p.name, p_spec)
      from products p
     where p.id = o.product_id and o.step_id = v_step;
  end if;
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
begin
  insert into product_groups (slug, name, brand, description, category_id, sort)
  select p_slug, p_name, 'Shimano',
         'Specify the build: crank length, chainring, cassette, and rotors front '
         || 'and rear or none at all. Every part is ordered as its own line at '
         || 'its own price, so you can adjust anything before you check out.'
         || case when p_power then
              E'\n\nThis build uses the power-meter chainset. The same groupset '
              || 'without one is listed separately.'
            else '' end,
         (select id from categories where slug = 'groupsets'),
         case when p_power then 1 else 0 end
  on conflict (slug) do update
    set name = excluded.name, description = excluded.description, sort = excluded.sort;

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  -- The only difference between the two builds: which chainsets are offered.
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

  perform seed_group_step(p_slug, 'Battery',         9, p_battery);
  perform seed_group_step(p_slug, 'Charger',        10, p_charger);
  perform seed_group_step(p_slug, 'Di2 wire 900mm',  11, p_wire_a);
  perform seed_group_step(p_slug, 'Di2 wire 1000mm', 12, p_wire_b);
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
