/**
 * Reading a Shimano price list into a catalogue.
 *
 * The supplier's sheet is a picking list: one row per orderable part, named
 * the way a warehouse names things — "C/SET D/Ace R9200 52/36 172.5mm". That
 * is right for the warehouse and unreadable as a catalogue, where eighteen
 * rows of it are one chainset in eighteen shapes.
 *
 * This turns each row into four facts a catalogue can use:
 *
 *   series — the range a shop asks for by name: Dura-Ace, Ultegra, Di2;
 *   model  — the thing the sizes are sizes of, and the key that groups them;
 *   size   — what distinguishes this one from its siblings;
 *   name   — the model written out, with the size on the end.
 *
 * The size stays on the end of the name on purpose. The catalogue strips it
 * off when it draws the group heading, and an invoice does not: a customer
 * reading "Dura-Ace R9200 Chainset" on a line they paid £178 for cannot tell
 * which of six crank lengths turned up.
 *
 * Nothing here guesses. Every series, model and size is read out of the name
 * or the part number the supplier wrote; a row this file cannot read keeps its
 * own name, gets no series and is left ungrouped, which is what a catalogue
 * should do with something it does not understand.
 */

/** Series stated by the part number, which is where Shimano states it. */
const SERIES_BY_CODE = [
  // Road groupsets. The number is the range: R92xx is Dura-Ace 12-speed,
  // R81xx/R82xx Ultegra. No word boundary in front, because a part number
  // runs the prefix straight into it — FCR9200D26 is FC-R9200.
  [/R9[0-9]{3}/, 'Dura-Ace'],
  [/R8[0-9]{3}/, 'Ultegra'],
  // Chains are named for both ends of the range they fit.
  [/M9100/, 'Dura-Ace'],
  [/M8100/, 'Ultegra'],
  // The electronics belong to Di2 and to no groupset in particular.
  [/^EW/, 'Di2'],
  [/^BTDN/, 'Di2'],
  // Rotors. The pairing is the sheet's own: its Dura-Ace build bundles
  // RT-CL900 and its Ultegra build bundles RT-CL800.
  [/\bRTCL900/, 'Dura-Ace'],
  [/\bRTCL800/, 'Ultegra'],
];

/** Series stated in words rather than in a part number. */
const SERIES_BY_NAME = [
  [/\bd\/?ace\b|\bdura[- ]?ace\b/i, 'Dura-Ace'],
  [/\bult(egra)?\b/i, 'Ultegra'],
];

/**
 * The range this part belongs to, or null.
 *
 * Null is the ordinary answer. A bottom bracket, a brake pad and a Deore rotor
 * belong to no road range, and inventing one for them would put a made-up word
 * in front of a customer.
 */
export function seriesOf({ name = '', sku = '' }) {
  const code = sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const [pattern, series] of SERIES_BY_CODE) {
    if (pattern.test(code)) return series;
  }
  for (const [pattern, series] of SERIES_BY_NAME) {
    if (pattern.test(name)) return series;
  }
  // Di2 is a range too — the battery, the charger and the wires belong to it
  // and to no groupset in particular.
  if (/\bdi2\b|\be-?tube\b/i.test(name)) return 'Di2';
  return null;
}

/** ── rotors ───────────────────────────────────────────────────────────────
 *
 * A rotor states its size nowhere in its name; it is in the part number,
 * where the same letters also carry something else. RT-CL900-L, -LE and -LI
 * are all 203mm and all different products, so the size is read out and
 * whatever follows it is kept in brackets. The trailing letters are not
 * decoded: E and I are almost certainly the lockring, J is something else,
 * and this file does not know. It shows the code as the supplier wrote it.
 */
const ROTOR_SIZES = [
  [/^200/, '200mm', 3], [/^220/, '220mm', 3],
  [/^SS/, '140mm', 2], [/^S/, '160mm', 1],
  [/^M/, '180mm', 1], [/^L/, '203mm', 1],
];

export function rotorParts(sku = '') {
  // Two or three digits: the model number. A greedy run would swallow the
  // 200 of RT-CL750-200E and leave a model nothing else shares.
  const m = sku.toUpperCase().match(/^(RTCL|SMRT)(\d{2,3})(.*)$/);
  if (!m) return null;
  const [, prefix, digits, tail] = m;
  // Written as Shimano prints it, because this is the key a person reads in
  // the sheet's Model column: RT-CL900, not RTCL900.
  const model = `${prefix.slice(0, 2)}-${prefix.slice(2)}${digits}`;
  for (const [pattern, size, take] of ROTOR_SIZES) {
    if (!pattern.test(tail)) continue;
    const rest = tail.slice(take);
    return { model, size, label: rest ? `${size} (${rest})` : size };
  }
  return null;
}

