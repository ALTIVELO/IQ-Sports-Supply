-- ============================================================================
-- 0006: fuller company details on the trade account application.
--
-- The apply form only ever asked for the bare minimum needed to review an
-- application by hand. Reviewing distributors and importers in particular
-- needs more: a trading name distinct from the registered company, the
-- company and EORI numbers, a social media presence, and a legal invoicing
-- address that may differ from where the goods are actually picked from.
--
-- These are additive and nullable — existing rows and the approval flow
-- (approve_account_request) are untouched. `address` keeps its existing
-- meaning as the trading address.
-- ============================================================================

alter table account_requests
  add column if not exists trading_name      text,
  add column if not exists company_number    text,
  add column if not exists eori_no           text,
  add column if not exists social_media      text,
  add column if not exists invoicing_address text;
