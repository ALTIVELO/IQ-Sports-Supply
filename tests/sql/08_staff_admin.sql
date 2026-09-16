-- ============================================================================
-- 08: an admin manages the staff list, and cannot lock the company out.
--
-- These functions hand out roles, so the assertions that matter are the ones
-- that refuse: only an admin may call them, the last admin cannot be demoted
-- or removed, an admin cannot remove themselves, and a trade customer's
-- address cannot be turned into a staff login.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'james@iqsportsupply.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rohail@iqsportsupply.com');
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

set role app_user;
set session "test.user_id" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

\echo ''
\echo '───────── An admin adds a staff member ─────────'
select invite_staff('warehouse@iqsportsupply.com', 'ops', 'Maryport');
do $$
begin
  perform assert_eq((select role::text from staff_invites where email='warehouse@iqsportsupply.com'),
                    'ops', 'the new starter is listed before they ever sign in');
  perform assert_eq((select note from staff_invites where email='warehouse@iqsportsupply.com'),
                    'Maryport', 'with the note that says who they are');
end $$;

\echo ''
\echo '───────── An address is tidied up on the way in ─────────'
select invite_staff('  Accounts@IQSportSupply.com  ', 'accounts');
do $$
begin
  perform assert_eq(
    (select count(*)::integer from staff_invites where email='accounts@iqsportsupply.com'),
    1, 'stored folded to lower case and trimmed, so it matches at sign-in');
  perform assert_fails($q$select invite_staff('not-an-email', 'ops')$q$,
                       'a malformed address is refused');
end $$;

\echo ''
\echo '───────── Changing a role takes effect immediately ─────────'
-- Rohail has already signed in, so this must move him now, not at next login.
select invite_staff('rohail@iqsportsupply.com', 'accounts');
do $$
begin
  perform assert_eq((select role::text from profiles where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
                    'accounts', 'someone already signed in changes role at once');
  perform assert_eq((select role::text from staff_invites where email='rohail@iqsportsupply.com'),
                    'accounts', 'and the allowlist agrees with the profile');
end $$;

\echo ''
\echo '───────── The company cannot be locked out ─────────'
do $$
begin
  -- James is now the only admin, Rohail having just moved to accounts.
  perform assert_fails($q$select invite_staff('james@iqsportsupply.com', 'ops')$q$,
                       'the last admin cannot demote themselves');
  perform assert_fails($q$select revoke_staff('james@iqsportsupply.com')$q$,
                       'nor remove themselves');
  perform assert_eq((select role::text from profiles where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
                    'admin', 'so James is still an admin after both refusals');
end $$;

\echo ''
\echo '───────── Self-removal is refused even with another admin present ─────────'
select invite_staff('rohail@iqsportsupply.com', 'admin');
do $$
begin
  perform assert_fails($q$select revoke_staff('james@iqsportsupply.com')$q$,
                       'removing your own access is always a slip, so always refused');
end $$;

\echo ''
\echo '───────── A trade customer cannot be made staff ─────────'
do $$
declare v_email text;
begin
  select email into v_email from clients where email is not null limit 1;
  perform assert_fails(
    format($q$select invite_staff(%L, 'ops')$q$, v_email),
    'an address that belongs to a trade account is refused');
end $$;

\echo ''
\echo '───────── Removing someone takes their access away ─────────'
reset role;
insert into auth.users (id, email)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'warehouse@iqsportsupply.com');
set role app_user;
do $$
begin
  perform assert_eq((select role::text from profiles where id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
                    'ops', 'they signed in as ops');
end $$;
insert into ops_locations (profile_id, location_id)
  select 'cccccccc-cccc-cccc-cccc-cccccccccccc', id from locations limit 1;
set session "test.user_id" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select revoke_staff('warehouse@iqsportsupply.com');
do $$
begin
  perform assert_eq((select count(*)::integer from staff_invites
                      where email='warehouse@iqsportsupply.com'),
                    0, 'the invitation is gone, so signing in again grants nothing');
  perform assert_eq((select role::text from profiles where id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
                    'client', 'and the account they still have reaches nothing');
  perform assert_eq((select count(*)::integer from ops_locations
                      where profile_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
                    0, 'their site assignments are cleared too');
end $$;

\echo ''
\echo '───────── Only an admin may do any of it ─────────'
set session "test.user_id" = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
do $$
begin
  perform assert_fails($q$select invite_staff('attacker@evil.com', 'admin')$q$,
                       'the person just removed cannot let themselves back in');
end $$;

set session "test.user_id" = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select invite_staff('ops2@iqsportsupply.com', 'ops');
reset role;
insert into auth.users (id, email)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'ops2@iqsportsupply.com');
set role app_user;
set session "test.user_id" = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
do $$
begin
  perform assert_fails($q$select invite_staff('attacker@evil.com', 'admin')$q$,
                       'an ops user cannot promote anyone');
  perform assert_fails($q$select revoke_staff('james@iqsportsupply.com')$q$,
                       'nor remove an admin');
end $$;
