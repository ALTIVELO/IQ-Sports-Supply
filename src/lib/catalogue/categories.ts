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

export interface CategoryDef {
  slug: string; name: string; sort: number;
  /** null for a group; the group's slug for a collection inside it. */
  parent: string | null;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'brake-pads',      name: 'Brake pads',          sort: 10, parent: 'components' },
  { slug: 'rotors',          name: 'Disc rotors',         sort: 20, parent: 'components' },
  { slug: 'brakes',          name: 'Brakes & levers',     sort: 30, parent: 'components' },
  { slug: 'chains',          name: 'Chains',              sort: 40, parent: 'components' },
  { slug: 'chainsets',       name: 'Chainsets & cranks',  sort: 50, parent: 'components' },
  { slug: 'chainrings',      name: 'Chainrings',          sort: 60, parent: 'components' },
  { slug: 'cassettes',       name: 'Cassettes & sprockets', sort: 70, parent: 'components' },
  { slug: 'derailleurs',     name: 'Derailleurs',         sort: 80, parent: 'components' },
  { slug: 'shifters',        name: 'Shifters',            sort: 90, parent: 'components' },
  { slug: 'bottom-brackets', name: 'Bottom brackets',     sort: 100, parent: 'components' },
  { slug: 'pulleys',         name: 'Pulleys & jockey wheels', sort: 110, parent: 'components' },
  { slug: 'bearings',        name: 'Bearings',            sort: 120, parent: 'components' },
  { slug: 'headsets',        name: 'Headsets',            sort: 130, parent: 'components' },
  { slug: 'hubs',            name: 'Hubs',                sort: 140, parent: 'components' },
  { slug: 'wheels',          name: 'Wheels & rims',       sort: 150, parent: 'wheelsets' },
  { slug: 'spokes',          name: 'Spokes & nipples',    sort: 160, parent: 'wheelsets' },
  { slug: 'tyres',           name: 'Tyres',               sort: 170, parent: 'wheelsets' },
  { slug: 'tubes',           name: 'Inner tubes',         sort: 180, parent: 'wheelsets' },
  { slug: 'pedals',          name: 'Pedals & cleats',     sort: 190, parent: 'components' },
  { slug: 'handlebars',      name: 'Handlebars & tape',   sort: 200, parent: 'components' },
  { slug: 'stems',           name: 'Stems',               sort: 210, parent: 'components' },
  { slug: 'seatposts',       name: 'Seatposts',           sort: 220, parent: 'components' },
  { slug: 'saddles',         name: 'Saddles',             sort: 230, parent: 'components' },
  { slug: 'cables',          name: 'Cables & housing',    sort: 240, parent: 'components' },
  { slug: 'workshop-tools',  name: 'Workshop tools',      sort: 10, parent: 'tools' },
  { slug: 'lubricants',      name: 'Lubricants & care',   sort: 260, parent: 'tools' },
  { slug: 'power-meters',    name: 'Power meters',        sort: 55, parent: 'components' },
  { slug: 'electronics',     name: 'Di2 & electronics',   sort: 95, parent: 'components' },
  { slug: 'groupsets',       name: 'Groupsets',           sort: 5, parent: 'components' },

  // ── groups ────────────────────────────────────────────────────────────────
  { slug: 'bicycles',    name: 'Complete bicycles', sort: 10, parent: null },
  { slug: 'frames',      name: 'Frames & forks',    sort: 20, parent: null },
  { slug: 'components',  name: 'Bike parts',        sort: 30, parent: null },
  { slug: 'wheelsets',   name: 'Wheels & tyres',    sort: 40, parent: null },
  { slug: 'clothing',    name: 'Clothing',          sort: 50, parent: null },
  { slug: 'helmets',     name: 'Helmets',           sort: 60, parent: null },
  { slug: 'accessories', name: 'Accessories',       sort: 70, parent: null },
  { slug: 'tools',       name: 'Tools & workshop',  sort: 80, parent: null },

  // ── collections inside those groups ───────────────────────────────────────
  { slug: 'road-bikes',      name: 'Road',                sort: 10, parent: 'bicycles' },
  { slug: 'gravel-bikes',    name: 'Gravel & cyclocross', sort: 20, parent: 'bicycles' },
  { slug: 'mountain-bikes',  name: 'Mountain',            sort: 30, parent: 'bicycles' },
  { slug: 'e-bikes',         name: 'Electric',            sort: 40, parent: 'bicycles' },
  { slug: 'hybrid-bikes',    name: 'Hybrid & urban',      sort: 50, parent: 'bicycles' },
  { slug: 'kids-bikes',      name: 'Kids',                sort: 60, parent: 'bicycles' },
  { slug: 'track-bikes',     name: 'Track & TT',          sort: 70, parent: 'bicycles' },

  { slug: 'road-frames',     name: 'Road frames',         sort: 10, parent: 'frames' },
  { slug: 'gravel-frames',   name: 'Gravel frames',       sort: 20, parent: 'frames' },
  { slug: 'mountain-frames', name: 'Mountain frames',     sort: 30, parent: 'frames' },
  { slug: 'forks',           name: 'Forks',               sort: 40, parent: 'frames' },

  { slug: 'road-helmets',    name: 'Road helmets',        sort: 10, parent: 'helmets' },
  { slug: 'mtb-helmets',     name: 'Mountain helmets',    sort: 20, parent: 'helmets' },
  { slug: 'aero-helmets',    name: 'Aero & TT helmets',   sort: 30, parent: 'helmets' },
  { slug: 'kids-helmets',    name: 'Kids helmets',        sort: 40, parent: 'helmets' },

  { slug: 'jerseys',         name: 'Jerseys',             sort: 10, parent: 'clothing' },
  { slug: 'shorts',          name: 'Shorts & bibs',       sort: 20, parent: 'clothing' },
  { slug: 'jackets',         name: 'Jackets & gilets',    sort: 30, parent: 'clothing' },
  { slug: 'base-layers',     name: 'Base layers',         sort: 40, parent: 'clothing' },
  { slug: 'gloves',          name: 'Gloves',              sort: 50, parent: 'clothing' },
  { slug: 'socks',           name: 'Socks',               sort: 60, parent: 'clothing' },
  { slug: 'shoes',           name: 'Shoes',               sort: 70, parent: 'clothing' },
  { slug: 'eyewear',         name: 'Eyewear',             sort: 80, parent: 'clothing' },

  { slug: 'bottles',         name: 'Bottles & cages',     sort: 10, parent: 'accessories' },
  { slug: 'lights',          name: 'Lights',              sort: 20, parent: 'accessories' },
  { slug: 'computers',       name: 'Computers & sensors', sort: 30, parent: 'accessories' },
  { slug: 'pumps',           name: 'Pumps & inflation',   sort: 40, parent: 'accessories' },
  { slug: 'locks',           name: 'Locks',               sort: 50, parent: 'accessories' },
  { slug: 'luggage',         name: 'Bags & luggage',      sort: 60, parent: 'accessories' },
  { slug: 'mudguards',       name: 'Mudguards & racks',   sort: 70, parent: 'accessories' },

  { slug: 'torque-tools',    name: 'Torque tools',        sort: 20, parent: 'tools' },
  { slug: 'bleed-kits',      name: 'Bleed kits',          sort: 30, parent: 'tools' },
  { slug: 'wheel-tools',     name: 'Wheel & spoke tools', sort: 40, parent: 'tools' },
];

