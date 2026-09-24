-- ============================================================================
-- 0042: 105 Di2 and GRX Di2 get configurators of their own.
--
-- The builder has offered four groupsets since 0016 — Dura-Ace and Ultegra,
-- each with and without the power-meter chainset — and they are the two
-- dearest things Shimano make. The September list carries two more complete
-- electronic groupsets we can actually sell: 105 Di2 R7100, which is the
-- twelve-speed road groupset most people buying a road bike end up on, and
-- GRX Di2 RX825, which is the gravel one and has no equivalent on the site
-- at all. Every part of both is already in the catalogue and priced. Nothing
-- but the two seed calls was missing.
--
-- Two things had to give first.
--
-- A step's rule is one LIKE pattern, and 105 and GRX are each offered two
-- twelve-speed cassettes that are not one SKU family: CS-R7101 11-34 and
-- CS-HG710 11-36. So a rule may now name several families, bar-separated.
-- Nothing seeded before this contains a bar, so every existing step is a
-- list of one and matches exactly what it matched yesterday.
--
-- And spec_value could not read those cassettes at all. It wants "11-30T",
-- which is how Madison wrote the eleven-speed ranges; the twelve-speed ones
-- arrive as "105 R7101 - HYPERGLIDE+ - 12-speed - 11-34", with no T. The
-- cassette step names 'Cassette' as an axis, and apply_step_options drops an
-- option that cannot answer an axis the step names — so left alone, the 105
-- cassette step would have been built empty and nobody would have been told
-- why. This is the same fault 0041 fixed for rotors, in the next column
-- along.
-- ============================================================================

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      coalesce(
        -- "11-30T": unambiguous wherever in the name it sits.
        replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', ''),
        -- Madison write the newer twelve-speed ranges without the T: "105
        -- R7101 - HYPERGLIDE+ - 12-speed - 11-34". Anchored to the end of
        -- the name, because unanchored it reads "CS-HG500 - 11-25" as
        -- "00-11" and a cassette would be labelled by its part number.
        replace(substring(p_name from '(\d{2}\s*-\s*\d{2})\s*$'), ' ', ''))
    when 'Wire length' then
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Length' then
      -- Two to four digits and an optional decimal: 90mm, 172.5mm, 1000mm.
      nullif(regexp_replace(substring(p_name from '(\d{2,4}(?:\.\d+)?)\s*mm'),
                            '\s', '', 'g'), '') || 'mm'
    when 'Rotor size' then
      coalesce(
        -- What the name says, which is what it says now. Three digits covers
        -- every rotor Shimano make: 140, 160, 180, 200, 203, 220.
        substring(p_name from '(\d{3})\s*mm') || 'mm',
        -- And the part number, for the names written before a rotor could be
        -- read. Kept rather than replaced: a catalogue imported years ago
        -- still holds them, and a step that stopped recognising those would
        -- empty itself exactly as this one did.
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

create or replace function public.apply_step_options(p_step uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st product_group_steps%rowtype; pats text[]; excl text[];
begin
  select * into st from product_group_steps where id = p_step;
  if not found or st.sku_pattern is null then return; end if;

  /*
   * One rule, but it may name several SKU families.
   *
   * A 105 Di2 build is offered two twelve-speed cassettes and they are not
   * one family: CS-R7101 and CS-HG710. LIKE takes one pattern, so the step
   * holds them bar-separated and they are matched as a set. Nothing
   * seeded before this contains a bar, so every existing step is a list of
   * one and reads exactly as it did.
   */
  pats := string_to_array(st.sku_pattern, '|');
  excl := string_to_array(st.sku_exclude, '|');   -- null stays null

  -- Options that no longer answer the rule. Including the products that have
  -- since been withdrawn: a part nobody can buy must not sit on a build as
  -- though they could.
  delete from product_group_options o
   using products p
   where o.step_id = st.id and p.id = o.product_id
     and (not p.active
          or not (p.sku like any (pats))
          or (excl is not null and p.sku like any (excl))
          or (st.spec_values is not null
              and coalesce(spec_value(p.name, st.spec), '') <> all (st.spec_values))
          -- An option that cannot answer an axis the step names could never be
          -- picked from the controls, so it does not belong on the step.
          or (st.axis1_name is not null and spec_value(p.name, st.axis1_name) is null)
          or (st.axis2_name is not null and spec_value(p.name, st.axis2_name) is null));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select st.id, p.id,
         case
           when st.axis1_name is not null then
             concat_ws(' · ', spec_value(p.name, st.axis1_name), spec_value(p.name, st.axis2_name))
           when st.spec is not null then spec_value(p.name, st.spec)
           else p.name end,
         spec_value(p.name, st.axis1_name),
         spec_value(p.name, st.axis2_name),
         0
    from products p
   where p.active
     and p.sku like any (pats)
     and (excl is null or p.sku not like all (excl))
     and (st.axis1_name is null or spec_value(p.name, st.axis1_name) is not null)
     and (st.axis2_name is null or spec_value(p.name, st.axis2_name) is not null)
     and (st.spec_values is null or spec_value(p.name, st.spec) = any (st.spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = st.id and o.product_id = p.id)
  on conflict do nothing;

  /*
   * Order recomputed over the whole step, not set on insert.
   *
   * By the number in the spec rather than its text, or a 1000mm wire lists
   * before a 900mm one — and now that a step can gain options long after it
   * was created, a newly imported 150mm wire would otherwise land at the
   * bottom of a list it belongs at the top of.
   */
  with ordered as (
    select o.id,
           row_number() over (order by
             -- A step that names an axis rather than a spec is ordered by
             -- that. Two cassette families on one step is the case: by SKU,
             -- CS-HG710 11-36 came before CS-R7101 11-34.
             nullif(regexp_replace(coalesce(spec_value(p.name, st.spec),
                                            spec_value(p.name, st.axis1_name), ''),
                                   '[^0-9.]', '', 'g'), '')::numeric nulls last,
             p.sku) as n
      from product_group_options o
      join products p on p.id = o.product_id
     where o.step_id = st.id
  )
  update product_group_options o set sort = ordered.n
    from ordered where ordered.id = o.id;

  /*
   * Labels and axis values rebuilt for options already present.
   *
   * Not only for the ones just inserted: a step that gains the ability to read
   * a spec — or a product whose name the importer has since corrected — leaves
   * every option that was already there reading the old way. A chainset that
   * used to show with no chainring shows with one after this, and a wire whose
   * name gained its length reads as a length rather than as a part number.
   */
  update product_group_options o
     set label = case
                   when st.axis1_name is not null then
                     concat_ws(' · ', spec_value(p.name, st.axis1_name),
                               spec_value(p.name, st.axis2_name))
                   when st.spec is not null then spec_value(p.name, st.spec)
                   else p.name end,
         axis1_value = spec_value(p.name, st.axis1_name),
         axis2_value = spec_value(p.name, st.axis2_name)
    from products p
   where p.id = o.product_id and o.step_id = st.id;
end $$;
-- ── the builds ──────────────────────────────────────────────────────────────
/*
 * Every overload goes before the new one is written.
 *
 * p_series, p_wire_a and p_wire_b were read by nothing: the wires became a
 * choice in 0017 and the series was never used at all. They are dropped here
 * rather than carried, because a parameter a caller sets and the function
 * ignores is worse than no parameter. p_sort and p_note replace them.
 *
 * Dropped rather than replaced, because adding a defaulted argument to an
 * existing function creates a competing overload instead of a new version of
 * it, and every call that matched the old arity then matches both and fails.
 */
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
            where proname = 'seed_shimano_groupset'
              and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig; end loop;
end $$;

create or replace function public.seed_shimano_groupset(
  p_slug text, p_name text,
  p_shift_l text, p_shift_r text, p_rd text, p_fd text,
  p_chainset text, p_cassette text, p_chain text, p_rotor text,
  p_battery text default 'BTDN300', p_charger text default 'EWEC300',
  p_power boolean default false,
  -- Where it sits among the others. The builds are listed by this, on the
  -- collection page and at the foot of every builder, and the order people
  -- expect is the range order: Dura-Ace, Ultegra, 105, then gravel.
  p_sort integer default null,
  -- A sentence about this build in particular, after the shared ones.
  p_note text default null
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
            else '' end
         || case when p_note is not null then E'\n\n' || p_note else '' end,
         (select id from categories where slug = 'groupsets'),
         coalesce(p_sort, case when p_power then 1 else 0 end)
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

/*
 * All six, in range order.
 *
 * The four that existed are re-seeded rather than left alone: they are being
 * given an explicit sort for the first time, and re-running a seed is how
 * this schema has always applied a change to a build.
 *
 * The chainset patterns say which build it is. 105 Di2 is FC-R7100, one
 * chainring pair across four crank lengths; GRX is FC-RX8202, the 48/31
 * double that FD-RX825 is cut for and RD-RX825 can reach — the 1x RX8201
 * cranks are deliberately not on it, because they need a different mech and
 * no front derailleur, which is a different build rather than an option on
 * this one.
 *
 * Neither has a power-meter chainset in Madison's list, so neither gets the
 * second variant the two road groupsets have.
 */
select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', false, 0);
select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', true, 1);
select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', false, 2);
select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', true, 3);
select seed_shimano_groupset(
  '105-di2-r7100', '105 Di2 R7100 groupset',
  'R7170DLR', 'R7170DRF', 'RDR7150', 'FDR7150F',
  'FCR7100%', 'CSR7101%|CSHG710%', 'CNM7100%', 'RTCL700%',
  'BTDN300', 'EWEC300', false, 4,
  'Twelve-speed 105 Di2, on the same SD300 wiring as Dura-Ace and Ultegra. '
  || 'The 50/34 chainset comes in four crank lengths, and there is a choice '
  || 'of 11-34 or 11-36 at the back.');
select seed_shimano_groupset(
  'grx-di2-rx825', 'GRX Di2 RX825 groupset',
  'RX825LR', 'RX825RF', 'RDRX825', 'FDRX825F',
  'FCRX8202%', 'CSHG710%|CSR7101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', false, 5,
  'Twelve-speed GRX Di2 for gravel: the 48/31 double chainset with the '
  || 'RD-RX825 mech, on the same SD300 wiring as the road groupsets. The '
  || 'single-ring RX8201 cranks need a different rear mech and no front '
  || 'derailleur, so they are not an option here.');

select refresh_group_options();
