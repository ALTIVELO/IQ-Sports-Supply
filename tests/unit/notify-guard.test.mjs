async function notify(run, what) {
  try { await run(); return undefined; }
  catch (e) {
    return `${what} could not be sent (${e instanceof Error ? e.message : String(e)}). ` +
           'Everything else went through — check the Outbox.';
  }
}

// This is what supabaseAdmin() does when the key is absent.
const missingKey = async () => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set'); };
const works      = async () => {};

let fail = 0;
const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`); };

const orderId = 'order-123';
// Simulates placeOrder(): the RPC has committed before notify runs.
async function placeOrder(notifier) {
  const committed = orderId;                    // place_order() already succeeded
  const warning = await notify(notifier, 'The order confirmation');
  return { ok: true, orderId: committed, warning };
}

const bad = await placeOrder(missingKey);
check('a failed notification still returns ok', bad.ok === true);
check('the order id still comes back', bad.orderId === orderId);
check('the failure is reported, not swallowed', typeof bad.warning === 'string');
check('the warning names the real cause', bad.warning.includes('SUPABASE_SERVICE_ROLE_KEY'));
check('and tells the user where to look', bad.warning.includes('Outbox'));

const good = await placeOrder(works);
check('a working notification leaves no warning', good.warning === undefined);
check('and still returns ok', good.ok === true);

process.exit(fail ? 1 : 0);
