-- ============================================================================
-- 0040: a builder step keeps its rule, and re-reads the catalogue.
--
-- The groupset builder's steps were filled by seed_group_step at migration
-- time: every active product matching a SKU pattern became an option, once.
-- The pattern lived in the call and nowhere else, so the options were a
-- photograph of the catalogue on the day the migration ran.
--
-- Which was fine until the catalogue grew. Madison's September list carries
-- fourteen EW-SD300 wire lengths — 150mm through 850mm — where the old sheet
-- had two, a 900 and a 1000. They imported, they are in the catalogue, they
-- are priced, and the builder offers none of them, because nothing re-ran the
-- rule that would have found them. The same is true of every chainset length,
-- cassette ratio and rotor size a supplier adds from here on.
--
-- So the rule moves on to the step, where it can be read back, and
-- refresh_group_options() re-runs it. The import calls that when it finishes,
-- which is the moment the answer can have changed.
-- ============================================================================

alter table product_group_steps add column if not exists sku_pattern text;
alter table product_group_steps add column if not exists sku_exclude text;
alter table product_group_steps add column if not exists spec text;
alter table product_group_steps add column if not exists spec_values text[];

comment on column product_group_steps.sku_pattern is
  'The SKU pattern whose products are this step''s options. Held here rather '
  'than in the migration that seeded it, so the step can be filled again when '
  'the catalogue changes.';

/**
 * Fills one step's options from the rule the step carries.
 *
 * The whole of what seed_group_step used to do inline, moved somewhere it can
 * be called again. A step with no pattern is left alone: its options were put
 * there by hand and are nobody's to take away.
 */
