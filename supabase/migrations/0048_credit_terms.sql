-- ============================================================================
-- 0048: credit terms, and what a client owes.
--
-- Nothing has ever left the building unpaid: mark_invoice_packed refuses an
-- invoice that is not paid, and the packing queue only shows the ones that
-- are. That is the right default and it is why it was built that way — but it
-- is not how the trade actually works with an account customer. MDI are on
-- terms. Their goods go when the goods are ready, and the money follows.
--
-- So the account carries the arrangement, rather than somebody overriding the
-- rule one invoice at a time. A client on terms packs when the stock is there;
-- everybody else still packs when the money is there, and nothing about that
-- has changed.
--
-- Which makes the other half of this the important half. Releasing goods
-- against a promise is only safe if somebody can see how much has already been
-- promised, so the amount outstanding is worked out here and shown where the
-- decision gets made — on the client, and on the packing queue beside the
-- invoice about to go out.
--
-- What this is not: a ledger. It answers "what have we invoiced this client
-- that they have not paid", which is the question asked before releasing
-- goods. Credits raised against invoices still unpaid are netted off, because
-- those reduce what is owed. A credit against an invoice already paid is money
-- owed back to them — a refund, a different question, and not counted here.
-- ============================================================================

alter table clients add column if not exists credit_account boolean not null default false;

comment on column clients.credit_account is
  'On terms: their goods are packed when the stock is ready rather than when '
  'the invoice is paid. What they owe is on their account until it is settled.';

/**
 * What each client has been invoiced and has not paid.
 *
 * Per currency, because we invoice in both and one added-up figure would be a
 * number nobody is owed. An agency acknowledgement is not an unpaid invoice —
 * the brand is invoicing that customer and nothing on it is owed to us — and a
 * superseded invoice was withdrawn rather than left unpaid.
 *
 * Gross, because what a customer owes is what the invoice asks for, VAT and
 * all.
 */
create or replace function public.client_balances(p_clients uuid[] default null)
returns table (
  client_id uuid, currency text, due numeric,
  overdue numeric, invoices integer, oldest_due date
)
language sql stable security definer set search_path = public as $$
  with mine as (
    select i.*
      from invoices i
     where (p_clients is null or i.client_id = any(p_clients))
       and (is_staff() or i.client_id = my_client_id())
  ),
  owing as (
    select i.id, i.client_id, i.currency, i.due_date, i.vat_rate,
           coalesce((select sum(l.qty * l.unit_price) from invoice_lines l
                      where l.invoice_id = i.id), 0) as net
      from mine i
     where not i.paid and not i.superseded and not i.agency and i.type <> 'credit'
  ),
  -- A credit note raised against one of those reduces it. One against an
  -- invoice already settled is a refund and is somebody else's question.
  credited as (
    select c.credit_of as against,
           coalesce((select sum(l.qty * l.unit_price) from invoice_lines l
                      where l.invoice_id = c.id), 0) as net
      from mine c
     where c.type = 'credit' and not c.superseded
       and c.credit_of in (select id from owing)
  ),
  per_invoice as (
    select o.client_id, o.currency, o.due_date,
           greatest(0, (o.net - coalesce((select sum(x.net) from credited x
                                           where x.against = o.id), 0)))
             * (1 + o.vat_rate / 100) as gross
      from owing o
  )
  select client_id,
         coalesce(currency, 'GBP'),
         round(sum(gross), 2),
         -- Coalesced, because a filtered sum over no matching rows is null
         -- rather than nothing: a screen doing arithmetic on "overdue" would
         -- get null for the client who owes money and happens to be on time.
         round(coalesce(sum(gross) filter (where due_date < current_date), 0), 2),
         count(*)::integer,
         min(due_date)
    from per_invoice
   group by client_id, coalesce(currency, 'GBP')
  having sum(gross) > 0;
$$;

/**
 * Puts a client on terms, or takes them off.
 *
 * Admin and accounts, the same two who decide what a client pays and whether
 * their account is open at all. Releasing goods against a promise is the same
 * kind of decision as pricing them, and it is logged for the same reason.
 */
create or replace function public.set_client_credit(p_client uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_was boolean; v_name text;
begin
  perform assert_pricing_staff();

  select credit_account, name into v_was, v_name from clients where id = p_client;
  if v_name is null then raise exception 'No such client'; end if;
  if v_was = p_on then return false; end if;

  update clients set credit_account = p_on where id = p_client;

  insert into audit_log (actor, entity, entity_id, action, detail)
  values (auth.uid(), 'client', p_client, 'credit_terms',
          jsonb_build_object('on', p_on, 'client', v_name));
  return true;
end $$;

-- ── packing ─────────────────────────────────────────────────────────────────
/**
 * The stock still has to be here. The money does not, on an account.
 *
 * The refusal stays exactly as it was for everybody else, and the reason it
 * can be lifted is written on the client rather than decided at the moment of
 * packing — so the person with the box in their hands is not the person
 * deciding whether this customer is good for it.
 *
 * It is said out loud on the order's timeline and in the log, with what was
 * owed at the moment it went. Goods leaving against a promise is a thing
 * somebody will want to find afterwards.
 */
create or replace function public.mark_invoice_packed(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_credit boolean; v_due numeric;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;
  select * into v_inv from invoices where id = p_invoice_id;
  if not found then raise exception 'Unknown invoice'; end if;

  select credit_account into v_credit from clients where id = v_inv.client_id;

  if not v_inv.paid and not coalesce(v_credit, false) then
    raise exception 'Invoice is not paid — nothing ships before payment';
  end if;
  if not v_inv.ready_to_pack then raise exception 'Stock for this invoice has not arrived yet'; end if;

  update invoices set packed = true, packed_at = now() where id = p_invoice_id;
  insert into order_events (order_id, type, meta)
  values (v_inv.order_id, 'packed', jsonb_build_object('invoice', v_inv.number));

  if not v_inv.paid then
    select sum(due) into v_due from client_balances(array[v_inv.client_id]);
    insert into order_events (order_id, type, meta)
    values (v_inv.order_id, 'packed',
            jsonb_build_object('invoice', v_inv.number, 'on_account', true,
                               'owed_after', v_due));
    insert into audit_log (actor, entity, entity_id, action, detail)
    values (auth.uid(), 'invoice', p_invoice_id, 'packed_on_account',
            jsonb_build_object('invoice', v_inv.number, 'owed_after', v_due));
  end if;
end $$;

/*
 * MDI, who are the reason this exists.
 *
 * Named here rather than left for somebody to tick, because the arrangement is
 * already true and a feature that ships switched off is a feature nobody
 * remembers to switch on. Guarded on the name, so it does nothing at all on a
 * database that has never heard of them, and reversible from the Clients
 * screen like any other account.
 */
update clients set credit_account = true where name = 'MDI Ltd';
