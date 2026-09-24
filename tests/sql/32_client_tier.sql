-- ============================================================================
-- 32: moving a client between pricing tiers.
--
-- The tier was always editable, as a box on the client form. What it was not
-- was a decision with a name on it: anybody who could correct a phone number
-- could reprice a customer, and nothing recorded that they had.
--
-- Three claims here. That the move works and the prices follow. That ops
-- cannot make it — they pick and pack, and repricing a customer is not theirs
-- either from the row or from the form. And that the log says who, when, and
-- what from, because that is the question asked when a price looks wrong.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com'),
  ('22222222-2222-2222-2222-222222222222','accounts@iqsportsupply.com'),
  ('33333333-3333-3333-3333-333333333333','warehouse@iqsportsupply.com'),
  ('44444444-4444-4444-4444-444444444444','dave@mikedixonimports.co.uk');
update profiles set role='admin',    full_name='James Mitri'
 where id='11111111-1111-1111-1111-111111111111';
update profiles set role='accounts', full_name='Rohail'
 where id='22222222-2222-2222-2222-222222222222';
update profiles set role='ops',      full_name='Warehouse'
 where id='33333333-3333-3333-3333-333333333333';
-- A real customer, so the claim "every price they see changes" can be read
-- through the view they actually read it through rather than inferred from
-- a column on their record.
update clients set auth_user_id='44444444-4444-4444-4444-444444444444'
 where name='MDI Ltd';
do $$ begin create role app_user nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on auth.users to app_user;
\set QUIET off

\echo ''
\echo '───────── A0. What the customer is charged before anybody touches it ─────────'
-- Held in a table rather than a psql variable, because psql does not
-- substitute inside a dollar-quoted body and that is where it is read back.
create table seen_before as
  select tp.price from tier_prices tp
    join tiers t on t.id = tp.tier_id
    join products p on p.id = tp.product_id
   where p.sku = 'BPB05SR25' and t.name = 'Distributor';
grant select on seen_before to app_user;
do $$
begin
  perform assert_eq((select tier_id from clients where name='MDI Ltd')
                    = (select id from tiers where name='Distributor'),
                    true, 'MDI are on Distributor to begin with');
end $$;

\echo ''
\echo '───────── A. An admin moves a client, and the prices move ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_client uuid; v_from uuid; v_to uuid; v_was text; v_now uuid;
begin
  select id, tier_id into v_client, v_from from clients where name = 'MDI Ltd';
  select id into v_to from tiers where id <> v_from order by sort limit 1;

  v_was := set_client_tier(v_client, v_to);
  select tier_id into v_now from clients where id = v_client;

  perform assert_eq(v_now = v_to, true, 'the client is on the new tier');
  perform assert_eq(v_was, (select name from tiers where id = v_from),
    'and it says which one they came off, so the screen can too');
end $$;

\echo ''
\echo '───────── A2. And the customer is reading the new price ─────────'
-- The claim the whole feature rests on, read the way the customer reads it.
-- Moving the record is not the point; moving what they are charged is.
set role app_user;
set session "test.user_id" = '44444444-4444-4444-4444-444444444444';
do $$
declare v_now numeric; v_tier text;
begin
  select price into v_now from client_catalogue where sku='BPB05SR25';
  select t.name into v_tier from tiers t join clients c on c.tier_id = t.id
   where c.name = 'MDI Ltd';
  perform assert_eq(v_now,
    (select tp.price from tier_prices tp
      join tiers t on t.id = tp.tier_id
      join products p on p.id = tp.product_id
     where p.sku = 'BPB05SR25' and t.name = v_tier),
    'the price on their screen is the new tier''s, not the old one''s');
  perform assert_eq(v_now <> (select price from seen_before), true,
    'and a different number from what Distributor would have charged them');
end $$;
reset role;

