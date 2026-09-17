"""Pulls the manufactured size range out of a DRAG product page.

The size *options* on a listing are what Bulgaria has on the shelf — Ronin CF
7.0 offers L and XL there and is built in S through XXL. The geometry table
under the product is the range DRAG actually make, which is what a trade
catalogue has to offer, so that is what this reads.
"""
import re, json, sys, glob, os

SIZE = re.compile(r'^(XXS|XS|S|M|L|XL|XXL|XXXL|\d{3})$', re.I)

def sizes_from(html):
    # The geometry accordion is pasted-in Excel markup: the first row of the
    # table is "Size" followed by one cell per frame size.
    i = html.lower().find('>geometry')
    if i < 0: return []
    seg = html[i:i + 40000]
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', seg, re.S | re.I):
        cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c)).strip().replace('\xa0', '')
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S | re.I)]
        cells = [c for c in cells if c]
        if not cells or not re.fullmatch(r'size', cells[0], re.I): continue
        found = [c.upper() for c in cells[1:] if SIZE.fullmatch(c)]
        if found:
            # Dedupe keeping order: a geometry table sometimes repeats a header.
            seen, out = set(), []
            for s in found:
                if s not in seen: seen.add(s); out.append(s)
            return out
    return []

if __name__ == '__main__':
    out = {}
    for f in sorted(glob.glob('pages/*.html')):
        h = os.path.basename(f)[:-5]
        out[h] = sizes_from(open(f, encoding='utf-8', errors='replace').read())
    json.dump(out, open('geometry.json', 'w'), indent=1)
    got = {k: v for k, v in out.items() if v}
    print(f'{len(got)} of {len(out)} pages have a geometry table')
    for k, v in sorted(out.items()):
        print(f'  {k[:46]:46} {",".join(v) if v else "— none"}')
