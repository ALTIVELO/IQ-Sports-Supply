-- ============================================================================
-- 0008: collections become two levels.
--
-- The catalogue started as componentry only, so a flat list of part types was
-- enough. It now has to carry complete bicycles, frames, helmets, clothing,
-- accessories and workshop tools as well, and twenty-seven part types sitting
-- alongside "Clothing" as equals reads as noise.
--
-- So: a group holds collections, and a collection holds products. A product may
-- also attach directly to a group — "Helmet" with no further detail is a real
-- description, and it is better filed under Helmets than forced into a
-- sub-type the text does not support.
-- ============================================================================

alter table categories add column if not exists parent_id uuid references categories(id);
create index if not exists categories_parent_idx on categories (parent_id, sort);

-- 'tools' becomes the group name, so the existing part-type leaf of that name
-- is renamed. Products reference categories by id, so nothing is detached.
update categories set slug = 'workshop-tools', name = 'Workshop tools'
 where slug = 'tools' and parent_id is null
   and not exists (select 1 from categories c2 where c2.slug = 'workshop-tools');

-- ── groups ──────────────────────────────────────────────────────────────────
insert into categories (slug, name, sort) values
  ('bicycles',    'Complete bicycles', 10),
  ('frames',      'Frames & forks',    20),
  ('components',  'Bike parts',        30),
  ('wheelsets',   'Wheels & tyres',    40),
  ('clothing',    'Clothing',          50),
  ('helmets',     'Helmets',           60),
  ('accessories', 'Accessories',       70),
  ('tools',       'Tools & workshop',  80)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- ── new collections ─────────────────────────────────────────────────────────
insert into categories (slug, name, sort) values
  ('road-bikes',      'Road',              10),
  ('gravel-bikes',    'Gravel & cyclocross',20),
  ('mountain-bikes',  'Mountain',          30),
  ('e-bikes',         'Electric',          40),
  ('hybrid-bikes',    'Hybrid & urban',    50),
  ('kids-bikes',      'Kids',              60),
  ('track-bikes',     'Track & TT',        70),

  ('road-frames',     'Road frames',       10),
  ('gravel-frames',   'Gravel frames',     20),
  ('mountain-frames', 'Mountain frames',   30),
  ('forks',           'Forks',             40),

  ('road-helmets',    'Road helmets',      10),
  ('mtb-helmets',     'Mountain helmets',  20),
  ('aero-helmets',    'Aero & TT helmets', 30),
  ('kids-helmets',    'Kids helmets',      40),

  ('jerseys',         'Jerseys',           10),
  ('shorts',          'Shorts & bibs',     20),
  ('jackets',         'Jackets & gilets',  30),
  ('base-layers',     'Base layers',       40),
  ('gloves',          'Gloves',            50),
  ('socks',           'Socks',             60),
  ('shoes',           'Shoes',             70),
  ('eyewear',         'Eyewear',           80),

  ('bottles',         'Bottles & cages',   10),
  ('lights',          'Lights',            20),
  ('computers',       'Computers & sensors',30),
  ('pumps',           'Pumps & inflation', 40),
  ('locks',           'Locks',             50),
  ('luggage',         'Bags & luggage',    60),
  ('mudguards',       'Mudguards & racks', 70),

  ('torque-tools',    'Torque tools',      20),
  ('bleed-kits',      'Bleed kits',        30),
  ('wheel-tools',     'Wheel & spoke tools',40)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

-- ── parenting ───────────────────────────────────────────────────────────────
-- Everything that was a flat part type becomes a child of Bike parts, except
-- the few that belong to another group now that those groups exist.
update categories child
   set parent_id = parent.id
  from categories parent
 where parent.slug = 'components'
   and child.parent_id is null
   and child.slug in (
     'brake-pads','rotors','brakes','chains','chainsets','chainrings','cassettes',
     'derailleurs','shifters','bottom-brackets','pulleys','bearings','headsets',
     'hubs','pedals','handlebars','stems','seatposts','saddles','cables',
     'electronics','power-meters','groupsets');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'wheelsets' and child.parent_id is null
   and child.slug in ('wheels','spokes','tyres','tubes');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'tools' and child.parent_id is null
   and child.slug in ('workshop-tools','torque-tools','bleed-kits','wheel-tools','lubricants');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'bicycles' and child.parent_id is null
   and child.slug in ('road-bikes','gravel-bikes','mountain-bikes','e-bikes',
                      'hybrid-bikes','kids-bikes','track-bikes');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'frames' and child.parent_id is null
   and child.slug in ('road-frames','gravel-frames','mountain-frames','forks');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'helmets' and child.parent_id is null
   and child.slug in ('road-helmets','mtb-helmets','aero-helmets','kids-helmets');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'clothing' and child.parent_id is null
   and child.slug in ('jerseys','shorts','jackets','base-layers','gloves',
                      'socks','shoes','eyewear');

update categories child set parent_id = parent.id from categories parent
 where parent.slug = 'accessories' and child.parent_id is null
   and child.slug in ('bottles','lights','computers','pumps','locks',
                      'luggage','mudguards');

-- No category may be its own parent, and a group must not be parented.
update categories set parent_id = null where parent_id = id;
