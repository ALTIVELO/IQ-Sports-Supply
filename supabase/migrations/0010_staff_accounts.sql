-- ============================================================================
-- 0010: named staff accounts, and who gets told about orders and applications.
--
-- A staff account cannot simply be inserted: the profile row is keyed to an
-- auth user that does not exist until that person signs in for the first time.
-- Promoting them by hand afterwards means someone has to remember, and until
-- they do the new starter signs in as a client and sees the trade portal.
--
-- So the allowlist comes first. An address listed here is given its role the
-- moment the account appears, whether that is through the signup trigger or
-- through the application's own fallback — and anyone already signed in with
-- the wrong role is corrected when this file runs.
-- ============================================================================

create table if not exists staff_invites (
  email      text primary key,
  role       user_role not null default 'admin',
  note       text,
  created_at timestamptz not null default now(),
  constraint staff_invites_email_lower check (email = lower(email)),
  constraint staff_invites_not_client check (role <> 'client')
);

comment on table staff_invites is
  'Addresses that become staff on first sign-in. Being listed here grants a '
  'role, so only an admin may read or write it.';

alter table staff_invites enable row level security;

-- Deliberately admin-only, not is_staff(): this table decides who is staff, so
-- letting ops or accounts edit it would let them promote themselves.
drop policy if exists staff_invites_admin on staff_invites;
create policy staff_invites_admin on staff_invites for all
  using (is_admin()) with check (is_admin());

insert into staff_invites (email, role, note) values
  ('james@iqsportsupply.com',  'admin', 'Director'),
  ('rohail@iqsportsupply.com', 'admin', 'Director')
on conflict (email) do update set role = excluded.role, note = excluded.note;

-- ── first sign-in picks the role up ─────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  -- An allowlisted address is staff from its very first sign-in; everyone
  -- else is a client, as before.
  select si.role into v_role
    from staff_invites si where si.email = lower(new.email);

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name',
          coalesce(v_role, 'client'))
  on conflict (id) do nothing;

  -- Link an approved client that was created for this email address. Staff
  -- are excluded: a staff address must never be attached to a trade account.
  if v_role is null then
    update public.clients set auth_user_id = new.id
     where auth_user_id is null and lower(email) = lower(new.email);
  end if;

  return new;
end $$;

-- Same caveat as 0002: some hosted setups will not let this trigger be added
-- to auth.users, and that must not abort the file. The application's own
-- ensureProfile() applies the same allowlist, so sign-in works either way.
do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception when insufficient_privilege then
  raise notice
    'Could not add the signup trigger to auth.users (%). Everything else is '
    'installed, and the app assigns staff roles itself on first sign-in.',
    sqlerrm;
end $$;

-- ── correct anyone who has already signed in ────────────────────────────────
update profiles p
   set role = si.role
  from staff_invites si
 where lower(p.email) = si.email
   and p.role is distinct from si.role;

-- A staff address must not also be a trade account; detach it if it ever was.
update clients c
   set auth_user_id = null
  from profiles p
  join staff_invites si on si.email = lower(p.email)
 where c.auth_user_id = p.id;

-- ── who hears about orders and applications ─────────────────────────────────
-- application_recipient held one address. Both directors want the
-- applications, so it becomes a list like confirmation_cc already is.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'settings' and column_name = 'application_recipient') then
    alter table settings rename column application_recipient to application_recipients;
    alter table settings
      alter column application_recipients drop default,
      alter column application_recipients type text[]
        using case when coalesce(trim(application_recipients), '') = ''
                   then '{}'::text[] else array[application_recipients] end,
      alter column application_recipients set default '{}'::text[];
  end if;
end $$;

alter table settings
  add column if not exists application_recipients text[] not null default '{}';

update settings set
  confirmation_cc        = array['james@iqsportsupply.com','rohail@iqsportsupply.com'],
  application_recipients = array['james@iqsportsupply.com','rohail@iqsportsupply.com'],
  supplier_recipient     = case when coalesce(trim(supplier_recipient), '') = ''
                                then 'james@iqsportsupply.com' else supplier_recipient end
 where id = 1;
