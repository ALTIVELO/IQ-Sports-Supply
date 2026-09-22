-- ============================================================================
-- 0029: ask for the price in force, not for every price there has ever been.
--
-- Two screens — the staff catalogue and the order desk — read the whole of
-- tier_prices, sort it by date and keep the first row they see for each
-- product and tier. That works only while the whole table fits in one
-- response, and PostgREST caps a response at a thousand rows by default.
--
-- It fitted for a year. Then one import added a few hundred products across
-- four tiers, all dated the same day, and those rows — being the newest —
-- filled the entire response on their own. Every older price fell off the end,
-- so the catalogue showed a dash in every tier column and the order desk said
-- there was no price. Nothing had been deleted; the rows were simply never
-- asked for. Costs kept working because there is one cost row per product
-- rather than one per tier, so that table was still under the cap — which is
-- exactly why the screens looked like they had lost only the selling prices.
--
-- The fix is to stop shipping history to the browser at all. These return one
-- row per product per tier: the price in force on a date, already chosen. The
-- caller asks about the products it is showing, so the answer is bounded by
-- what is on screen instead of by how long we have been trading.
--
-- Both are SECURITY INVOKER on purpose. tier_prices already restricts a client
-- to their own tier and product_costs to staff, and a definer function here
-- would quietly hand every tier's price to anyone who called it.
-- ============================================================================

/**
 * The price each tier pays for these products, as at a date.
 *
 * DISTINCT ON does in one pass what the screens were doing by sorting the
 * whole table and keeping the first row of each group — except the database
 * has the index for it and returns one row instead of fifteen.
 *
 * A product with no price on a tier has no row here. That is the honest
 * answer: it has no price on that tier, which is not the same as a price of
 * zero, and the screens now say so.
 */
-- Dropped first rather than replaced. A later migration widens what these
-- return, and setup.sql is one file replayed from the top: on the second run
-- this statement meets a function of that wider shape, and CREATE OR REPLACE
-- cannot change a return type. Dropping is a no-op on a fresh database and
-- makes a re-run behave like a first run, which is what the file promises.
drop function if exists public.current_tier_prices(uuid[], date);
create function public.current_tier_prices(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, tier_id uuid, price numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (tp.product_id, tp.tier_id)
         tp.product_id, tp.tier_id, tp.price
    from tier_prices tp
   where tp.product_id = any(p_products)
     and tp.effective_from <= p_on
   order by tp.product_id, tp.tier_id, tp.effective_from desc;
$$;

/** What these products cost us, as at a date. Staff only, by RLS. */
drop function if exists public.current_costs(uuid[], date);
create function public.current_costs(
  p_products uuid[], p_on date default current_date
)
returns table (product_id uuid, cost numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on (pc.product_id)
         pc.product_id, pc.cost
    from product_costs pc
   where pc.product_id = any(p_products)
     and pc.effective_from <= p_on
   order by pc.product_id, pc.effective_from desc;
$$;

-- The lookup both of them lean on. Without it this is a sequential scan of
-- every price we have ever set, once per screen.
create index if not exists tier_prices_current_idx
  on tier_prices (product_id, tier_id, effective_from desc);
create index if not exists product_costs_current_idx
  on product_costs (product_id, effective_from desc);
