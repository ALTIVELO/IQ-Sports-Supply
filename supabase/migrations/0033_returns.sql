-- ============================================================================
-- 0033: goods coming back, for the two reasons we accept.
--
-- IQ does not take returns because somebody over-ordered or changed their
-- mind. Trade stock is bought to be sold on, a shop that has held a frame for
-- three weeks has not bought it on approval, and a policy that says otherwise
-- gets used. The two reasons we do accept are the two that are our fault:
--
--   faulty      — it arrived broken, or broke under warranty;
--   wrong_item  — we picked and sent something other than what was ordered.
--
-- That list is an enum, not a dropdown. A dropdown is a suggestion; an enum
-- means no screen, script or future import can record a return for any other
-- reason, and nobody has to remember the policy to enforce it.
--
-- The two reasons are not the same thing afterwards, either. A wrong item is
-- good stock that should never have left, so it goes back on the shelf when
-- it arrives. A faulty one does not, whatever it looks like. That difference
-- is in receive_return and is the main reason the reason sits on the line
-- rather than on the request: one parcel can hold both.
--
-- Nothing here refunds anybody by itself. A return is a request, then a
-- decision, then goods actually arriving, then a resolution — and the credit
-- note is raised by the same credit_invoice() 0018 already uses, so a refund
-- from a return and a refund typed in by hand are the same document.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'return_reason') then
    create type return_reason as enum ('faulty', 'wrong_item');
  end if;
  if not exists (select 1 from pg_type where typname = 'return_status') then
    create type return_status as enum
      ('requested', 'approved', 'declined', 'received', 'resolved', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'return_outcome') then
    create type return_outcome as enum ('refund', 'exchange');
  end if;
end $$;

alter type order_event_type add value if not exists 'return_requested';
alter type order_event_type add value if not exists 'return_decided';
alter type order_event_type add value if not exists 'return_resolved';

-- How long after dispatch we will look at one. A policy, so it lives where
-- the rest of the terms live rather than in a constant somebody has to find.
alter table settings add column if not exists returns_days integer not null default 30;
comment on column settings.returns_days is
  'Days after dispatch a client may still report a fault or a wrong item.';

-- Who hears about one. Seeded from whoever already fields trade applications,
-- because a returns queue nobody is told about is a returns queue nobody works.
alter table settings add column if not exists returns_recipients text[] not null default '{}';
update settings
   set returns_recipients = application_recipients
 where id = 1 and returns_recipients = '{}' and application_recipients <> '{}';

create table if not exists returns (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  client_id     uuid not null references clients(id),
  order_id      uuid not null references orders(id) on delete cascade,
  status        return_status not null default 'requested',
  /** What the client asked for. Staff may settle it the other way with a note. */
  wanted        return_outcome not null,
  raised_by     uuid references profiles(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references profiles(id),
  decision_note text,
  received_at   timestamptz,
  resolved_at   timestamptz,
  /** Whichever of these the resolution produced. */
  credit_id     uuid references invoices(id),
  replacement_order_id uuid references orders(id)
);
create index if not exists returns_client_idx on returns (client_id, created_at desc);
create index if not exists returns_open_idx on returns (status, created_at)
  where status in ('requested', 'approved', 'received');

create table if not exists return_lines (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns(id) on delete cascade,
  order_line_id uuid not null references order_lines(id),
  -- Snapshotted like an order line's, so a return still reads correctly when
  -- the catalogue moves on.
  sku           text not null,
  name          text not null,
  qty           integer not null check (qty > 0),
  /** Per line: one parcel can hold a faulty item and a wrongly-picked one. */
  reason        return_reason not null,
  note          text
);
create index if not exists return_lines_return_idx on return_lines (return_id);

alter table settings add column if not exists next_return integer not null default 1;

create or replace function public.next_return_number() returns text
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update settings set next_return = next_return + 1 where id = 1
    returning next_return - 1 into n;
  return 'RMA-' || lpad(n::text, 4, '0');
end $$;

-- ── who sees what ───────────────────────────────────────────────────────────

alter table returns enable row level security;
alter table return_lines enable row level security;

drop policy if exists returns_staff on returns;
create policy returns_staff on returns for all using (is_staff()) with check (is_staff());
drop policy if exists returns_client_read on returns;
create policy returns_client_read on returns for select using (client_id = my_client_id());

drop policy if exists return_lines_staff on return_lines;
create policy return_lines_staff on return_lines for all
  using (is_staff()) with check (is_staff());
drop policy if exists return_lines_client_read on return_lines;
create policy return_lines_client_read on return_lines for select using (
  exists (select 1 from returns r where r.id = return_id and r.client_id = my_client_id())
);

-- ── how much of a line is still returnable ──────────────────────────────────

/**
 * What is left to send back on an order line.
 *
 * Counts everything not declined or cancelled, so a request sitting unread
 * still holds its quantity: without that, a client clicking twice could ask
 * to return four of the two they bought and both requests would look valid
 * until somebody added them up.
 */
create or replace function public.returnable_qty(p_order_line uuid)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, l.qty - coalesce((
    select sum(rl.qty) from return_lines rl
      join returns r on r.id = rl.return_id
     where rl.order_line_id = l.id
       and r.status not in ('declined', 'cancelled')
  ), 0))::integer
    from order_lines l
   where l.id = p_order_line;
