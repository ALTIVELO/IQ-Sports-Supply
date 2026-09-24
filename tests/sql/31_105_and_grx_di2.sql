-- ============================================================================
-- 31: the 105 Di2 and GRX Di2 configurators.
--
-- Two claims. That both builds exist and are offered the parts they are made
-- of — which is the feature. And that the two things 0042 had to change first
-- do what they were changed for: a step's rule may name several SKU families,
-- and a cassette range written without a T is still a cassette range.
--
-- The second is the one that would fail quietly. The cassette step names
-- 'Cassette' as an axis, and apply_step_options drops an option that cannot
-- answer an axis the step names — so a reader that returns null builds an
-- empty step rather than a wrong one, and an empty step looks like a
-- catalogue we have not bought into yet. That is how the rotors were missing
-- for a month.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

\echo ''
\echo '───────── A. A cassette range reads with or without the T ─────────'
do $$
begin
  perform assert_eq(spec_value('Dura-Ace CS-R9200 Cassette 11-30T', 'Cassette'),
    '11-30T', 'the eleven-speed ranges still read as they did');
  perform assert_eq(spec_value('105 R7101 - HYPERGLIDE+ - 12-speed - 11-34', 'Cassette'),
    '11-34', 'and a twelve-speed range with no T on it reads too');
  perform assert_eq(spec_value('Cassettes HG710 - HYPERGLIDE+ - 12-speed - 11-36', 'Cassette'),
    '11-36', 'however the supplier names the family');
  -- The reason the second pattern is anchored. Unanchored it reads the tail of
  -- the part number and the head of the range as one pair.
  perform assert_eq(spec_value('Cassettes - 10-speed CS-HG500 - 11-25', 'Cassette'),
    '11-25', 'a part number before the range is not read as the range');
  perform assert_eq(spec_value('Deore XT M8200 - HYPERGLIDE+ - 12-speed - 10-51T', 'Cassette'),
    '10-51T', 'and a T anywhere in the name still wins outright');
  -- A crank length is a pair of numbers with a hyphen nowhere near it.
  perform assert_eq(spec_value('FC-R7100 Chainset 50/34 172.5mm', 'Cassette') is null,
    true, 'a chainset is not read as a cassette');
end $$;

\echo ''
\echo '───────── B. Both builds exist, in range order ─────────'
do $$
declare n integer; s integer;
begin
  select count(*)::int into n from product_groups
   where slug in ('105-di2-r7100', 'grx-di2-rx825') and active;
  perform assert_eq(n, 2, 'the two new configurators are there');

  select sort into s from product_groups where slug = '105-di2-r7100';
  perform assert_eq(s, 4, '105 sits below Ultegra');
  select sort into s from product_groups where slug = 'grx-di2-rx825';
  perform assert_eq(s, 5, 'and the gravel build below the road ones');

  select count(*)::int into n from product_group_steps s
    join product_groups g on g.id = s.group_id
   where g.slug = '105-di2-r7100';
  perform assert_eq(n, 13, 'with the same thirteen steps as the others');
end $$;

\echo ''
\echo '───────── C. The catalogue arrives and both builds fill ─────────'
-- Exactly what an import does: products, active, nothing touching the options.
insert into products (sku, name, brand, active) values
  ('R7170DLR', '105 ST-R7170 hydraulic disc brakes Di2 STI - left rear', 'Shimano', true),
  ('R7170DRF', '105 ST-R7170 hydraulic disc brakes Di2 STI - right front', 'Shimano', true),
  ('RDR7150',  '105 Di2 R7150 12-speed - E-tube for SD300 wires', 'Shimano', true),
  ('FDR7150F', '105 FD-R7150 Di2 - braze-on', 'Shimano', true),
  ('FCR7100C04', 'FC-R7100 Chainset 50/34 170mm', 'Shimano', true),
  ('FCR7100D04', 'FC-R7100 Chainset 50/34 172.5mm', 'Shimano', true),
  ('CSR710112134', '105 R7101 - HYPERGLIDE+ - 12-speed - 11-34', 'Shimano', true),
  ('CSHG71012136', 'Cassettes HG710 - HYPERGLIDE+ - 12-speed - 11-36', 'Shimano', true),
  ('CNM7100126Q', 'CN-M7100 SLX - with quick link - 12-speed - 126L', 'Shimano', true),
  ('RTCL700SI',  'RT-CL700 Disc Rotor 160mm (I)', 'Shimano', true),
  ('RTCL700SSI', 'RT-CL700 Disc Rotor 140mm (I)', 'Shimano', true),
  ('RX825LR', 'GRX ST-RX825 Di2 2-speed STI - left rear', 'Shimano', true),
  ('RX825RF', 'GRX ST-RX825 Di2 12-speed STI - right front', 'Shimano', true),
  ('RDRX825',  'RD-RX825 GRX Di2 - 12-speed - Shadow+ - for double 36T max', 'Shimano', true),
  ('FDRX825F', 'FD-RX825 GRX Di2 for 12-speed - 61-66 deg - for 48T', 'Shimano', true),
  ('FCRX8202D81', 'FC-RX8202 Chainset 48/31 172.5mm', 'Shimano', true),
  ('FCRX8201D0',  'FC-RX8201 Chainset 40T 172.5mm', 'Shimano', true),
  ('CNM8100126Q', 'CN-M8100 XT / Ultegra - with quick link - 12-speed - 126L', 'Shimano', true),
  ('RTCL800SI',  'Ultegra RT-CL800 Disc Rotor 160mm (I)', 'Shimano', true),
  ('RTCL800SSI', 'Ultegra RT-CL800 Disc Rotor 140mm (I)', 'Shimano', true),
  ('BTDN300', 'E-tube SEIS Di2 battery - 3-ports for SD300 wires', 'Shimano', true),
  ('EWEC300', 'Charger EW-EC300 charging cable - 1700 mm', 'Shimano', true),
  ('EWSD300IL055', 'Di2 EW-SD300 E-tube Wire 550mm', 'Shimano', true),
  ('EWSD300IL080', 'Di2 EW-SD300 E-tube Wire 800mm', 'Shimano', true);

