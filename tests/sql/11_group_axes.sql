-- ============================================================================
-- 11: specifying a part by two things at once.
--
-- A chainset is one SKU fixing both crank length and chainring pair, and the
-- builder offers a control per axis. The thing that must hold is that a pair
-- resolves to exactly one SKU — two options claiming the same pair would make
-- the controls pick whichever row came back first.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk');
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

-- The real Dura-Ace chainset range, as the supplier writes it: the gap at
-- 160mm (no 54/40) is theirs, not ours.
insert into products (sku, name, brand, active) values
  ('FCR7100M04','C/SET 105 R7100 50/34 160mm','Shimano',true),
  ('FCR7100M26','C/SET 105 R7100 52/36 160mm','Shimano',true),
  ('FCR7100D04','C/SET 105 R7100 50/34 172.5mm','Shimano',true),
  ('FCR7100D40','C/SET 105 R7100 54/40 172.5mm','Shimano',true),
  ('FCR7100PD40','Power 54 / 40 - double - 172.5 mm','Shimano',true),
  ('CSR710012136','CASS 105 R7100 12 spd 11-36T','Shimano',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 177.88, current_date from products p, tiers t
   where p.sku like 'FCR7100%' or p.sku like 'CSR7100%';
insert into product_groups (slug, name) values ('test-build','Test build');
\set QUIET off

\echo ''
\echo '───────── A spec is read out of the description, not the part code ─────────'
do $$
begin
  perform assert_eq(spec_value('C/SET 105 R7100 50/34 172.5mm', 'Crank length'),
                    '172.5mm', 'a fractional crank length');
  perform assert_eq(spec_value('C/SET 105 R7100 50/34 160mm', 'Crank length'),
                    '160mm', 'and a whole one');
  perform assert_eq(spec_value('Power 54 / 40 - double - 172.5 mm', 'Chainring'),
                    '54/40', 'chainrings, however the supplier spaces them');
  perform assert_eq(spec_value('CASS 105 R7100 12 spd 11-36T', 'Cassette'),
                    '11-36T', 'and a sprocket range');
  -- R7100 is four digits next to no "mm", so it must not read as a length.
  perform assert_eq(spec_value('RR MECH 105 Di2 R7150 12spd', 'Crank length') is null,
                    true, 'a model number is not mistaken for a measurement');
end $$;

\echo ''
\echo '───────── Seeding builds the axes from the catalogue ─────────'
select seed_group_step('test-build', 'Chainset', 0, 'FCR7100%', true, 1,
                       'Crank length', 'Chainring', null, 'FCR7100P%');
do $$
declare v_step uuid;
begin
  select id into v_step from product_group_steps
   where name='Chainset'
     and group_id=(select id from product_groups where slug='test-build');
  perform assert_eq((select count(*)::integer from product_group_options where step_id=v_step),
                    4, 'the four standard chainsets are offered');
  -- The power-meter version shares a length and ring pair with a standard one,
  -- so letting it in would make that pair ambiguous.
  perform assert_eq((select count(*)::integer from product_group_options o
                       join products p on p.id=o.product_id
                      where o.step_id=v_step and p.sku like '%P%'),
                    0, 'and the power-meter version is excluded');
  perform assert_eq((select axis1_value || ' ' || axis2_value from product_group_options o
                       join products p on p.id=o.product_id
                      where o.step_id=v_step and p.sku='FCR7100D40'),
                    '172.5mm 54/40', 'each option carries both of its values');
end $$;

\echo ''
\echo '───────── A pair resolves to exactly one SKU ─────────'
do $$
declare v_step uuid; v_dupe text;
begin
  select id into v_step from product_group_steps
   where name='Chainset'
     and group_id=(select id from product_groups where slug='test-build');
  perform assert_eq(
    (select count(*)::integer from (
       select axis1_value, axis2_value from product_group_options
        where step_id=v_step group by 1,2 having count(*) > 1) d),
    0, 'no two options claim the same combination');

  -- And the database refuses to let one be added.
  begin
    insert into product_group_options (step_id, product_id, axis1_value, axis2_value)
    select v_step, id, '172.5mm', '54/40' from products where sku='FCR7100PD40';
    v_dupe := 'accepted';
  exception when unique_violation then v_dupe := 'refused';
  end;
  perform assert_eq(v_dupe, 'refused', 'a duplicate combination is refused outright');
end $$;

\echo ''
\echo '───────── The gaps in the range are real ─────────'
do $$
declare v_step uuid;
begin
  select id into v_step from product_group_steps
   where name='Chainset'
     and group_id=(select id from product_groups where slug='test-build');
  perform assert_eq(
    (select count(*)::integer from product_group_options
      where step_id=v_step and axis1_value='160mm' and axis2_value='54/40'),
    0, 'there is no 54/40 at 160mm, so the builder can disable it');
  perform assert_eq(
    (select count(*)::integer from product_group_options
      where step_id=v_step and axis1_value='172.5mm' and axis2_value='54/40'),
    1, 'but there is at 172.5mm');
end $$;

\echo ''
\echo '───────── Re-seeding after a price list import adds only what is new ─────────'
insert into products (sku, name, brand, active)
  values ('FCR7100C26','C/SET 105 R7100 52/36 170mm','Shimano',true);
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 177.88, current_date from products p, tiers t where p.sku='FCR7100C26';
select seed_group_step('test-build', 'Chainset', 0, 'FCR7100%', true, 1,
                       'Crank length', 'Chainring', null, 'FCR7100P%');
do $$
begin
  perform assert_eq((select count(*)::integer from product_group_options o
                      join product_group_steps s on s.id=o.step_id
                     where s.name='Chainset'
                       and s.group_id=(select id from product_groups where slug='test-build')),
                    5, 'the new SKU joins the step, the existing four are untouched');
end $$;

\echo ''
\echo '───────── A client sees the axes, and cannot change them ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select count(*)::integer from client_group_options
                      where axis1_value is not null
                        and group_id=(select id from product_groups where slug='test-build')),
                    5, 'the axis values reach the client view');
  update product_group_options set axis1_value = '999mm';
  perform assert_eq((select count(*)::integer from product_group_options
                      where axis1_value = '999mm'), 0,
                    'and a client cannot rewrite a specification');
end $$;
