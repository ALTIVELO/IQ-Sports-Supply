-- ============================================================================
-- 0045: moving a client between pricing tiers, on the record.
--
-- The tier has always been editable — it is a field on the client form — but
-- it is not a field like the others. A phone number is wrong or right; a tier
-- is the whole price list that client sees, on every screen, from the moment
-- it changes. Buried in a seven-box form it reads like a detail, and it is
-- the single most consequential thing on that screen.
--
-- So it gets its own way in, its own permission and its own record.
--
--   * its own way in, because the staff screen can now change it from the row
--     rather than by opening a form and saving six other fields alongside it;
--
--   * its own permission, because ops are warehouse staff. Suspending a client
--     already asks for admin or accounts, and a tier change is the same kind
--     of decision. The client form's own tier box is held to the same rule in
--     the same commit, or this one is decoration;
--
--   * its own record, because when a price looks wrong the first question is
--     who moved them and when, and until now nothing answered it.
--
-- Nothing has to be done about work in progress. A basket holds ids and
-- quantities and is priced fresh when it is read; an order takes its prices
-- when it is placed and keeps them. So a client whose tier moves mid-basket
-- sees the new prices at checkout, which is the answer that needs no rule.
-- ============================================================================

/**
 * Who may price a customer.
 *
 * Admin and accounts, the same two who may suspend one. Ops pick and pack:
 * they have every reason to read a client record and none to reprice it.
 */
create or replace function public.assert_pricing_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(my_role() in ('admin','accounts'), false) is not true then
    raise exception 'Only an admin or accounts can change what a client pays';
  end if;
end $$;

/**
 * Moves one client to another pricing tier, and says so in the log.
 *
 * Returns the tier moved from, so the screen can say what it just did rather
 * than only that it worked. A move to the tier they are already on is not an
 * error and is not a log entry: it is somebody re-picking the same option,
 * and a log full of those is a log nobody reads.
 */
create or replace function public.set_client_tier(p_client uuid, p_tier uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_from_name text; v_to_name text; v_client text;
begin
  perform assert_pricing_staff();

  select c.tier_id, c.name into v_from, v_client from clients c where c.id = p_client;
  if v_client is null then raise exception 'No such client'; end if;

  select name into v_to_name from tiers where id = p_tier;
  if v_to_name is null then raise exception 'No such pricing tier'; end if;

  if v_from = p_tier then return null; end if;

  select name into v_from_name from tiers where id = v_from;

  update clients set tier_id = p_tier where id = p_client;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'client', p_client, 'tier',
          jsonb_build_object('from', v_from, 'to', p_tier,
                             'from_name', v_from_name, 'to_name', v_to_name,
                             'client', v_client));

  return v_from_name;
end $$;

/**
 * The last tier move on each client, for the screen that lists them.
 *
 * One row per client, newest only: the question this answers is "who put them
 * on this, and when", which the current record answers and the history does
 * not. The whole history is in audit_log for anybody who wants it.
 */
create or replace function public.last_tier_changes()
returns table (client_id uuid, changed_at timestamptz, by_name text,
               from_name text, to_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (a.entity_id)
         a.entity_id,
         a.created_at,
         coalesce(nullif(trim(p.full_name), ''), p.email, 'someone no longer here'),
         a.detail ->> 'from_name',
         a.detail ->> 'to_name'
    from audit_log a
    left join profiles p on p.id = a.actor
   where a.entity = 'client' and a.action = 'tier' and is_staff()
   order by a.entity_id, a.created_at desc;
$$;
