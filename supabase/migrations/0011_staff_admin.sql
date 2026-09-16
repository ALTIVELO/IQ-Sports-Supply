-- ============================================================================
-- 0011: an admin manages the staff list from the app.
--
-- 0010 introduced staff_invites and seeded the two directors. Editing it meant
-- opening the SQL editor, which is not something to ask of someone adding a
-- warehouse hand, so these two functions put it behind a screen.
--
-- Both are definer functions rather than direct table writes because granting
-- an account a role is exactly the operation that must not be loosened: they
-- check who is asking, and they refuse the three ways an admin could lock the
-- company out of its own system or hand a role to a customer.
-- ============================================================================

-- Raises unless the caller is an admin. Every entry point starts here.
create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only an admin can change who works here';
  end if;
end $$;

-- How many admins would remain if this address stopped being one. Counted
-- across both the allowlist and the profiles, because a person may exist in
-- either — invited but not yet signed in, or promoted by hand years ago.
create or replace function public.other_admin_count(p_email text) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from (
    select si.email from staff_invites si
      where si.role = 'admin' and si.email <> lower(p_email)
    union
    select lower(p.email) from profiles p
      where p.role = 'admin' and lower(p.email) <> lower(p_email)
         and p.email is not null
  ) remaining;
$$;

/**
 * Adds a staff member, or changes the role of one who is already listed.
 *
 * Takes effect immediately for someone who has already signed in, and waits in
 * the allowlist for someone who has not — so an admin never has to come back
 * and finish the job once the new starter first logs in.
 */
create or replace function public.invite_staff(
  p_email text,
  p_role  user_role,
  p_note  text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  perform assert_admin();

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  if p_role = 'client' then
    raise exception 'Use Clients to manage trade accounts, not this screen';
  end if;

  -- A trade customer must never be turned into staff here: their orders and
  -- pricing hang off the client record this would orphan.
  if exists (select 1 from clients where lower(email) = v_email) then
    raise exception 'That address belongs to a trade account, so it cannot be staff';
  end if;

  -- Demoting the last admin leaves nobody who can undo it.
  if p_role <> 'admin' and other_admin_count(v_email) = 0 then
    raise exception 'That would leave no admin. Make someone else an admin first';
  end if;

  insert into staff_invites (email, role, note)
  values (v_email, p_role, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (email) do update
    set role = excluded.role,
        note = coalesce(excluded.note, staff_invites.note);

  -- Anyone already signed in changes role now rather than at next login.
  update profiles set role = p_role where lower(email) = v_email;

  -- A role other than ops has no business holding site assignments.
  if p_role <> 'ops' then
    delete from ops_locations
     where profile_id in (select id from profiles where lower(email) = v_email);
  end if;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'staff', null, 'invite:' || v_email || ':' || p_role);
end $$;

/**
 * Removes someone's access. They keep their sign-in, but land on the "no
 * access" page rather than the staff app — the same place any stranger lands.
 */
create or replace function public.revoke_staff(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  perform assert_admin();

  -- Removing yourself is almost always a slip, and it is the one mistake you
  -- cannot undo from this screen.
  if v_email = (select lower(email) from profiles where id = auth.uid()) then
    raise exception 'You cannot remove your own access';
  end if;

  if other_admin_count(v_email) = 0 then
    raise exception 'That would leave no admin. Make someone else an admin first';
  end if;

  delete from staff_invites where email = v_email;
  delete from ops_locations
   where profile_id in (select id from profiles where lower(email) = v_email);
  update profiles set role = 'client' where lower(email) = v_email;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'staff', null, 'revoke:' || v_email);
end $$;
