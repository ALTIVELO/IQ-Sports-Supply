-- ============================================================================
-- 0004: seed. Settings, tiers, fulfilment sites, and the sample catalogue and
-- client carried over from the prototype so the full loop can be walked
-- through end to end on a fresh database.
--
-- Invoice numbering continues from IQ-2026-001/002, already issued: next is 003.
-- ============================================================================

insert into settings (id) values (1) on conflict (id) do nothing;

insert into tiers (name, sort) values
  ('Distributor', 1), ('Shop', 2), ('Club', 3), ('Retail', 4)
on conflict (name) do nothing;

-- The four fulfilment sites. Addresses are left blank for the three that do
-- not share the registered office; fill them in on the Locations screen.
insert into locations (name, address) values
  ('Slough',      '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ'),
  ('Cornwall',    null),
  ('Maryport',    null),
  ('Glastonbury', null)
on conflict (name) do nothing;

-- ── sample catalogue ────────────────────────────────────────────────────────
insert into products (sku, name, brand) values
  ('BBR9100B',    'Shimano Dura-Ace BB-R9100 Bottom Bracket BSA',        'Shimano'),
  ('BPL05ARF25',  'Shimano Brake Pad L05A Resin w/ Fin',                 'Shimano'),
  ('BPB05SR25',   'Shimano Brake Pad B05S Resin',                        'Shimano'),
  ('FCR9200C26',  'Shimano Dura-Ace FC-R9200 Crankset 170mm 52-36',      'Shimano'),
  ('TP-AOPW-54',  'Tripeak AOPW Oversized Pulley Wheel 54T',             'Tripeak')
on conflict (sku) do nothing;

-- Prototype stock, held at the Slough site.
insert into stock_levels (product_id, location_id, qty)
select p.id, l.id, v.qty
  from (values ('BBR9100B', 0), ('BPL05ARF25', 6), ('BPB05SR25', 20),
               ('FCR9200C26', 2), ('TP-AOPW-54', 8)) as v(sku, qty)
  join products p on p.sku = v.sku
  cross join (select id from locations where name = 'Slough') l
on conflict (product_id, location_id) do nothing;

insert into tier_prices (product_id, tier_id, price, effective_from)
select p.id, t.id, v.price, current_date
  from (values
    ('BBR9100B',   'Distributor',  24.50), ('BBR9100B',   'Shop',  28.00),
    ('BBR9100B',   'Club',         31.50), ('BBR9100B',   'Retail', 39.99),
    ('BPL05ARF25', 'Distributor',  11.20), ('BPL05ARF25', 'Shop',  13.50),
    ('BPL05ARF25', 'Club',         15.00), ('BPL05ARF25', 'Retail', 19.99),
    ('BPB05SR25',  'Distributor',   5.40), ('BPB05SR25',  'Shop',   6.80),
    ('BPB05SR25',  'Club',          7.60), ('BPB05SR25',  'Retail',  9.99),
    ('FCR9200C26', 'Distributor', 428.00), ('FCR9200C26', 'Shop',  472.00),
    ('FCR9200C26', 'Club',        505.00), ('FCR9200C26', 'Retail', 599.99),
    ('TP-AOPW-54', 'Distributor', 189.00), ('TP-AOPW-54', 'Shop',  215.00),
    ('TP-AOPW-54', 'Club',        232.00), ('TP-AOPW-54', 'Retail', 279.00)
  ) as v(sku, tier, price)
  join products p on p.sku = v.sku
  join tiers t on t.name = v.tier
on conflict (product_id, tier_id, effective_from) do nothing;

insert into clients (name, tier_id, email, vat_no, address, default_location_id)
select 'MDI Ltd', t.id, 'dave@mikedixonimports.co.uk', '618 6837 06',
       'Unit 4 Wellington Point, Amy Johnson Way, Blackpool FY4 2RG', l.id
  from tiers t, locations l
 where t.name = 'Distributor' and l.name = 'Slough'
   and not exists (select 1 from clients where name = 'MDI Ltd');
