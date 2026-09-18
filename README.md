# IQ Sports Supply — trade ordering platform

A B2B trade ordering system for IQ Sports Supply Ltd. Clients log in and order at
their tier prices, ops pack at their own site, accounts invoice through Xero, and
supplier orders go out carrying SKUs and quantities only.

Next.js (App Router) · Supabase (Postgres, Auth, RLS) · Xero · Resend

## Brand

Palette and mark come from the IQ Sports Supply logo, defined once in
`tailwind.config.ts` and drawn in `src/components/Logo.tsx`.

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#121619` | Text, the navigation rail, primary buttons |
| `flame` | `#FF4A1A` | The mark, active indicators, rules, focus, accent buttons |
| `flame-text` | `#C2340C` | Links and labels on a light ground |
| `parch` / `line` / `mute` | `#F4F5F7` / `#E1E4E8` / `#5A6470` | Surfaces, rules, secondary text |

`flame` measures **3.36:1** against white, which fails WCAG AA for normal text
both as text on white and as a fill behind white text. So it never carries small
white text: primary buttons use `ink` (18.19:1), accent buttons and count chips
use ink *on* flame (5.41:1), and links on light use `flame-text` (5.54:1).

The mark is SVG rather than a bitmap, so it stays sharp at every size and takes
`currentColor` for the letterforms while the orange stays fixed — one component
serves the dark rail and the white public pages.

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
8. **Returns.** Two reasons are accepted and they are an enum, not a dropdown:
   the goods arrived faulty, or we sent the wrong thing. Nothing comes back
   because a shop over-ordered. A client raises one from the order it is about,
   within `returns_days` of dispatch (staff are exempt, so somebody can always do
   the right thing); it goes requested → approved → received → resolved. Booking
   the parcel in restocks the wrongly-picked lines and never the faulty ones —
   the reason sits on the line because one parcel can hold both. Settling it
   raises a credit note through the same `credit_invoice()` a hand-typed credit
   uses, or points at the replacement order raised on the order desk.

## Roles

| Role | Sees |
| --- | --- |
| `admin` | Everything. |
| `accounts` | Invoices, Xero, settings, applications, imports. |
| `ops` | Orders, packing, supplier POs, receiving — scoped to their assigned site(s). |
| `client` | Only their own catalogue view, orders, backorders, invoices and returns. |

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

## Product images

Supplier price sheets carry no images, so `products.image_url` holds a full URL
and is filled in afterwards — either by uploading on the Catalogue screen
(straight from the browser to the `product-images` bucket, public read, staff
write) or from an optional Image URL column on import. Holding a URL rather
than a storage path means a supplier's own CDN works without the app having to
know the difference.

Most of the catalogue has no photo and will not for some time, so the
placeholder is the common case rather than the exception and is drawn to look
deliberate. A URL that fails to load falls back to the same placeholder, since
a supplier's image can disappear without warning.

Plain `<img>`, not `next/image`: these URLs point at whatever host the image
lives on, and `next/image` would need every one declared up front.

## Collections

Two levels: a **group** holds collections, a collection holds products.

```
Complete bicycles   road · gravel · mountain · electric · hybrid · kids · track
Frames & forks      road · gravel · mountain frames · forks
Bike parts          brake pads · chains · chainsets · cassettes · derailleurs · …
Wheels & tyres      wheels · spokes · tyres · tubes
Clothing            jerseys · shorts · jackets · base layers · gloves · socks · shoes · eyewear
Helmets             road · mountain · aero · kids
Accessories         bottles · lights · computers · pumps · locks · luggage · mudguards
Tools & workshop    workshop · torque · bleed kits · wheel tools · lubricants
```

The portal opens on the groups; `/portal/c/[slug]` shows a group's collections
or a collection's products, with `?all=1` to list everything under a group.
`/portal/c/other` gathers anything not yet categorised.

Counts roll up, so a group shows everything beneath it. **Every collection is
shown whether or not it holds stock** — the full list tells a customer what IQ
supplies, which is worth more than hiding the gaps while the catalogue is
still being loaded. An empty one reads "Coming soon" in muted type rather than
carrying a count, and its page says so plainly instead of 404ing, so it is
clearly not-yet-stocked rather than broken.

A product may attach to a group directly: "Helmet" with no further detail is a
real description, and Helmets is a better answer than a sub-type the text does
not support. Searching from the landing page skips straight to matching
products, because someone who knows the SKU should not have to guess where it
is filed.

Splitting the catalogue across pages means the basket has to outlive
navigation, so it lives in `CartContext` above the page tree and is mirrored to
`localStorage` — a trade order runs to dozens of lines and should not be lost to
a refresh or a phone locking. Only quantities are stored; prices are always read
fresh from the server, so a stale basket can never carry a stale price.

The header carries the basket and its count on every page of the portal, and
`/portal/basket` reviews it line by line before committing: quantities editable,
back-ordered lines called out before the order is placed rather than after, and
anything withdrawn from the catalogue since it went in the basket reported and
left out.

## Numbering

`next_order_number()`, `next_invoice_number()`, `next_po_number()`,
`next_transfer_number()` and `next_return_number()` each run `UPDATE settings SET n = n + 1 RETURNING`,
taking a row lock on the single settings row. Concurrent callers serialise, so a
number is never issued twice. Invoice numbering continues from the `IQ-2026-001`
and `002` already issued: the next is `003`.

## Tests

The workflow rules live in Postgres functions, so they are tested against a real
Postgres rather than mocked:

```bash
PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./tests/run-sql-tests.sh
```

491 assertions covering allocation and backordering, invoicing at placement, the
payment gate, receiving by SO reference, the invoice split and its dating, RLS
isolation between clients and between brand partners, currency, variant grouping,
returns, and the approval flow. Each suite runs against a freshly migrated
database.

The pure logic that runs on a screen rather than in Postgres has its own suite:

```bash
./tests/run-unit-tests.sh
```

## Layout

```
src/app/            (public) apply · login
                    staff/   order desk · orders · supplier · packing · invoices
                             returns · catalogue · variants & builds · clients
                             brand partners · applications · locations
                             import · outbox · settings
                    portal/  catalogue · current orders · history · invoices
                             returns · back orders · shipping
                    brand/   a partner's own sales, margin and dispatch list
src/lib/            domain helpers: supabase clients, auth guards, email,
                    xero, pdf, import parsing
supabase/migrations 0001 schema · 0002 domain logic · 0003 RLS · 0004 seed
tests/              SQL test suites and their runner
```

## Deploying

Vercel, with the environment variables above set in the project.

Production is **https://orders.iqsportsupply.com**, with the root domain and
`www` redirecting to it.

Four places have to name the same host, or sign-in breaks in ways that are
quiet rather than loud:

| Where | Value |
| --- | --- |
| Vercel → Domains | `orders.iqsportsupply.com` (plus root and `www` redirecting to it) |
| Vercel → env | `NEXT_PUBLIC_APP_URL=https://orders.iqsportsupply.com` |
| Supabase → Auth → URL Configuration | Site URL, and `https://orders.iqsportsupply.com/**` in Redirect URLs |
| Xero app (phase 4) | `XERO_REDIRECT_URI=https://orders.iqsportsupply.com/api/xero/callback` |

A magic link whose host is not in Supabase's redirect list fails silently — the
link opens and drops the visitor back at login with nothing said. If
`NEXT_PUBLIC_APP_URL` is unset the app falls back to Vercel's own URL variables
(see `src/lib/app-url.ts`), so emails still carry a working link, just not the
branded one.

For an existing database, `supabase/set-domain.sql` updates the stored email
sender identity — the migration default only applies to a fresh install.