/** Groups, in display order. */
export const GROUPS = CATEGORIES.filter((c) => c.parent === null)
  .sort((a, b) => a.sort - b.sort);

/** The collections inside a group, in display order. */
export const collectionsIn = (groupSlug: string) =>
  CATEGORIES.filter((c) => c.parent === groupSlug).sort((a, b) => a.sort - b.sort);

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/**
 * Compound terms whose meaning comes from the LAST word, checked before
 * anything else. A chain whip is a tool, not a chain; a brake cable is a
 * cable, not a brake. Without this pass the leading word wins and the product
 * lands in the wrong filter — which is worse than being uncategorised, because
 * nobody thinks to look for it.
 */
const COMPOUND_RULES: { slug: string; patterns: RegExp[] }[] = [
  // Supplier order forms are written in trade shorthand — "STI LVR", "RR MECH",
  // "C/SET", "CASS" — which no general keyword rule would catch. These come
  // first because the abbreviations are unambiguous where the long words are
  // not: "STI LVR STR9270/BRR9270 Di2 hydra" names a brake in passing but is a
  // shifter.
  { slug: 'shifters', patterns: [
      /\bsti\s*lvr\b/i, /\bsti\b/i, /\bshift(er)?\s*lvr\b/i,
  ]},
  { slug: 'derailleurs', patterns: [
      /\b(rr|fr|rear|front)\s*mech\b/i, /\bmech\b.*\bdi2\b/i,
  ]},
  // Di2 batteries, chargers and E-tube wires. Kept ahead of the cable rules,
  // which would otherwise claim "CABLE E-tube Di2 SD300" as a gear cable, and
  // narrow enough not to swallow "RR MECH D/Ace Di2", which is a derailleur.
  { slug: 'electronics', patterns: [
      /\bbatt(ery)?\b/i, /\bcharger\b/i, /\be-?\s*tube\b/i,
      /\bjunction\s*(box|a|b)\b/i, /\bcharging\s*cable\b/i,
      /\bwireless\s*unit\b/i,
  ]},
  // Power-meter chainsets. The order form describes these only as
  // "Power 50 / 34 - double - 170 mm", with the chainring sizes and no noun.
  { slug: 'power-meters', patterns: [
      /\bpower\s*meters?\b/i, /\bpowermeter\b/i,
      /^power\s+\d+\s*\/\s*\d+/i, /\bpower\b.*\bdouble\b/i,
  ]},
  { slug: 'groupsets', patterns: [
      /\bgroup\s*sets?\b/i, /\bgroupsets?\b/i,
      /\b(standard|complete)\s+build\b/i,
  ]},
  { slug: 'chainsets', patterns: [/\bc\s*\/\s*set\b/i] },
  { slug: 'cassettes', patterns: [/\bcass\b/i] },
  { slug: 'wheel-tools', patterns: [
      /\bspoke\s*(key|wrench|spanner|tool)\b/i,
      /\btruing\s*stand\b/i,
      /\bwheel\s*(jig|truing)\b/i,
  ]},
  { slug: 'workshop-tools', patterns: [
      /\bchain\s*(whip|tool|breaker|checker|splitter)\b/i,
      /\b(cassette|bb|bottom\s*bracket|pedal|crank|rotor)\s*(tool|spanner|wrench|remover|puller)\b/i,
  ]},
  { slug: 'torque-tools', patterns: [/\btorque\s*(wrench|key|tool)\b/i] },
  { slug: 'bleed-kits',   patterns: [/\bbleed\s*kits?\b/i] },
  { slug: 'wheel-tools',  patterns: [/\b(spoke|wheel)\s*(key|wrench|spanner|tool|jig)\b/i,
                                     /\btruing\s*stand\b/i] },
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
  // ── things that are not components at all ─────────────────────────────────
  // These come first because a complete bike or a frame mentions half the
  // component vocabulary in passing: a road bike "with Ultegra groupset" is a
  // bike, not a groupset.
  { slug: 'e-bikes',        patterns: [/\be-?bikes?\b/i, /\belectric\s+(bike|bicycle)/i] },
  { slug: 'road-bikes',     patterns: [/\broad\s+(bike|bicycle)\b/i] },
  { slug: 'gravel-bikes',   patterns: [/\b(gravel|cyclo-?cross|cx)\s+(bike|bicycle)\b/i] },
  { slug: 'mountain-bikes', patterns: [/\b(mountain|mtb|trail|enduro)\s+(bike|bicycle)\b/i] },
  { slug: 'kids-bikes',     patterns: [/\b(kids?|child(ren)?s?|junior)\s+(bike|bicycle)\b/i] },
  { slug: 'track-bikes',    patterns: [/\b(track|tt|time\s*trial|triathlon)\s+(bike|bicycle)\b/i] },
  { slug: 'hybrid-bikes',   patterns: [/\b(hybrid|urban|commuter|city)\s+(bike|bicycle)\b/i] },
  { slug: 'bicycles',       patterns: [/\bcomplete\s+(bike|bicycle)\b/i, /\bbicycles?\b/i] },

  { slug: 'forks',          patterns: [/\b(suspension\s+)?forks?\b/i] },
  { slug: 'road-frames',    patterns: [/(?=.*\bframe)(?=.*\broad\b)/i] },
  { slug: 'gravel-frames',  patterns: [/(?=.*\bframe)(?=.*\b(gravel|cyclo-?cross|cx)\b)/i] },
  { slug: 'mountain-frames',patterns: [/(?=.*\bframe)(?=.*\b(mountain|mtb|trail|enduro)\b)/i] },
  { slug: 'frames',         patterns: [/\bframe\s*sets?\b/i, /\bframes?\b/i] },

  { slug: 'aero-helmets',   patterns: [/(?=.*\bhelmet)(?=.*\b(aero|tt|time\s*trial)\b)/i] },
  { slug: 'mtb-helmets',    patterns: [/(?=.*\bhelmet)(?=.*\b(mtb|mountain|trail|full\s*face|enduro)\b)/i] },
  { slug: 'kids-helmets',   patterns: [/(?=.*\bhelmet)(?=.*\b(kids?|child(ren)?s?|junior)\b)/i] },
  { slug: 'road-helmets',   patterns: [/(?=.*\bhelmet)(?=.*\broad\b)/i] },
  { slug: 'helmets',        patterns: [/\bhelmets?\b/i] },

  // ── clothing ──────────────────────────────────────────────────────────────
  { slug: 'jerseys',     patterns: [/\bjerseys?\b/i, /\bcycling\s+tops?\b/i] },
  { slug: 'shorts',      patterns: [/\bbib\s*(shorts|tights)\b/i, /\bshorts?\b/i, /\btights\b/i] },
  { slug: 'jackets',     patterns: [/\bjackets?\b/i, /\bgilets?\b/i, /\bvests?\b/i, /\bwind\s*proof/i] },
  { slug: 'base-layers', patterns: [/\bbase\s*layers?\b/i] },
  { slug: 'gloves',      patterns: [/\bgloves?\b/i, /\bmitts?\b/i] },
  { slug: 'socks',       patterns: [/\bsocks?\b/i] },
  { slug: 'shoes',       patterns: [/\bshoes?\b/i, /\bcycling\s+boots?\b/i, /\boversho(e|es)\b/i] },
  { slug: 'eyewear',     patterns: [/\b(sun)?glasses\b/i, /\beyewear\b/i, /\bgoggles?\b/i] },
  { slug: 'clothing',    patterns: [/\bclothing\b/i, /\bapparel\b/i] },

  // ── accessories ───────────────────────────────────────────────────────────
  { slug: 'bottles',   patterns: [/\bbottle\s*cages?\b/i, /\bbidons?\b/i, /\bwater\s*bottles?\b/i] },
  { slug: 'lights',    patterns: [/\b(front|rear)?\s*lights?\b/i, /\bhead\s*torch\b/i] },
  { slug: 'computers', patterns: [/\b(bike|cycle)\s*computers?\b/i, /\bgps\b/i, /\bheart\s*rate/i, /\bcadence\s*sensor/i] },
  { slug: 'pumps',     patterns: [/\bpumps?\b/i, /\bco2\b/i, /\binflators?\b/i, /\btrack\s*pump\b/i] },
  { slug: 'locks',     patterns: [/\blocks?\b/i, /\bd-?lock\b/i] },
  { slug: 'luggage',   patterns: [/\bpanniers?\b/i, /\bsaddle\s*bags?\b/i, /\bbar\s*bags?\b/i, /\bbackpacks?\b/i] },
  { slug: 'mudguards', patterns: [/\bmud\s*guards?\b/i, /\bfenders?\b/i, /\bpannier\s*racks?\b/i, /\bracks?\b/i] },

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
  { slug: 'workshop-tools', patterns: [
      /\btools?\b/i, /\bwrenche?s?\b/i, /\bspanners?\b/i, /\bchain\s*whip\b/i,
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
