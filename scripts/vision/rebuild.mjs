#!/usr/bin/env node
/**
 * Turns a Shopify product export into a sheet the Import screen can read.
 *
 *   node scripts/vision/rebuild.mjs <in.csv> <out.csv> \
 *     --price-is cost --costs scripts/vision/prices.json \
 *     --quoted-in EUR --currency GBP --fx 0.89 --duty 4 \
 *     --margin "Distributor=15,Shop=20,Teams=20" --category wheels
 *
 * `--price-is` has no default, and that is the point. A Shopify export calls
 * its one price column "Variant Price" whatever the number in it actually is —
 * a retail price, a dealer price, a landed cost — and the file carries nothing
 * that says which. Guessing is the one mistake here worth guarding against: a
 * selling price filed as a cost makes every margin in the business look
 * healthy, and nothing downstream ever questions it.
 *
 * So the column is named on the command line by somebody who knows. Name it
 * `cost` and the tiers are worked out from it; name a tier and the figure goes
 * in that column alone, with the rest left blank, because there is no way to
 * derive a cost from one selling price.
 *
 * `--costs` overrides the export's figures with a supplier's own written
 * quote, keyed by handle or SKU. A Shopify export is a shop's file and can
 * have been through anybody's hands before it reaches us — every price in
 * Vision's is an old euro-to-sterling conversion, at a rate that has since
 * moved — whereas a quote in an email is what the supplier said they would
 * charge, in the currency they will invoice in. Where both exist and differ,
 * the gap is reported on every run rather than silently resolved.
 *
 * What a supplier quotes is not what the goods cost us. A price quoted in
 * euros by a supplier in Italy becomes a cost in sterling only after the money
 * is changed and the border is crossed, so `--fx` and `--duty` are separate,
 * named steps rather than a number somebody worked out in their head:
 *
 *     our cost = quote × fx × (1 + duty)
 *
 * and each tier is that cost sold at the margin given.
 *
 * VAT is deliberately not one of the steps. See `--vat` below.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { flattenShopify } from './classify.mjs';

const TIERS = ['Distributor', 'Shop', 'Club', 'Retail'];
const COLUMNS = [
  'Name', 'SKU', 'Brand', 'Series', 'Model', 'Size', 'Category', 'Image',
  'Currency', 'Price note', 'Our cost', ...TIERS,
];

/** A CSV reader that survives quoted fields holding commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/*
 * Written with a byte-order mark.
 *
 * Without one, a reader with no encoding to go on guesses, and both the
 * importer's parser and Excel guess latin-1 — so "Wheelset — Shimano freehub"
 * arrives as "Wheelset â€" Shimano freehub" and the mojibake goes into the
 * product name, the order line and the invoice. Three bytes at the front
 * settle it.
 */
const BOM = '\uFEFF';

const cell = (v) => {
  const s = String(v ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))]
    .join('\n') + '\n';

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/*
 * What the trade calls each tier, and what this business calls it.
 *
 * "Teams" is what everybody says out loud; Club is the column on the price
 * list, because a cycling club and a race team buy on the same terms. Taking
 * the spoken word and filing it in the right column beats making somebody
 * remember which of the two the software wanted.
 */
const TIER_ALIASES = { teams: 'Club', team: 'Club' };

export function tierNamed(word) {
  const key = String(word ?? '').trim().toLowerCase();
  const named = TIER_ALIASES[key]
    ?? TIERS.find((t) => t.toLowerCase() === key);
  if (!named) {
    throw new Error(`"${word}" is not a tier on our price list — `
      + `expected one of ${[...TIERS, 'Teams'].join(', ')}.`);
  }
  return named;
}

/**
 * What the goods cost us, landed: the quote converted and cleared through
 * customs.
 *
 * Two steps, in this order, because duty is charged on the sterling value of
 * the goods at import — so the rate applies to the converted figure, not the
 * euro one.
 */
export function landedCost(quote, { fx = 1, duty = 0 } = {}) {
  return quote * fx * (1 + duty);
}

/**
 * Margin, not markup.
 *
 * A 20% margin is twenty pence in every pound we take, so the price is the
 * cost divided by 0.8 — not the cost plus 20%, which leaves 16.7%. The two
 * differ by a quarter of the margin, every line, in our favour or theirs
 * depending which way round somebody guessed, so the sheet asks for one and
 * says which.
 */
