-- ============================================================================
-- 0044: the builds carry the number of the groupset they actually are.
--
-- They have been named for the series — R9200, R8100, R7100 — since the first
-- one was seeded. A series covers rim and disc, mechanical and Di2, and every
-- build here is one corner of it: the hydraulic disc Di2 groupset, specced
-- around ST-R9270 shifters and BR-R9270 callipers and their equivalents. That
-- corner has its own number and the trade uses it, which is why the shifters,
-- the callipers and the hoses on these builds are all numbered R9270, R8170
-- and R7170 while the page above them said R9200.
--
-- So the name says what it is. The slugs are left alone deliberately: they are
-- in the address of every builder page and in anything anybody has bookmarked
-- or sent to a customer, and a link that stops working is a worse trade than
-- a tidy URL.
--
-- GRX is untouched. It was already named for its shifter, ST-RX825.
-- ============================================================================

do $$
declare
  renames constant text[][] := array[
    ['dura-ace-r9200',       'Dura-Ace Di2 R9270 groupset'],
    ['dura-ace-r9200-power', 'Dura-Ace Di2 R9270 groupset with power meter'],
    ['ultegra-r8100',        'Ultegra Di2 R8170 groupset'],
    ['ultegra-r8100-power',  'Ultegra Di2 R8170 groupset with power meter'],
    ['105-di2-r7100',        '105 Di2 R7170 groupset']
  ];
  r text[];
  hit integer;
  total integer := 0;
begin
  foreach r slice 1 in array renames loop
    update product_groups set name = r[2] where slug = r[1];
    get diagnostics hit = row_count;
    /*
     * A rename that matches nothing is the quiet failure worth guarding: the
     * migration succeeds, the page keeps the old name, and nobody finds out
     * until somebody reads the screen.
     */
    if hit <> 1 then
      raise exception 'Renaming % matched % rows, expected 1', r[1], hit;
    end if;
    total := total + hit;
  end loop;
  raise notice 'renamed % groupset builds', total;
end $$;
