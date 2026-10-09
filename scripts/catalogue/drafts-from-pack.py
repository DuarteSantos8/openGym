#!/usr/bin/env python3
"""Lists the exercises of the Gym visual pack that the catalogue does not have yet, from the pack's
FILE NAMES only (work/index.json), as work/drafts.json in the private archive:

    python3 -I scripts/catalogue/drafts-from-pack.py /path/to/opengym-media

Each draft carries the id, the drawing (male/female), a readable version of the file title and the
pack's category word. A female drawing whose title matches a male one becomes that exercise's
female variant instead of an exercise of its own, unless its id is already in the catalogue (ids
that shipped before stay what they were)."""
import json, os, re, sys

root = os.path.abspath(sys.argv[1])
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
known = {f[:-5] for f in os.listdir(os.path.join(repo, 'catalogue', 'exercises')) if f.endswith('.json')}
rows = json.load(open(os.path.join(root, 'work', 'index.json')))

def readable(title):
    t = (title or '').replace('---', ' - ').replace('-', ' ').replace('»', 'g')
    return re.sub(r'\s+', ' ', t).strip()

def key(title):
    t = (title or '').lower()
    t = re.sub(r'\((fe)?male\)|\b(fe)?male\b|-m$|_m$', '', t)
    return re.sub(r'[^a-z0-9]', '', t)

def category(bp):
    return re.sub(r'-(fix\d*|[as])$|-?fix\d*$', '', (bp or '').lower()).strip('-')

male_by_key = {}
for r in rows:
    if r['sex'] == 'male':
        male_by_key.setdefault(key(r['title']), r['gv'])

drafts, variants, taken = [], {}, set()
for r in sorted(rows, key=lambda r: (r['sex'] != 'male', r['gv'])):
    gv = r['gv']
    twin = male_by_key.get(key(r['title'])) if r['sex'] == 'female' else None
    if twin and gv not in known and twin not in taken:
        variants[twin] = gv
        taken.add(twin)
        continue
    if gv in known:
        continue
    drafts.append({'id': gv, 'sex': r['sex'], 'title': readable(r['title']), 'category': category(r['bp'])})

json.dump({'drafts': drafts, 'femaleVariants': variants}, open(os.path.join(root, 'work', 'drafts.json'), 'w'), indent=1)
print(len(drafts), 'drafts;', len(variants), 'female variants;', sum(d['sex'] == 'female' for d in drafts), 'female-only drafts')
