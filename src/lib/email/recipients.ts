/**
 * Addresses somebody typed into a box.
 *
 * A packing list goes to whoever is packing — an address on this system, a
 * partner site that holds our stock, or the person asking for it — so the
 * recipient is typed rather than looked up. Typed means commas, semicolons,
 * stray spaces, a trailing comma, a name in angle brackets pasted out of a
 * mail client, and the same address twice.
 *
 * What it will not do is guess. An address that does not look like one is
 * handed back rather than quietly dropped: sending to three of the four
 * addresses somebody typed, and saying "sent", is worse than refusing.
 */

/** Deliberately loose: the mail server is the judge of what exists. */
const SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface Recipients {
  to: string[];
  /** What could not be read as an address, as it was typed. */
  bad: string[];
}

export function parseRecipients(typed: string): Recipients {
  const to: string[] = [];
  const bad: string[] = [];

  for (const raw of (typed ?? '').split(/[,;\n]+/)) {
    const piece = raw.trim();
    if (!piece) continue;

    // "James <james@example.com>" — take what is inside, as a mail client
    // would, rather than calling the whole thing a bad address.
    const angled = /<([^<>]+)>/.exec(piece);
    const addr = (angled ? angled[1] : piece).trim();

    if (!SHAPE.test(addr)) { bad.push(piece); continue; }
    const seen = addr.toLowerCase();
    if (!to.some((a) => a.toLowerCase() === seen)) to.push(addr);
  }

  return { to, bad };
}
