# Turning a Shopify export into a price list

```bash
node scripts/vision/rebuild.mjs <export.csv> <out.csv> \
  --price-is cost --costs scripts/vision/prices.json \
  --quoted-in EUR --currency GBP --fx 0.89 --duty 4 --freight 40 \
  --margin "Distributor=10,Shop=15,Teams=15,Retail=45" \
  --category wheels
```

Shopify writes a product across several rows. The first carries the title, the
vendor, the description and the photograph; every row after it is bare except
for the handle, the option that distinguishes it, its own SKU and its own
price. Six wheelsets in three freehubs is eighteen rows, only six of which say
what they are.

This flattens that into one row per orderable SKU, with each bare row
inheriting its handle's title, brand, series and photograph, and the option
becoming the Size — which is what a freehub is: one wheelset in three shapes,
shown as one catalogue line rather than three wheelsets.

A handle with one variant comes through as a product sold on its own, with no
model and no size, because a group of one is a heading somebody has to click
through to reach a single product.

## `--price-is` has no default, on purpose

A Shopify export calls its one price column `Variant Price` whatever the number
in it actually is — a retail price, a dealer price, a landed cost — and the
file carries nothing that says which. Guessing is the one mistake here worth
guarding against: a selling price filed as a cost makes every margin in the
business look healthy, and nothing downstream questions it.

So it is named on the command line by somebody who knows:

* `--price-is cost` works the tiers out from it at the markups given;
* `--price-is distributor|shop|club|retail` puts the figure in that column
  alone and leaves the rest blank, because one selling price says nothing
  about what we pay or what any other tier pays.

Shopify does have a cost field — `Cost per item` — but an export only carries
it when the shop has filled it in. Vision's has no such column at all.

## `--costs`, for when the export and the quote disagree

An export is a shop's file and can have been through anybody's hands before it
reaches us. Vision's is in sterling at an old rate: every `Variant Price` is
0.8550 of what Vision quoted by email, to four decimal places — one conversion
applied to the whole file on one day, not a discount, which would have landed
on some lines and not others. A quote in an email is what the supplier said
they would charge, in the currency they will invoice in, so `--costs` points at
a JSON file of those figures, keyed by handle (one price per model — a freehub
does not change what a wheelset costs) or by SKU for the odd variant priced on
its own.

Where a row has both and they differ, the gap is printed on every run rather
than silently resolved, and a gap that is the same on every row is named for
what it is:

```
! vision-sc-45-wheelset: the quote says EUR 560.00, the export says 478.80
  — 0.8550 of it. Using the quote.
  All of them at 0.8550: one conversion applied to the whole export, not a
  discount. Today's rate is the one to cost against, and --fx says which.
```

Two models sharing one photograph is reported the same way. Vision's export
hangs `metron_45_rs` on the Metron 45 SL as well as the RS, and the RS is the
one with carbon spokes — so without saying so the SL listing would show a wheel
it is not.

## Landed cost: `--fx`, `--duty` and `--freight`

What a supplier quotes is not what the goods cost us. Vision quote in euros and
invoice from Italy, so a sterling cost exists only after the money is changed
and the border is crossed. Both are named steps rather than a number somebody
worked out in their head:

```
our cost = quote × fx × (1 + duty) + freight
```

`--fx 0.89` says one euro costs 0.89 pounds. It is a deliberately unkind rate:
over the twelve months to September 2026 EUR/GBP ran 0.8487 to 0.8846, and 0.89
sits above the top of that. A sheet priced at today's rate goes underwater the
first week sterling softens, and re-quoting a trade customer is worse than
being a few pounds dear on day one.

`--duty 4` is the UK tariff on commodity 8714.92.10, *Rims* — 4.00% third
country duty, ERGA OMNES. Nil applies instead where the goods qualify as EU
origin under the Trade and Cooperation Agreement, which a wheel built in the
Far East and shipped through Italy does not, unless Vision supply a statement
on origin saying otherwise. Getting one is worth about 4% on every wheel.

`--freight 40` is a flat amount per unit, in the currency of the sheet, added
after the border. Not a rate: a carrier charges for a box rather than a
percentage of what is in it, and a rate would put the most carriage on the
dearest wheel for no reason. It lands before any margin is taken, because a
margin on a figure that leaves out the carriage is a margin the carriage then
eats.

### The arithmetic does not go in `Price note`

It used to. `price_note` is drawn on the portal product row, in the basket and
on the invoice PDF — it is the customer's column, and it means *what this
price does not include*. Our exchange rate is not that, our duty basis is not
that, and what we pay a carrier is certainly not that.

How the cost was built is printed on every run and written here.
`--price-note` remains for what the column is actually for: DRAG quote
ex-works, and their customer does need telling.

## Margin, not markup, and `Teams` means `Club`

`--margin "Distributor=10,Shop=15,Teams=15,Retail=45"` is margin on the selling price:
20% margin is twenty pence in every pound we take, so the price is the cost
over 0.8. It is *not* cost plus 20%, which leaves 16.7% — the two differ by a
quarter of the margin on every line, so the flag says which it means. Anyone
who prices the other way has `--markup`, and giving both is an error rather
than a race.

Every run prints the translation:

```
Distributor: 10% margin = 11.1% on cost (× 1.1111)
Shop: 15% margin = 17.6% on cost (× 1.1765)
```

`Teams` is accepted wherever a tier is named, and files under `Club` — a
cycling club and a race team buy on the same terms, and nobody should have to
remember which of the two words the software wanted.

### Retail is a decision, not a figure we hold

Shimano's Retail column is Madison's own SRP, a published number. Vision give
us nothing of the sort: the emailed quote is trade prices only, the Shopify
export's `Compare At Price` is empty, and Vision's own web shop sells to
consumers in euros including Italian IVA, which is not a UK recommended price
and would be wrong to convert into one.

So Retail is set the same way the other tiers are, by a margin, and the number
is IQ's to choose. It is run at 45%, which leaves a shop buying at the Shop
price a 35.3% margin of their own — a normal trade margin on a wheelset — and
puts the RRPs where comparable wheels sit. 40% would leave the shop 29.4% and
50% would leave them 41.2%.

Like every other tier price here it is **net**: the invoice adds VAT. A shop
window shows the VAT-inclusive figure, which is 20% more.

## `--vat` is refused, with the reason

Every price on this list is net. `place_order()` adds VAT at the rate in
settings when it raises the invoice, and skips the clients who are exempt, so a
tier price with VAT already inside it would go through that again and land 20%
over.

Import VAT is not a cost either: a VAT-registered business reclaims it on the
next return, so it is money out and back rather than margin lost. Import duty
is the one that stays, and that is `--duty`.

Passing `--vat` stops the run and says all of that, because a sheet that
quietly left VAT out after somebody asked for it looks like an oversight.

## Encoding

The output carries a byte-order mark. Without one, a reader with no encoding to
go on guesses, and both the importer and Excel guess latin-1 — so "Wheelset —
Shimano freehub" arrives as mojibake, in the product name, on the order line
and on the invoice.
