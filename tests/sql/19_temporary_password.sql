-- ============================================================================
-- 19: the flag that says a password was somebody else's idea.
--
-- The point of a temporary password is that it survives one sign-in. What has
-- to hold here is that the person holding it cannot simply clear the flag and
-- carry on using it — only the server action that actually changes a password
-- does that, and it has the service role.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email, encrypted_password) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com','$2a$10$hash'),
  ('22222222-2222-2222-2222-222222222222','dave@mikedixonimports.co.uk','$2a$10$temp'),
  ('33333333-3333-3333-3333-333333333333','other@shop.test','$2a$10$hash');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
update clients set auth_user_id='22222222-2222-2222-2222-222222222222' where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── It starts off, for everybody ─────────'
do $$
begin
  perform assert_eq((select count(*)::integer from profiles where must_change_password), 0,
                    'nobody is asked to change anything by default');
end $$;

\echo ''
\echo '───────── Staff issue one, and only that person is marked ─────────'
do $$
begin
  -- The server action does this with the service role, which is what setting
  -- somebody else's password needs anyway.
  update profiles set must_change_password = true
   where id = '22222222-2222-2222-2222-222222222222';

  perform assert_eq(
    (select must_change_password from profiles
      where id = '22222222-2222-2222-2222-222222222222'),
    true, 'the client must change theirs');
  perform assert_eq(
    (select must_change_password from profiles
      where id = '11111111-1111-1111-1111-111111111111'),
    false, 'and nobody else was touched');
end $$;

\echo ''
\echo '───────── The person holding it cannot wave it away ─────────'
set role app_user;
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform assert_eq((select must_change_password from profiles where id = auth.uid()),
                    true, 'they can see that they are being asked');

  -- RLS filters the write rather than raising, so the proof is the value.
  begin
    update profiles set must_change_password = false where id = auth.uid();
  exception when others then null;
  end;

  perform assert_eq((select must_change_password from profiles where id = auth.uid()),
                    true, 'and clearing it themselves changes nothing');
end $$;

\echo ''
\echo '───────── Nor can they set it on anybody else ─────────'
do $$
begin
  begin
    update profiles set must_change_password = true
     where id = '11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;
  reset role;
  perform assert_eq(
    (select must_change_password from profiles
      where id = '11111111-1111-1111-1111-111111111111'),
    false, 'an admin is not locked out by a client');
end $$;

\echo ''
\echo '───────── Clearing it is what the change of password does ─────────'
do $$
begin
  -- Service role, both halves together: a flag cleared without a password
  -- changed leaves the temporary one live.
  update auth.users set encrypted_password = '$2a$10$theirown'
   where id = '22222222-2222-2222-2222-222222222222';
  update profiles set must_change_password = false
   where id = '22222222-2222-2222-2222-222222222222';

  set role app_user;
  perform set_config('test.user_id', '22222222-2222-2222-2222-222222222222', true);
  perform assert_eq((select must_change_password from profiles where id = auth.uid()),
                    false, 'and afterwards they are asked no more');
  perform assert_eq(has_password(), true, 'with a password of their own');
  reset role;
end $$;

\echo ''
\echo '───────── done ─────────'
