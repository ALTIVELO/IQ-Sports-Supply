-- ============================================================================
-- Set the fulfilment sites to Slough, Cornwall, Maryport, Glastonbury.
--
-- Renames in place rather than deleting and re-creating, so every existing
-- reference — stock levels, orders, invoices, clients' default sites — keeps
-- pointing at the right row. Safe to run more than once.
-- ============================================================================

update locations set name = 'Cornwall',    address = null where name = 'Blackpool';
update locations set name = 'Maryport',    address = null where name = 'Manchester';
update locations set name = 'Glastonbury', address = null where name = 'Bristol';

-- Glasgow is not one of the four. Remove it only if nothing points at it;
-- otherwise deactivate, so no existing record is left dangling.
do $$
declare gid uuid;
begin
  select id into gid from locations where name = 'Glasgow';
  if gid is null then
    raise notice 'No Glasgow row — nothing to do';
    return;
  end if;

  if exists (select 1 from stock_levels     where location_id = gid)
  or exists (select 1 from orders           where fulfilment_location_id = gid)
  or exists (select 1 from invoices         where location_id = gid)
  or exists (select 1 from clients          where default_location_id = gid)
  or exists (select 1 from purchase_orders  where receive_location_id = gid)
  or exists (select 1 from stock_transfers  where from_location_id = gid or to_location_id = gid)
  then
    update locations set active = false where id = gid;
    raise notice 'Glasgow is referenced by existing records — deactivated, not deleted';
  else
    delete from ops_locations where location_id = gid;
    delete from locations where id = gid;
    raise notice 'Glasgow removed';
  end if;
end $$;

select name, coalesce(address, '—') as address, active from locations order by name;
