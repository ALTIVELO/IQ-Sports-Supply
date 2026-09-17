# Frame sizes from dragbicycles.com

The 2026 export price list has one row per bike and says nothing about frame
sizes. A shop ordering a Storm 7.0 is ordering a size, so the catalogue needs
the range — and the only place it is written down is DRAG's own shop.

Three steps, each kept separate so the result can be checked before it is
believed:

    match.py      the price list's titles → a model on dragbicycles.com
    geometry.py   the size range out of a product page's geometry table
    sizes.py      the two together, into sizes.json

`sizes.json` is the output and the only thing `convert-shopify-export.mjs`
reads. It is committed because it is a judgement about which bike is which,
not a cache: regenerating it against a changed shop would silently change the
catalogue's size ranges, so it is reviewed when it changes.

## Why the matching is so strict

A wrong match puts a size range against a bike that is not that bike, and the
catalogue then offers a frame DRAG do not build. `match.py` therefore requires
the model words and the trim number to be identical, allowing only a named set
of differences the two catalogues genuinely spell differently (`TE`, `DB`,
`Man`/`Lady`, `G2`) and near-identical words (the shop has "Stearrato" where
the price list has "Sterrato"). 58 of 147 bikes match. The rest get no sizes
and import as one line each, which is the honest outcome — a size range nobody
can source is worse than none.

## Why geometry rather than the listing's own sizes

The size *options* on a listing are what Bulgaria has on the shelf: Ronin CF
7.0 offers L and XL there and is built in S through XXL. The geometry table
under each product is the range DRAG make, so that is preferred; where a page
has no geometry table the listing's options are used instead, and `sizes.json`
records which of the two each range came from.

## Re-running

    cd scripts/drag
    curl -s "https://www.dragbicycles.com/collections/bicycles/products.json?limit=250" \
      | python3 -c "import json,sys;print(json.dumps({p['handle']:p for p in json.load(sys.stdin)['products']}))" \
      > drag-bikes.json
    python3 match.py <price-list.csv>        # writes match.json, prints every match
    # fetch pages/<handle>.html for each matched handle, then:
    python3 geometry.py                      # writes geometry.json
    python3 sizes.py                         # writes sizes.json

Read the match table before trusting the output.
