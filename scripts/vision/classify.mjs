/**
 * Reading a Shopify product export into a catalogue.
 *
 * Shopify writes a product across several rows: the first carries the title,
 * the vendor, the description and the photograph, and every row after it is
 * bare except for the handle, the option that distinguishes it, its own SKU
 * and its own price. So a file of six wheelsets in three freehubs is eighteen
 * rows, only six of which say what they are.
 *
 * Flattening that is the whole job. Every row becomes one orderable SKU with
 * the title and picture its handle carries, and the option becomes the size —
 * which is exactly what a freehub is: one wheelset in three shapes, picked
 * from one catalogue line rather than listed as three wheelsets.
 *
 * Nothing here decides what a price is. That is a flag on the script, without
 * a default, because a Shopify export labels its one price column "Variant
 * Price" whatever it holds, and a selling price filed as a cost makes every
 * margin in the business look healthy.
 */

/**
 * Axes whose values already say what they are.
 *
 * "56cm" is a size; calling it "56cm size" is saying it twice. A freehub value
 * is "Shimano", which on its own is a brand, so that one wants its axis.
 */
// Matched at the end, so "rotor size" counts as a size the way "size" does.
const SELF_EVIDENT = /(^|\s)(size|length|width|colour|color|weight|capacity|diameter)$/;

/** The value of a Shopify option, and what to call it in a catalogue. */
export function optionLabel(name, value) {
  const label = (value ?? '').trim();
  const axis = (name ?? '').trim().toLowerCase();
  if (!label) return null;
  if (!axis || SELF_EVIDENT.test(axis)) return label;
  // Where the value already carries the axis, saying it twice reads as a typo.
  if (label.toLowerCase().includes(axis)) return label;
  return `${label} ${axis}`;
}

/**
 * The series a Vision wheelset belongs to.
 *
 * Read off the title, where Vision state it: SC, Metron SL, Metron RS. The
 * longer names are asked for first, because "Metron 45 SL" contains "Metron"
 * and a shorter rule would swallow it.
 */
const SERIES = [
  [/\bmetron\b[^,]*\bRS\b/i, 'Metron RS'],
  [/\bmetron\b[^,]*\bSL\b/i, 'Metron SL'],
  [/\bmetron\b/i, 'Metron'],
  [/\bSC\s*\d/i, 'SC'],
  [/\btrimax\b/i, 'Trimax'],
  [/\bteam\b/i, 'Team'],
];

export function seriesOf(title = '') {
  const hit = SERIES.find(([pattern]) => pattern.test(title));
  return hit ? hit[1] : null;
}

/**
 * A brand as a catalogue says it, out of what a Shopify vendor field holds.
 *
 * "Vision (FSA)" is a vendor telling you who owns the brand. The brand is
 * Vision, and a catalogue that files half its wheels under "Vision" and half
 * under "Vision (FSA)" has two brands where there is one.
 */
export function brandOf(vendor = '') {
  return vendor.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * One row per orderable SKU, with what its handle knows filled in.
 *
 * A handle whose rows share no option is a product sold one way: it comes
 * through as itself, with no model and no size, because a group of one is a
 * heading a customer has to click through to reach a single product.
 */
export function flattenShopify(rows) {
  const heads = new Map();
  for (const r of rows) {
    const handle = (r.Handle ?? '').trim();
    if (!handle || heads.has(handle)) continue;
    // The first row of a handle is the one that says what the product is.
    if ((r.Title ?? '').trim()) heads.set(handle, r);
  }

  const counts = new Map();
  for (const r of rows) {
    const handle = (r.Handle ?? '').trim();
    if (!handle || !(r['Variant SKU'] ?? '').trim()) continue;
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }

  const out = [];
  for (const r of rows) {
    const handle = (r.Handle ?? '').trim();
    const sku = (r['Variant SKU'] ?? '').trim();
    if (!handle || !sku) continue;

    const head = heads.get(handle) ?? r;
    const title = (head.Title ?? '').trim() || handle;
    const label = optionLabel(head['Option1 Name'] ?? r['Option1 Name'],
                              r['Option1 Value']);
    // One of a range only where the handle actually holds more than one.
    const ranged = (counts.get(handle) ?? 0) > 1 && Boolean(label);

    out.push({
      sku,
      // The option goes on the end of the name, where the catalogue strips it
      // for the group heading and an invoice keeps it — a line reading only
      // "Vision SC 45 SL Carbon Wheelset" does not say which freehub turned up.
      name: ranged ? `${title} — ${label}` : title,
      brand: brandOf(head.Vendor ?? ''),
      series: seriesOf(title),
      model: ranged ? handle.toUpperCase() : null,
      size: ranged ? label : null,
      // Shopify hangs the photograph off the first row of the handle, so every
      // variant of one wheelset shows the wheelset.
      image: (head['Image Src'] ?? '').trim(),
      price: (r['Variant Price'] ?? '').trim(),
      handle,
      title,
    });
  }
  return out;
}
