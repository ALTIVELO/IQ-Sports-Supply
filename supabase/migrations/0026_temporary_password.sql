-- ============================================================================
-- 0026: a password that has to be changed.
--
-- A new customer needs to get in before they have an inbox habit with us, and
-- "wait for the link" is a poor first impression when somebody is on the phone
-- to you. So staff can hand out a temporary password — read out once, never
-- emailed — and the account insists on a real one the first time it is used.
--
-- The flag lives on profiles rather than in auth metadata because it is ours:
-- every screen already reads this row to find a role, RLS already decides who
-- may write it, and it can be tested here rather than only against a live
-- Supabase.
-- ============================================================================

alter table profiles
  add column if not exists must_change_password boolean not null default false;

comment on column profiles.must_change_password is
  'Set when staff issue a temporary password. Every guarded screen sends the '
  'user to change it, and only the server action that actually changes a '
  'password clears it.';
