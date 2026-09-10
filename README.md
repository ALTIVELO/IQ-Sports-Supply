# IQ Sports Supply — trade ordering platform

A B2B trade ordering system for IQ Sports Supply Ltd. Clients log in and order at
their tier prices, ops pack at their own site, accounts invoice through Xero, and
supplier orders go out carrying SKUs and quantities only.

Next.js (App Router) · Supabase (Postgres, Auth, RLS) · Xero · Resend

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the Supabase values
npm run dev
```

Paste [`supabase/setup.sql`](supabase/setup.sql) into the Supabase SQL editor
and run it — that is the whole schema, and it prints a table of checks that
should all say PASS. It is safe to re-run. See
[`supabase/README.md`](supabase/README.md) for the details.

Then sign in once so an auth user exists, and promote yourself:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

## What runs without keys

`SUPABASE_*` and `APP_URL` are needed from the start. Everything else is
optional, and the app is fully usable without it:

| Absent | Behaviour |
| --- | --- |
| `RESEND_API_KEY` | Invoices are still raised and downloadable as PDFs. Every message is written to the in-app **Outbox** exactly as it would be sent, so supplier orders can be copied out and forwarded by hand. |
| `XERO_*` | The Xero-format CSV export on the Invoices screen covers accounts, and payments are marked paid by hand. |

Client sign-in uses Supabase's own magic-link email, so the portal works before
Resend exists. Adding the keys later switches real sending and the Xero push on
with no rebuild.

## The workflow

1. **Placement.** Price per line comes from the client's tier; staff may override
   per line, clients never can. Allocation draws from the order's fulfilment
   location only — `alloc_qty = min(qty, stock there)` — and the remainder becomes
   `bo_qty`. Staff see other sites' stock at order time, so they can switch site
   or raise a transfer instead of backordering.
2. **Invoice at placement.** The whole order is invoiced immediately (VAT 20%, or
   zero-rated for a VAT-exempt client; due = date + payment terms) and emailed to
   the client with the CC addresses from Settings copied in. If a part-shipment
   later becomes necessary, staff split it into a shipment invoice and a backorder
   invoice dated to the stock availability date.
3. **Supplier order.** Raised automatically for the shortfall. Every line carries
   its `SO-###` reference and the supplier is asked to quote it back. The PO tables
   have no price columns and no client identity — that is enforced by the schema,
   not by convention.
4. **Payment gates dispatch.** Nothing is packable until the invoice is paid *and*
   its stock has arrived. Payment normally comes back from Xero; there is a manual
   fallback and an admin reversal.
5. **Receiving.** Booked in at the PO's location against the SO reference first,
   then oldest-order-first for anything unreferenced. Surplus becomes free stock.
6. **Packing and shipping.** One packing list per invoice, queued at that invoice's
   location and filtered to the signed-in ops user's site. Marking shipped with a
   carrier and tracking number emails the client the tracking link.
7. **Timeline.** Placed → Invoice sent → Payment received → Ordered from supplier →
   Stock arrived → Packed → Shipped, driven entirely by `order_events`. There is no
   manually editable status anywhere.

## Roles

| Role | Sees |
| --- | --- |
| `admin` | Everything. |
| `accounts` | Invoices, Xero, settings, applications, imports. |
| `ops` | Orders, packing, supplier POs, receiving — scoped to their assigned site(s). |
| `client` | Only their own catalogue view, orders, backorders and invoices. |

A client never sees another client, another tier's prices, supplier information,
or stock levels. Availability reaches the portal as a boolean through
`product_in_stock()` — never a quantity, never per-location.

## Price imports

Excel stays the working master. The Import screen takes `.xlsx`/`.csv` by
drag-and-drop — one file per tier, or one workbook with a tab per tier, matched
to tiers by tab name. Column mappings are saved per tier, so subsequent quarters
need no setup. It tolerates title blocks above the header row and blank rows in
the middle.

Before anything is written you get a preview in three buckets: new SKUs, price
changes with old → new and the % delta (anything beyond ±25% flagged as a likely
typo), and SKUs in the system missing from the sheet — reported only. **Imports
never delete anything.** An unreadable price is reported as a bad row rather than
silently becoming £0.00.

Applying writes new `tier_prices` rows dated to the chosen effective date, so a
quarterly sheet can be uploaded early and switch over on its own. Order lines
snapshot `unit_price` at placement, so past orders and invoices never move when
prices do.

## Categories

Price sheets carry a SKU, a description and a price — never a category — so
categories are derived from the description when a sheet is imported. New SKUs
are filed automatically; existing ones can be back-filled from the Catalogue
screen, and staff can override any product from a dropdown there.

The rules live in one place, `src/lib/catalogue/categories.ts`, and are checked
in two passes. Compound terms go first, because the meaning of a name often sits
in its last word: a chain whip is a tool, a brake cable is a cable, chain lube is
a lubricant. Only then are single keywords tried, most specific first, so a
chainset is never filed under chains.

A description that matches nothing stays uncategorised rather than being pushed
into an approximate bucket — a product in the wrong filter is worse than one in
none, because nobody thinks to look for it. The client portal shows only
categories that actually contain something, each with a count, plus an "Other"
chip when anything is unfiled.

45 assertions in `tests/unit/categories.test.mjs` cover the real catalogue rows,
the ordering traps, and the cases that must stay uncategorised.

## Numbering

`next_order_number()`, `next_invoice_number()`, `next_po_number()` and
`next_transfer_number()` each run `UPDATE settings SET n = n + 1 RETURNING`,
taking a row lock on the single settings row. Concurrent callers serialise, so a
number is never issued twice. Invoice numbering continues from the `IQ-2026-001`
and `002` already issued: the next is `003`.

## Tests

The workflow rules live in Postgres functions, so they are tested against a real
Postgres rather than mocked:

```bash
PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./tests/run-sql-tests.sh
```

61 assertions covering allocation and backordering, invoicing at placement, the
payment gate, receiving by SO reference, the invoice split and its dating, RLS
isolation between clients, and the approval flow. Each suite runs against a
freshly migrated database.

## Layout

```
src/app/            (public) apply · login
                    staff/   order desk · orders · supplier · packing · invoices
                             catalogue · clients · applications · locations
                             import · outbox · settings
                    portal/  catalogue · current orders · history · invoices
                             back orders · shipping
src/lib/            domain helpers: supabase clients, auth guards, email,
                    xero, pdf, import parsing
supabase/migrations 0001 schema · 0002 domain logic · 0003 RLS · 0004 seed
tests/              SQL test suites and their runner
```

## Deploying

Vercel, with the environment variables above set in the project. Point
`NEXT_PUBLIC_APP_URL` and `XERO_REDIRECT_URI` at the production domain, and add
that domain to Supabase's allowed redirect URLs so magic links land correctly.
