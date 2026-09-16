-- ============================================================================
-- 0007: product images.
--
-- Supplier price sheets carry no images, so these are attached afterwards —
-- uploaded by staff, or pointed at a supplier's own URL on import. The column
-- holds a full URL rather than a storage path so both work without the app
-- having to know which it is looking at.
-- ============================================================================

alter table products add column if not exists image_url text;

-- Bucket for staff uploads. Public read: a product photo is not confidential,
-- and a public URL means no signing on every catalogue render.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists product_images_staff_write on storage.objects;
create policy product_images_staff_write on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_staff());

drop policy if exists product_images_staff_update on storage.objects;
create policy product_images_staff_update on storage.objects for update
  using (bucket_id = 'product-images' and public.is_staff());

drop policy if exists product_images_staff_delete on storage.objects;
create policy product_images_staff_delete on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_staff());

-- The client-facing view gains the image. Still security_invoker, and the tier
-- is still pinned to the signed-in client's own.
-- cascade: later migrations build views on top of this one, and a plain
-- drop fails the moment one exists — which is every re-run of setup.sql.
-- Each dependent view is recreated by its own migration further down.
drop view if exists client_catalogue cascade;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  p.image_url,
  c.slug as category_slug,
  c.name as category_name,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
left join categories c on c.id = p.category_id
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.tier_id = (select c2.tier_id from clients c2 where c2.id = my_client_id())
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;