/** ── sizes written into a name ────────────────────────────────────────── */

/** "11-30T", and asked for first: it is also a pair of two-digit numbers. */
const cassette = (name, category) => {
  const m = name.match(/(\d{2})\s*-\s*(\d{2})\s*T\b/i);
  if (m) return `${m[1]}-${m[2]}T`;
  /*
   * The twelve-speed ranges arrive without the T.
   *
   * "105 R7101 - HYPERGLIDE+ - 12-speed - 11-34" is a cassette and 11-34 is
   * its range, and before this it came through with no size at all — so the
   * 105 Di2 and GRX Di2 builds could not say which cassette they were quoting
   * and the ranges of a family could not group.
   *
   * Two guards, because a bare pair of two-digit numbers is a weak signal.
   * Only on a row already filed as a cassette, so a hose length or a bearing
   * code cannot be read as a sprocket range; and only at the end of the name,
   * because unanchored "Cassettes - 10-speed CS-HG500 - 11-25" reads as
   * "00-11" — the tail of the part number and the head of the range.
   */
  if (category !== 'cassettes') return null;
  const bare = name.match(/(\d{2})\s*-\s*(\d{2})\s*$/);
  return bare ? `${bare[1]}-${bare[2]}` : null;
};

/** "52/36", however the sheet punctuates it. */
const chainring = (name) => {
  const pair = name.match(/(\d{2})\s*\/\s*(\d{2})\b/);
  if (pair) return `${pair[1]}/${pair[2]}`;
  /*
   * A single ring is a ring specification as much as a pair is.
   *
   * Gravel chainsets are sold one ring at a time — "40T - single" and "42T -
   * single" are two products at one crank length, and reading only the length
   * out of them gave both the same size. Two sizes that are the same size are
   * one product hidden behind another.
   */
  const single = name.match(/\b(\d{2})\s*T\b/i);
  return single ? `${single[1]}T` : null;
};

/** "172.5mm", "900mm", "1700mm". */
const length = (name) => {
  const m = name.match(/(\d{2,4}(?:\.\d+)?)\s*mm\b/i);
  return m ? `${m[1]}mm` : null;
};

/** Which hand a shifter is, which is how they are sold. */
const hand = (name) => {
  if (/\bLH\b/i.test(name)) return 'Left (rear)';
  if (/\bRH\b/i.test(name)) return 'Right (front)';
  return null;
};

/**
 * What distinguishes this row from its siblings, or null where nothing does.
 *
 * A cassette first and alone, because "11-34T" matches the chainring pattern
 * too and "11/34 11-34T" is a label nobody would recognise.
 */
