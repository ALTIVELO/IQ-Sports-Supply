# Turning a Shopify export into a price list

```bash
node scripts/vision/rebuild.mjs <export.csv> <out.csv> \
  --price-is cost --markup "Distributor=10,Shop=15,Club=20" \
  --category wheels --currency GBP
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
reaches us. Vision's had a 14.5% discount applied to every row: each `Variant
Price` is exactly 0.855 of what Vision quoted by email. A quote in an email is
what the supplier said they would charge, so `--costs` points at a JSON file of
those figures, keyed by handle (one price per model — a freehub does not change
what a wheelset costs) or by SKU for the odd variant priced on its own.

Where a row has both and they differ, the gap is printed on every run rather
than silently resolved:

```
! vision-sc-45-wheelset: the quote says 560.00, the export says 478.80
  (85.5% of it). Using the quote.
```

Two models sharing one photograph is reported the same way. Vision's export
hangs `metron_45_rs` on the Metron 45 SL as well as the RS, and the RS is the
one with carbon spokes — so without saying so the SL listing would show a wheel
it is not.

## Encoding

The output carries a byte-order mark. Without one, a reader with no encoding to
go on guesses, and both the importer and Excel guess latin-1 — so "Wheelset —
Shimano freehub" arrives as mojibake, in the product name, on the order line
and on the invoice.
