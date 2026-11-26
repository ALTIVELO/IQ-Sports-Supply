/**
 * The groupset spec a packing list prints under its lines.
 *
 * A groupset goes on an order as loose components at their own SKUs (see
 * build.ts), so the packing list used to be a flat run of part numbers sorted
 * by SKU. Everything was on it, but nothing on it said what was *not*: a
 * build ordered without rotors looked exactly like one where somebody forgot
 * to pick the rotors, and the cassette ratio and wire lengths were buried in
 * product names a picker had to read in full.
 *
 * So for a groupset order the sheet is laid out the way the builder asked the
 * questions — one row per part of the groupset, with the size that matters
 * pulled out, and "Not included" where the order has nothing for that part.
 *
 * Pure, so it can be tested without a database: the caller hands in the
 * invoice lines and the groups whose options any of those lines matched.
 */

/** From order SO-1280 on, a packing list carries the groupset spec. */
export const BUILD_SHEET_FROM_ORDER = 1280;

export function orderSeq(orderNumber: string): number | null {
  const m = /(\d+)\s*$/.exec(orderNumber ?? '');
  return m ? Number(m[1]) : null;
}

export function wantsBuildSheet(orderNumber: string): boolean {
  const n = orderSeq(orderNumber);
  return n !== null && n >= BUILD_SHEET_FROM_ORDER;
}

export interface SheetLine { sku: string; name: string; qty: number }

export interface SheetStep {
  name: string;
  sort: number;
  /** The one spec the step's options differ by: 'Cassette', 'Wire length'… */
  spec?: string | null;
  axis1_name?: string | null;
  axis2_name?: string | null;
  /** SKUs this step offers. */
  skus: string[];
}

export interface SheetGroup { name: string; steps: SheetStep[] }

export interface BuildSheetItem { sku: string; qty: number; detail: string }
export interface BuildSheetRow { part: string; items: BuildSheetItem[] }
export interface BuildSheet { group: string; rows: BuildSheetRow[] }

/**
 * The application-side twin of spec_value() in the database.
 *
 * Same patterns, so a cassette reads "11-34T" here exactly as it did on the
 * builder's button.
 */
export function specValue(name: string, axis: string | null | undefined): string | null {
  if (!axis || !name) return null;
  const m = (re: RegExp) => re.exec(name)?.[1] ?? null;
  switch (axis) {
    case 'Crank length': {
      const v = m(/(\d{3}(?:\.\d)?)\s*mm/);
      return v ? `${v}mm` : null;
    }
    case 'Chainring': {
      const v = m(/(\d{2}\s*[/-]\s*\d{2})/);
      return v ? v.replace(/\s/g, '').replace('-', '/') : null;
    }
    case 'Cassette': {
      const v = m(/(\d{2}\s*-\s*\d{2}\s*T)/);
      return v ? v.replace(/\s/g, '') : null;
    }
    case 'Wire length': {
      const v = m(/(\d{3,4})\s*mm/);
      return v ? `${v}mm` : null;
    }
    case 'Length': {
      const v = m(/(\d{2,4}(?:\.\d+)?)\s*mm/);
      return v ? `${v}mm` : null;
    }
    case 'Rotor size': {
      const named = m(/(\d{3})\s*mm/);
      if (named) return `${named}mm`;
      const big = m(/(?:RTCL|SMRT)\d+(200|220)/);
      if (big) return `${big}mm`;
      const letter = m(/(?:RTCL|SMRT)\d+(SS|S|M|L)/);
      return letter ? ({ SS: '140mm', S: '160mm', M: '180mm', L: '203mm' } as Record<string, string>)[letter] : null;
    }
    default:
      return null;
  }
}

function detailFor(step: SheetStep, line: SheetLine): string {
  const parts = step.axis1_name
    ? [specValue(line.name, step.axis1_name), specValue(line.name, step.axis2_name)]
    : [specValue(line.name, step.spec)];
  const spec = parts.filter(Boolean).join(' · ');
  return spec ? `${spec} — ${line.name}` : line.name;
}

/**
 * Steps that offer exactly the same parts are one question asked twice —
 * front and rear rotor, first and second Di2 wire. An order line cannot say
 * which of the two it answered, so they print as one row: "Rotors".
 */
function mergeLabel(names: string[]): string {
  if (names.length === 1) return names[0];
  const words = names.map((n) => n.split(/\s+/));
  const suffix: string[] = [];
  for (let i = 1; i <= Math.min(...words.map((w) => w.length)); i++) {
    const w = words[0][words[0].length - i];
    if (words.every((ws) => ws[ws.length - i].toLowerCase() === w.toLowerCase())) suffix.unshift(w);
    else break;
  }
  if (!suffix.length) return names.join(' / ');
  const label = `${suffix.join(' ')}s`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface Part { label: string; steps: SheetStep[]; skus: Set<string> }

function partsOf(group: SheetGroup): Part[] {
  const parts: Part[] = [];
  const byKey = new Map<string, Part>();
  for (const step of [...group.steps].sort((a, b) => a.sort - b.sort)) {
    const key = [...new Set(step.skus)].sort().join('|');
    const existing = key ? byKey.get(key) : undefined;
    if (existing) { existing.steps.push(step); continue; }
    const part: Part = { label: step.name, steps: [step], skus: new Set(step.skus) };
    parts.push(part);
    if (key) byKey.set(key, part);
  }
  for (const p of parts) p.label = mergeLabel(p.steps.map((s) => s.name));
  return parts;
}

/** A group must answer at least this many of its parts to count as a groupset on the order. */
const MIN_PARTS = 3;

/**
 * One sheet per groupset found on the lines.
 *
 * Greedy: the group answering the most parts claims its lines first, then the
 * next group is tried on what is left. That keeps a Dura-Ace order from also
 * reporting an Ultegra build because the two share a chain and the wires,
 * while an order genuinely carrying two groupsets still gets two sheets.
 */
export function buildSheets(lines: SheetLine[], groups: SheetGroup[]): BuildSheet[] {
  const remaining = lines.filter((l) => l.qty > 0);
  const sheets: BuildSheet[] = [];
  let candidates = groups.map((g) => ({ g, parts: partsOf(g) }));

  for (;;) {
    let best: { g: SheetGroup; parts: Part[]; answered: number } | null = null;
    for (const c of candidates) {
      const answered = c.parts.filter((p) => remaining.some((l) => p.skus.has(l.sku))).length;
      if (answered >= MIN_PARTS && (!best || answered > best.answered)) best = { ...c, answered };
    }
    if (!best) break;

    const taken = new Set<SheetLine>();
    const rows: BuildSheetRow[] = best.parts.map((part) => {
      const step = part.steps[0];
      const items = remaining
        .filter((l) => part.skus.has(l.sku) && !taken.has(l))
        .map((l) => { taken.add(l); return { sku: l.sku, qty: l.qty, detail: detailFor(step, l) }; });
      return { part: part.label, items };
    });

    sheets.push({ group: best.g.name, rows });
    for (let i = remaining.length - 1; i >= 0; i--) if (taken.has(remaining[i])) remaining.splice(i, 1);
    candidates = candidates.filter((c) => c.g !== best!.g);
  }
  return sheets;
}