\echo ''
\echo '───────── B. The log says who, when and what from ─────────'
do $$
declare a audit_log%rowtype; v_client uuid;
begin
  select id into v_client from clients where name = 'MDI Ltd';
  select * into a from audit_log
   where entity = 'client' and entity_id = v_client and action = 'tier'
   order by created_at desc limit 1;

  perform assert_eq(a.actor, '11111111-1111-1111-1111-111111111111'::uuid,
    'the person who did it is named');
  perform assert_eq(a.detail ? 'from_name' and a.detail ? 'to_name', true,
    'and both tiers by name, not only by id');
  perform assert_eq(a.detail ->> 'to_name',
    (select t.name from tiers t join clients c on c.tier_id = t.id where c.id = v_client),
    'the tier they moved to is the one they are on');
end $$;

\echo ''
\echo '───────── C. The screen can say who last moved them ─────────'
-- Back to the admin: reading this is a staff question, and the last section
-- was answering as the customer.
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare r record; v_client uuid; n integer;
begin
  select id into v_client from clients where name = 'MDI Ltd';
  select * into r from last_tier_changes() where client_id = v_client;
  perform assert_eq(r.by_name, 'James Mitri', 'by their name, not their id');

  -- One row per client, newest only: this answers "who put them on this",
  -- which is a current fact, not a history.
  perform set_client_tier(v_client, (select id from tiers order by sort desc limit 1));
  select count(*)::int into n from last_tier_changes() where client_id = v_client;
  perform assert_eq(n, 1, 'and only the latest move, however many there have been');
end $$;

\echo ''
\echo '───────── D. Re-picking the tier they are on is not a change ─────────'
do $$
declare v_client uuid; v_tier uuid; before_n integer; after_n integer; v_was text;
begin
  select id, tier_id into v_client, v_tier from clients where name = 'MDI Ltd';
  select count(*)::int into before_n from audit_log where entity='client' and action='tier';

  v_was := set_client_tier(v_client, v_tier);
  select count(*)::int into after_n from audit_log where entity='client' and action='tier';

  perform assert_eq(v_was is null, true, 'nothing to report, so nothing is reported');
  perform assert_eq(after_n, before_n, 'and a log full of non-events is a log nobody reads');
end $$;

\echo ''
\echo '───────── E. Accounts may price a customer ─────────'
set session "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare v_client uuid; v_to uuid;
begin
  select id into v_client from clients where name = 'MDI Ltd';
  select id into v_to from tiers order by sort limit 1;
  perform set_client_tier(v_client, v_to);
  perform assert_eq((select t.name from tiers t join clients c on c.tier_id = t.id
                      where c.id = v_client),
                    (select name from tiers where id = v_to),
                    'accounts can move them, the same two who can suspend them');
  perform assert_eq((select by_name from last_tier_changes() where client_id = v_client),
                    'Rohail', 'and the log names them rather than the last person');
end $$;

\echo ''
\echo '───────── F. Ops cannot, and are told why ─────────'
set session "test.user_id" = '33333333-3333-3333-3333-333333333333';
do $$
declare v_client uuid; v_to uuid; v_before uuid;
begin
  select id, tier_id into v_client, v_before from clients where name = 'MDI Ltd';
  select id into v_to from tiers where id <> v_before order by sort limit 1;

  perform assert_fails(
    format('select set_client_tier(%L, %L)', v_client, v_to),
    'the warehouse cannot reprice a customer');

  perform assert_eq((select tier_id from clients where id = v_client), v_before,
    'and the client is where they were');
end $$;

\echo ''
\echo '───────── G. A tier that does not exist is refused ─────────'
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
declare v_client uuid;
begin
  select id into v_client from clients where name = 'MDI Ltd';
  perform assert_fails(
    format('select set_client_tier(%L, %L)', v_client,
           '00000000-0000-0000-0000-000000000000'::uuid),
    'a tier we do not have is not a tier to put anybody on');
  perform assert_fails(
    format('select set_client_tier(%L, (select id from tiers limit 1))',
           '00000000-0000-0000-0000-000000000000'::uuid),
    'nor is a client we do not have somebody to move');
end $$;
