-- ============================================================================
-- 23: reading the size out of the name.
--
-- Shimano write the size into the description and nowhere else, so eighteen
-- shapes of one chainset arrive as eighteen products with nothing linking
-- them. This reads the link back out — and the thing worth proving is not
-- that it groups, but that it refuses to when it should: a wrong grouping
-- hides a real product behind another one's name.
--
-- Every description below is copied from the July–August price list.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

insert into categories (slug, name, sort) values ('chainsets','Chainsets',90)
  on conflict (slug) do nothing;

insert into products (sku, name, brand, active, category_id)
select v.sku, v.name, 'Shimano', true, (select id from categories where slug='chainsets')
  from (values
    -- One chainset model: three chainrings across three crank lengths.
    ('T-FCR9200M04','C/SET D/Ace R9200 50/34 160mm'),
    ('T-FCR9200A04','C/SET D/Ace R9200 50/34 165mm'),
    ('T-FCR9200C26','C/SET D/Ace R9200 52/36 170mm'),
    ('T-FCR9200D40','C/SET D/Ace R9200 54/40 172.5mm'),
    -- A different model, which must stay apart.
    ('T-FCR8100C26','C/SET Ultegra R8100 52/36 170mm'),
    ('T-FCR8100D26','C/SET Ultegra R8100 52/36 172.5mm'),
    -- Cassettes: one model, two ratios.
    ('T-CSR920012130','CASS D/Ace R9200 12 spd 11-30T'),
    ('T-CSR920012134','CASS D/Ace R9200 12 spd 11-34T'),
    -- Di2 wires: one model, two lengths.
    ('T-EWSD300IL090','CABLE E-tube Di2 SD300 900mm'),
    ('T-EWSD300IL100','CABLE E-tube Di2 SD300 1000mm'),
    -- Things that must NOT be grouped.
    ('T-CNM9100126Q','CHAIN XTR/DuraAce 12spd 126L Q/Link'),
    ('T-BTDN300','BATT Di2 DN300 internal'),
    ('T-R9270DLR','STI LVR STR9270/BRR9270 Di2 hydra LH RR'),
    ('EWEC300A','CHARGER EWEC300 charging cable 1700mm'),
    ('EWEC300B','CHARGER EWEC300 charging cable 1700mm dup')
  ) as v(sku, name);
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── The model is the name with the sizes taken out ─────────'
do $$
begin
  perform assert_eq(variant_model_key('C/SET D/Ace R9200 52/36 172.5mm'),
    'C/SET D/Ace R9200', 'a chainset loses both its ring and its crank length');
  perform assert_eq(variant_model_key('CASS D/Ace R9200 12 spd 11-30T'),
    'CASS D/Ace R9200 12 spd', 'a cassette loses its ratio and keeps its speed count');
  perform assert_eq(variant_model_key('CABLE E-tube Di2 SD300 900mm'),
    'CABLE E-tube Di2 SD300', 'a wire loses its length');
  -- The hyphenated spelling 0017 was written for.
  perform assert_eq(variant_model_key('Crankset 170mm 52-36'),
    'Crankset', 'and a ring written with a hyphen comes out too');
  -- Nothing to take out means nothing taken out.
  perform assert_eq(variant_model_key('BATT Di2 DN300 internal'),
    'BATT Di2 DN300 internal', 'a product with no size in it is left whole');
end $$;

\echo ''
\echo '───────── The label is what tells two of a model apart ─────────'
do $$
begin
  perform assert_eq(variant_label_for('C/SET D/Ace R9200 52/36 172.5mm'),
    '52/36 172.5mm', 'ring then crank length, the way it is said');
  perform assert_eq(variant_label_for('CASS D/Ace R9200 12 spd 11-34T'),
    '11-34T', 'a cassette is its ratio');
  perform assert_eq(variant_label_for('CABLE E-tube Di2 SD300 1000mm'),
    '1000mm', 'a wire is its length');
  -- Crank length and wire length read the same millimetres, and a chainset
  -- printing "170mm 170mm" would be nonsense.
  perform assert_eq(variant_label_for('C/SET D/Ace R9200 50/34 160mm'),
    '50/34 160mm', 'a length is never printed twice');
  perform assert_eq(variant_label_for('BATT Di2 DN300 internal'), null,
    'and a product with no size has no label');
