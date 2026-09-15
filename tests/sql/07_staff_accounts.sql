-- ============================================================================
-- 07: an allowlisted address becomes staff; nobody else does.
--
-- staff_invites hands out roles, so the things worth proving are the refusals:
-- an address that is not on the list stays a client, a staff address never
-- picks up a trade account, and a non-admin cannot add themselves to the list.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── The two directors are allowlisted as admins ─────────'
do $$
begin
  perform assert_eq(
    (select role::text from staff_invites where email = 'james@iqsportsupply.com'),
    'admin', 'james is invited as an admin');
  perform assert_eq(
    (select role::text from staff_invites where email = 'rohail@iqsportsupply.com'),
    'admin', 'rohail is invited as an admin');
end $$;

\echo ''
\echo '───────── First sign-in gives them the role, without anyone acting ─────────'
insert into auth.users (id, email)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'james@iqsportsupply.com');
insert into auth.users (id, email)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rohail@IQSportSupply.com');
do $$
begin
  perform assert_eq(
    (select role::text from profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'admin', 'james signs in straight into the staff app');
  -- Addresses are not case sensitive; a capitalised invitation still matches.
  perform assert_eq(
    (select role::text from profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    'admin', 'and so does Rohail, whatever case he types');
end $$;

\echo ''
\echo '───────── Everyone else is still a client ─────────'
insert into auth.users (id, email)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'someone@elsewhere.com');
do $$
begin
  perform assert_eq(
    (select role::text from profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    'client', 'an address that was never invited gets no access');
end $$;

\echo ''
\echo '───────── A staff address never picks up a trade account ─────────'
-- The trap: a client record carrying a director's address would otherwise be
-- claimed on sign-in, putting a director into the trade portal on tier pricing.
insert into clients (name, tier_id, email, address, default_location_id)
select 'Ghost Trading Ltd', (select id from tiers limit 1), 'dave@iqsportsupply.com',
       'Nowhere', (select id from locations limit 1);
insert into staff_invites (email, role) values ('dave@iqsportsupply.com', 'ops');
insert into auth.users (id, email)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dave@iqsportsupply.com');
do $$
begin
  perform assert_eq(
    (select role::text from profiles where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'ops', 'an invite can grant a role other than admin');
  perform assert_eq(
    (select auth_user_id is null from clients where name = 'Ghost Trading Ltd'),
    true, 'and the matching trade account is left unclaimed');
end $$;

\echo ''
\echo '───────── Only an admin may hand out roles ─────────'
set role app_user;
set session "test.user_id" = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
do $$
begin
  -- A client cannot see the list at all, so cannot learn who is staff.
  perform assert_eq((select count(*)::integer from staff_invites), 0,
                    'a client cannot read the allowlist');
  perform assert_fails(
    $q$insert into staff_invites (email, role) values ('attacker@evil.com','admin')$q$,
    'a client cannot add themselves to it');
end $$;

set session "test.user_id" = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
do $$
begin
  -- ops is staff, but staff_invites decides who is staff, so it is admin-only.
  perform assert_fails(
    $q$insert into staff_invites (email, role) values ('attacker@evil.com','admin')$q$,
    'an ops user cannot promote anyone either');
end $$;

set session "test.user_id" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$
begin
  perform assert_eq((select count(*)::integer from staff_invites) >= 3, true,
                    'an admin can read the allowlist');
end $$;

set role none;
\echo ''
\echo '───────── Both directors are told about orders and applications ─────────'
do $$
begin
  perform assert_eq(
    (select confirmation_cc @> array['james@iqsportsupply.com','rohail@iqsportsupply.com']
       from settings where id = 1),
    true, 'both are CC''d on every order confirmation');
  perform assert_eq(
    (select application_recipients @> array['james@iqsportsupply.com','rohail@iqsportsupply.com']
       from settings where id = 1),
    true, 'both are told about every trade application');
end $$;
