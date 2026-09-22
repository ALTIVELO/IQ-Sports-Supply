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
| `… under outer` | One per price column: what one unit costs outside a full carton. |

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
the carton quantity per SKU, and what one unit costs outside one.

```
57 SKUs with an outer · 48 with a loose-unit price · higher of the two columns
  Dura Ace: 37 with an outer
  Bottom Brackets: no outer column — sold in ones
```

The workbook carries **two** loose-unit prices side by side, headed by a bare
number that changes per range — 1400 and 1200 on Dura-Ace, 850 and 750 on
Ultegra — and the second is the first scaled by the ratio of those two numbers,
exactly, on every row. Which of them applies to us is a commercial fact the
workbook does not state, so `--below-outer higher|lower` names it rather than
the script guessing.

It defaults to `higher`, the dearer of the two, because that is the one that
cannot lose money if the guess is wrong: a loose price set too high costs a
sale and is visible, one set too low costs margin on every line and is not.
Switch it with one flag and re-run.

The selling prices that go with it are worked out from each row's own margin
rather than from a markup written down here, so both prices always sit at the
same margin as each other. A row whose Distributor price is 8% over cost keeps
being 8% over cost when the cost is the loose one — whatever that 8% was, and
whoever changes it next.

A SKU absent from `outers.json` is sold in ones: an MOQ of one and a single
price at any quantity. Bottom brackets, rotors and bulk pads are all of them,
because those sheets have no Outer column at all.

Nine Dura-Ace power chainsets have an outer and no loose price. They sell at
the carton price whatever the quantity, which is what happened before, and
every run says so by name.

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
