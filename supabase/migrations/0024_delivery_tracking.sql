-- ============================================================================
-- 0024: delivery tracking — a real second milestone after shipped.
--
-- "Shipped" only ever meant the parcel left the warehouse. Nothing recorded
-- that it actually reached the client, yet the client portal and history
-- already called an order "Delivered" the moment tracking was entered. This
-- adds a genuine delivered milestone — set by hand once a parcel is confirmed
-- at the client's door — with its own order event and its own notification,
-- so "Delivered" means delivered.
-- ============================================================================

alter table invoices
  add column if not exists delivered    boolean not null default false,
  add column if not exists delivered_at timestamptz;

-- The client-facing timeline is driven entirely by order_events (0001), so a
-- new milestone needs a new enum value before anything can log one. Adding a
-- value is safe outside of a transaction that also reads it, which nothing
-- here does — the function below only uses it when it runs later, not when
-- it is created.
alter type order_event_type add value if not exists 'delivered';

-- ── mark delivered ──────────────────────────────────────────────────────────
-- Mirrors mark_invoice_shipped: gated on the previous stage, idempotent, logs
-- one order_events row so the client timeline and the notification are both
-- driven off the same fact.
create or replace function public.mark_invoice_delivered(p_invoice_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if not v_inv.shipped then raise exception 'Invoice has not shipped yet'; end if;
  if v_inv.delivered then return; end if;

  update invoices set delivered = true, delivered_at = now() where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'delivered', jsonb_build_object('invoice', v_inv.number));
end $$;

-- ── who gets copied ──────────────────────────────────────────────────────────
-- confirmation_cc already held the directors' addresses for order
-- confirmation only; it now also carries dispatch and delivery, so both
-- directors are copied on every client-facing milestone email, not just the
-- first one.
comment on column settings.confirmation_cc is
  'Copied on order confirmation, dispatch and delivery emails to the client.';
