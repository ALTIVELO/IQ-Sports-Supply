-- ============================================================================
-- 0015: rotors chosen by size.
--
-- The supplier's sheet gives no description for any rotor — just a code and a
-- price — so 0014 left them reading "Shimano Disc Rotor RTCL900SE", which is
-- no use to anyone specifying a bike. The size is in the code: Shimano writes
-- SS, S, M and L for 140, 160, 180 and 203mm, and spells the bigger XTR sizes
-- out (RTCL750200E is 200mm).
--
-- That convention is an assumption, not something the sheet states. It is kept
-- in one CASE below so it is easy to see and easy to correct, and it holds
-- against the data: all 48 rotors resolve, and the price bands per size line
-- up. On a groupset only the road sizes are offered, which is what a road
-- groupset takes.
--
-- Unlike a chainset, several rotors share a size — three 160mm in the R9200
-- range, differing in lockring — so size is a label and a filter here rather
-- than an axis, which would need one SKU per value.
-- ============================================================================

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(substring(p_name from '(\d{2}\s*/\s*\d{2})'), ' ', '')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Rotor size' then
      coalesce(
        -- XTR and downhill sizes are written out in the code itself.
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        -- Otherwise the letter after the model number. SS is tested before S,
        -- or every 140 would read as a 160.
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

-- Clear every overload of these two before defining them. A signature-by-
-- signature drop is not enough here: setup.sql applies 0014 and then 0015 on
-- every run, so re-running recreates 0014's shorter version alongside 0015's
-- longer one, and the four-argument calls inside seed_shimano_groupset then
-- match both and fail as ambiguous.
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
  -- A spec used to label and narrow the options without making it an axis,
  -- for a step where several SKUs legitimately share the same value.
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

  -- An option that no longer belongs — a size we have stopped offering on this
  -- step — is cleared out, so narrowing the list actually narrows it.
  if p_spec is not null and p_spec_values is not null then
    delete from product_group_options o
     using products p
     where o.step_id = v_step and p.id = o.product_id
       and coalesce(spec_value(p.name, p_spec), '') <> all (p_spec_values);
  end if;

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select v_step, p.id,
         case
           when p_axis1 is not null then
             concat_ws(' · ', spec_value(p.name, p_axis1), spec_value(p.name, p_axis2))
           -- The size is the choice. The part code is already printed under
           -- the label, so repeating it here only reads as noise.
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

  -- Labels are rebuilt for options already present, so re-running after this
  -- migration renames the ones 0014 left reading as bare part codes.
  if p_spec is not null then
    update product_group_options o
       set label = spec_value(p.name, p_spec)
      from products p
     where p.id = o.product_id and o.step_id = v_step;
  end if;
end $$;

-- Rebuild both groupsets so the rotor steps pick this up.
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

  perform seed_group_step(p_slug, 'Left shifter',      0, p_shift_l);
  perform seed_group_step(p_slug, 'Right shifter',     1, p_shift_r);
  perform seed_group_step(p_slug, 'Rear derailleur',   2, p_rd);
  perform seed_group_step(p_slug, 'Front derailleur',  3, p_fd);

  perform seed_group_step(p_slug, 'Chainset', 4, p_chainset, true, 1,
    'Crank length', 'Chainring', 'Standard chainset — power meter versions are listed separately',
    p_chainset || 'P%');
  perform seed_group_step(p_slug, 'Cassette', 5, p_cassette, true, 1,
    'Cassette', null, 'Sprocket range');
  perform seed_group_step(p_slug, 'Chain', 6, p_chain);

  -- Road sizes only: a road groupset takes 140 or 160, and offering the 180
  -- and 203 from the same range would only invite a wrong order.
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

-- Every rotor in the catalogue gets its size in its name, not just the ones a
-- groupset offers: "Shimano Disc Rotor RTCL900SE" tells a customer nothing.
update products
   set name = 'Shimano ' || spec_value(name, 'Rotor size') || ' Disc Rotor ' || sku
 where name like 'Shimano Disc Rotor %'
   and spec_value(name, 'Rotor size') is not null;
