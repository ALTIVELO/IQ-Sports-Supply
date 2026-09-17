# Frame sizes from dragbicycles.com

The 2026 export price list has one row per bike and says nothing about frame
sizes. A shop ordering a Storm 7.0 is ordering a size, so the catalogue needs
the range — and the only place it is written down is DRAG's own shop.

The photos are the same story. `Image Src` is empty on all 147 rows of the
export, so the only place the pictures exist is the same shop.

Four steps, each kept separate so the result can be checked before it is
believed:

    match.py      the price list's titles → a model on dragbicycles.com
    geometry.py   the size range out of a product page's geometry table
    sizes.py      the two together, into sizes.json
    images.py     the first photo of each matched listing, into images.json

`sizes.json` and `images.json` are the outputs and the only things
`convert-shopify-export.mjs` reads. They are committed because they are a
judgement about which bike is which, not a cache: regenerating them against a
changed shop would silently change the catalogue's size ranges and photos, so
they are reviewed when they change.

## Why the matching is so strict

A wrong match puts a size range against a bike that is not that bike, and the
catalogue then offers a frame DRAG do not build. `match.py` therefore requires
the model words and the trim number to be identical, allowing only a named set
of differences the two catalogues genuinely spell differently (`TE`, `DB`,
`Man`/`Lady`, `G2`) and near-identical words (the shop has "Stearrato" where
the price list has "Sterrato"). 81 of 147 bikes match; 47 of those turn out to
have a size range and 80 have a photo. The rest get neither and import as one
line each, which is the honest outcome — a size range nobody can source is
worse than none, and a photo of the wrong bike is worse than no photo.

One extra rule applies to photos only. Where two rows of the price list both
match one listing, only the closer match takes its picture: that is what stops
"24 Hacker Lady" borrowing the photo of the unisex 24 Hacker. A tie keeps
both, because DRAG themselves list one product for the men's and women's Grand
Canyon, so one photo really is the photo for both.

A listing is often duplicated on the shop — once with the wheel size in the
title, once without — so `match.py` keeps every equally-good candidate in
`also`, and the steps that want a size range or a photo take the first
candidate that has one. Without that, the copy that happens to win on
alphabetical order is sometimes the empty one.

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
    # fetch pages/<handle>.html for each handle in match.json, then:
    python3 geometry.py                      # writes geometry.json
    python3 sizes.py                         # writes sizes.json
    python3 images.py                        # writes images.json

Read the match table before trusting the output.

`match.py` is run against the whole catalogue scrape rather than the bicycles
collection: 23 bikes — most of the kids' range — are filed elsewhere on the
shop and are only found that way.
