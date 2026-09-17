"""Matches the 2026 export price list to models on dragbicycles.com.

Deliberately strict. A wrong match puts a size range against a bike that is
not that bike, and the catalogue then offers a customer a frame DRAG does not
build — which is worse than offering no size at all.
"""
import json, csv, re, difflib, sys
BRAND = {'drag', 'bicycle', 'bike'}
# Words the two catalogues spell differently for the same bike: build detail,
# generation markers and the gendered names the export list still uses.
SOFT = {'te','db','rb','sl','disk','disc','brake','man','lady','gent','uni',
        'mullet','trail','g2','g3','comp'}
MAX_SOFT = 2

def parse(title):
    t = title.lower().replace('"',' ').replace('”',' ').replace('ТЕ','te').replace('\n',' ')
    t = t.replace('gen.3','g3').replace('gen. 2','g2').replace('gen.2','g2').replace('gen2','g2')
    t = re.sub(r'[^a-z0-9./]+',' ',t)
    words, trims, wheels = set(), set(), set()
    for tok in t.split():
        tok = tok.strip('.')
        if not tok: continue
        if re.fullmatch(r'\d+(\.\d)?(/\d+(\.\d)?)*', tok):
            if float(tok.split('/')[0]) >= 14: wheels |= set(tok.split('/'))
            else: trims.add(tok)
        elif tok not in BRAND:
            words.add(tok)
    return words, trims, wheels

def align(a, b):
    """Symmetric difference, treating a near-identical word as the same word.
    The site has 'Stearrato' where the price list has 'Sterrato'."""
    a, b = set(a), set(b)
    for x in list(a - b):
        near = difflib.get_close_matches(x, list(b - a), n=1, cutoff=0.85)
        if near: a.discard(x); b.discard(near[0])
    return a ^ b

def build(site_json, price_csv):
    ps = json.load(open(site_json))
    site = [(h, p, *parse(p['title'])) for h, p in ps.items()]
    rows = list(csv.DictReader(open(price_csv, encoding='utf-8-sig')))
    out = {}
    for r in rows:
        w, tr, wh = parse(r['Title'])
        hits = []
        for h, p, sw, str_, swh in site:
            if wh and swh and not (wh & swh): continue
            if tr and str_ and tr != str_: continue
            d = align(w, sw)
            if d - SOFT or len(d) > MAX_SOFT: continue
            hits.append((len(d) + (0 if tr == str_ else 2), h, p['title'], sorted(d)))
        if hits:
            hits.sort()
            out[r['Title']] = {'handle': hits[0][1], 'site_title': hits[0][2], 'diff': hits[0][3]}
    return rows, out

if __name__ == '__main__':
    rows, out = build('drag-bikes.json', sys.argv[1])
    print(f'matched {len(out)} of {len(rows)}')
    for t, m in sorted(out.items()):
        print(f"  {t.strip()[:40]:40} → {m['site_title'][:42]:42} {m['diff'] or ''}")
    json.dump(out, open('match.json','w'), indent=1)
