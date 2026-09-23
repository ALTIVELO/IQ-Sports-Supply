# Rebuilding a Shimano price list

```bash
# Madison's master list → a priced sheet → the catalogue sheet
node scripts/shimano/madison.mjs <master.xlsx> priced.csv --buffer 0
node scripts/shimano/rebuild.mjs priced.csv <out.csv> --outers none
```

`--outers none` is the September 2026 position: Madison have asked for an MOQ
of one while the account is established, so every row states an outer of 1.
That is a statement, not silence — silence would leave the fifty-seven parts
already carrying a carton quantity behind a minimum the supplier has
withdrawn. When outer-box pricing comes back, swap it for `--outers
outers.json` and the section below applies again.

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

## Madison's master list

`madison.mjs` reads the supplier's own workbook — Description, Notes, Madison
Code, Barcode, SRP, UOM, IQ Sports Price — and writes the priced sheet
`rebuild.mjs` expects.

It is a printed catalogue rather than a data file, and three things about it
need saying:

**Headings carry the meaning.** A section heading has no code against it, and
the rows under it are often variants rather than products: "50 / 34 - double -
170 mm" is a chainset solely because of the heading four rows above. A
description that names its own range is kept as the supplier wrote it; one
that does not is given the heading it sat under.

**Sections say what a part is; model headings do not.** The sheet mixes
"Cassettes" with "Dura-Ace R9270 Di2 - 12-speed - E-tube fit for SD300 wires",
and reading the second as a section filed every Dura-Ace shifter under
electronics because its heading mentions wires. A heading carrying a Shimano
model code — three or four digits with at most two letters in front — is
skipped, and the walk continues up to the real section.

**A part listed twice is one part.** 534 rows carry 351 codes: a pedal appears
under Dura-Ace and again under Pedals. The first wins, and a repeat at a
different price is reported rather than resolved, because then it is not the
same part.

### The 5% buffer

Madison quote this list as a quote. Their words: *"this should be treated as a
quote and not the final price … the final price may have to change by a % here
and there"*. A trade price list cannot move every time theirs does, so
`--buffer` is the margin of error we price from. It is currently run at
`--buffer 0` — costing at Madison's quote as it stands — so the flag is there
for the quarter their prices move and nothing is absorbing it yet.

It goes into the cost, not on to the tiers, because that is where it has to be
for the tiers to inherit it — buffer first, standard rates on the buffered
figure. The consequence is that Our cost on this sheet is what we expect to
pay rather than what the quote says today, which is the point of it and worth
knowing when reading a margin off it.

It is deliberately **not** written into Price note: that column is shown to
customers, and what we pay is not their business.

### The standard rates

`--tiers "Distributor=8,Shop=12,Club=18"`, which is what this catalogue has
always used — read off the prices already published, where a cost of 189.20
gives 204.34, 211.91 and 223.26. Stated in the script rather than rediscovered
each time, because a rate nobody can find is a rate nobody can change.

### Two sizes that read the same

The catalogue shows a model once with its sizes underneath, so two rows both
labelled "46/30 170mm" are a customer picking whichever the screen lists
first. Madison's list has exactly that — the FC-RX6001 in ten-speed and
eleven-speed, identical otherwise.

Rather than put the speed on every chainset to catch the one range that needs
it, the extra word is added only where a model would otherwise collide, and
every run says which:

```
· FC-RX6001-CHAINSETS: 9 sizes read the same, so each now carries its speed as well.
```

A model nothing separates is ungrouped altogether and reported. A range that
quietly loses a member is worse than no range.

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

It is filled, from the sheet IQ returned with the images in it: eighteen model
keys where every size of a range shares one photograph, and two hundred and
forty SKUs for the products sold on their own and the ranges photographed per
size. A SKU entry wins over its model's.

Keeping them here rather than only in a spreadsheet is the point of the file —
attaching them was a piece of work, and it is done once. Every rebuild from
here reads them back on, so the next quarterly price list arrives with its
pictures already attached and only the prices to check.

Anything still missing stays blank and draws the placeholder.

Photographs can also be uploaded one at a time on the Catalogue screen, which
is the quicker path for a handful.

## What a whole groupset comes to

```bash
node scripts/shimano/groupset-prices.mjs <catalogue.csv> [--itemise]
```

The builder sells a groupset as its parts — thirteen lines, each at its own
price, so a customer can change any of them. That is right for ordering and
useless for answering "what does a Dura-Ace groupset cost", which is the
question a shop asks first and the one the screen cannot answer until
everything has been chosen.

Rotors and wires are in: a groupset without brakes or wiring is not one. The
bottom bracket is out, and there is nothing to leave out — the builder has no
bottom bracket step, because which cups a frame takes is a property of the
frame. It is priced separately at the foot of the output so that is not
mistaken for not needing one.

Every choice moves the total, so the headline is one stated specification and
the swing between the cheapest and dearest of everything the builder would
allow is printed under it. A quote built on the cheapest of everything is a
quote somebody will be held to.
