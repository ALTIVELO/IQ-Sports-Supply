# Rebuilding a Shimano price list

```bash
node scripts/shimano/outers.mjs <groupset-workbook.xlsx> scripts/shimano/outers.json
node scripts/shimano/rebuild.mjs <supplier-sheet.csv> <out.csv>
```

The supplier's sheet is a picking list: one row per orderable part, named the
way a warehouse names things — `C/SET D/Ace R9200 52/36 172.5mm`. That is right
for the warehouse and unreadable as a catalogue, where eighteen rows of it are
one chainset in eighteen shapes.

This adds columns and changes nothing else. Every SKU comes out, every price
comes out untouched, and no two rows are ever merged.

| Column   | What it is |
| --- | --- |
| `Series` | The range a shop asks for: Dura-Ace, Ultegra, Di2. Blank where the part belongs to none, which is most of a catalogue. |
| `Model`  | The key that gathers a model's sizes into one catalogue line. |
| `Size`   | What distinguishes this one from its siblings. |
| `Image`  | A photograph, where `images.json` has one for that model. |
| `Outer`  | The carton the part ships in, and so the least that buys the advertised price. Blank where it is sold in ones. |
| `… under outer` | One per tier: what one unit costs outside a full carton. |

Rows that turn out to be one of a range are also renamed — `Dura-Ace FC-R9200
Chainset 52/36 172.5mm` — with the size kept on the end, because the catalogue
strips it for the group heading and an invoice does not.

Rows that are not one of a range keep the name the supplier gave them. Thirty
bottom brackets rewritten from their part numbers would all come out as
`BB-UN300 Bottom Bracket`: one readable name on thirty different products,
which is a worse catalogue than thirty unreadable ones.

## What gets grouped

Anything whose size can be read out of its name or its part number, where at
least two rows share a model and differ:

* chainsets and power meters, by chainring and crank length;
* cassettes, by ratio;
* rotors, by diameter — read out of the part number, where the same letters
  also carry the lockring code, which is kept in brackets so two 203mm rotors
  that are different products stay different (`203mm (E)`, `203mm (I)`). Those
  letters are shown as the supplier writes them and are not decoded here;
* Di2 wires, by length;
* shifters, by which hand they are.

The series is part of the grouping key, and that is the case it exists for: the
Dura-Ace and Ultegra power meters are called exactly `Power 52 / 36 - double -
170 mm` and differ by £105. Without it they would be one product at one price.

## Outers, and the price for fewer than one

Shimano sell by the carton. A shifter comes in tens, a charging cable in
hundreds, and the trade prices on this sheet are the prices at those
quantities — which was true before this column existed and written down
nowhere. A shop ordering three of something that comes in tens was quoted the
carton price on the screen and corrected at invoice time.

`outers.mjs` reads the supplier's groupset workbook and writes `outers.json`:
the carton quantity per SKU, and — for the warning below — what the supplier
charges for a single.

```
57 SKUs with an outer · 48 with a loose-unit price · higher of the two columns
  Dura Ace: 37 with an outer
  Bottom Brackets: no outer column — sold in ones
```

### What the loose price is

A flat uplift on our own advertised price:

| Tier | Under the outer |
| --- | --- |
| Distributor | +5% |
| Shop | +10% |
| Club (teams) | +10% |
| Retail | no change — it is the number on the box |
| Our cost | no change — see below |

It is an uplift rather than a margin worked back from what a single costs the
supplier, because we do not buy singles. We buy the carton and split it, so
the charge is for splitting it. A distributor taking a few is still buying
volume across the order and pays five; a shop or a team taking one is the case
the carton was broken for and pays ten.

**Our cost has no loose figure.** A part we ship loose came out of a carton we
already paid the carton rate for, so what it costs us is the same either way.
Writing the supplier's single-unit price into a cost column would make 48 SKUs
read as selling below cost on the Catalogue screen and on every import
preview, when nothing of the sort is happening.

The workbook does still quote a single-unit price, and every run reports where
buying one in — rather than splitting one out of stock — would cost more than
we are charging for it:

```
! 48 would lose money if the loose unit were bought in as a single rather
  than split out of an outer: R9270DLR (buy 230.00, sell 214.56), … Order
  the carton.
```

That is a purchasing instruction, not a pricing problem. The answer is to
order the carton, which is what the outer is for.

`--below-outer higher|lower` picks which of the workbook's **two** single-unit
columns that warning is measured against. They are headed by a bare number
that changes per range — 1400 and 1200 on Dura-Ace, 850 and 750 on Ultegra —
and the second is the first scaled by the ratio of those two, exactly, on
every row. Which applies to us is a commercial fact the workbook does not
state, so it is named rather than guessed, and defaults to the dearer.

### Ranges with no outer

Bottom brackets, brake pads and rotors are sold in ones: standard prices, no
minimum, no second price. Their sheets have no Outer column at all, and the
rebuild also refuses them one by name — so a future workbook that lists a
rotor with a carton quantity cannot quietly put every rotor behind a minimum.

## Images

`images.json` maps a model key — or a SKU, for the rare product that needs its
own picture — to a full `https://` URL. A model key covers every size of that
model, which is the point of grouping: one photo of an FC-R9200 chainset serves
all eighteen, so the file needs about thirty entries rather than one hundred
and ninety.

It ships empty. These are Shimano's photographs and the licence to publish them
in a trade catalogue is IQ's to hold, not this repository's to assume — and a
URL invented here would 404 into the same placeholder the app already draws,
having first made the sheet look finished. Fill it from whatever IQ is entitled
to use, run `rebuild.mjs` again, and re-import. Anything still missing stays
blank and draws the placeholder.

Photographs can also be uploaded one at a time on the Catalogue screen, which
is the quicker path for a handful.
