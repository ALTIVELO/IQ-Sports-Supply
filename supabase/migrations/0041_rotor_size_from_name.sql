-- ============================================================================
-- 0041: a rotor's size is written on it now, so read that.
--
-- spec_value(name, 'Rotor size') decodes a Shimano part number found inside a
-- product name: RTCL900SI is a 160mm, RTCL900SSI a 140mm. That was the right
-- reader when it was written, because the converter could not decode a rotor
-- and named them "Shimano Disc Rotor RTCL900SI" — the part number, for want of
-- anything better.
--
-- 0036 taught the rebuild to read a rotor properly, and they have been called
-- "Dura-Ace RT-CL900 Disc Rotor 160mm (I)" ever since. The part number in that
-- is hyphenated, so the reader cannot see it, and the size is in plain words
-- it never learned to look at. It has returned null for every rotor in the
-- catalogue since that day.
--
-- Nothing showed it, because the builder's options were seeded once and never
-- re-checked. 0040 made them re-check after every import — which is correct,
-- and which turned a reader that quietly returned null into two rotor steps
-- with nothing on them. The fault is this function's; 0040 only stopped
-- hiding it.
-- ============================================================================

create or replace function public.spec_value(p_name text, p_axis text)
returns text language sql immutable as $$
  select case p_axis
    when 'Crank length' then
      nullif(regexp_replace(substring(p_name from '(\d{3}(?:\.\d)?)\s*mm'), '\s', '', 'g'), '') || 'mm'
    when 'Chainring' then
      replace(replace(substring(p_name from '(\d{2}\s*[/-]\s*\d{2})'), ' ', ''), '-', '/')
    when 'Cassette' then
      replace(substring(p_name from '(\d{2}\s*-\s*\d{2}\s*T)'), ' ', '')
    when 'Wire length' then
      substring(p_name from '(\d{3,4})\s*mm') || 'mm'
    when 'Length' then
      -- Two to four digits and an optional decimal: 90mm, 172.5mm, 1000mm.
      nullif(regexp_replace(substring(p_name from '(\d{2,4}(?:\.\d+)?)\s*mm'),
                            '\s', '', 'g'), '') || 'mm'
    when 'Rotor size' then
      coalesce(
        -- What the name says, which is what it says now. Three digits covers
        -- every rotor Shimano make: 140, 160, 180, 200, 203, 220.
        substring(p_name from '(\d{3})\s*mm') || 'mm',
        -- And the part number, for the names written before a rotor could be
        -- read. Kept rather than replaced: a catalogue imported years ago
        -- still holds them, and a step that stopped recognising those would
        -- empty itself exactly as this one did.
        substring(p_name from '(?:RTCL|SMRT)\d+(200|220)') || 'mm',
        case substring(p_name from '(?:RTCL|SMRT)\d+(SS|S|M|L)')
          when 'SS' then '140mm'
          when 'S'  then '160mm'
          when 'M'  then '180mm'
          when 'L'  then '203mm'
        end)
    else null
  end;
$$;

-- Put them back. Every step that carries a rule is filled again from the
-- catalogue as it stands, which is what an import would have done — except
-- that nobody should have to run an import to get their rotors back.
select refresh_group_options();