select refresh_group_options() as refreshed \gset

create or replace function pg_temp.opts(p_slug text, p_step text)
returns text[] language sql as $$
  select array_agg(o.label order by o.sort)
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = p_slug and s.name = p_step;
$$;

do $$
declare v text[];
begin
  perform assert_eq(array_length(pg_temp.opts('105-di2-r7100','Left shifter'),1), 1,
    '105 has a left shifter to pick');
  perform assert_eq(array_length(pg_temp.opts('105-di2-r7100','Rear derailleur'),1), 1,
    'and the R7150 mech');
  perform assert_eq(pg_temp.opts('105-di2-r7100','Chainset'),
    array['170mm · 50/34','172.5mm · 50/34'], 'its chainset by length and ring');
  perform assert_eq(pg_temp.opts('105-di2-r7100','Front rotor'),
    array['140mm','160mm'], 'both rotor sizes, the smaller first');
  v := pg_temp.opts('105-di2-r7100','First Di2 wire');
  perform assert_eq(v, array['550mm','800mm'], 'and every wire length in the catalogue');
end $$;

\echo ''
\echo '───────── D. One step, two SKU families ─────────'
do $$
declare st product_group_steps%rowtype;
begin
  select s.* into st from product_group_steps s
    join product_groups g on g.id = s.group_id
   where g.slug = '105-di2-r7100' and s.name = 'Cassette';
  perform assert_eq(st.sku_pattern, 'CSR7101%|CSHG710%',
    'the rule names both cassette families');

  -- The whole point: CS-R7101 and CS-HG710 share no prefix, and before 0042 a
  -- step could hold one LIKE pattern, so one of them was unbuyable here.
  perform assert_eq(pg_temp.opts('105-di2-r7100','Cassette'),
    array['11-34','11-36'], 'and both are offered, in ratio order');
  -- Ratio order rather than SKU order: by SKU, CS-HG710 comes first and the
  -- list reads 11-36 before 11-34.
  perform assert_eq(pg_temp.opts('grx-di2-rx825','Cassette'),
    array['11-34','11-36'], 'on the gravel build too');
end $$;

\echo ''
\echo '───────── E. The gravel build is the double, not the single ─────────'
do $$
declare v text[];
begin
  perform assert_eq(pg_temp.opts('grx-di2-rx825','Chainset'),
    array['172.5mm · 48/31'], 'the 48/31 double that FD-RX825 is cut for');
  -- FC-RX8201 is the 1x crank. It needs a different rear mech and no front
  -- derailleur, so it is a different groupset rather than an option on this.
  select array_agg(p.sku) into v
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
    join products p on p.id = o.product_id
   where g.slug = 'grx-di2-rx825' and s.name = 'Chainset';
  perform assert_eq(v @> array['FCRX8201D0'], false,
    'and the single-ring crank is not on it');

  perform assert_eq(pg_temp.opts('grx-di2-rx825','Front rotor'),
    array['140mm','160mm'], 'RT-CL800 rotors, both sizes');
end $$;

\echo ''
\echo '───────── F. A part withdrawn leaves the new builds too ─────────'
do $$
declare v text[];
begin
  update products set active = false where sku = 'CSHG71012136';
  perform refresh_group_options();
  perform assert_eq(pg_temp.opts('105-di2-r7100','Cassette'), array['11-34'],
    'a withdrawn cassette stops being offered');
  perform assert_eq(pg_temp.opts('grx-di2-rx825','Cassette'), array['11-34'],
    'on every build that named its family');
  update products set active = true where sku = 'CSHG71012136';
  perform refresh_group_options();
end $$;

\echo ''
\echo '───────── G. One rule of one is still one rule ─────────'
-- Every step seeded before 0042 holds a single pattern with no bar in it.
-- Nothing about those may have changed.
do $$
declare n integer;
begin
  select count(*)::int into n from product_group_steps
   where sku_pattern like '%|%';
  perform assert_eq(n, 2, 'only the two cassette steps name more than one family');

  perform assert_eq(pg_temp.opts('dura-ace-r9200','First Di2 wire'),
    array['550mm','800mm'], 'and Dura-Ace reads exactly as it did');
end $$;

\echo ''
\echo '───────── H. An exclusion may name several families too ─────────'
do $$
declare v text[];
begin
  update product_group_steps s
     set sku_pattern = 'FCRX8202%|FCRX8201%', sku_exclude = 'FCRX8201%|FCR7100%'
    from product_groups g
   where g.id = s.group_id and g.slug = 'grx-di2-rx825' and s.name = 'Chainset';
  perform refresh_group_options();
  perform assert_eq(pg_temp.opts('grx-di2-rx825','Chainset'),
    array['172.5mm · 48/31'], 'a bar-separated exclusion holds each of its patterns out');
end $$;
