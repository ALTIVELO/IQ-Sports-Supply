"""The size range to offer for each bike on the 2026 export list.

Two sources on dragbicycles.com, in this order:

  1. the geometry table under the product, which is the range DRAG build;
  2. failing that, the listing's own frame-size options, which is what Bulgaria
     has on the shelf and so can understate the range.

Anything with neither stays a single line, because inventing a size range for
a trade catalogue is how a customer ends up ordering a frame that is not made.
"""
import json, re
ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
LETTERS = set(ORDER)

def sort_key(s):
    return (0, ORDER.index(s)) if s in LETTERS else (1, int(s) if s.isdigit() else 0)

def options_for(product):
    for o in product.get('options', []):
        if o['name'].strip().lower() in ('frame size', 'size'):
            vals = []
            for v in o['values']:
                v = v.strip().upper().replace('М', 'M')   # Cyrillic М on one listing
                if v and v != 'DEFAULT TITLE': vals.append(v)
            return vals
    return []

def build():
    match = json.load(open('match.json'))
    geom = json.load(open('geometry.json'))
    bikes = json.load(open('drag-bikes.json'))
    out = {}
    for title, m in match.items():
        # Geometry across every equally-good listing first, then stock options
        # across every one: a size range on any copy of the bike is the range,
        # and a copy that happens to carry neither says nothing about it.
        for source, pick in (('geometry', lambda h: geom.get(h, [])),
                             ('stock listing', lambda h: options_for(bikes.get(h, {})))):
            for h in [m['handle'], *m.get('also', [])]:
                found = [s for s in pick(h) if s in LETTERS]
                if len(found) > 1:
                    out[title] = {
                        'sizes': sorted(set(found), key=sort_key),
                        'source': source,
                        'site_title': m['site_title'],
                        'handle': h,
                    }
                    break
            if title in out: break
    return out

if __name__ == '__main__':
    out = build()
    json.dump(out, open('sizes.json', 'w'), indent=1)
    print(f'{len(out)} models with a size range\n')
    for t, v in sorted(out.items()):
        print(f"  {t.strip()[:38]:38} {','.join(v['sizes']):22} ({v['source']})")
    print(f"\ntotal variant rows they expand to: {sum(len(v['sizes']) for v in out.values())}")