export function priceAtMargin(cost, margin) {
  if (!(margin >= 0 && margin < 1)) {
    throw new Error(`A margin of ${(margin * 100).toFixed(0)}% cannot be `
      + 'made into a price — it has to be under 100%.');
  }
  return cost / (1 - margin);
}

/** The same margin said the other way, for anyone who prices on cost. */
export const marginAsMarkup = (margin) => margin / (1 - margin);

const rate = (pair, flag) => {
  const [name, pct] = pair.split('=');
  const n = Number(pct);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} wants "Tier=percent" pairs — "${pair}" is not one.`);
  }
  return { name: tierNamed(name), rate: n / 100 };
};

const percent = (v, flag) => {
  const n = Number(String(v ?? '').replace('%', '').trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${flag} wants a percentage — "${v}" is not one.`);
  }
  return n / 100;
};

const USAGE = 'usage: rebuild.mjs <in.csv> <out.csv> '
  + '--price-is <cost|distributor|shop|club|retail> '
  + '[--margin "Distributor=15,Shop=20,Teams=20" | --markup "Shop=25"] '
  + '[--costs prices.json] [--quoted-in EUR --fx 0.89] [--duty 4] '
  + '[--category wheels] [--currency GBP] [--price-note "…"]';

function parseArgs(argv) {
  const [input, output, ...rest] = argv;
  const args = {
    input, output, margin: [], markup: [], category: '', currency: 'GBP',
    priceIs: null, costs: null, priceNote: '',
    quotedIn: null, fx: null, duty: 0,
  };
  let saidMargin = false, saidMarkup = false;

  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--price-is') args.priceIs = rest[++i].trim().toLowerCase();
    else if (rest[i] === '--costs') args.costs = rest[++i];
    else if (rest[i] === '--price-note') args.priceNote = rest[++i];
    else if (rest[i] === '--quoted-in') args.quotedIn = rest[++i].trim().toUpperCase();
    else if (rest[i] === '--fx') {
      const n = Number(rest[++i]);
      if (!(n > 0)) throw new Error('--fx wants a rate, as a multiplier: --fx 0.89');
      args.fx = n;
    } else if (rest[i] === '--duty') args.duty = percent(rest[++i], '--duty');
    else if (rest[i] === '--margin') {
      saidMargin = true;
      args.margin = rest[++i].split(',').map((p) => rate(p, '--margin'));
    } else if (rest[i] === '--markup') {
      saidMarkup = true;
      args.markup = rest[++i].split(',').map((p) => rate(p, '--markup'));
    } else if (rest[i] === '--category') args.category = rest[++i];
    else if (rest[i] === '--currency') args.currency = rest[++i].toUpperCase();
    else if (rest[i] === '--vat') {
      /*
       * Asked for, and refused, with the reason — because leaving VAT
       * quietly out of a sheet somebody asked to have it in looks like an
       * oversight, and putting it in would charge it twice.
       *
       * Every price on our list is net. place_order() adds VAT at the rate in
       * settings when it raises the invoice, and exempts the clients who are
       * exempt; a tier price with VAT already inside it would go through that
       * again and land 20% over. Import VAT is not a cost either — a
       * VAT-registered business reclaims it on the next return, so it is
       * money out and back, not margin lost. Duty is the one that stays, and
       * that is --duty.
       */
      throw new Error(
        'VAT does not belong in a tier price. Prices on this list are net: '
        + 'the invoice adds VAT at the rate in settings, and skips the clients '
        + 'who are exempt — so VAT baked in here would be charged twice. '
        + 'Import VAT is reclaimed on the next return and is not a cost. '
        + 'Import duty is, and that is --duty.');
    } else throw new Error(`Unknown argument ${rest[i]}\n${USAGE}`);
  }

  const columns = ['cost', ...TIERS.map((t) => t.toLowerCase())];
  if (!args.input || !args.output || !args.priceIs) throw new Error(USAGE);

  if (!columns.includes(args.priceIs)) {
    throw new Error(`--price-is must be one of ${columns.join(', ')} — `
      + `"${args.priceIs}" is not a column on our price list.`);
  }
  if (saidMargin && saidMarkup) {
    throw new Error('--margin and --markup are two ways of saying the same '
      + 'thing and they disagree: 20% margin is a 25% markup. Pick one.');
  }
  if (args.priceIs === 'cost' && !args.margin.length && !args.markup.length) {
    throw new Error('--price-is cost needs --margin, or the tiers come out empty.');
  }

  // A rate with nothing to convert, or a conversion with no rate, is somebody
  // half way through a thought. Both are worth stopping for: the first would
  // silently move every price, the second would leave euros in a sterling
  // column and nothing on the sheet would say so.
  const converting = args.quotedIn !== null && args.quotedIn !== args.currency;
  if (converting && args.fx === null) {
    throw new Error(`Prices are quoted in ${args.quotedIn} and the sheet is in `
      + `${args.currency}, so --fx has to say the rate: --fx 0.89 means one `
      + `${args.quotedIn} costs 0.89 ${args.currency}.`);
  }
  if (!converting && args.fx !== null) {
    throw new Error('--fx converts between two currencies, and this sheet has '
      + `only one (${args.currency}). Say --quoted-in if the quote is in `
      + 'another.');
  }
  if (args.fx !== null && args.priceIs !== 'cost') {
    throw new Error('--fx converts what we pay. A tier price is what we '
      + 'charge, and it is set in the currency we sell in, not converted '
      + 'into it.');
  }
  if (args.duty && args.priceIs !== 'cost') {
    throw new Error('--duty is part of what the goods cost us landed, so it '
      + 'only applies to --price-is cost.');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = parseCsv(readFileSync(args.input, 'utf8'));
  const built = flattenShopify(source);

  // The supplier's own written quote, where we have one. Keyed by handle
  // because a quote is per model and a freehub does not change what a
  // wheelset costs; a SKU key wins over its handle's, for the odd variant
  // priced on its own.
  const quoted = args.costs ? JSON.parse(readFileSync(args.costs, 'utf8')) : null;
  const quoteFor = (r) =>
    quoted?.skus?.[r.sku] ?? quoted?.handles?.[r.handle] ?? null;
  const quoteCurrency = args.quotedIn ?? quoted?.currency ?? args.currency;

  // A quote file that names its own currency and a command line that names
  // another is two people describing the same money differently, and one of
  // them has the rate. Better to stop than to convert from the wrong end.
  if (quoted?.currency && args.quotedIn && quoted.currency !== args.quotedIn) {
    throw new Error(`${args.costs} says the quote is in ${quoted.currency}, `
      + `--quoted-in says ${args.quotedIn}.`);
  }

  // Where both exist and disagree, somebody needs to know which to buy against.
  const disagreed = new Map();
  for (const r of built) {
    const quote = quoteFor(r);
    const exported = money(r.price);
    if (quote === null || exported === null) continue;
    if (Math.abs(quote - exported) < 0.005) continue;
    disagreed.set(r.handle, { quote, exported, ratio: exported / quote });
  }

  /*
   * How the sterling figure was arrived at, written on every row.
   *
   * A price list outlives the conversation that produced it. Six months on,
   * "why is the SC 45 £518?" is answerable from the sheet itself rather than
   * from somebody's memory of what the euro was doing in September.
   */
  const costNote = args.priceIs === 'cost' && (args.fx || args.duty)
    ? [
      args.fx ? `${quoteCurrency}→${args.currency} at ${args.fx}` : null,
      args.duty ? `${(args.duty * 100).toFixed(args.duty * 100 % 1 ? 1 : 0)}% duty` : null,
      'net of VAT',
    ].filter(Boolean).join(', ')
    : '';

  const out = built.map((r) => {
    // The quote is the authority where there is one: an export is a shop's
    // file and can have been through anybody's hands on the way here.
    const price = quoteFor(r) ?? money(r.price);
    const row = {
      Name: r.name, SKU: r.sku, Brand: r.brand,
      Series: r.series ?? '', Model: r.model ?? '', Size: r.size ?? '',
      Category: args.category, Image: r.image,
      Currency: args.currency,
      'Price note': args.priceNote || costNote,
      'Our cost': '', Distributor: '', Shop: '', Club: '', Retail: '',
    };
    if (price === null) return row;

    if (args.priceIs === 'cost') {
      // The quote is in the supplier's currency and the goods are still
      // abroad. Both are dealt with here, in that order, before a single
      // margin is taken — a margin on an unconverted, uncleared figure is a
      // margin on a number nobody ever pays.
      const cost = landedCost(price, { fx: args.fx ?? 1, duty: args.duty });
      row['Our cost'] = cost.toFixed(2);
      for (const { name, rate } of args.margin) {
        row[name] = priceAtMargin(cost, rate).toFixed(2);
      }
      for (const { name, rate } of args.markup) {
        row[name] = (cost * (1 + rate)).toFixed(2);
      }
    } else {
      // One selling price says nothing about what we pay or what any other
      // tier pays, so the rest stay empty rather than being made up.
      const column = TIERS.find((t) => t.toLowerCase() === args.priceIs);
      row[column] = price.toFixed(2);
    }
    return row;
  });

  const csv = toCsv(COLUMNS, out);
  if (args.output) writeFileSync(args.output, BOM + csv);
  else process.stdout.write(csv);

  const models = new Set(out.filter((r) => r.Model).map((r) => r.Model));
  const unpriced = out.filter((r) => !['Our cost', ...TIERS].some((c) => r[c]));
  // To stderr, so piping the sheet somewhere still gets you the sheet.
  console.error(
    `${out.length} SKUs · ${models.size} model${models.size === 1 ? '' : 's'} · `
    + `${out.length - models.size ? out.filter((r) => r.Model).length : 0} of them in a range · `
    + `${new Set(out.map((r) => r.Series).filter(Boolean)).size} series · `
    + `${out.filter((r) => r.Image).length} with a photograph · `
    + `${args.priceIs === 'cost' ? 'tiers from cost' : `price filed as ${args.priceIs}`}`
    + (unpriced.length ? ` · ${unpriced.length} with no price` : ''));

  if (args.priceIs === 'cost') {
    console.error('  cost = quote'
      + (args.fx ? ` × ${args.fx} (${quoteCurrency}→${args.currency})` : '')
      + (args.duty ? ` × ${(1 + args.duty).toFixed(4)} (duty)` : '')
      + ' — net of VAT, which the invoice adds.');
    for (const { name, rate } of args.margin) {
      console.error(`  ${name}: ${(rate * 100).toFixed(0)}% margin `
        + `= ${(marginAsMarkup(rate) * 100).toFixed(1)}% on cost `
        + `(× ${(1 / (1 - rate)).toFixed(4)})`);
    }
    for (const { name, rate } of args.markup) {
      console.error(`  ${name}: ${(rate * 100).toFixed(0)}% markup on cost `
        + `= ${(rate / (1 + rate) * 100).toFixed(1)}% margin`);
    }
  }

  /*
   * Two different models wearing one photograph.
   *
   * Vision's export hangs metron_45_rs on the Metron 45 SL as well as the RS,
   * and the RS is the one with carbon spokes — so the SL listing shows a wheel
   * it is not. A shared photo is worth saying out loud rather than leaving to
   * be noticed by a customer who ordered from it.
   */
  const byPhoto = new Map();
  for (const r of out) {
    if (!r.Image) continue;
    const file = r.Image.split('/').pop();
    byPhoto.set(file, new Set([...(byPhoto.get(file) ?? []), r.Model || r.SKU]));
  }
  for (const [file, models] of byPhoto) {
    if (models.size < 2) continue;
    console.error(`  ! ${file} is the photograph for ${models.size} different `
      + `models: ${[...models].join(', ')}`);
  }

  /*
   * The export disagrees with the quote, and the shape of the gap says why:
   * every row the same fraction of the quote is a currency conversion done
   * once, at some rate, on some day — not a discount, which would land on
   * some lines and not others. Naming the rate is what makes that legible,
   * and what shows how far it has moved since.
   */
  const gaps = [...disagreed.values()].map((d) => d.ratio);
  const oneRate = gaps.length > 1
    && Math.max(...gaps) - Math.min(...gaps) < 0.001;
  for (const [handle, d] of disagreed) {
    console.error(
      `  ! ${handle}: the quote says ${quoteCurrency} ${d.quote.toFixed(2)}, `
      + `the export says ${d.exported.toFixed(2)} — `
      + `${d.ratio.toFixed(4)} of it. Using the quote.`);
  }
  if (oneRate) {
    console.error(`    All of them at ${gaps[0].toFixed(4)}: one conversion `
      + 'applied to the whole export, not a discount. Today\'s rate is the '
      + 'one to cost against, and --fx says which.');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