end $$;

\echo ''
\echo '───────── What it proposes, and what it leaves alone ─────────'
do $$
declare r record;
begin
  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups()), 10,
    'four Dura-Ace chainsets, two Ultegra, two cassettes, two wires');

  perform assert_eq(
    (select count(distinct model)::integer from suggest_variant_groups()), 4,
    'across four models');

  -- The pair that differ only by model name must not merge.
  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups()
      where model = 'C/SET D/Ace R9200'), 4,
    'the Dura-Ace chainsets group together');
  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups()
      where model = 'C/SET Ultegra R8100'), 2,
    'and the Ultegra ones separately');

  -- A chain, a battery and a lever have no size and must be left out.
  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups()
      where sku in ('T-CNM9100126Q','T-BTDN300','T-R9270DLR')), 0,
    'a chain, a battery and a shifter are not sizes of anything');

  -- Two rows of one part at one length is a duplicate, not a range.
  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups() where sku like 'EWEC300%'), 0,
    'and the same size listed twice is not a range');
end $$;

\echo ''
\echo '───────── Applying it, and applying it again ─────────'
do $$
declare v_first integer; v_second integer;
begin
  v_first := apply_variant_groups();
  perform assert_eq(v_first, 10, 'the ten it proposed are the ten it writes');

  perform assert_eq(
    (select count(distinct variant_group)::integer from products
      where variant_group is not null), 4,
    'landing in four groups');
  perform assert_eq(
    (select variant_label from products where sku = 'T-FCR9200D40'),
    '54/40 172.5mm', 'each labelled by what makes it different');

  -- Run twice, because somebody will.
  v_second := apply_variant_groups();
  perform assert_eq(v_second, 0, 'running it again changes nothing');
end $$;

\echo ''
\echo '───────── What was already grouped is never overwritten ─────────'
do $$
declare v_before text;
begin
  insert into products (sku, name, brand, active, variant_group, variant_label)
  values ('HAND-1','C/SET D/Ace R9200 50/34 175mm','Shimano',true,'BY-HAND','Big');

  perform assert_eq(
    (select count(*)::integer from suggest_variant_groups() where sku = 'HAND-1'), 0,
    'a product already in a group is not proposed for another');
  perform apply_variant_groups();
  perform assert_eq(
    (select variant_label from products where sku = 'HAND-1'), 'Big',
    'and what somebody typed by hand survives');
end $$;

\echo ''
\echo '───────── A collection keeps unrelated sizes apart ─────────'
do $$
begin
  -- A 160mm rotor and a 160mm chainset share a measurement and nothing else.
  insert into categories (slug, name, sort) values ('rotors-t','Rotors',91)
    on conflict (slug) do nothing;
  insert into products (sku, name, brand, active, category_id)
  select v.sku, v.name, 'Shimano', true, (select id from categories where slug='rotors-t')
    from (values ('RT-A','Disc rotor CL900 160mm'),
                 ('RT-B','Disc rotor CL900 140mm')) as v(sku, name);

  perform assert_eq(
    (select count(distinct model)::integer from suggest_variant_groups()), 1,
    'the rotors are their own model');
  perform apply_variant_groups();
  perform assert_eq(
    (select count(distinct variant_group)::integer from products
      where sku in ('RT-A','RT-B')), 1,
    'grouped with each other');
  perform assert_eq(
    (select variant_group from products where sku = 'RT-A')
      = (select variant_group from products where sku = 'T-FCR9200M04'),
    false, 'and never with a chainset that happens to share a millimetre');
end $$;

\echo ''
\echo '───────── Only staff may propose or apply ─────────'
reset role;
set role app_user;
set session "test.user_id" = '00000000-0000-0000-0000-000000000000';
select assert_fails($$select count(*) from suggest_variant_groups()$$,
  'a stranger asking what would be grouped');
select assert_fails($$select apply_variant_groups()$$,
  'and a stranger grouping it');
