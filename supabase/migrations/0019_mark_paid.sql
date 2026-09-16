-- ============================================================================
-- 0019: a proforma is not an unpaid invoice.
--
-- 0018 added proformas and credit notes without telling mark_invoice_paid
-- about either, so a proforma — a document that asks for nothing — appeared on
-- the invoice list in red as unpaid, with a button offering to settle it.
-- Marking one paid would have recorded a payment against money never demanded,
-- and the real invoice that follows would then be chased on its own.
--
-- The payment date is also worth having properly. Payment usually reaches us
-- before anyone gets to the screen, and an invoice recorded as paid today when
-- it was paid last Tuesday makes the ledger disagree with the bank.
-- ============================================================================

create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_paid_date  date default null,
  p_source     text default 'manual'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_date date;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;
  if v_inv.paid then return; end if;

  if v_inv.type = 'proforma' then
    raise exception 'A proforma asks for no payment. Raise the invoice first';
  end if;
  if v_inv.type = 'credit' then
    raise exception 'A credit note is money owed back, not a payment to receive';
  end if;
  if v_inv.superseded then
    raise exception 'That invoice has been superseded — pay the one that replaced it';
  end if;

  v_date := coalesce(p_paid_date, current_date);
  if v_date > current_date then
    raise exception 'That payment date is in the future';
  end if;
  -- An invoice cannot have been paid before it existed.
  if v_date < v_inv.date then
    raise exception 'That is before the invoice was raised on %', to_char(v_inv.date, 'DD Mon YYYY');
  end if;

  update invoices set paid = true, paid_date = v_date where id = p_invoice_id;

  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'payment_received',
          jsonb_build_object('invoice', v_inv.number, 'source', p_source, 'date', v_date));

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'invoice', p_invoice_id, 'mark_paid',
          jsonb_build_object('source', p_source, 'date', v_date));
end $$;
