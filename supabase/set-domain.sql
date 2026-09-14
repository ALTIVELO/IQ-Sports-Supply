-- ============================================================================
-- Point the live database at the production domain.
--
-- The migration default only applies to a fresh install, so a database that is
-- already running keeps whatever it was seeded with. Safe to run more than once.
-- ============================================================================

update settings
   set email_from = 'IQ Sports Supply <orders@iqsportsupply.com>'
 where id = 1
   and email_from like '%iqsportssupply.com%';   -- only the old, misspelt value

select company, email_from, confirmation_cc, supplier_recipient, application_recipient
  from settings where id = 1;
