/**
 * Which trade account an email address belongs to.
 *
 * Both the sign-in preparation and the link repair ask this question, so it is
 * answered in one place and tested on its own — the ways it can go wrong are
 * quiet ones. A pattern match would let `john_smith@x.com` claim
 * `johnXsmith@x.com`'s account, since `_` is a wildcard. A case-sensitive
 * match would fail the customer who capitalises their own name in an address.
 * And claiming a record that already has a user would hand one customer
 * another's orders.
 */
export interface LinkableClient {
  id: string;
  email: string | null;
  active: boolean;
  auth_user_id?: string | null;
}

const normalise = (email: string | null | undefined) =>
  (email ?? '').trim().toLowerCase();

/**
 * The one unclaimed, active account carrying this address, or null.
 *
 * Null when two records share the address, which is a fault in the data rather
 * than a choice to make: attaching the person to whichever came back first
 * would be a coin toss over whose orders they see.
 */
export function clientToLink(
  candidates: LinkableClient[], email: string,
): LinkableClient | null {
  const wanted = normalise(email);
  if (!wanted || !wanted.includes('@')) return null;

  const matches = candidates.filter(
    (c) => c.active && !c.auth_user_id && normalise(c.email) === wanted,
  );
  return matches.length === 1 ? matches[0] : null;
}
