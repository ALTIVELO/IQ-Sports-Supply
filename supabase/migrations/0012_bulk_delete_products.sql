-- ============================================================================
-- 0012: removing products from the catalogue in bulk.
--
-- A price list arrives with lines that should never have been listed, or a
-- supplier drops a range, and clearing them one at a time is not realistic.
--
-- The care needed is in what "delete" means. order_lines and
-- stock_transfer_lines reference products without ON DELETE, so Postgres
-- already refuses to destroy anything that has been sold or moved — correctly,
-- because an invoice has to keep saying what was on it. A bulk action that
-- simply failed on those rows would be useless on any real selection, so this
-- splits the work: anything with no history is genuinely deleted, anything
-- with history is withdrawn from the catalogue instead, and the caller is told
-- which was which rather than being left to guess.
-- ============================================================================

create or replace function public.delete_products(p_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role      user_role;
  v_deletable uuid[];
  v_withdrawn text[];
  v_deleted   integer;
begin
  select role into v_role from profiles where id = auth.uid();
  -- Deliberately narrower than the rest of the catalogue screen, which any
  -- staff member can use: ops pack boxes, and should not be able to empty the
  -- price list from the same page they check a SKU on.
  if v_role is null or v_role not in ('admin', 'accounts') then
    raise exception 'Only an admin or accounts user can delete products';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Nothing was selected';
  end if;

  -- Sold or moved at any point, so the history has to keep naming them.
  select coalesce(array_agg(p.sku order by p.sku), '{}')
    into v_withdrawn
    from products p
   where p.id = any(p_ids)
     and (exists (select 1 from order_lines ol where ol.product_id = p.id)
       or exists (select 1 from stock_transfer_lines tl where tl.product_id = p.id));

  update products set active = false
   where id = any(p_ids)
     and (exists (select 1 from order_lines ol where ol.product_id = products.id)
       or exists (select 1 from stock_transfer_lines tl where tl.product_id = products.id));

  select coalesce(array_agg(p.id), '{}')
    into v_deletable
    from products p
   where p.id = any(p_ids)
     and not exists (select 1 from order_lines ol where ol.product_id = p.id)
     and not exists (select 1 from stock_transfer_lines tl where tl.product_id = p.id);

  -- tier_prices and stock_levels cascade, so this clears their rows too.
  delete from products where id = any(v_deletable);
  get diagnostics v_deleted = row_count;

  insert into audit_log (actor, entity, entity_id, action)
  values (auth.uid(), 'product', null,
          'bulk_delete:' || v_deleted || ' deleted,'
          || coalesce(array_length(v_withdrawn, 1), 0) || ' withdrawn');

  return jsonb_build_object(
    'deleted',   v_deleted,
    'withdrawn', to_jsonb(v_withdrawn));
end $$;
