// Asking about a lot of rows without silently getting a prefix of the answer.
//
// This exists because a capped response does not announce itself. A query that
// read the whole price list for a year started returning only its newest
// thousand rows the day the catalogue outgrew the cap, and every older price
// vanished from the screen while sitting untouched in the database.
const { chunkSize, inChunks, fetchAll } =
  await import('../../.test-build/supabase/chunk.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// ── how big a batch may be ────────────────────────────────────────────────
// Four tiers means four rows per product, so a batch must stay well under the
// cap once multiplied.
eq('four rows per id gives a smaller batch than one', chunkSize(4) < chunkSize(1), true);
eq('and every batch stays under the cap', chunkSize(4) * 4 <= 800, true);
eq('one row per id is the biggest batch', chunkSize(1), 800);
eq('a batch is never zero, however many rows per id', chunkSize(5000), 1);
eq('nor for nonsense', chunkSize(0), 800);

// ── batching by id ────────────────────────────────────────────────────────
const ids = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);

let seen = [];
const spy = (batch) => {
  seen.push(batch.length);
  return Promise.resolve({ data: batch.map((id) => ({ id })) });
};

seen = [];
eq('every id comes back, across however many batches',
  (await inChunks(ids(1000), 4, spy)).length, 1000);
eq('and it really was split up', seen.length > 1, true);
eq('with no batch big enough to hit the cap', Math.max(...seen) * 4 <= 800, true);

seen = [];
eq('a short list is one batch', (await inChunks(ids(3), 4, spy)).length, 3);
eq('...one', seen, [3]);

seen = [];
eq('nothing asked is nothing fetched', await inChunks([], 4, spy), []);
eq('and no request is made at all', seen, []);

// A batch that comes back empty must not lose the others.
eq('an empty answer from one batch does not discard the rest',
  (await inChunks(ids(900), 1, (b) =>
    Promise.resolve({ data: b[0] === 'id-0' ? null : b.map((id) => ({ id })) }))).length,
  100);

// ── paging a whole query ──────────────────────────────────────────────────
const table = (rows) => (from, to) =>
  Promise.resolve({ data: Array.from({ length: rows }, (_, i) => i).slice(from, to + 1), error: null });

eq('a table smaller than a page is one read', (await fetchAll(table(10))).length, 10);
eq('a table exactly a page long is read to the end', (await fetchAll(table(500))).length, 500);
// The case the cap creates: page after page until one comes back short.
eq('a table many pages long comes back whole', (await fetchAll(table(2300))).length, 2300);
eq('an empty table is empty', (await fetchAll(table(0))).length, 0);

eq('an error stops paging rather than looping',
  (await fetchAll(() => Promise.resolve({ data: null, error: 'boom' }))).length, 0);

// A page that keeps returning full pages must not run forever.
let calls = 0;
const endless = (from, to) => {
  calls += 1;
  return Promise.resolve({ data: Array.from({ length: to - from + 1 }, () => 1), error: null });
};
await fetchAll(endless, 2000);
eq('a runaway query is capped', calls, 4);

process.exit(fail ? 1 : 0);
