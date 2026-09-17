-- ============================================================================
-- 16: a collection served by its builders.
--
-- The flag has to reach the client, because the client decides what to list.
-- The thing it must NOT do is reach client_group_options: the builders are
-- built out of client_catalogue, and a flag that filtered rather than marked
-- would empty every step whose parts happened to be filed in a configured
-- collection.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;

-- A fixed-spec bundle filed where the builders live, and an ordinary rotor.
insert into products (sku, name, brand, active, category_id) values
  ('CO-BUNDLE','Fixed groupset bundle','Shimano',true,
   (select id from categories where slug='groupsets')),
  ('CO-ROTOR','Disc rotor 160mm','Shimano',true,
   (select id from categories where slug='rotors'));
insert into tier_prices (product_id, tier_id, price, effective_from)
  select p.id, t.id, 100.00, current_date from products p, tiers t where p.sku like 'CO-%';
\set QUIET off

set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';

\echo ''
\echo '───────── The client is told which collections are configured ─────────'
do $$
begin
  perform assert_eq(
    (select configurator_only from client_catalogue where sku='CO-BUNDLE'),
    true, 'a product in a configured collection says so');
  perform assert_eq(
    (select configurator_only from client_catalogue where sku='CO-ROTOR'),
    false, 'and an ordinary one says it is not');

  -- Marked, not withheld. The staff screens, the basket and the builders all
  -- still resolve it; only the listings leave it out, which the site decides.
  perform assert_eq((select count(*)::integer from client_catalogue where sku='CO-BUNDLE'),
                    1, 'the product is still in the client catalogue');
  perform assert_eq((select count(*)::integer from client_catalogue
                      where sku like 'CO-%'), 2, 'along with everything else');
end $$;

\echo ''
\echo '───────── A builder is not emptied by the flag ─────────'
do $$
declare v_group uuid; v_step uuid; v_before integer; v_after integer;
begin
  v_before := (select count(*) from client_group_options);
  perform assert_eq(v_before > 0, true, 'the seeded builders have options to start with');

  reset role;
  -- The awkward case: a part that a builder needs, filed in the very
  -- collection the builders serve.
  insert into product_groups (slug, name, brand, category_id)
  values ('co-test','Configured test group','Shimano',
          (select id from categories where slug='groupsets'))
  returning id into v_group;
  insert into product_group_steps (group_id, name, sort)
  values (v_group, 'The awkward part', 0) returning id into v_step;
  insert into product_group_options (step_id, product_id, sort)
  values (v_step, (select id from products where sku='CO-BUNDLE'), 0);
  set role app_user;

  perform assert_eq(
    (select count(*)::integer from client_group_options where group_id = v_group),
    1, 'a step whose part sits in a configured collection still has it');
  perform assert_eq(
    (select sku from client_group_options where group_id = v_group),
    'CO-BUNDLE', 'priced and named as any other option');
  v_after := (select count(*) from client_group_options);
  perform assert_eq(v_after, v_before + 1, 'and nothing else lost an option');
end $$;

\echo ''
\echo '───────── Only a collection that says so is configured ─────────'
do $$
begin
  perform assert_eq(
    (select count(*)::integer from categories where configurator_only), 1,
    'exactly one collection is served by its builders');
  perform assert_eq(
    (select slug from categories where configurator_only), 'groupsets',
    'and it is the groupsets');
end $$;

\echo ''
\echo '───────── A client cannot decide what is configured ─────────'
do $$
begin
  begin
    update categories set configurator_only = false where slug = 'groupsets';
  exception when others then null;
  end;
  -- RLS filters the write rather than raising, so the proof is the value.
  perform assert_eq((select configurator_only from categories where slug='groupsets'),
                    true, 'the flag is unchanged after a client tries to clear it');
end $$;

\echo ''
\echo '───────── done ─────────'