export function sizeOf({ name = '', sku = '', category = '' }) {
  if (category === 'rotors') return rotorParts(sku)?.label ?? null;
  if (category === 'shifters') return hand(name);

  const cass = cassette(name, category);
  if (cass) return cass;

  const parts = [chainring(name), length(name)].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** ── what the thing is ────────────────────────────────────────────────── */

/**
 * What a shop calls this kind of part, per collection.
 *
 * Written out rather than taken from the supplier's abbreviation: "C/SET" is
 * a picking code, "Chainset" is a word.
 */
const KIND = {
  chainsets: 'Chainset',
  'power-meters': 'Power Meter Chainset',
  cassettes: 'Cassette',
  chains: 'Chain',
  shifters: 'Di2 Shifter & Hydraulic Brake Lever',
  derailleurs: null,   // front or rear, read from the name
  rotors: 'Disc Rotor',
  'bottom-brackets': 'Bottom Bracket',
  'brake-pads': 'Disc Brake Pads',
  electronics: null,   // battery, charger or wire, read from the name
  groupsets: null,     // already named properly on the sheet
};

const PREFIXES = 'BB|BP|BR|BT|CN|CS|EW|FC|FD|RD|RT|SM|ST';

/**
 * The part number as Shimano prints it: FCR9200A04 is FC-R9200.
 *
 * At most four digits, because a supplier's code packs more than the model
 * into one string: CSR920012130 is a CS-R9200 cassette in 12 speed and 11-30T,
 * and a greedy run of digits would call the model "R920012130".
 *
 * A shifter's code carries no prefix at all — R9270DLR — so where the part
 * number does not parse, the description is asked: it writes the code out in
 * full as "STR9270/BRR9270".
 */
export function modelCode(sku = '', name = '') {
  const fromSku = sku.toUpperCase()
    .match(new RegExp(`^(${PREFIXES})([A-Z]*\\d{1,4})`));
  if (fromSku) return `${fromSku[1]}-${fromSku[2]}`;

  const fromName = name.toUpperCase()
    .match(new RegExp(`\\b(${PREFIXES})([A-Z]*\\d{3,4})`));
  return fromName ? `${fromName[1]}-${fromName[2]}` : null;
}

/**
 * The catalogue name for a row: series, model code, what it is, then the size.
 *
 * "Dura-Ace FC-R9200 Chainset 52/36 172.5mm". The series and the part number
 * are both there because a shop uses one and a warehouse uses the other, and
 * a catalogue that drops either makes somebody look it up.
 */
export function catalogueName(row, { series, size }) {
  const category = row.category ?? '';

  // The sheet already names these properly, and they have no size.
  if (category === 'groupsets') return row.name;

  const kind = KIND[category] ?? null;
  // A rotor's model comes out of the same reader that gave it its size. The
  // general one cannot see where the model ends: RT-CL750-200E would read as
  // model "CL7502".
  const code = category === 'rotors'
    ? rotorParts(row.sku)?.model ?? modelCode(row.sku, row.name)
    : modelCode(row.sku, row.name);

  let what = kind;
  if (category === 'derailleurs') {
    what = /\bFR\b|\bfront\b/i.test(row.name) ? 'Front Derailleur' : 'Rear Derailleur';
  }
  if (category === 'electronics') {
    // No "Di2" in these: the series already says it, and "Di2 Di2 Wire" is
    // what happens when two places both know the same fact.
    if (/\bcharg/i.test(row.name)) what = 'Charging Cable';
    else if (/\bbatt/i.test(row.name)) what = 'Battery';
    else what = 'E-tube Wire';
  }
  if (category === 'cassettes') {
    const speeds = row.name.match(/(\d{1,2})\s*spd\b/i);
    what = speeds ? `${speeds[1]}-speed Cassette` : 'Cassette';
  }

  // Nothing recognised: keep what the supplier called it rather than invent.
  if (!what) return row.name;

  const model = [series, code].filter(Boolean).join(' ');
  const head = model ? `${model} ${what}` : what;
  return size ? `${head} ${size}` : head;
}

/**
 * The key that gathers a model's sizes into one catalogue line.
 *
 * Series, part number and collection, because those are the three things that
 * must match for two rows to be the same product in two shapes. The series is
 * in it because the Dura-Ace and Ultegra power meters are called exactly the
 * same thing — "Power 50 / 34 - double - 170 mm" — and differ by £105.
 */
export function modelKey(row, { series, size }) {
  if (!size) return null;
  const code = row.category === 'rotors'
    ? rotorParts(row.sku)?.model ?? null
    : modelCode(row.sku, row.name);
  if (!code) return null;
  // A person reads this key in the sheet's Model column, so it says only what
  // it needs to: a range with no series does not get the word NONE in it.
  return [series, code, row.category]
    .filter(Boolean).join('-').toUpperCase().replace(/[^A-Z0-9]+/g, '-');
}

/**
 * One sheet row, read.
 *
 * A row whose size cannot be read gets no model and no size. Half-grouping a
 * product is worse than not grouping it, because a group of one that is really
 * one of six hides the other five.
 */
export function rebuildRow(row) {
  const series = seriesOf(row);
  const size = sizeOf(row);
  const model = modelKey(row, { series, size });
  return {
    ...row,
    series,
    // A size with no model to hang it on is not a variant of anything.
    model,
    size: model ? size : null,
  };
}

/**
 * Every row, with the groups that turned out to hold one member undone, and
 * the grouped ones renamed.
 *
 * Only the grouped ones. A supplier's name is ugly but it is unique, and
 * thirty bottom brackets rewritten from their part numbers would all come out
 * as "BB-UN300 Bottom Bracket" — one readable name on thirty different
 * products, which is a worse catalogue than thirty unreadable ones. Where a
 * row is one of a range the size on the end keeps it distinct, so the rewrite
 * is safe exactly where it is worth doing.
 *
 * A model key is only worth writing where at least two rows share it. One row
 * alone under a model heading is a heading a customer must click through to
 * reach a single product.
 */
export function rebuildSheet(rows) {
  const built = rows.map(rebuildRow);
  const count = new Map();
  for (const r of built) {
    if (r.model) count.set(r.model, (count.get(r.model) ?? 0) + 1);
  }
  return built.map((r) => {
    if (!r.model || count.get(r.model) < 2) {
      // Ungrouped: the supplier's name stands, size and all.
      return { ...r, model: null, size: null };
    }
    return { ...r, name: catalogueName(r, { series: r.series, size: r.size }) };
  });
}