$$;

/**
 * Raises a return request.
 *
 * Called by the client, so every constraint is checked here and not on the
 * screen that called it: the order must be theirs, the lines must be on that
 * order, the quantity must be left to return, and the window must be open.
 *
 * The window runs from dispatch, not from the order date. An order that sat
 * on back order for five weeks has not used up its returns window sitting in
 * our warehouse.
 */
create or replace function public.request_return(
  p_order_id uuid, p_wanted return_outcome, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_return  uuid;
  v_line    jsonb;
  v_src     order_lines%rowtype;
  v_qty     integer;
  v_left    integer;
  v_days    integer;
  v_shipped date;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then raise exception 'Unknown order'; end if;

  if not (is_staff() or v_order.client_id = my_client_id()) then
    raise exception 'Not authorised';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'That order was cancelled, so there is nothing to send back';
  end if;

  select returns_days into v_days from settings where id = 1;
  select max(i.shipped_at)::date into v_shipped
    from invoices i where i.order_id = p_order_id and i.shipped and not i.superseded;

  if v_shipped is null then
    raise exception 'Nothing on that order has been dispatched yet — '
                    'tell us what is wrong and we will amend it before it goes';
  end if;
  -- Staff can raise one outside the window; a client cannot. Somebody has to
  -- be able to do the right thing for a customer, and that somebody is a
  -- person with a reason, not a form.
  if not is_staff() and v_shipped + v_days < current_date then
    raise exception 'That order was dispatched more than % days ago', v_days;
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Say which items are coming back';
  end if;

  insert into returns (number, client_id, order_id, wanted, raised_by)
  values (next_return_number(), v_order.client_id, p_order_id, p_wanted, auth.uid())
  returning id into v_return;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_src from order_lines
     where id = (v_line->>'order_line_id')::uuid and order_id = p_order_id;
    if not found then raise exception 'That item is not on this order'; end if;

    v_qty  := greatest(1, (v_line->>'qty')::integer);
    v_left := returnable_qty(v_src.id);
    if v_qty > v_left then
      raise exception 'You can send back % of %, not %', v_left, v_src.sku, v_qty;
    end if;

    -- The cast is the policy: anything but 'faulty' or 'wrong_item' fails
    -- here, whatever screen or script is asking.
    insert into return_lines (return_id, order_line_id, sku, name, qty, reason, note)
    values (v_return, v_src.id, v_src.sku, v_src.name, v_qty,
            (v_line->>'reason')::return_reason,
            nullif(trim(coalesce(v_line->>'note', '')), ''));
  end loop;

  insert into order_events (order_id, type, meta)
  values (p_order_id, 'return_requested',
          jsonb_build_object('return', v_return, 'wanted', p_wanted));

  return v_return;
end $$;

/** Staff deciding. A declined return is over; an approved one waits for goods. */
create or replace function public.decide_return(
  p_return uuid, p_approve boolean, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ret returns%rowtype;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'requested' then
    raise exception 'That return has already been %', v_ret.status;
  end if;

  update returns
     set status = case when p_approve then 'approved' else 'declined' end::return_status,
         decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_return;

  insert into order_events (order_id, type, meta)
  values (v_ret.order_id, 'return_decided',
          jsonb_build_object('return', p_return, 'approved', p_approve, 'note', p_note));
end $$;

/**
 * The goods are back on our counter.
 *
 * A wrongly-picked item is good stock that should never have left, so it goes
 * back on the shelf. A faulty one does not, whatever it looks like on the
 * counter: it is going back to the supplier or in the bin, and putting it
 * into stock would sell somebody else's fault to the next customer.
 */
create or replace function public.receive_return(
  p_return uuid, p_location uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ret      returns%rowtype;
  v_location uuid;
  v_restocked integer := 0;
  r          record;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'approved' then
    raise exception 'Only an approved return can be received — this one is %', v_ret.status;
  end if;

  select coalesce(p_location, o.fulfilment_location_id) into v_location
    from orders o where o.id = v_ret.order_id;

  for r in
    select rl.qty, l.product_id
      from return_lines rl
      join order_lines l on l.id = rl.order_line_id
     where rl.return_id = p_return
       and rl.reason = 'wrong_item'
       and l.product_id is not null
  loop
    insert into stock_levels (product_id, location_id, qty)
    values (r.product_id, v_location, r.qty)
    on conflict (product_id, location_id) do update
      set qty = stock_levels.qty + excluded.qty;
    v_restocked := v_restocked + r.qty;
  end loop;

  update returns set status = 'received', received_at = now() where id = p_return;
  return v_restocked;
end $$;

/**
 * Settling it: a credit note, or a replacement on its way.
 *
 * A refund credits the invoice the goods were billed on, through the same
 * function a hand-typed credit note uses, for the quantities actually coming
 * back — not the whole invoice, which is what somebody in a hurry would do.
 *
 * An exchange is recorded against an order staff have raised for the
 * replacement, rather than raised here. A replacement is picked, packed and
 * shipped like anything else and the order desk already does all of that;
 * inventing a second path would be a second thing to keep working.
 */
create or replace function public.resolve_return(
  p_return uuid, p_outcome return_outcome, p_replacement_order uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ret     returns%rowtype;
  v_invoice uuid;
  v_credit  uuid;
  v_lines   jsonb;
begin
  if not is_staff() then raise exception 'Not authorised'; end if;

  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if v_ret.status <> 'received' then
    raise exception 'The goods have not been received yet';
  end if;

  if p_outcome = 'exchange' then
    if p_replacement_order is null then
      raise exception 'Say which order is the replacement';
    end if;
    update returns
       set status = 'resolved', resolved_at = now(),
           replacement_order_id = p_replacement_order
     where id = p_return;
  else
    -- The live invoice the goods were billed on. A superseded one was
    -- withdrawn and crediting it would credit a document owed by nobody.
    select i.id into v_invoice
      from invoices i
     where i.order_id = v_ret.order_id
       and not i.superseded and i.type in ('full', 'shipment', 'backorder')
     order by i.date, i.number
     limit 1;
    if v_invoice is null then
      raise exception 'There is no invoice on that order to credit';
    end if;

    select jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty))
      into v_lines from return_lines where return_id = p_return;

    v_credit := credit_invoice(v_invoice, v_lines,
                               'Return ' || v_ret.number);
    update returns
       set status = 'resolved', resolved_at = now(), credit_id = v_credit
     where id = p_return;
  end if;

  insert into order_events (order_id, type, meta)
  values (v_ret.order_id, 'return_resolved',
          jsonb_build_object('return', p_return, 'outcome', p_outcome,
                             'credit', v_credit, 'replacement', p_replacement_order));

  return coalesce(v_credit, p_replacement_order);
end $$;

/** A client thinking better of it, before anybody has looked. */
create or replace function public.cancel_return(p_return uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ret returns%rowtype;
begin
  select * into v_ret from returns where id = p_return;
  if not found then raise exception 'Unknown return'; end if;
  if not (is_staff() or v_ret.client_id = my_client_id()) then
    raise exception 'Not authorised';
  end if;
  if v_ret.status <> 'requested' then
    raise exception 'That return is already being dealt with';
  end if;
  update returns set status = 'cancelled' where id = p_return;
end $$;
