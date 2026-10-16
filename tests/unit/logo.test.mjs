// The wordmark that goes on the top of every document a customer keeps.
//
// It is a base64 string in a module rather than a file on disk, because these
// documents render inside a serverless function and files in public/ are
// served from the CDN rather than sitting on the function's filesystem —
// fs.readFile would work on a laptop and fail in production, which is the
// worst shape a bug can take.
//
// The thing actually worth holding down is the pair of dimensions beside it.
// They are typed by hand and the layout divides one by the other to keep the
// aspect ratio, so if they ever drift from the file the logo is not missing
// or broken — it is subtly squashed, on every invoice, and nobody notices for
// a year.
const { LOGO_PNG, LOGO_WIDTH, LOGO_HEIGHT } =
  await import('../../.test-build/pdf/logo.js');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${cond ? '' : ` — ${extra}`}`);
};

// ── it is what it says it is ──────────────────────────────────────────────
ok('it is a PNG data URI', LOGO_PNG.startsWith('data:image/png;base64,'),
  LOGO_PNG.slice(0, 40));

const bytes = Buffer.from(LOGO_PNG.split(',')[1], 'base64');
// The eight-byte PNG signature. A truncated or re-encoded string would still
// be valid base64 and would render as nothing at all.
ok('and decodes to a real PNG',
  bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  [...bytes.subarray(0, 8)].join(' '));

// ── the dimensions match the file ─────────────────────────────────────────
// IHDR is the first chunk: width and height are big-endian at bytes 16 and 20.
const width = bytes.readUInt32BE(16);
const height = bytes.readUInt32BE(20);
ok('the stated width is the file’s width', width === LOGO_WIDTH, `${width} vs ${LOGO_WIDTH}`);
ok('and the stated height is the file’s height', height === LOGO_HEIGHT,
  `${height} vs ${LOGO_HEIGHT}`);

// Which is the whole point: the layout works the drawn height out from these.
const drawnHeight = (150 * LOGO_HEIGHT) / LOGO_WIDTH;
const trueHeight = (150 * height) / width;
ok('so the drawn height is the true one', Math.abs(drawnHeight - trueHeight) < 0.001,
  `${drawnHeight} vs ${trueHeight}`);

// ── and it is worth carrying ──────────────────────────────────────────────
// Every rendered document embeds this, and a render happens on every download
// and every emailed invoice. The source artwork was 76KB; a two-colour
// wordmark has no business being that on a letterhead.
ok('it is small enough to live in the bundle', bytes.length < 12 * 1024,
  `${(bytes.length / 1024).toFixed(1)}KB`);
// And large enough to print: 150pt wide at 300dpi wants about 625px, so
// anything under 400 would be visibly soft on paper.
ok('and large enough to print cleanly', width >= 400, `${width}px`);

process.exit(fail ? 1 : 0);
