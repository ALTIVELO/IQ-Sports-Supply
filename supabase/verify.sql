-- ============================================================================
-- Run this in the Supabase SQL editor AFTER applying 0001–0004.
-- Every row should say PASS. Anything else means that migration did not land.
-- ============================================================================

with checks as (
  select 'tables created' as item,
         (select count(*) from information_schema.tables
           where table_schema='public' and table_type='BASE TABLE')::text as found,
         '24' as expected

  union all
  select 'RLS enabled on every table',
         (select count(*)::text from pg_tables t
           join pg_class c on c.relname = t.tablename
           where t.schemaname='public' and not c.relrowsecurity),
         '0'

  union all
  select 'domain functions present',
         (select count(*)::text from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname in
            ('place_order','split_invoice','create_supplier_order','receive_po',
             'mark_invoice_paid','mark_invoice_packed','mark_invoice_shipped',
             'approve_account_request','receive_transfer','refresh_invoice_readiness',
             'next_order_number','next_invoice_number','next_po_number','next_transfer_number',
             'current_tier_price','product_in_stock','my_role','is_staff','is_admin',
             'my_client_id','my_location_ids','handle_new_user')),
         '22'

  union all
  select 'signup trigger on auth.users',
         (select count(*)::text from pg_trigger
           where tgname='on_auth_user_created' and not tgisinternal),
         '1'

  union all
  select 'client catalogue view is security_invoker',
         (select case when reloptions::text like '%security_invoker=true%'
                 then 'yes' else 'no' end
            from pg_class where relname='client_catalogue'),
         'yes'

  union all
  select 'settings row seeded',
         (select count(*)::text from settings where id=1), '1'

  union all
  select 'next invoice number continues from 002',
         (select next_invoice::text from settings where id=1), '3'

  union all
  select 'pricing tiers seeded',
         (select count(*)::text from tiers), '4'

  union all
  select 'fulfilment locations seeded',
         (select count(*)::text from locations), '5'
)
select
  case when found = expected then 'PASS' else 'FAIL' end as result,
  item,
  found,
  expected
from checks
order by result, item;