create or replace function public.apply_step_options(p_step uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st product_group_steps%rowtype;
begin
  select * into st from product_group_steps where id = p_step;
  if not found or st.sku_pattern is null then return; end if;

  -- Options that no longer answer the rule. Including the products that have
  -- since been withdrawn: a part nobody can buy must not sit on a build as
  -- though they could.
  delete from product_group_options o
   using products p
   where o.step_id = st.id and p.id = o.product_id
     and (not p.active
          or p.sku not like st.sku_pattern
          or (st.sku_exclude is not null and p.sku like st.sku_exclude)
          or (st.spec_values is not null
              and coalesce(spec_value(p.name, st.spec), '') <> all (st.spec_values))
          -- An option that cannot answer an axis the step names could never be
          -- picked from the controls, so it does not belong on the step.
          or (st.axis1_name is not null and spec_value(p.name, st.axis1_name) is null)
          or (st.axis2_name is not null and spec_value(p.name, st.axis2_name) is null));

  insert into product_group_options (step_id, product_id, label, axis1_value, axis2_value, sort)
  select st.id, p.id,
         case
           when st.axis1_name is not null then
             concat_ws(' · ', spec_value(p.name, st.axis1_name), spec_value(p.name, st.axis2_name))
           when st.spec is not null then spec_value(p.name, st.spec)
           else p.name end,
         spec_value(p.name, st.axis1_name),
         spec_value(p.name, st.axis2_name),
         0
    from products p
   where p.active
     and p.sku like st.sku_pattern
     and (st.sku_exclude is null or p.sku not like st.sku_exclude)
     and (st.axis1_name is null or spec_value(p.name, st.axis1_name) is not null)
     and (st.axis2_name is null or spec_value(p.name, st.axis2_name) is not null)
     and (st.spec_values is null or spec_value(p.name, st.spec) = any (st.spec_values))
     and not exists (select 1 from product_group_options o
                      where o.step_id = st.id and o.product_id = p.id)
  on conflict do nothing;

  /*
   * Order recomputed over the whole step, not set on insert.
   *
   * By the number in the spec rather than its text, or a 1000mm wire lists
   * before a 900mm one — and now that a step can gain options long after it
   * was created, a newly imported 150mm wire would otherwise land at the
   * bottom of a list it belongs at the top of.
   */
  with ordered as (
    select o.id,
           row_number() over (order by
             nullif(regexp_replace(coalesce(spec_value(p.name, st.spec), ''),
                                   '[^0-9.]', '', 'g'), '')::numeric nulls last,
             p.sku) as n
      from product_group_options o
      join products p on p.id = o.product_id
     where o.step_id = st.id
  )
  update product_group_options o set sort = ordered.n
    from ordered where ordered.id = o.id;

  /*
   * Labels and axis values rebuilt for options already present.
   *
   * Not only for the ones just inserted: a step that gains the ability to read
   * a spec — or a product whose name the importer has since corrected — leaves
   * every option that was already there reading the old way. A chainset that
   * used to show with no chainring shows with one after this, and a wire whose
   * name gained its length reads as a length rather than as a part number.
   */
  update product_group_options o
     set label = case
                   when st.axis1_name is not null then
                     concat_ws(' · ', spec_value(p.name, st.axis1_name),
                               spec_value(p.name, st.axis2_name))
                   when st.spec is not null then spec_value(p.name, st.spec)
                   else p.name end,
         axis1_value = spec_value(p.name, st.axis1_name),
         axis2_value = spec_value(p.name, st.axis2_name)
    from products p
   where p.id = o.product_id and o.step_id = st.id;
end $$;

/**
 * Every step that carries a rule, filled again.
 *
 * Called at the end of a catalogue import, because that is when the answer
 * can have changed — a new wire length, a crank length the supplier has added,
 * a part withdrawn. Cheap enough to run unconditionally: there are a handful
 * of builds and a step's rule matches tens of products, not thousands.
 */
create or replace function public.refresh_group_options()
returns integer language plpgsql security definer set search_path = public as $$
declare v_step uuid; v_count integer := 0;
begin
  for v_step in
    select s.id from product_group_steps s
      join product_groups g on g.id = s.group_id
     where s.sku_pattern is not null and g.active
  loop
    perform apply_step_options(v_step);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── seeding, now that the rule is kept ──────────────────────────────────────
/*
 * seed_group_step records what it was told and then defers to the shared
 * filler, so a step seeded by a migration and a step refreshed after an import
 * are filled by the same code. Two implementations of "which products belong
 * on this step" is one of them being wrong.
 */
create or replace function public.seed_group_step(
  p_group_slug  text,
  p_step_name   text,
  p_sort        integer,
  p_pattern     text,
  p_required    boolean default true,
  p_qty         integer default 1,
  p_axis1       text default null,
  p_axis2       text default null,
  p_hint        text default null,
  p_exclude     text default null,
  p_spec        text default null,
  p_spec_values text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_step uuid;
begin
  select id into v_group from product_groups where slug = p_group_slug;
  if v_group is null then return; end if;

  select id into v_step from product_group_steps
   where group_id = v_group and name = p_step_name;

  if v_step is null then
    insert into product_group_steps
      (group_id, name, hint, qty, required, sort, axis1_name, axis2_name,
       sku_pattern, sku_exclude, spec, spec_values)
    values (v_group, p_step_name, p_hint, p_qty, p_required, p_sort, p_axis1, p_axis2,
            p_pattern, p_exclude, p_spec, p_spec_values)
    returning id into v_step;
  else
    update product_group_steps
       set hint = p_hint, qty = p_qty, required = p_required, sort = p_sort,
           axis1_name = p_axis1, axis2_name = p_axis2,
           sku_pattern = p_pattern, sku_exclude = p_exclude,
           spec = p_spec, spec_values = p_spec_values
     where id = v_step;
  end if;

  perform apply_step_options(v_step);
end $$;

-- Re-run the four builds, which records the rule on every step they own and
-- fills them from the catalogue as it is now — fourteen wire lengths included.
select seed_shimano_groupset(
  'dura-ace-r9200', 'Dura-Ace Di2 R9200 groupset', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%');
select seed_shimano_groupset(
  'ultegra-r8100', 'Ultegra Di2 R8100 groupset', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%');
select seed_shimano_groupset(
  'dura-ace-r9200-power', 'Dura-Ace Di2 R9200 groupset with power meter', 'R9200',
  'R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F',
  'FCR9200%', 'CSR9200%', 'CNM9100%', 'RTCL900%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
select seed_shimano_groupset(
  'ultegra-r8100-power', 'Ultegra Di2 R8100 groupset with power meter', 'R8100',
  'R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F',
  'FCR8100%', 'CSR8101%', 'CNM8100%', 'RTCL800%',
  'BTDN300', 'EWEC300', 'EWSD300IL090', 'EWSD300IL100', true);
