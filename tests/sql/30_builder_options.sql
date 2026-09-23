-- ============================================================================
-- 30: a builder step re-reads the catalogue.
--
-- The groupset builder's steps were filled once, when the migration that
-- created them ran: every active product matching a SKU pattern became an
-- option, and the pattern then existed nowhere. So the options were a
-- photograph of the catalogue on that day.
--
-- Madison's September list carries fourteen EW-SD300 wire lengths where the
-- old sheet had two. They import, they are priced, and before this the builder
-- offered neither the new lengths nor any part any supplier adds from here on.
--
-- The claim tested here is the one that matters: a part that arrives after the
-- step was built turns up on it, and a part that leaves goes.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','james@iqsportsupply.com');
update profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set session "test.user_id" = '11111111-1111-1111-1111-111111111111';
\set QUIET off

\echo ''
\echo '───────── A. The rule is on the step, not only in the migration ─────────'
do $$
declare st product_group_steps%rowtype;
begin
  select s.* into st from product_group_steps s
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'First Di2 wire';
  perform assert_eq(st.sku_pattern, 'EWSD300%', 'the wire step knows which SKUs are its own');
  perform assert_eq(st.spec, 'Wire length', 'and which part of the name is the length');
end $$;

\echo ''
\echo '───────── B. A length that arrives later turns up on the step ─────────'
-- Exactly what the import does: new products, priced, active. Nothing touches
-- product_group_options.
insert into products (sku, name, brand, active) values
  ('EWSD300IL015', 'Di2 EW-SD300 E-tube Wire 150mm', 'Shimano', true),
  ('EWSD300IL040', 'Di2 EW-SD300 E-tube Wire 400mm', 'Shimano', true),
  ('EWSD300IL085', 'Di2 EW-SD300 E-tube Wire 850mm', 'Shimano', true);

do $$
declare n integer;
begin
  select count(*)::int into n
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
    join products p on p.id = o.product_id
   where g.slug = 'dura-ace-r9200' and s.name = 'First Di2 wire'
     and p.sku = 'EWSD300IL015';
  perform assert_eq(n, 0, 'importing a wire does not put it on a build by itself');
end $$;

select refresh_group_options() as refreshed \gset

do $$
declare
  lengths text[];
begin
  select array_agg(o.label order by o.sort) into lengths
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'First Di2 wire';

  perform assert_eq(lengths @> array['150mm','400mm','850mm'], true,
    'after a refresh the new lengths are offered');
  -- And ordered by the number rather than by its text, or 1000mm lists before
  -- 150mm and a 400 lands at the bottom because it arrived last.
  perform assert_eq(lengths[1], '150mm', 'shortest first');
  perform assert_eq(lengths[2], '400mm', 'in numeric order, not arrival order');
end $$;

\echo ''
\echo '───────── C. Both wire steps, not just the first ─────────'
do $$
declare a integer; b integer;
begin
  select count(*)::int into a from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'First Di2 wire';
  select count(*)::int into b from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'Second Di2 wire';
  perform assert_eq(a = b and a >= 3, true,
    'the second run offers the same lengths as the first');
end $$;

\echo ''
\echo '───────── D. A part that is withdrawn stops being offered ─────────'
do $$
declare n integer;
begin
  update products set active = false where sku = 'EWSD300IL040';
  perform refresh_group_options();
  select count(*)::int into n
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
    join products p on p.id = o.product_id
   where g.slug = 'dura-ace-r9200' and s.name = 'First Di2 wire'
     and p.sku = 'EWSD300IL040';
  perform assert_eq(n, 0, 'a withdrawn wire cannot be picked on a build');
end $$;

\echo ''
\echo '───────── E. A refresh does not disturb what already matched ─────────'
do $$
declare before_n integer; after_n integer;
begin
  select count(*)::int into before_n from product_group_options;
  perform refresh_group_options();
  perform refresh_group_options();
  select count(*)::int into after_n from product_group_options;
  perform assert_eq(after_n, before_n, 'running it twice changes nothing');
end $$;

\echo ''
\echo '───────── F. A step somebody filled by hand is left alone ─────────'
do $$
declare v_step uuid; n integer;
begin
  -- No pattern: its options were put there deliberately and are not ours to
  -- take away on the next import.
  insert into product_group_steps (group_id, name, qty, required, sort)
  select g.id, 'Hand-picked extras', 1, false, 99
    from product_groups g where g.slug = 'dura-ace-r9200'
  returning id into v_step;

  insert into product_group_options (step_id, product_id, label, sort)
  select v_step, p.id, 'Chosen by hand', 1 from products p where p.sku = 'EWSD300IL015';

  perform refresh_group_options();
  select count(*)::int into n from product_group_options where step_id = v_step;
  perform assert_eq(n, 1, 'a step with no rule keeps what it was given');
end $$;
