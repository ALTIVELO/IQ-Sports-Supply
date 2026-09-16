-- ============================================================================
-- 12: the power-meter groupsets.
--
-- A power build is the standard build with the power chainset substituted, so
-- the assertions worth making are that the two chainset lists do not overlap,
-- that switching a step's pattern actually replaces its options rather than
-- accumulating both, and that a configured build still comes to the price the
-- supplier publishes for the equivalent bundle.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
-- The parts of a Dura-Ace build, priced as the July list prices them.
insert into products (sku, name, brand, active) values
  ('R9270DLR','STI LVR STR9270/BRR9270 Di2 hydra LH RR','Shimano',true),
  ('R9270DRF','STI LVR STR9270/BRR9270 Di2 hydra RH FR','Shimano',true),
  ('RDR9250','RR MECH D/Ace Di2 R9250 12spd','Shimano',true),
  ('FDR9250F','FR MECH D/Ace Di2 R9250 12spd braze','Shimano',true),
  ('FCR9200D26','C/SET D/Ace R9200 52/36 172.5mm','Shimano',true),
  ('FCR9200PD26','Power 52 / 36 - double - 172.5 mm','Shimano',true),
  ('CSR920012130','CASS D/Ace R9200 12 spd 11-30T','Shimano',true),
  ('CNM9100126Q','CHAIN XTR/DuraAce 12spd 126L Q/Link','Shimano',true),
  ('BTDN300','BATT Di2 DN300 internal','Shimano',true),
  ('EWEC300','CHARGER EWEC300 charging cable 1700mm','Shimano',true),
  ('EWSD300IL090','CABLE E-tube Di2 SD300 900mm','Shimano',true),
  ('EWSD300IL100','CABLE E-tube Di2 SD300 1000mm','Shimano',true)
on conflict (sku) do nothing;

insert into tier_prices (product_id, tier_id, price, effective_from)
select p.id, t.id, v.price, current_date
  from (values ('R9270DLR',204.34),('R9270DRF',204.34),('RDR9250',247.97),
               ('FDR9250F',136.57),('FCR9200D26',177.88),('FCR9200PD26',496.80),
               ('CSR920012130',129.60),('CNM9100126Q',21.92),('BTDN300',55.51),
               ('EWEC300',14.50),('EWSD300IL090',8.52),('EWSD300IL100',8.72))
       as v(sku, price)
  join products p on p.sku = v.sku
  cross join tiers t
on conflict do nothing;

select seed_shimano_groupset(
  'test-std', 'Test standard', 'R9200', 'R9270DLR','R9270DRF','RDR9250','FDR9250F',
  'FCR9200%','CSR9200%','CNM9100%','RTCL900%');
select seed_shimano_groupset(
  'test-power', 'Test power', 'R9200', 'R9270DLR','R9270DRF','RDR9250','FDR9250F',
  'FCR9200%','CSR9200%','CNM9100%','RTCL900%',
  'BTDN300','EWEC300','EWSD300IL090','EWSD300IL100', true);
\set QUIET off

\echo ''
\echo '───────── The two builds offer different chainsets, and only those ─────────'
do $$
begin
  -- Asserted as a property, not a list: the base seed ships a chainset of its
  -- own that legitimately belongs on the standard step.
  perform assert_eq(
    (select bool_and(p.sku not like 'FCR9200P%') from product_group_options o
       join product_group_steps s on s.id=o.step_id join products p on p.id=o.product_id
      where s.name='Chainset' and s.group_id=(select id from product_groups where slug='test-std')),
    true, 'no power chainset reaches the standard build');
  perform assert_eq(
    (select bool_and(p.sku like 'FCR9200P%') from product_group_options o
       join product_group_steps s on s.id=o.step_id join products p on p.id=o.product_id
      where s.name='Chainset' and s.group_id=(select id from product_groups where slug='test-power')),
    true, 'and nothing but power chainsets reaches the power build');
  perform assert_eq(
    (select count(*)::integer from product_group_options o
       join product_group_steps s on s.id=o.step_id join products p on p.id=o.product_id
      where s.name='Chainset' and p.sku='FCR9200PD26'
        and s.group_id=(select id from product_groups where slug='test-power')),
    1, 'the power chainset is on the power build');
end $$;

\echo ''
\echo '───────── Everything else about the two builds is the same ─────────'
do $$
begin
  perform assert_eq(
    (select count(*)::integer from product_group_steps
      where group_id=(select id from product_groups where slug='test-power')),
    (select count(*)::integer from product_group_steps
      where group_id=(select id from product_groups where slug='test-std')),
    'same number of steps, so nothing was duplicated by hand');
end $$;

\echo ''
\echo '───────── Re-pointing a step replaces its options, it does not add to them ─────────'
-- The trap: seeding a step that already exists used to leave the old options
-- in place, so a standard build switched to power would offer both.
select seed_group_step('test-std', 'Chainset', 4, 'FCR9200%P%', true, 1,
                       'Crank length', 'Chainring');
do $$
begin
  perform assert_eq(
    (select bool_and(p.sku like 'FCR9200P%') from product_group_options o
       join product_group_steps s on s.id=o.step_id join products p on p.id=o.product_id
      where s.name='Chainset' and s.group_id=(select id from product_groups where slug='test-std')),
    true, 'the standard chainsets are gone, not sitting alongside the power one');
end $$;

\echo ''
\echo '───────── A configured build still prices as the supplier''s bundle ─────────'
do $$
declare v_std numeric; v_pm numeric;
begin
  select sum(price) into v_std from (
    select (select tp.price from product_group_options o
              join products p on p.id=o.product_id
              join lateral (select price from tier_prices
                             where product_id=p.id and tier_id=(select id from tiers where name='Distributor')
                             limit 1) tp on true
             where o.step_id=s.id limit 1) as price
      from product_group_steps s
     where s.group_id=(select id from product_groups where slug='test-power') and s.required) x;

  -- 1209.87 standard, less the 177.88 chainset, plus the 496.80 power one.
  perform assert_eq(v_std, 1528.79::numeric,
                    'the power build comes to the published bundle price');
end $$;
