"""Product photos for the 2026 export list, from DRAG's own shop.

The export CSV carries no image data at all — Image Src is empty on all 147
rows — so the only place the photos exist is dragbicycles.com, where every
listing has several.

Matching is the same strict rule the sizes use, with one extra: where two rows
of the price list both match one listing, only the closer match takes its
photo. That is what stops "24 Hacker Lady" borrowing the photo of the unisex
24 Hacker, which is the one failure mode a wrong image actually has — a shop
ordering a three-thousand-euro bike from a picture of a different bike.

Shopify serves a resized copy from the same URL, so the width is capped here
rather than shipping a 3000px original to a 112px thumbnail.
"""
import json, sys

WIDTH = 900


def sized(url: str) -> str:
    """Shopify's CDN resizes on request. Its URLs already carry ?v=, so the
    width is appended rather than set."""
    return f'{url}{"&" if "?" in url else "?"}width={WIDTH}'


def build(products_json, match_json):
    products = json.load(open(products_json))
    match = json.load(open(match_json))

    # A listing claimed by two rows goes to whichever matched it more exactly.
    # Ties keep both: DRAG themselves list one product for the men's and
    # women's Grand Canyon, so one photo really is the photo for both.
    best = {}
    for title, m in match.items():
        n = len(m['diff'])
        if m['handle'] not in best or n < best[m['handle']]:
            best[m['handle']] = n

    out = {}
    for title, m in match.items():
        if len(m['diff']) > best[m['handle']]:
            continue
        images = next(
            (imgs for h in [m['handle'], *m.get('also', [])]
             if (imgs := products.get(h, {}).get('images'))),
            None)
        if not images:
            continue
        out[title] = {
            'image': sized(images[0]['src']),
            'site_title': m['site_title'],
            'of': len(images),
        }
    return out


if __name__ == '__main__':
    out = build(sys.argv[1] if len(sys.argv) > 1 else 'drag-products.json', 'match.json')
    json.dump(out, open('images.json', 'w'), indent=1)
    match = json.load(open('match.json'))
    print(f'{len(out)} of {len(match)} matched bikes have a photo')
    skipped = [t for t in match if t not in out]
    if skipped:
        print('\nno photo taken:')
        for t in sorted(skipped):
            print(f'  {t.strip()}')
