# Database

Apply in order against a fresh Supabase project:

```
0001_schema.sql     tables, enums, indexes
0002_functions.sql  domain logic (allocation, invoicing, receiving, numbering)
0003_rls.sql        row level security + the client-safe catalogue view
0004_seed.sql       settings, tiers, locations, sample catalogue and client
```

With the Supabase CLI: `supabase db push`. Or paste each file into the SQL
editor in order.

Then run `verify.sql` in the SQL editor. Every row must say PASS — a FAIL means
that migration did not land, and you should re-run it before going further.

## If a statement fails

All four files are safe to re-run. Every object is created with `IF NOT EXISTS`
or an equivalent guard, so if a run stops halfway you can fix the cause and
paste the same file again — you do not need to reset the database.

The one statement that commonly cannot run on a hosted project is the trigger on
`auth.users`, which is owned by the auth service rather than by you. It is
wrapped so that a permission error prints a notice and the rest of the file
still installs. The app does not depend on it: `getSessionUser()` creates the
profile row itself on first sign-in when the trigger is absent.

`verify.sql` reports `FAIL` for `signup trigger on auth.users` in that case, and
that one failure is safe to ignore. Any other `FAIL` is not.

## Making yourself an admin

Sign in once via magic link so an `auth.users` row exists, then:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

`handle_new_user()` gives every new auth user the `client` role. A client user
sees nothing at all until an approved `clients` row carries their email
address — that link is made automatically on signup, and by the approval flow.

## Numbering

`next_order_number()`, `next_invoice_number()`, `next_po_number()` and
`next_transfer_number()` each do `UPDATE settings SET n = n + 1 RETURNING`,
which takes a row lock on the single settings row. Two concurrent callers
serialise, so no number is ever issued twice.
