-- ============================================================================
-- 0049: a parcel each, and a tracking number that can be corrected.
--
-- An invoice has carried one carrier and one tracking number since the
-- beginning, written once by mark_invoice_shipped and never again. Two things
-- wrong with that, and both of them are everyday.
--
-- An order does not always leave in one box. Three wheels and a groupset is
-- three parcels and three numbers, and until now the second and third went
-- into a note or nowhere — so the customer tracked one carton and wondered
-- where the rest was.
--
-- And a tracking number typed at the counter is typed by a person. A
-- transposed digit, or a carrier that voids a label and issues another, left
-- the customer with a link to nothing and nobody able to put it right.
--
-- So the parcels become rows. The invoice keeps its three columns and they go
-- on meaning what they always meant — the first parcel, the one the shipping
-- email quoted — kept in step by a trigger, so every screen, email and export
-- that reads them is untouched and the ones that should list every parcel can
-- ask for the rows instead.
--
-- Adding a parcel is shipping, so whoever ships may do it. Changing or
-- removing one that is already out is a correction to something a customer has
-- been told, so that is an admin, and it is logged.
-- ============================================================================

alter type order_event_type add value if not exists 'tracking_changed';

/**
 * Who may change what a customer has already been told.
 *
 * An admin. Adding a parcel is shipping and belongs to whoever ships; editing
 * or removing one that is out is a correction to a number somebody is holding
 * in an email, and that is a different kind of act.
 */
create or replace function public.assert_admin_tracking() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only an admin can change a tracking number that has gone out';
  end if;
end $$;

create table if not exists shipments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references invoices(id) on delete cascade,
  carrier         text not null,
  tracking_number text not null,
  tracking_url    text,
  /** When this parcel went, which for the second box may not be the first's. */
  shipped_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id),
  /*
   * The order they were recorded in, which timestamps cannot give.
   *
   * now() is the transaction's clock, so two parcels put on in one request
   * share it to the microsecond — and then "the first parcel", which is the
   * one the invoice mirrors and the shipping email quoted, would be decided by
   * whichever random uuid sorted first, and could decide differently tomorrow.
   */
  seq             bigint generated always as identity,
  -- The same number twice on one invoice is a slip, not a second parcel.
  unique (invoice_id, tracking_number)
);
create index if not exists shipments_invoice_idx
  on shipments (invoice_id, shipped_at, seq);

comment on table shipments is
  'One row per parcel. invoices.carrier/tracking_number/tracking_url mirror the '
  'first of these and are maintained by trigger; this table is the truth.';

alter table shipments enable row level security;
drop policy if exists shipments_staff on shipments;
create policy shipments_staff on shipments for all
  using (is_staff()) with check (is_staff());
-- A client reads the parcels of their own invoices and nobody else's.
drop policy if exists shipments_own on shipments;
create policy shipments_own on shipments for select using (
  invoice_id in (select id from invoices where client_id = my_client_id())
);

/**
 * The invoice's own three columns, kept as the first parcel.
 *
 * Not a convenience: every screen, email and export written before today reads
 * them, and rewriting all of those at once to fix a tracking number would be
 * the way to break something far from here. They keep meaning what they meant
 * — the parcel the shipping email quoted — and the list lives in the table.
 */
create or replace function public.sync_invoice_tracking(p_invoice uuid)
returns void language sql security definer set search_path = public as $$
  update invoices i
     set carrier         = s.carrier,
         tracking_number = s.tracking_number,
         tracking_url    = s.tracking_url
    from (
      select carrier, tracking_number, tracking_url
        from shipments
       where invoice_id = p_invoice
       -- By when it was recorded, not by when it says it went: the first
       -- parcel is the one the customer was told about, and backdating a
       -- later one must not move what their email pointed at.
       order by seq
       limit 1
    ) s
   where i.id = p_invoice;
$$;

