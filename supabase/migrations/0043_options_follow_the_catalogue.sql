-- ============================================================================
-- 0043: a product added by hand reaches the builds too.
--
-- 0040 moved each builder step's rule on to the step and gave the import a
-- refresh_group_options() call at the end, because an import was the only way
-- the catalogue changed. It is not. A part added, renamed or withdrawn on the
-- staff Catalogue screen writes to products and nothing re-reads the rules, so
-- the part sits in the catalogue, correctly priced, and appears on no build.
--
-- Found the plain way: four EW-SD300 wires — 900, 1000, 1200 and 1400mm, none
-- of them on Madison's September list — were added by hand, and the groupset
-- configurators went on offering fourteen lengths.
--
-- So the refresh hangs off the table rather than off one screen, and it is
-- narrow on purpose. Not every step: only the steps whose rule could name this
-- SKU. The import restates products one row at a time — deliberately, because
-- the changes differ per product and one wrong batch would file the whole
-- catalogue under one model — so a full refresh on every write would put
-- eighty milliseconds on each of three hundred and fifty updates and turn a
-- re-import into half a minute of re-reading rules that cannot have changed.
--
-- Matching steps only, and most products match none: a bottom bracket is on
-- no build, a wire is on twelve. Both the old and the new SKU are asked
-- about, so a part renumbered by hand leaves the step it was on as well as
-- joining the one it now answers.
-- ============================================================================

/**
 * Re-reads the rules that could name this SKU, and no others.
 *
 * The narrow half of refresh_group_options(), for a single product changing.
 * A step whose pattern cannot match the SKU cannot gain or lose it, so
 * re-running that step would read the same answer out of the same rows.
 */
create or replace function public.apply_steps_for_sku(p_sku text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_step uuid; v_count integer := 0;
begin
  if p_sku is null then return 0; end if;

  for v_step in
    select s.id from product_group_steps s
      join product_groups g on g.id = s.group_id
     where s.sku_pattern is not null and g.active
       and p_sku like any (string_to_array(s.sku_pattern, '|'))
  loop
    perform apply_step_options(v_step);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.products_refresh_group_options()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform apply_steps_for_sku(old.sku);
    return null;
  end if;

  perform apply_steps_for_sku(new.sku);
  -- A SKU corrected by hand has to leave the step it was on as well as join
  -- the one it now answers, and the step it was on is found by the old one.
  if tg_op = 'UPDATE' and old.sku is distinct from new.sku then
    perform apply_steps_for_sku(old.sku);
  end if;
  return null;
end $$;

drop trigger if exists products_refresh_group_options on products;

/*
 * Only the three columns a rule reads.
 *
 * A rule matches on sku, narrows on what spec_value can read out of name, and
 * drops anything not active. Re-pointing an image, re-filing a category or
 * re-costing a part is not a change to what any step matches, and must not
 * pay for a re-read.
 */
create trigger products_refresh_group_options
  after insert or delete or update of sku, name, active on products
  for each row execute function public.products_refresh_group_options();

comment on trigger products_refresh_group_options on products is
  'Re-reads the builder rules that could name this SKU, so a part added, '
  'renamed or withdrawn anywhere — an import, the Catalogue screen, a fix run '
  'by hand — reaches the builds that ask for it.';

-- And every rule once now, for the catalogue as it already stands.
select refresh_group_options();
