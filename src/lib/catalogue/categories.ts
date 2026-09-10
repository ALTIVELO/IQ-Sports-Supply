/**
 * Product categories, and the rules that assign one from a product's name.
 *
 * Price sheets carry a SKU, a description and a price — never a category — so
 * categories are derived from the description text. The rules live here, in one
 * place, and are used both when importing and when back-filling the products
 * that are already in the catalogue.
 *
 * Nothing here guesses beyond what the text supports: a description that
 * matches no rule leaves the product uncategorised rather than being forced
 * into an approximate bucket, and staff can set it by hand.
 */

export interface CategoryDef { slug: string; name: string; sort: number }

export const CATEGORIES: CategoryDef[] = [
  { slug: 'brake-pads',      name: 'Brake pads',          sort: 10 },
  { slug: 'rotors',          name: 'Disc rotors',         sort: 20 },
  { slug: 'brakes',          name: 'Brakes & levers',     sort: 30 },
  { slug: 'chains',          name: 'Chains',              sort: 40 },
  { slug: 'chainsets',       name: 'Chainsets & cranks',  sort: 50 },
  { slug: 'chainrings',      name: 'Chainrings',          sort: 60 },
  { slug: 'cassettes',       name: 'Cassettes & sprockets', sort: 70 },
  { slug: 'derailleurs',     name: 'Derailleurs',         sort: 80 },
  { slug: 'shifters',        name: 'Shifters',            sort: 90 },
  { slug: 'bottom-brackets', name: 'Bottom brackets',     sort: 100 },
  { slug: 'pulleys',         name: 'Pulleys & jockey wheels', sort: 110 },
  { slug: 'bearings',        name: 'Bearings',            sort: 120 },
  { slug: 'headsets',        name: 'Headsets',            sort: 130 },
  { slug: 'hubs',            name: 'Hubs',                sort: 140 },
  { slug: 'wheels',          name: 'Wheels & rims',       sort: 150 },
  { slug: 'spokes',          name: 'Spokes & nipples',    sort: 160 },
  { slug: 'tyres',           name: 'Tyres',               sort: 170 },
  { slug: 'tubes',           name: 'Inner tubes',         sort: 180 },
  { slug: 'pedals',          name: 'Pedals & cleats',     sort: 190 },
  { slug: 'handlebars',      name: 'Handlebars & tape',   sort: 200 },
  { slug: 'stems',           name: 'Stems',               sort: 210 },
  { slug: 'seatposts',       name: 'Seatposts',           sort: 220 },
  { slug: 'saddles',         name: 'Saddles',             sort: 230 },
  { slug: 'cables',          name: 'Cables & housing',    sort: 240 },
  { slug: 'tools',           name: 'Tools',               sort: 250 },
  { slug: 'lubricants',      name: 'Lubricants & care',   sort: 260 },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/**
 * Compound terms whose meaning comes from the LAST word, checked before
 * anything else. A chain whip is a tool, not a chain; a brake cable is a
 * cable, not a brake. Without this pass the leading word wins and the product
 * lands in the wrong filter — which is worse than being uncategorised, because
 * nobody thinks to look for it.
 */
const COMPOUND_RULES: { slug: string; patterns: RegExp[] }[] = [
  { slug: 'tools', patterns: [
      /\bchain\s*(whip|tool|breaker|checker|splitter)\b/i,
      /\bspoke\s*(key|wrench|spanner)\b/i,
      /\b(cassette|bb|bottom\s*bracket|pedal|crank|rotor)\s*(tool|spanner|wrench|remover|puller)\b/i,
      /\btorque\s*(wrench|key)\b/i,
      /\bbleed\s*kits?\b/i,
  ]},
  { slug: 'cables', patterns: [
      /\b(brake|gear|shift|derailleur)\s*(inner|outer)?\s*(cable|housing|casing)\b/i,
      /\bcable\s*(set|kit)\b/i,
  ]},
  { slug: 'lubricants', patterns: [
      /\bchain\s*(lube|lubricant|oil|wax|cleaner|degreaser)\b/i,
      /\bbrake\s*(fluid|cleaner)\b/i,
      /\bbearing\s*grease\b/i,
  ]},
  { slug: 'bearings', patterns: [
      /\b(bottom\s*bracket|bb|headset|hub|wheel|pulley)\s*bearings?\b/i,
  ]},
  { slug: 'brake-pads', patterns: [
      /\bdis[ck]\s*brake\s*pads?\b/i,
  ]},
];

/**
 * Ordered, most specific first — the first match wins. Order carries real
 * weight here: "brake pad" has to be tested before "brake", and "chainset"
 * before "chain", or a chainset ends up filed under chains.
 */
const RULES: { slug: string; patterns: RegExp[] }[] = [
  { slug: 'brake-pads', patterns: [
      /\bbrake\s*pads?\b/i, /\bdisc\s*pads?\b/i, /\bbrake\s*(block|shoe)s?\b/i,
      /\b(resin|sintered|metal)\s*pads?\b/i, /\bpad\s*set\b/i,
  ]},
  { slug: 'rotors', patterns: [
      /\brotors?\b/i, /\bdis[ck]\s*brake\s*dis[ck]s?\b/i, /\bcentre?\s*lock\s*dis[ck]\b/i,
  ]},
  { slug: 'pulleys', patterns: [
      /\bpulley\s*wheels?\b/i, /\bjockey\s*wheels?\b/i, /\bpulleys?\b/i,
      /\bderailleur\s*cage\b/i,
  ]},
  { slug: 'chainrings', patterns: [/\bchain\s*rings?\b/i, /\bchainrings?\b/i] },
  { slug: 'chainsets',  patterns: [
      /\bchain\s*sets?\b/i, /\bchainsets?\b/i, /\bcrank\s*sets?\b/i, /\bcranksets?\b/i,
      /\bcrank\s*arms?\b/i, /\bcranks?\b/i,
  ]},
  { slug: 'cassettes', patterns: [
      /\bcassettes?\b/i, /\bfreewheels?\b/i, /\bsprockets?\b/i, /\bfreehub\s*bod(y|ies)\b/i,
  ]},
  { slug: 'derailleurs', patterns: [
      /\bderailleurs?\b/i, /\bmech\b/i, /\b(rear|front)\s*mech\b/i, /\bdi2\s*(rd|fd)\b/i,
  ]},
  { slug: 'shifters', patterns: [
      /\bshifters?\b/i, /\bsti\b/i, /\bdual\s*control\b/i, /\bshift\s*levers?\b/i,
  ]},
  { slug: 'bottom-brackets', patterns: [
      /\bbottom\s*brackets?\b/i, /\bbb\b/i, /\bbb\d+/i,
  ]},
  { slug: 'brakes', patterns: [
      /\bcalipers?\b/i, /\bcallipers?\b/i, /\bbrake\s*levers?\b/i, /\bbrake\s*sets?\b/i,
      /\bhydraulic\s*brake/i, /\b(rim|dis[ck])\s*brakes?\b/i, /\bbrakes?\b/i,
  ]},
  { slug: 'chains', patterns: [/\bchains?\b/i, /\bquick\s*links?\b/i, /\bmissing\s*links?\b/i] },
  { slug: 'headsets', patterns: [/\bhead\s*sets?\b/i, /\bheadsets?\b/i] },
  { slug: 'bearings', patterns: [/\bbearings?\b/i, /\bbearing\s*kits?\b/i] },
  { slug: 'hubs', patterns: [/\bhubs?\b/i, /\bfreehubs?\b/i] },
  { slug: 'spokes', patterns: [/\bspokes?\b/i, /\bnipples?\b/i] },
  { slug: 'wheels', patterns: [/\bwheel\s*sets?\b/i, /\bwheelsets?\b/i, /\brims?\b/i, /\bwheels?\b/i] },
  { slug: 'tubes', patterns: [/\binner\s*tubes?\b/i, /\btubes?\b/i, /\btubeless\s*valves?\b/i] },
  { slug: 'tyres', patterns: [/\btyres?\b/i, /\btires?\b/i, /\btubeless\b/i] },
  { slug: 'pedals', patterns: [/\bpedals?\b/i, /\bcleats?\b/i] },
  { slug: 'handlebars', patterns: [
      /\bhandle\s*bars?\b/i, /\bhandlebars?\b/i, /\bbar\s*tape\b/i, /\bdrop\s*bars?\b/i,
  ]},
  { slug: 'stems', patterns: [/\bstems?\b/i] },
  { slug: 'seatposts', patterns: [/\bseat\s*posts?\b/i, /\bseatposts?\b/i, /\bseat\s*clamps?\b/i] },
  { slug: 'saddles', patterns: [/\bsaddles?\b/i] },
  { slug: 'cables', patterns: [
      /\bcables?\b/i, /\bhousings?\b/i, /\bouter\s*casing\b/i, /\bferrules?\b/i,
  ]},
  { slug: 'tools', patterns: [
      /\btools?\b/i, /\bwrenche?s?\b/i, /\bspanners?\b/i, /\bchain\s*whip\b/i,
      /\bbleed\s*kits?\b/i, /\btorque\s*key\b/i,
  ]},
  { slug: 'lubricants', patterns: [
      /\blubes?\b/i, /\blubricants?\b/i, /\bgreases?\b/i, /\bdegreasers?\b/i,
      /\bchain\s*oil\b/i, /\bcleaners?\b/i,
  ]},
];

/**
 * The category slug for a product, or null when the text does not support one.
 * Matches on the description primarily; the SKU is a weak signal and is only
 * consulted when the description yields nothing.
 */
export function classifyProduct(input: {
  name?: string | null;
  brand?: string | null;
  sku?: string | null;
}): string | null {
  const name = (input.name ?? '').trim();
  if (name) {
    for (const rule of COMPOUND_RULES) {
      if (rule.patterns.some((p) => p.test(name))) return rule.slug;
    }
    for (const rule of RULES) {
      if (rule.patterns.some((p) => p.test(name))) return rule.slug;
    }
  }

  // SKUs are often codes rather than words, so only a very clear signal counts.
  const sku = (input.sku ?? '').trim().replace(/[-_]/g, ' ');
  if (sku) {
    for (const rule of [...COMPOUND_RULES, ...RULES]) {
      if (rule.patterns.some((p) => p.test(sku))) return rule.slug;
    }
  }

  return null;
}