create or replace function public.shipments_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sync_invoice_tracking(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists shipments_sync on shipments;
create trigger shipments_sync
  after insert or update or delete on shipments
  for each row execute function public.shipments_sync();

-- ── what is already out there ───────────────────────────────────────────────
-- Every invoice that has shipped becomes its own first parcel, so nothing
-- that has gone already loses the number the customer was given.
insert into shipments (invoice_id, carrier, tracking_number, tracking_url, shipped_at)
select id, coalesce(carrier, 'Carrier'), tracking_number, tracking_url,
       coalesce(shipped_at, now())
  from invoices
 where tracking_number is not null and btrim(tracking_number) <> ''
on conflict (invoice_id, tracking_number) do nothing;

-- ── putting a parcel on an invoice ──────────────────────────────────────────
/**
 * Another box on an order that is going out, or the first one.
 *
 * The first parcel is what makes an invoice shipped, so this does both rather
 * than making the counter remember which function to reach for. The customer
 * is told once, when it first ships; a parcel added afterwards appears on
 * their shipping screen without another email, because three emails for one
 * order read as three orders.
 */
create or replace function public.add_shipment(
  p_invoice_id uuid, p_carrier text, p_tracking text, p_url text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_id uuid; v_carrier text; v_tracking text;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  v_carrier  := btrim(coalesce(p_carrier, ''));
  v_tracking := btrim(coalesce(p_tracking, ''));
  if v_carrier = '' or v_tracking = '' then
    raise exception 'A parcel needs a carrier and a tracking number';
  end if;

  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if not v_inv.packed then raise exception 'Invoice has not been packed yet'; end if;

  insert into shipments (invoice_id, carrier, tracking_number, tracking_url, created_by)
  values (p_invoice_id, v_carrier, v_tracking, nullif(btrim(coalesce(p_url, '')), ''),
          auth.uid())
  returning id into v_id;

  if not v_inv.shipped then
    update invoices set shipped = true, shipped_at = now() where id = p_invoice_id;
    insert into order_events (order_id, type, meta)
    values (v_inv.order_id, 'shipped',
            jsonb_build_object('invoice', v_inv.number, 'carrier', v_carrier,
                               'tracking_number', v_tracking, 'tracking_url', p_url));
  else
    -- Said on the timeline, because a customer ringing about a missing box is
    -- asking a question this answers.
    insert into order_events (order_id, type, meta)
    values (v_inv.order_id, 'tracking_changed',
            jsonb_build_object('invoice', v_inv.number, 'added', v_tracking,
                               'carrier', v_carrier,
                               'parcels', (select count(*) from shipments
                                            where invoice_id = p_invoice_id)));
  end if;

  return v_id;
end $$;

-- Unchanged where it is called from, and now one parcel among what may become
-- several. The packed check and the event it raises both live in add_shipment.
create or replace function public.mark_invoice_shipped(
  p_invoice_id     uuid,
  p_carrier        text,
  p_tracking_number text,
  p_tracking_url   text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform add_shipment(p_invoice_id, p_carrier, p_tracking_number, p_tracking_url);
end $$;

-- ── correcting one ──────────────────────────────────────────────────────────
/**
 * A tracking number is a thing a customer has already been told.
 *
 * So changing one is an admin's, and the old value is kept in the log rather
 * than only the new one: somebody looking into "the link you sent me does not
 * work" needs to know what the link used to be.
 */
create or replace function public.update_shipment(
  p_id uuid, p_carrier text, p_tracking text, p_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_s shipments%rowtype; v_inv invoices%rowtype;
        v_carrier text; v_tracking text;
begin
  perform assert_admin_tracking();

  select * into v_s from shipments where id = p_id;
  if not found then raise exception 'No such parcel'; end if;
  select * into v_inv from invoices where id = v_s.invoice_id;

  v_carrier  := btrim(coalesce(p_carrier, ''));
  v_tracking := btrim(coalesce(p_tracking, ''));
  if v_carrier = '' or v_tracking = '' then
    raise exception 'A parcel needs a carrier and a tracking number';
  end if;

  update shipments
     set carrier = v_carrier, tracking_number = v_tracking,
         tracking_url = nullif(btrim(coalesce(p_url, '')), '')
   where id = p_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'tracking_changed',
          jsonb_build_object('invoice', v_inv.number,
                             'was', v_s.tracking_number, 'now', v_tracking,
                             'carrier', v_carrier));
  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', v_s.invoice_id, 'tracking_changed',
          jsonb_build_object('was', v_s.tracking_number, 'was_carrier', v_s.carrier,
                             'now', v_tracking, 'now_carrier', v_carrier));
end $$;

/**
 * Takes a parcel off, for one added in error.
 *
 * Never the last one: an invoice that has shipped with no tracking number at
 * all is a worse record than one with the wrong number, and correcting the
 * number is a button away.
 */
create or replace function public.remove_shipment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s shipments%rowtype; v_inv invoices%rowtype; v_left integer;
begin
  perform assert_admin_tracking();

  select * into v_s from shipments where id = p_id;
  if not found then raise exception 'No such parcel'; end if;
  select * into v_inv from invoices where id = v_s.invoice_id;

  select count(*)::int into v_left from shipments where invoice_id = v_s.invoice_id;
  if v_left <= 1 then
    raise exception 'That is the only tracking number on a shipped invoice — '
                    'correct it rather than removing it';
  end if;

  delete from shipments where id = p_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'tracking_changed',
          jsonb_build_object('invoice', v_inv.number, 'removed', v_s.tracking_number));
  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', v_s.invoice_id, 'tracking_removed',
          jsonb_build_object('removed', v_s.tracking_number, 'carrier', v_s.carrier));
end $$;
