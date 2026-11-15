"""Consistency checks for openGym Next plan v2. Usage: check_plan.py v2.md [v1.md]"""
import re, sys
v2 = open(sys.argv[1], encoding='utf-8').read()
ok = True
def fail(msg):
    global ok; ok = False; print('FAIL:', msg)
# 1. task coverage
if len(sys.argv) > 2:
    v1 = open(sys.argv[2], encoding='utf-8').read()
    ids = set(re.findall(r'EP\d\d-T\d\d', v1))
    sec9 = v2.split('## 9.')[1].split('## 10.')[0]
    missing = sorted(i for i in ids if i not in sec9)
    print(f'v1 task ids: {len(ids)}; missing in section 9: {missing or "none"}')
    if missing: fail('uncovered tasks')
# 2. deps.yaml vs mermaid
y = re.search(r'```yaml\n# deps.yaml.*?\n(.*?)```', v2, re.S).group(1)
deps, ms = {}, {}
for e, m, d in re.findall(r'^(EP\d\d): \{m: (M\d), deps: \[([^\]]*)\]\}', y, re.M):
    deps[e] = {x.strip() for x in d.split(',') if x.strip()}; ms[e] = int(m[1])
yedges = {(a, b) for b, s in deps.items() for a in s}
mer = re.search(r'```mermaid\n(.*?)```', v2.split('## 8.')[1], re.S).group(1)
medges = {('EP' + a, 'EP' + b) for a, b in re.findall(r'E(\d\d) --> E(\d\d)', mer)}
print(f'yaml edges {len(yedges)}, mermaid edges {len(medges)}')
if yedges != medges: fail(f'only yaml {sorted(yedges-medges)} only mermaid {sorted(medges-yedges)}')
# 3. acyclic
seen, stack = set(), set()
def dfs(n):
    if n in stack: fail(f'cycle at {n}'); return
    if n in seen: return
    stack.add(n)
    for p in deps.get(n, ()): dfs(p)
    stack.discard(n); seen.add(n)
for n in deps: dfs(n)
# 4. milestone order
for e, s in deps.items():
    for p in s:
        if ms.get(p, 0) > ms[e]: fail(f'{e} ({ms[e]}) depends on later {p} ({ms[p]})')
print('epics in deps.yaml:', len(deps))
print('RESULT:', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
