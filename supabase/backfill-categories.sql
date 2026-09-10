-- ============================================================================
-- Optional. Categorises products already in the catalogue.
--
-- The app does this on the Catalogue screen ("Categorise from descriptions"),
-- using the full rule set in src/lib/catalogue/categories.ts. This file covers
-- the common cases only, for when you would rather do it in SQL.
--
-- Only ever fills a blank — a category set by hand is never overwritten.
-- ============================================================================

update products p set category_id = c.id
  from categories c
 where p.category_id is null
   and c.slug = case
     -- Compound terms first: a chain whip is a tool, a brake cable is a cable.
     when p.name ~* '\mchain\s*(whip|tool|breaker)\M'        then 'tools'
     when p.name ~* '\m(brake|gear|shift)\s*cable\M'         then 'cables'
     when p.name ~* '\mchain\s*(lube|oil|wax|degreaser)\M'   then 'lubricants'
     when p.name ~* '\mbrake\s*pads?\M'                      then 'brake-pads'
     when p.name ~* '\mrotors?\M'                            then 'rotors'
     when p.name ~* '\m(pulley|jockey)\s*wheels?\M'          then 'pulleys'
     when p.name ~* '\mchain\s*rings?\M'                     then 'chainrings'
     when p.name ~* '\m(chain|crank)\s*sets?\M'              then 'chainsets'
     when p.name ~* '\mcranks?\M'                            then 'chainsets'
     when p.name ~* '\mcassettes?\M'                         then 'cassettes'
     when p.name ~* '\mderailleurs?\M'                       then 'derailleurs'
     when p.name ~* '\mshifters?\M'                          then 'shifters'
     when p.name ~* '\mbottom\s*brackets?\M'                 then 'bottom-brackets'
     when p.name ~* '\m(caliper|callipers?|brake\s*levers?)\M' then 'brakes'
     when p.name ~* '\mbrakes?\M'                            then 'brakes'
     when p.name ~* '\mchains?\M'                            then 'chains'
     when p.name ~* '\mheadsets?\M'                          then 'headsets'
     when p.name ~* '\mbearings?\M'                          then 'bearings'
     when p.name ~* '\mhubs?\M'                              then 'hubs'
     when p.name ~* '\m(wheel\s*sets?|wheels?|rims?)\M'      then 'wheels'
     when p.name ~* '\minner\s*tubes?\M'                     then 'tubes'
     when p.name ~* '\mty[re]es?\M|\mtires?\M'               then 'tyres'
     when p.name ~* '\mpedals?\M'                            then 'pedals'
     when p.name ~* '\m(handle\s*bars?|bar\s*tape)\M'        then 'handlebars'
     when p.name ~* '\mstems?\M'                             then 'stems'
     when p.name ~* '\mseat\s*posts?\M'                      then 'seatposts'
     when p.name ~* '\msaddles?\M'                           then 'saddles'
     when p.name ~* '\mtools?\M'                             then 'tools'
   end;

select coalesce(c.name, '— uncategorised —') as category, count(*) as products
  from products p left join categories c on c.id = p.category_id
 where p.active
 group by c.name, c.sort
 order by c.sort nulls last;
