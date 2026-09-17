// What a customer is offered, and what that adds up to.
//
// The counts on a department tile and above a collection are a promise: click
// here and there is that much to look at. A collection served by builders has
// to count its builders and not the fixed-spec products they replaced, or the
// tile says six and the page shows four.
const { buildTree, findNode, slugsUnder, offeredLoose } =
  await import('../../.test-build/catalogue/tree.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}`
    + (ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`));
};

const CATEGORIES = [
  { id: 'c1', slug: 'components', name: 'Bike parts', sort: 1, parent_id: null },
  { id: 'c2', slug: 'groupsets', name: 'Groupsets', sort: 1, parent_id: 'c1' },
  { id: 'c3', slug: 'rotors', name: 'Rotors', sort: 2, parent_id: 'c1' },
  { id: 'c4', slug: 'clothing', name: 'Clothing', sort: 2, parent_id: null },
];

const product = (slug, over = {}) =>
  ({ category_slug: slug, image_url: null, configurator_only: false, ...over });

// Six fixed-spec bundles in a collection served by builders, four rotors that
// are ordinary products, and one jersey filed nowhere near either.
const PRODUCTS = [
  ...Array.from({ length: 6 }, () => product('groupsets', { configurator_only: true })),
  ...Array.from({ length: 4 }, (_, i) =>
    product('rotors', { image_url: i === 0 ? 'rotor.jpg' : null })),
  product('clothing'),
];
const BUILDERS = [
  { categorySlug: 'groupsets' }, { categorySlug: 'groupsets' },
  { categorySlug: 'groupsets' }, { categorySlug: 'groupsets' },
];

// ── what is offered at all ────────────────────────────────────────────────
check('an ordinary product is offered on its own',
  offeredLoose(product('rotors')), true);
check('one in a collection served by builders is not',
  offeredLoose(product('groupsets', { configurator_only: true })), false);

// ── counts ────────────────────────────────────────────────────────────────
const tree = buildTree(CATEGORIES, PRODUCTS, BUILDERS);
const at = (slug) => findNode(tree, slug)?.node;

check('the builders are counted, the products they replaced are not',
  at('groupsets').own, 4);
check('and that is the whole of the collection',
  at('groupsets').total, 4);
check('an ordinary collection counts its products',
  at('rotors').own, 4);
check('a parent rolls up both kinds',
  at('components').total, 8);
check('and holds nothing of its own',
  at('components').own, 0);
check('a collection nowhere near either is untouched',
  at('clothing').total, 1);

// Without the builders passed in, a configured collection counts as empty —
// which is what the page would show, so the two agree.
const bare = buildTree(CATEGORIES, PRODUCTS);
check('no builders given, and the collection they serve reads empty',
  findNode(bare, 'groupsets')?.node.total, 0);

// ── the rest of the tree still works ──────────────────────────────────────
check('departments come back in sort order',
  tree.map((n) => n.slug), ['components', 'clothing']);
check('a cover image comes from a product that has one',
  at('rotors').cover, 'rotor.jpg');
check('a collection served by builders has no cover to take',
  at('groupsets').cover, null);
check('and the parent borrows one from beneath it',
  at('components').cover, 'rotor.jpg');
check('slugsUnder names the node and everything below',
  slugsUnder(at('components')).sort(), ['components', 'groupsets', 'rotors']);
check('findNode reports the groups above what it found',
  findNode(tree, 'rotors').trail.map((t) => t.slug), ['components']);
check('and returns null for a slug that is not there',
  findNode(tree, 'nonsense'), null);

process.exit(fail ? 1 : 0);
