# Rebuilding a Shimano price list

```bash
node scripts/shimano/rebuild.mjs <supplier-sheet.csv> <out.csv>
```

The supplier's sheet is a picking list: one row per orderable part, named the
way a warehouse names things — `C/SET D/Ace R9200 52/36 172.5mm`. That is right
for the warehouse and unreadable as a catalogue, where eighteen rows of it are
one chainset in eighteen shapes.

This adds four columns and changes nothing else. Every SKU comes out, every
price comes out untouched, and no two rows are ever merged.

| Column   | What it is |
| --- | --- |
| `Series` | The range a shop asks for: Dura-Ace, Ultegra, Di2. Blank where the part belongs to none, which is most of a catalogue. |
| `Model`  | The key that gathers a model's sizes into one catalogue line. |
| `Size`   | What distinguishes this one from its siblings. |
| `Image`  | A photograph, where `images.json` has one for that model. |

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
