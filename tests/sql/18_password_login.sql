-- ============================================================================
-- 18: whether somebody has a password.
--
-- One bit of auth.users, which no client may read, reported about the caller
-- and nobody else. The assertions that matter are the ones proving it cannot
-- be turned into a way of asking about somebody else.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email, encrypted_password) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com','$2a$10$staffhash'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk',''),
  ('33333333-3333-3333-3333-333333333333','packer@iqsportsupply.com', null);
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='ops'   where id='33333333-3333-3333-3333-333333333333';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

set role app_user;

\echo ''
\echo '───────── It answers about whoever is asking ─────────'
do $$
begin
  perform set_config('test.user_id', '11111111-1111-1111-1111-111111111111', true);
  perform assert_eq(has_password(), true, 'a staff member who has set one');

  perform set_config('test.user_id', '22222222-2222-2222-2222-222222222222', true);
  perform assert_eq(has_password(), false,
                    'a client who signs in by link has none — empty, not null');

  perform set_config('test.user_id', '33333333-3333-3333-3333-333333333333', true);
  perform assert_eq(has_password(), false, 'and null counts as none too');
end $$;

\echo ''
\echo '───────── Setting one flips the answer, and only for them ─────────'
do $$
begin
  reset role;
  update auth.users set encrypted_password = '$2a$10$clienthash'
   where id = '22222222-2222-2222-2222-222222222222';
  set role app_user;

  perform set_config('test.user_id', '22222222-2222-2222-2222-222222222222', true);
  perform assert_eq(has_password(), true, 'the client now has one');

  perform set_config('test.user_id', '33333333-3333-3333-3333-333333333333', true);
  perform assert_eq(has_password(), false, 'and nobody else changed');
end $$;

\echo ''
\echo '───────── Nobody signed in learns anything ─────────'
do $$
begin
  perform set_config('test.user_id', '', true);
  perform assert_eq(has_password(), false, 'signed out, the answer is simply no');

  -- Not an error and not a null: a caller who is nobody gets the same false as
  -- a caller with no password, so the answer never distinguishes the two.
  perform set_config('test.user_id', '44444444-4444-4444-4444-444444444444', true);
  perform assert_eq(has_password(), false, 'and an id that is not a user gets the same');
end $$;

\echo ''
\echo '───────── The hash itself stays where it is ─────────'
do $$
declare v_leak text;
begin
  perform set_config('test.user_id', '22222222-2222-2222-2222-222222222222', true);
  -- The function returns a boolean, not something a caller can work back from.
  perform assert_eq(pg_typeof(has_password())::text, 'boolean',
                    'it hands back a boolean and nothing else');
  select prosrc into v_leak from pg_proc where proname = 'has_password';
  perform assert_eq(position('encrypted_password' in v_leak) > 0, true,
                    'it reads the column, rather than any copy of it kept elsewhere');
end $$;

\echo ''
\echo '───────── done ─────────'
