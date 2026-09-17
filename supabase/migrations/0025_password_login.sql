-- ============================================================================
-- 0025: does this person have a password?
--
-- A password is an addition here, never a replacement: the emailed sign-in
-- link keeps working for everybody, which is what makes "I have forgotten it"
-- a non-event rather than a phone call, and means nobody locks themselves out
-- of a trade account at five to five on a Friday.
--
-- Supabase's client API will set a password but will not say whether one
-- exists, and the account screens need to know which sentence to show. The
-- fact lives in auth.users.encrypted_password, which no client may read — so
-- this reports the one bit of it that is the caller's own business, about the
-- caller only.
-- ============================================================================

create or replace function public.has_password()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select coalesce(u.encrypted_password, '') <> ''
       from auth.users u
      where u.id = auth.uid()),
    false);
$$;

comment on function public.has_password() is
  'Whether the signed-in user can sign in with a password as well as a link. '
  'Answers about the caller and nobody else, and returns a boolean rather than '
  'anything derived from the hash.';
