-- ============================================================================
-- 27: the range a part belongs to, and the rotors the deriver could not read.
--
-- Two claims. First, that a catalogue can say "Dura-Ace" — the word a shop
-- actually uses, which sat between brand and model and was in neither.
--
-- Second, that the variant deriver now reads a rotor. It could already read a
-- chainset, a cassette and a wire, all of which write their size into their
-- name. A rotor writes it into its part number, where the same letters carry
-- the lockring as well, so two 203mm rotors that are different products must
-- come out with different labels or one of them disappears behind the other.
--
-- And the case the series exists for: the Dura-Ace and Ultegra power meters
-- are called exactly the same thing and differ by a hundred pounds.
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
\set QUIET off

set role app_user;
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '───────── A rotor says its size in its part number ─────────'
do $$
begin
  perform assert_eq(rotor_label_for('RTCL900LJ'), '203mm (J)',
    'the letter is the size and the rest is kept');
  perform assert_eq(rotor_label_for('RTCL900LE'), '203mm (E)',
    'so two lockrings of one size stay two products');
  perform assert_eq(rotor_label_for('RTCL300L'), '203mm',
    'a bare code needs no brackets');
  -- SS before S, or every 140 reads as a 160 and the range loses a size.
  perform assert_eq(rotor_label_for('RTCL900SSE'), '140mm (E)',
    'the small one is not read as the medium');
  perform assert_eq(rotor_label_for('RTCL900SE'), '160mm (E)',
    'and the medium is still the medium');
  perform assert_eq(rotor_label_for('RTCL750200E'), '200mm (E)',
    'a size written out is taken as written');
  perform assert_eq(rotor_model_for('RTCL750200E'), 'RTCL750',
    'and does not run into the model number');
  perform assert_eq(rotor_label_for('FCR9200D26') is null, true,
    'and a chainset is not read as a rotor');
end $$;

\echo ''
\echo '───────── Which the deriver now uses ─────────'
do $$
begin
  perform assert_eq(variant_label_for('Shimano Disc Rotor RTCL900LJ', 'RTCL900LJ'),
    '203mm (J)', 'a rotor gets a label at last');
  perform assert_eq(variant_model_key('Shimano Disc Rotor RTCL900LJ', 'RTCL900LJ'),
    'RTCL900', 'and a model that is not the description it shares with every other rotor');

  -- The name is still the better source wherever it says anything, so the
  -- part number is only asked when nothing was found in the name.
  perform assert_eq(variant_label_for('C/SET D/Ace R9200 52/36 172.5mm', 'FCR9200D26'),
    '52/36 172.5mm', 'a chainset still reads out of its name');
  perform assert_eq(variant_label_for('CASS D/Ace R9200 12 spd 11-34T', 'CSR920012134'),
    '11-34T', 'and a cassette is still asked about first and alone');
end $$;

\echo ''
\echo '───────── Two ranges, one description ─────────'
\set QUIET on
insert into products (sku, name, brand, series, active, category_id) values
  ('T-FCR9200PC26','Power 52 / 36 - double - 170 mm','Shimano','Dura-Ace',true,
   (select id from categories where slug='chainsets')),
  ('T-FCR9200PC04','Power 50 / 34 - double - 170 mm','Shimano','Dura-Ace',true,
   (select id from categories where slug='chainsets')),
  ('T-FCR8100PC26','Power 52 / 36 - double - 170 mm','Shimano','Ultegra',true,
   (select id from categories where slug='chainsets')),
  ('T-FCR8100PC04','Power 50 / 34 - double - 170 mm','Shimano','Ultegra',true,
   (select id from categories where slug='chainsets'));
\set QUIET off
do $$
declare v_dura text; v_ult text;
begin
  perform apply_variant_groups();

  select variant_group into v_dura from products where sku = 'T-FCR9200PC26';
  select variant_group into v_ult  from products where sku = 'T-FCR8100PC26';

  perform assert_eq(v_dura is not null, true, 'the Dura-Ace pair is a range');
  perform assert_eq(v_ult is not null, true, 'and so is the Ultegra pair');
  -- Without the series in the key these four land together, and a shop buying
  -- a £355 Ultegra chainset is shown a £460 Dura-Ace one.
  perform assert_eq(v_dura <> v_ult, true,
    'and they are not the same range, however alike the descriptions are');
  perform assert_eq(v_dura like '%DURA-ACE%', true, 'the key says which range it is');
  perform assert_eq(
    (select count(*)::integer from products where variant_group = v_dura), 2,
    'with only its own two in it');
end $$;

\echo ''
\echo '───────── Rotors group; a model with one size does not ─────────'
\set QUIET on
insert into products (sku, name, brand, active, category_id) values
  -- Not prefixed, unlike the power meters above: a rotor's size is read out
  -- of the part number, and a part number with T- on the front is not one.
  -- 999 is a model the seed does not have.
  ('RTCL999LJ','Shimano Disc Rotor RTCL999LJ','Shimano',true,
   (select id from categories where slug='rotors')),
  ('RTCL999ME','Shimano Disc Rotor RTCL999ME','Shimano',true,
   (select id from categories where slug='rotors')),
  ('RTCL999SI','Shimano Disc Rotor RTCL999SI','Shimano',true,
   (select id from categories where slug='rotors')),
  ('SMRT99L','Shimano Disc Rotor SMRT99L','Shimano',true,
   (select id from categories where slug='rotors'));
\set QUIET off
do $$
declare v_group text;
begin
  perform apply_variant_groups();

  select variant_group into v_group from products where sku = 'RTCL999LJ';
  perform assert_eq(v_group is not null, true, 'a rotor range is grouped');
  perform assert_eq(
    (select count(*)::integer from products where variant_group = v_group), 3,
    'with every size of it');
  perform assert_eq(
    (select count(distinct variant_label)::integer from products where variant_group = v_group), 3,
    'and three labels nobody can confuse');
  -- One rotor of a model is not a range, and a heading over it is a click to
  -- reach one product.
  perform assert_eq(
    (select variant_group is null from products where sku = 'SMRT99L'), true,
    'a model with one size is left alone');
end $$;

\echo ''
\echo '───────── The series reaches the client catalogue ─────────'
do $$
begin
  perform assert_eq(
    (select count(*)::integer from information_schema.columns
      where table_name = 'client_catalogue' and column_name = 'series'), 1,
    'the view a client reads carries it');
  perform assert_eq(
    (select count(*)::integer from information_schema.columns
      where table_name = 'client_group_options' and column_name = 'series'), 1,
    'and so does the one a builder reads');
  -- It is not a category: Dura-Ace is a chainset and a cassette and a rotor,
  -- and filing by range would break filing by what the thing is.
  perform assert_eq(
    (select count(*)::integer from categories where lower(name) like '%dura%'), 0,
    'and it did not become a collection');
end $$;
