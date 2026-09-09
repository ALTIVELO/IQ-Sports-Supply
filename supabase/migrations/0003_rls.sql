-- ============================================================================
-- 0003: Row Level Security.
--
-- A client may see ONLY their own catalogue view (their tier's prices), their
-- own orders, backorders and invoices. They never see other clients, other
-- tiers' prices, supplier information, or stock levels — the in-stock /
-- back-order flag they get is derived server-side and never exposes a count.
-- ============================================================================

alter table profiles            enable row level security;
alter table tiers               enable row level security;
alter table locations           enable row level security;
alter table ops_locations       enable row level security;
alter table products            enable row level security;
alter table stock_levels        enable row level security;
alter table tier_prices         enable row level security;
alter table clients             enable row level security;
alter table account_requests    enable row level security;
alter table orders              enable row level security;
alter table order_lines         enable row level security;
alter table order_events        enable row level security;
alter table invoices            enable row level security;
alter table invoice_lines       enable row level security;
alter table purchase_orders     enable row level security;
alter table po_lines            enable row level security;
alter table stock_transfers     enable row level security;
alter table stock_transfer_lines enable row level security;
alter table price_imports       enable row level security;
alter table import_templates    enable row level security;
alter table settings            enable row level security;
alter table email_log           enable row level security;
alter table xero_connection     enable row level security;
alter table audit_log           enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles for select using (id = auth.uid());
drop policy if exists profiles_staff_read on profiles;
create policy profiles_staff_read on profiles for select using (is_staff());
drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for all using (is_admin()) with check (is_admin());

-- ── reference data ──────────────────────────────────────────────────────────
-- Tier names are harmless; a client still cannot read another tier's prices.
drop policy if exists tiers_read on tiers;
create policy tiers_read on tiers for select using (auth.uid() is not null);
drop policy if exists tiers_admin_write on tiers;
create policy tiers_admin_write on tiers for all using (is_admin()) with check (is_admin());

drop policy if exists locations_staff_read on locations;
create policy locations_staff_read on locations for select using (is_staff());
drop policy if exists locations_admin_write on locations;
create policy locations_admin_write on locations for all using (is_admin()) with check (is_admin());

drop policy if exists ops_locations_read on ops_locations;
create policy ops_locations_read on ops_locations for select using (is_staff());
drop policy if exists ops_locations_admin_write on ops_locations;
create policy ops_locations_admin_write on ops_locations for all using (is_admin()) with check (is_admin());

-- ── catalogue ───────────────────────────────────────────────────────────────
drop policy if exists products_read on products;
create policy products_read on products for select using (auth.uid() is not null);
drop policy if exists products_staff_write on products;
create policy products_staff_write on products for all using (is_staff()) with check (is_staff());

-- Stock levels are staff-only. Clients get an availability flag computed in a
-- security-definer view, never the underlying quantities.
drop policy if exists stock_levels_staff on stock_levels;
create policy stock_levels_staff on stock_levels for all using (is_staff()) with check (is_staff());

-- A client reads only the price rows for their own tier.
drop policy if exists tier_prices_staff on tier_prices;
create policy tier_prices_staff on tier_prices for all using (is_staff()) with check (is_staff());
drop policy if exists tier_prices_own_tier on tier_prices;
create policy tier_prices_own_tier on tier_prices for select using (
  tier_id = (select c.tier_id from clients c where c.auth_user_id = auth.uid())
);

-- ── clients ─────────────────────────────────────────────────────────────────
drop policy if exists clients_staff on clients;
create policy clients_staff on clients for all using (is_staff()) with check (is_staff());
drop policy if exists clients_self_read on clients;
create policy clients_self_read on clients for select using (auth_user_id = auth.uid());

-- Applications are submitted through a server-side route with the service
-- role, so no anonymous insert policy is needed here.
drop policy if exists account_requests_staff on account_requests;
create policy account_requests_staff on account_requests for all
  using (is_staff()) with check (is_staff());

-- ── orders ──────────────────────────────────────────────────────────────────
drop policy if exists orders_staff on orders;
create policy orders_staff on orders for all using (is_staff()) with check (is_staff());
drop policy if exists orders_client_read on orders;
create policy orders_client_read on orders for select using (client_id = my_client_id());

drop policy if exists order_lines_staff on order_lines;
create policy order_lines_staff on order_lines for all using (is_staff()) with check (is_staff());
drop policy if exists order_lines_client_read on order_lines;
create policy order_lines_client_read on order_lines for select using (
  exists (select 1 from orders o where o.id = order_id and o.client_id = my_client_id())
);

drop policy if exists order_events_staff on order_events;
create policy order_events_staff on order_events for all using (is_staff()) with check (is_staff());
drop policy if exists order_events_client_read on order_events;
create policy order_events_client_read on order_events for select using (
  exists (select 1 from orders o where o.id = order_id and o.client_id = my_client_id())
);

-- ── invoices ────────────────────────────────────────────────────────────────
drop policy if exists invoices_staff on invoices;
create policy invoices_staff on invoices for all using (is_staff()) with check (is_staff());
drop policy if exists invoices_client_read on invoices;
create policy invoices_client_read on invoices for select using (client_id = my_client_id());

drop policy if exists invoice_lines_staff on invoice_lines;
create policy invoice_lines_staff on invoice_lines for all using (is_staff()) with check (is_staff());
drop policy if exists invoice_lines_client_read on invoice_lines;
create policy invoice_lines_client_read on invoice_lines for select using (
  exists (select 1 from invoices i where i.id = invoice_id and i.client_id = my_client_id())
);

-- ── supplier, stock movement, admin tables: staff only ──────────────────────
drop policy if exists purchase_orders_staff on purchase_orders;
create policy purchase_orders_staff on purchase_orders for all using (is_staff()) with check (is_staff());
drop policy if exists po_lines_staff on po_lines;
create policy po_lines_staff on po_lines for all using (is_staff()) with check (is_staff());
drop policy if exists stock_transfers_staff on stock_transfers;
create policy stock_transfers_staff on stock_transfers for all using (is_staff()) with check (is_staff());
drop policy if exists stock_transfer_lines_staff on stock_transfer_lines;
create policy stock_transfer_lines_staff on stock_transfer_lines for all using (is_staff()) with check (is_staff());
drop policy if exists price_imports_staff on price_imports;
create policy price_imports_staff on price_imports for all using (is_staff()) with check (is_staff());
drop policy if exists import_templates_staff on import_templates;
create policy import_templates_staff on import_templates for all using (is_staff()) with check (is_staff());
drop policy if exists email_log_staff on email_log;
create policy email_log_staff on email_log for select using (is_staff());
drop policy if exists audit_log_staff on audit_log;
create policy audit_log_staff on audit_log for select using (is_staff());

drop policy if exists xero_connection_read on xero_connection;
create policy xero_connection_read on xero_connection for select
  using (is_admin() or my_role() = 'accounts');
drop policy if exists xero_connection_write on xero_connection;
create policy xero_connection_write on xero_connection for all
  using (is_admin() or my_role() = 'accounts')
  with check (is_admin() or my_role() = 'accounts');

-- Settings are readable by any signed-in user (the portal needs VAT rate and
-- company details) but only admin and accounts may change them.
drop policy if exists settings_read on settings;
create policy settings_read on settings for select using (auth.uid() is not null);
drop policy if exists settings_write on settings;
create policy settings_write on settings for update
  using (is_admin() or my_role() = 'accounts')
  with check (is_admin() or my_role() = 'accounts');

-- ── client-safe availability ────────────────────────────────────────────────
-- Returns a boolean and nothing more: no quantity, no per-location breakdown.
create or replace function public.product_in_stock(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stock_levels where product_id = p_product and qty > 0);
$$;

-- ── client catalogue view ───────────────────────────────────────────────────
-- What a client is allowed to know about availability: a boolean, never a
-- count, and never per-location. Security-invoker so tier_prices RLS still
-- restricts each client to their own tier.
drop view if exists client_catalogue;
create view client_catalogue
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.brand,
  tp.tier_id,
  tp.price,
  product_in_stock(p.id) as in_stock
from products p
join lateral (
  select tp2.tier_id, tp2.price
    from tier_prices tp2
   where tp2.product_id = p.id
     and tp2.effective_from <= current_date
   order by tp2.effective_from desc
   limit 1
) tp on true
where p.active;
