-- ============================================================================
-- 13: a chainring written with a hyphen, and Di2 wires as a choice.
--
-- 52/36 at 170mm went missing from the Dura-Ace build because one chainset is
-- described "170mm 52-36" where every other line writes a slash. It was on the
-- step but unreachable: no chainring value, so no combination of the controls
-- could ever land on it. That is the shape of fault worth pinning down — an
-- option present but unpickable is invisible in a way a missing one is not.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into products (sku, name, brand, active) values
  ('TST-C26','Crankset 170mm 52-36','Shimano',true),
  ('TST-D26','C/SET Test 52/36 172.5mm','Shimano',true),
  ('TST-P26','Power 52 / 36 - double - 175 mm','Shimano',true),
  ('TST-NOSPEC','Crankset with nothing stated','Shimano',true),
  ('TSTW090','CABLE E-tube Di2 SD300 900mm','Shimano',true),
  ('TSTW100','CABLE E-tube Di2 SD300 1000mm','Shimano',true)
on conflict (sku) do nothing;
insert into product_groups (slug, name) values ('t13','Test 13')
on conflict (slug) do nothing;
\set QUIET off

\echo ''
\echo '───────── A chainring reads the same however it is written ─────────'
do $$
begin
  perform assert_eq(spec_value('Crankset 170mm 52-36', 'Chainring'), '52/36',
                    'a hyphen reads as the same pair as a slash');
  perform assert_eq(spec_value('C/SET Test 52/36 172.5mm', 'Chainring'), '52/36',
                    'and a slash still does');
  perform assert_eq(spec_value('Power 52 / 36 - double - 175 mm', 'Chainring'), '52/36',
                    'however it is spaced');
  -- A cassette range is hyphenated too, and must not be read as a chainring.
  perform assert_eq(spec_value('CASS D/Ace R9200 12 spd 11-30T', 'Cassette'), '11-30T',
                    'a sprocket range is still a sprocket range');
end $$;

\echo ''
\echo '───────── So the hyphenated chainset joins its own combination ─────────'
select seed_group_step('t13', 'Chainset', 0, 'TST-%', true, 1, 'Crank length', 'Chainring');
do $$
declare v_step uuid;
begin
  select id into v_step from product_group_steps
   where name='Chainset' and group_id=(select id from product_groups where slug='t13');
  perform assert_eq(
    (select axis1_value || ' ' || axis2_value from product_group_options o
       join products p on p.id=o.product_id where o.step_id=v_step and p.sku='TST-C26'),
    '170mm 52/36', 'the hyphenated one carries both values');
  perform assert_eq(
    (select count(*)::integer from product_group_options where step_id=v_step
      and axis2_value is null),
    0, 'and nothing is left on the step without a chainring');
  -- The one that states neither cannot be reached from the controls, so it is
  -- not offered at all rather than sitting there unpickable.
  perform assert_eq(
    (select count(*)::integer from product_group_options o
       join products p on p.id=o.product_id
      where o.step_id=v_step and p.sku='TST-NOSPEC'),
    0, 'a chainset stating no spec is kept off the step entirely');
end $$;

\echo ''
\echo '───────── Wires are chosen by length, shortest first ─────────'
select seed_group_step('t13', 'First Di2 wire', 1, 'TSTW%', true, 1,
                       null, null, null, null, 'Wire length');
do $$
declare v_step uuid;
begin
  select id into v_step from product_group_steps
   where name='First Di2 wire' and group_id=(select id from product_groups where slug='t13');
  perform assert_eq(spec_value('CABLE E-tube Di2 SD300 1000mm', 'Wire length'), '1000mm',
                    'a four digit length reads whole, not as its last three');
  perform assert_eq(spec_value('CABLE E-tube Di2 SD300 900mm', 'Wire length'), '900mm',
                    'and a three digit one reads too');
  perform assert_eq(
    (select string_agg(label, ', ' order by sort) from product_group_options
      where step_id=v_step),
    '900mm, 1000mm', 'ordered by the number, so 900 comes before 1000');
end $$;

\echo ''
\echo '───────── An option already on a step is re-read, not left as it was ─────────'
-- The bug this guards: the chainset was on the step from an earlier seeding
-- with no chainring, and re-seeding only ever added new rows.
do $$
declare v_step uuid;
begin
  select id into v_step from product_group_steps
   where name='Chainset' and group_id=(select id from product_groups where slug='t13');
  update product_group_options set axis2_value = null, label = 'stale', sort = 99
   where step_id = v_step;
  perform seed_group_step('t13', 'Chainset', 0, 'TST-%', true, 1, 'Crank length', 'Chainring');
  perform assert_eq(
    (select count(*)::integer from product_group_options
      where step_id=v_step and (axis2_value is null or label = 'stale')),
    0, 're-seeding repairs the rows it already had');
end $$;
