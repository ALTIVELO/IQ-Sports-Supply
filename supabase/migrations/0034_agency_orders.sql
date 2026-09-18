-- ============================================================================
-- 0034: the orders where IQ is not the seller.
--
-- Most of what IQ sells, IQ buys and sells on: it prices the goods, invoices
-- the customer, ships them and stands behind them. DRAG is not that. A DRAG
-- order is introduced: it goes to DRAG for confirmation, DRAG raises the
-- final invoice with shipping and taxes on it, DRAG ships and carries the
-- warranty and the product liability, and DRAG pays IQ a commission for the
-- introduction. IQ is an agent on those orders, and an agent that says
-- nothing looks exactly like a seller.
--
-- So the disclosure is not a sentence somebody remembered to type into a
-- template. It is a column on the brand, snapshotted onto the order when the
-- order is placed, and read by every surface that shows the order — the
-- basket, the confirmation, the portal, the emailed confirmation and the PDF.
-- One wording, in one place, on every document about that order.
--
-- Snapshotted rather than looked up, because these are terms, not a note
-- about pricing. If the arrangement with a brand changes next year, an order
-- placed today must still say what the customer was told when they placed it.
-- (Contrast products.price_note, which is deliberately live: that describes
-- how a supplier quotes, and a wrong one should be corrected everywhere.)
--
-- And an order is either an agency order or it is not. One invoice cannot be
-- a demand from a seller for half its lines and a note from an agent for the
-- other half, so mixing them is refused here rather than caught in reading.
-- The basket splits by brand before it ever gets this far; this is the wall
-- behind that, for every other way a line can reach an order.
-- ============================================================================

alter table brands add column if not exists agency boolean not null default false;
comment on column brands.agency is
  'We introduce this brand''s orders rather than selling their goods: they '
  'invoice the customer and carry shipping, warranty and product liability.';

alter table brands add column if not exists agency_terms text;
comment on column brands.agency_terms is
  'What the customer is told on an order for this brand. One statement per '
  'line. {brand} and {company} are filled in when it is shown.';

alter table orders add column if not exists agent_brand_id uuid references brands(id);
alter table orders add column if not exists agency_terms text;
comment on column orders.agency_terms is
  'The brand''s terms as they stood when this order was placed. Snapshotted, '
  'so a later change to the arrangement never rewrites what a customer was '
  'told at the time.';

create index if not exists orders_agent_brand_idx on orders (agent_brand_id)
  where agent_brand_id is not null;

/**
 * Stamps an order with the terms it was placed under.
 *
 * Runs per statement off the lines that landed, so every path into an order —
 * the portal basket, the counter, an amendment, a historic import — is
 * covered by the same rule, and none of them has to remember it.
 */
create or replace function public.snapshot_agency_terms()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select o.id as order_id,
           count(*) filter (where b.agency) as agency_lines,
           count(*) filter (where b.agency is not true) as own_lines,
           (array_agg(distinct b.id) filter (where b.agency))[1] as brand_id,
           count(distinct b.id) filter (where b.agency) as agency_brands
      from (select distinct order_id from new_lines) n
      join orders o on o.id = n.order_id
      join order_lines l on l.order_id = o.id
      left join products p on p.id = l.product_id
      left join brands b on b.id = p.brand_id
     group by o.id
  loop
    if r.agency_lines > 0 and r.own_lines > 0 then
      raise exception 'An order cannot hold both goods we sell and goods we only '
                      'introduce — they are invoiced by different companies. '
                      'Raise the introduced lines as their own order.';
    end if;
    if r.agency_brands > 1 then
      raise exception 'An order can only be introduced to one brand: each of them '
                      'invoices the customer separately.';
    end if;
    if r.agency_lines > 0 then
      update orders
         set agent_brand_id = r.brand_id,
             agency_terms = coalesce(
               orders.agency_terms,
               (select b2.agency_terms from brands b2 where b2.id = r.brand_id))
       where orders.id = r.order_id;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists order_lines_agency on order_lines;
create trigger order_lines_agency
  after insert on order_lines
  referencing new table as new_lines
  for each statement execute function public.snapshot_agency_terms();

/**
 * The agency brands, for a screen that has to warn about a basket.
 *
 * Definer, because a client cannot read `brands` and must not be able to —
 * that table carries the consignment arrangements. What comes back is only
 * what we intend to print on the customer's own order anyway, for the brands
 * we have chosen to disclose. Nothing here is commercial.
 */
create or replace function public.agency_brands()
returns table (key text, name text, terms text)
language sql stable security definer set search_path = public as $$
  select b.key, b.name, b.agency_terms
    from brands b
   where b.agency and auth.uid() is not null;
$$;

-- ── DRAG ────────────────────────────────────────────────────────────────────
--
-- Seeded rather than left for somebody to fill in, because the disclosure is
-- not optional and an empty one is the same as none. The brand row may not
-- exist yet on a database whose catalogue has not been imported; it will be
-- created by the product sync when it is, and this claims the key first so
-- the terms are already there when the first bike lands.
--
-- Existing terms are never overwritten: once staff have worded this
-- themselves, re-running the migration must not quietly put it back.
insert into brands (key, name, agency, agency_terms)
values ('drag', 'DRAG', true,
  'This order goes to {brand} for confirmation. {brand} raises the final ' ||
  'invoice, which includes shipping and any duty or taxes.' || E'\n' ||
  '{company} acts as an introducing agent on {brand} orders and is paid a ' ||
  'commission by {brand}. We are not the seller of these goods.' || E'\n' ||
  '{brand} is responsible for shipping, for warranty, and for product ' ||
  'liability.' || E'\n' ||
  'We are here to help with all of it — tell us what you need and we will ' ||
  'take it up with {brand} for you.')
on conflict (key) do update
   set agency = true,
       agency_terms = coalesce(brands.agency_terms, excluded.agency_terms);

-- Orders already placed for an agency brand get the terms too, so the PDFs
-- and the portal do not have a gap where the disclosure should be.
update orders o
   set agent_brand_id = b.id,
       agency_terms = coalesce(o.agency_terms, b.agency_terms)
  from brands b
 where b.agency
   and o.agent_brand_id is null
   and exists (
     select 1 from order_lines l join products p on p.id = l.product_id
      where l.order_id = o.id and p.brand_id = b.id)
   and not exists (
     select 1 from order_lines l
       left join products p2 on p2.id = l.product_id
       left join brands b2 on b2.id = p2.brand_id
      where l.order_id = o.id and b2.agency is not true);
