#!/usr/bin/env python3
"""Stand-in fonts for the Connect IQ simulator on a machine without Garmin's font pack.

The SDK Manager downloads the device files and, separately, the fonts (~/.Garmin/ConnectIQ/Fonts).
Without the fonts the simulator crashes as soon as an app draws text. AMOLED watches use plain
Roboto TTFs (open, Apache 2.0: drop them into the Fonts folder and they render as on the watch).
MIP watches use Garmin's bitmap fonts (FNT_*.cft); this script points those at Roboto TTFs of the
same line height, taken from the SDK's own Device Reference (doc/docs/Device_Reference/<id>.html,
"Fonts": face and height per font). Close, not exact: widths of Garmin's bitmap cuts differ a little,
so treat a line within a few pixels of the edge as a risk. With the real font pack, skip this.

  patch-fonts.py <sdk> <devices dir> <device id>...   (keeps simulator.json.orig, idempotent)
"""
import html, json, os, re, shutil, sys

CAP = 0.711      # Roboto cap height per em: Garmin's bitmap font names carry the cap height in px
LINE = 1.172     # Roboto line height per em (hhea ascender 1900 + descender 500, per 2048)
ASC = 1900 / 2400

def doc_table(sdk, dev):
    p = os.path.join(sdk, 'doc', 'docs', 'Device_Reference', dev + '.html')
    if not os.path.exists(p):
        return {}
    t = re.sub(r'<[^>]+>', '|', open(p, encoding='utf-8').read())
    t = re.sub(r'\|[\s|]*', '|', html.unescape(t))
    i = t.find('|Fonts|Font Symbol|Font Face|Font Size|Font|')
    if i < 0:
        return {}
    seg = t[i:].split('|')[6:]
    out, k = {}, 0
    while k + 3 < len(seg) and seg[k].startswith('FONT_'):
        out[seg[k + 3]] = (seg[k + 1], int(seg[k + 2]))
        k += 4
    return out

def ttf_for(face, fname):
    f = (face or '').lower()
    n = fname.upper()
    if 'black' in f or 'BLACK' in n:
        return 'Roboto-Black'
    cond = 'condensed' in f or 'CONDENSED' in n or 'CDPG' in n or '_BC_' in n or 'bebas' in f
    m = re.search(r'_(\d+)([BM]?)$', n)
    weight = m.group(2) if m else ''
    if 'bebas' in f or '_BC_' in n or 'GARMIN' in n:
        weight = 'B'
    if cond:
        return {'B': 'RobotoCondensed-Bold', 'M': 'RobotoCondensed-Medium'}.get(weight, 'RobotoCondensed-Regular')
    return {'B': 'Roboto-Bold', 'M': 'Roboto-Medium'}.get(weight, 'Roboto-Regular')

def stand_in(entry, table, ppi):
    fname = entry['filename']
    face, height = table.get(fname[4:] if fname.startswith('FNT_') else fname, (None, None))
    m = re.search(r'_(\d+)[BM]?$', fname)
    if m:
        em = int(m.group(1)) / CAP
    elif height:
        em = height / LINE
    else:
        em = 30 / LINE
    if not height:
        height = round(em * LINE)
    asc = round(height * ASC)
    return {'name': entry['name'], 'filename': ttf_for(face, fname), 'type': 'ttf', 'size': round(em * 72 / ppi, 4),
            'height': height, 'ascent': asc, 'descent': height - asc}

def main():
    sdk, devdir, devs = sys.argv[1], sys.argv[2], sys.argv[3:]
    for dev in devs:
        p = os.path.join(devdir, dev, 'simulator.json')
        orig = p + '.orig'
        if not os.path.exists(orig):
            shutil.copy2(p, orig)
        j = json.load(open(orig))
        table = doc_table(sdk, dev)
        # TTF sizes are points at the device's ppi; a watch without one gets 72 (points = pixels)
        ppi = j.get('ppi') or 72
        changed = 0
        for fs in j.get('fonts', []):
            new = []
            for e in fs['fonts']:
                if e.get('type') in ('ttf', 'system_ttf') or ' ' in e['filename']:
                    new.append(e)
                else:
                    new.append(stand_in(e, table, ppi)); changed += 1
            fs['fonts'] = new
        if changed and not j.get('ppi'):
            j['ppi'] = 72
        json.dump(j, open(p, 'w'), indent=4)
        print(f'{dev}: {changed} bitmap fonts -> Roboto stand-ins' if changed else f'{dev}: TTF fonts, unchanged')

main()
