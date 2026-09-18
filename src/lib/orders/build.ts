/**
 * What a specced build puts on an order.
 *
 * A build is a way of choosing, not a thing we sell: what goes on the order is
 * the components, each at its own SKU and price, because that is what the
 * warehouse picks and what the invoice has to show. Nothing here knows about a
 * "groupset" line, and there is deliberately no way to make one.
 *
 * Kept apart from the screen because the arithmetic is the part worth being
 * sure of — a step needing two rotors, ordered as three builds, is six rotors,
 * and that is not a number anybody notices being wrong on a busy afternoon.
 */

export interface BuildStep {
  id: string;
  name: string;
  /** How many of the chosen option one build needs: two rotors, one cassette. */
  qty: number;
  /**
   * Whether this step is part of the standard build.
   *
   * It decides what is specced for you when the builder opens, and nothing
   * else. It is not a lock: a shop buying a groupset often already has the
   * brakes, or wants it without the chainset, and what goes on the order is
   * the components at their own SKUs — there is no groupset line for a
   * missing part to make nonsense of.
   */
  required: boolean;
  options: { product_id: string }[];
}

/** Step id → the product id chosen for it. A step with no entry is unanswered. */
export type Chosen = Record<string, string>;

/**
 * Preselects only where there is no decision to make.
 *
 * A required step with one option answers itself. An optional step never
 * does, however few options it has — a lone optional extra is still an extra,
 * and quietly adding a power meter to somebody's order is not a convenience.
 */
export function preselect(steps: BuildStep[]): Chosen {
  const chosen: Chosen = {};
  for (const s of steps) {
    if (s.required && s.options.length === 1) chosen[s.id] = s.options[0].product_id;
  }
  return chosen;
}

/**
 * The standard build's steps that are not in this one, named so a screen can
 * say which.
 *
 * Information, not an obstacle. It used to be what stopped the build being
 * ordered, which made every part of a groupset compulsory — so a shop that
 * already had the brakes could clear that step and then find the button dead,
 * with no way forward and nothing saying why.
 */
export function missingSteps(steps: BuildStep[], chosen: Chosen): BuildStep[] {
  return steps.filter((s) => s.required && !chosen[s.id]);
}

/**
 * Whether there is anything here to order.
 *
 * The only real constraint on a build: it has to put at least one component
 * on the order, because a build of nothing is not an order. Everything else
 * about what is in it is the customer's business.
 */
export function canBuild(steps: BuildStep[], chosen: Chosen): boolean {
  return buildLines(steps, chosen, 1).length > 0;
}

/**
 * One entry per chosen component, quantities already multiplied out.
 *
 * A step whose option is not among its own options is ignored rather than
 * trusted: stale state from a build closed and reopened must not put a
 * component on the order that this build does not offer.
 */
export function buildLines(
  steps: BuildStep[], chosen: Chosen, builds = 1,
): { productId: string; qty: number }[] {
  const count = Math.max(1, Math.floor(builds) || 1);
  return steps.flatMap((step) => {
    const productId = chosen[step.id];
    if (!productId) return [];
    if (!step.options.some((o) => o.product_id === productId)) return [];
    return [{ productId, qty: step.qty * count }];
  });
}

/** What the build comes to, at whatever the caller says each component costs. */
export function buildNet(
  steps: BuildStep[], chosen: Chosen, builds: number,
  priceOf: (productId: string) => number | undefined,
): number {
  return buildLines(steps, chosen, builds)
    .reduce((total, line) => total + (priceOf(line.productId) ?? 0) * line.qty, 0);
}
