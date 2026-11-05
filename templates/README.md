# templates/

## madison-order.xlsx

Madison's order form, as the app fills it in.

Suppliers want their own paperwork, so the app does not draw a purchase order
— it opens this file, fills in the cells the **App mapping** tab lists, and
sends the result. That makes this file the thing to edit when the form
changes: the account number, the contact, the delivery sites, the wording of
the footer, the column widths. `src/lib/xlsx/supplier-sheet.ts` only fills it
in, and finds its way around by reading the labels in column A rather than by
counting rows, so adding a header field or more line rows does not need code.

Three things the code does rely on, and all three are asserted in
`tests/unit/supplier-sheet.test.mjs`:

- the sheet is named **Order**, with `Line` and `Total units` labels in column A;
- the **App mapping** tab says which cell each field goes in — keep it in step
  with the form, because the test reads it and compares;
- the line table's first column, and the two totals, are formulas. The app
  rewrites them for whatever row they end up on and never writes a number over
  one.

It carries an example line so the form makes sense on its own. The app clears
every line row before it writes, so the example never reaches a generated
sheet.

Anything else on the tab — a second supplier's form, say — needs its own file
and its own mapping.

### What never goes on it

No price of any kind, and nothing that identifies the customer: not their
name, their company, their address or their email. The only client reference
allowed is the SO number, which the supplier is asked to quote back so
arriving stock books in against the right order.

The generated sheet goes to James and to nobody else. He forwards it. That is
why the recipient is hard-coded in `supplier-sheet.ts` instead of being read
from the supplier address in Settings.

### Where it has to be at run time

It is read off disk inside a serverless function, so it is named in
`next.config.mjs` under `outputFileTracingIncludes` — without that, Vercel's
file trace leaves it out of the deployed function and the sheet fails to
generate. It cannot live in `public/`, which is served from the CDN and is not
on the function's filesystem at all.
