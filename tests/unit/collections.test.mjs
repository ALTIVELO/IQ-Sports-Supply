// The collections both staff screens offer, and what they count.
//
// Staff counts are of SKUs, deliberately unlike the client-facing counts in
// tree.ts: every frame size is its own row on the stock table and its own
// line on an order, so a bike built in five sizes really is five rows.
const { groupCollections, idsUnder, idsUnderSlug, departmentOf, catalogueHref } =
  await import('../../.test-build/catalogue/collections.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const cat = (id, slug, name, sort, parent_id = null) => ({ id, slug, name, sort, parent_id });
const CATEGORIES = [
  cat('bikes', 'bikes', 'Bikes', 1),
  cat('road', 'road-bikes', 'Road bikes', 2, 'bikes'),
  cat('gravel', 'gravel-bikes', 'Gravel bikes', 1, 'bikes'),
  cat('parts', 'parts', 'Parts', 2),
  cat('rotors', 'rotors', 'Rotors', 1, 'parts'),
  cat('empty', 'clothing', 'Clothing', 3),
];
const counts = new Map([['road', 12], ['gravel', 5], ['bikes', 2], ['rotors', 40]]);
const groups = groupCollections(CATEGORIES, counts);
const dept = (slug) => groups.find((g) => g.department.slug === slug);

// ── the shape ─────────────────────────────────────────────────────────────
eq('departments come back in sort order',
  groups.map((g) => g.department.slug), ['bikes', 'parts', 'clothing']);
eq('with their own collections, also sorted',
  dept('bikes').collections.map((c) => c.slug), ['gravel-bikes', 'road-bikes']);
eq('a department with no collections is still a department',
  dept('clothing').collections, []);

// ── counting ──────────────────────────────────────────────────────────────
eq('a collection counts what is filed in it', dept('bikes').collections[1].total, 12);
eq('a department counts its collections and itself', dept('bikes').department.total, 19);
eq('and keeps its own figure separately', dept('bikes').department.own, 2);
eq('a department with nothing under it counts nothing',
  dept('clothing').department.total, 0);
// Shown rather than hidden: an unpriced shelf is part of the range, and
// hiding it makes a gap look like something we do not sell.
eq('an empty department is still offered', groups.map((g) => g.department.slug).includes('clothing'), true);
eq('a category the counts say nothing about counts zero',
  groupCollections(CATEGORIES, new Map()).every((g) => g.department.total === 0), true);

// ── picking one ───────────────────────────────────────────────────────────
// Choosing Bikes has to show what is in Road and Gravel too, or it shows the
// two bikes nobody filed and none of the bikes.
eq('a department includes everything beneath it',
  idsUnder(CATEGORIES, 'bikes').sort(), ['bikes', 'gravel', 'road']);
eq('a collection is just itself', idsUnder(CATEGORIES, 'road'), ['road']);
eq('by slug too', idsUnderSlug(CATEGORIES, 'bikes').sort(), ['bikes', 'gravel', 'road']);
// A stale link must return nothing rather than silently everything.
eq('a slug nothing matches selects nothing', idsUnderSlug(CATEGORIES, 'nonsense'), []);

eq('a collection knows its department', departmentOf(CATEGORIES, 'road-bikes')?.slug, 'bikes');
eq('a department is its own', departmentOf(CATEGORIES, 'bikes')?.slug, 'bikes');
eq('and an unknown slug has none', departmentOf(CATEGORIES, 'nonsense'), null);

// ── the two filters have to compose ───────────────────────────────────────
// A plain GET form drops whichever filter it does not carry, which is how you
// end up searching the whole catalogue after choosing a shelf.
const href = (current, next) => catalogueHref(current, next);
const NOTHING = { collection: null, q: '' };

eq('no filters is the bare page', href(NOTHING, {}), '/staff/catalogue');
eq('a collection on its own',
  href(NOTHING, { collection: 'gravel-bikes' }), '/staff/catalogue?collection=gravel-bikes');
eq('a search on its own', href(NOTHING, { q: 'storm' }), '/staff/catalogue?q=storm');

eq('searching keeps the collection already chosen',
  href({ collection: 'gravel-bikes', q: '' }, { q: 'storm' }),
  '/staff/catalogue?collection=gravel-bikes&q=storm');
eq('and switching collection keeps the search already typed',
  href({ collection: 'gravel-bikes', q: 'storm' }, { collection: 'road-bikes' }),
  '/staff/catalogue?collection=road-bikes&q=storm');

eq('clearing the collection leaves the search',
  href({ collection: 'gravel-bikes', q: 'storm' }, { collection: null }),
  '/staff/catalogue?q=storm');
eq('clearing the search leaves the collection',
  href({ collection: 'gravel-bikes', q: 'storm' }, { q: '' }),
  '/staff/catalogue?collection=gravel-bikes');
eq('and clearing both is the bare page again',
  href({ collection: 'gravel-bikes', q: 'storm' }, { collection: null, q: '' }),
  '/staff/catalogue');

eq('the unfiled shelf is a collection like any other',
  href(NOTHING, { collection: 'none' }), '/staff/catalogue?collection=none');
eq('whitespace is not a search', href(NOTHING, { q: '   ' }), '/staff/catalogue');
eq('a term with a space survives being put in a URL',
  href(NOTHING, { q: 'storm 7.0' }), '/staff/catalogue?q=storm+7.0');
eq('and so does one with an ampersand in it',
  href(NOTHING, { q: 'a&b' }), '/staff/catalogue?q=a%26b');

process.exit(fail ? 1 : 0);
