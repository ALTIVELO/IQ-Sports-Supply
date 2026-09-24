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
  ('EWSD300IL085', 'Di2 EW-SD300 E-tube Wire 850mm', 'Shimano', true),
  -- The four digit lengths. Madison's September list stops at 850 and their
  -- July one carried only the 900 and the 1000, so nothing in the catalogue
  -- has exercised this: a reader that wanted three digits would take "120"
  -- out of "1200mm" and sort a 1200 wire between the 100 and the 150.
  ('EWSD300IL100', 'Di2 EW-SD300 E-tube Wire 1000mm', 'Shimano', true),
  ('EWSD300IL120', 'Di2 EW-SD300 E-tube Wire 1200mm', 'Shimano', true),
  ('EWSD300IL140', 'Di2 EW-SD300 E-tube Wire 1400mm', 'Shimano', true);

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

  perform assert_eq(lengths @> array['1000mm','1200mm','1400mm'], true,
    'a wire longer than a metre is a length like any other');
  perform assert_eq(lengths[array_length(lengths,1)], '1400mm',
    'and the longest is last, not sorted among the hundreds');
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

\echo ''
\echo '───────── G. A rotor named for its size, not for its part number ─────────'
-- The regression 0041 fixes. spec_value could only decode a part number found
-- inside a name — "Shimano Disc Rotor RTCL900SI" — which is how the converter
-- named rotors before it could read one. 0036 taught it to name them properly,
-- and every rotor in the catalogue has read "Dura-Ace RT-CL900 Disc Rotor
-- 160mm (I)" since, which that reader cannot see at all.
--
-- Nothing showed it while the options were seeded once and never re-checked.
-- Re-checking them after every import turned a reader quietly returning null
-- into two rotor steps with nothing on them.
do $$
begin
  perform assert_eq(spec_value('Dura-Ace RT-CL900 Disc Rotor 160mm (I)', 'Rotor size'),
    '160mm', 'a rotor named for its size reads as that size');
  perform assert_eq(spec_value('Ultegra RT-CL800 Disc Rotor 140mm (I)', 'Rotor size'),
    '140mm', 'whichever range it belongs to');
  perform assert_eq(spec_value('SM-RT64 Deore - 180 mm rotor', 'Rotor size'),
    '180mm', 'and however the supplier spaces it');
  perform assert_eq(spec_value('RT-CL750 Disc Rotor 200mm (E)', 'Rotor size'),
    '200mm', 'including the sizes that are written out');

  -- The old naming still has to work: a catalogue imported years ago holds
  -- these, and a reader that stopped recognising them would empty a step
  -- exactly as this one did.
  perform assert_eq(spec_value('Shimano Disc Rotor RTCL900SI', 'Rotor size'),
    '160mm', 'a part number in a name is still decoded');
  perform assert_eq(spec_value('Shimano Disc Rotor RTCL900SSI', 'Rotor size'),
    '140mm', 'the small one is not read as the medium');
  perform assert_eq(spec_value('Shimano Disc Rotor RTCL750200E', 'Rotor size'),
    '200mm', 'nor a written-out size as its last three digits');

  -- And a part that is not a rotor still answers nothing, or it would join a
  -- rotor step on the strength of a crank length.
  perform assert_eq(spec_value('Dura-Ace FC-R9200 Chainset 52/36 172.5mm', 'Rotor size') is null,
    true, 'a chainset is not read as a rotor');
end $$;

\echo ''
\echo '───────── H. Which means the rotor steps fill ─────────'
insert into products (sku, name, brand, active) values
  ('RTCL900SI',  'Dura-Ace RT-CL900 Disc Rotor 160mm (I)', 'Shimano', true),
  ('RTCL900SSI', 'Dura-Ace RT-CL900 Disc Rotor 140mm (I)', 'Shimano', true),
  -- A 203mm is a real rotor and not one these builds offer: the steps accept
  -- 140 and 160 only, and a size outside that must not slip in.
  ('RTCL900LI',  'Dura-Ace RT-CL900 Disc Rotor 203mm (I)', 'Shimano', true);

select refresh_group_options() as n \gset

do $$
declare front text[]; rear text[];
begin
  select array_agg(o.label order by o.sort) into front
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'Front rotor';
  select array_agg(o.label order by o.sort) into rear
    from product_group_options o
    join product_group_steps s on s.id = o.step_id
    join product_groups g on g.id = s.group_id
   where g.slug = 'dura-ace-r9200' and s.name = 'Rear rotor';

  perform assert_eq(front, array['140mm','160mm'], 'the front rotor step offers both sizes');
  perform assert_eq(rear, array['140mm','160mm'], 'and so does the rear');
  perform assert_eq(front @> array['203mm'], false,
    'a size these builds do not offer stays off');
end $$;
