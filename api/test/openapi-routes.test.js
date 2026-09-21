/* openapi.yaml says of itself: "Every route the server registers is documented here; if you add
   a route there, add it here too." Sixteen of them were not — the whole AI Coach surface, user
   and admin. Nothing was checking, so this does: the route table is one `'METHOD /path':` key per
   handler in two files, and the spec is one `get:`/`post:` under one path key, both of which can
   be read without a YAML parser (there is none in this package, by design).

   Plus the trap this test was written after: the doc generator renders the tags it knows and
   drops the rest in silence, so ten documented routes rendered nowhere at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(API, '..');
const read = f => fs.readFileSync(f, 'utf8');
const spec = read(path.join(API, 'openapi.yaml'));

/** Every `'GET /api/x': async (req, res)` key in the route table. */
const routeKeys = src => [...src.matchAll(/^\s*'(GET|POST|PUT|DELETE) (\/api\/[^']*)':/gm)].map(m => `${m[1]} ${m[2]}`);

/** Every operation under `paths:`, as "METHOD /path". */
function specOperations(yaml) {
  const out = [];
  let inPaths = false, current = null;
  for (const line of yaml.split('\n')) {
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^[a-zA-Z]/.test(line)) inPaths = false;     // the next top-level key ends it
    if (!inPaths) continue;
    const p = /^ {2}(\/[^:]*):/.exec(line);
    if (p) { current = p[1]; continue; }
    const m = /^ {4}(get|post|put|delete):/.exec(line);
    if (m && current) out.push(`${m[1].toUpperCase()} ${current}`);
  }
  return out;
}

test('every route the server registers is in openapi.yaml, and nothing else is', () => {
  const routes = new Set([
    ...routeKeys(read(path.join(API, 'server.js'))),
    ...routeKeys(read(path.join(API, 'coach', 'routes.js')))
  ]);
  const ops = new Set(specOperations(spec));
  assert.ok(routes.size > 40, `only found ${routes.size} routes — the route table moved`);

  assert.deepEqual([...routes].filter(r => !ops.has(r)).sort(), [], 'undocumented routes — add them to api/openapi.yaml');
  assert.deepEqual([...ops].filter(o => !routes.has(o)).sort(), [], 'documented routes the server does not serve');
  // The Coach surface in particular: this test exists because all sixteen were missing.
  for (const r of ['GET /api/coach/status', 'POST /api/coach/review', 'GET /api/admin/coach', 'POST /api/admin/coach/connect']) {
    assert.ok(ops.has(r), `${r} is missing from the spec`);
  }
});

test('every tag the spec uses is one the docs generator renders', () => {
  const declared = [...spec.matchAll(/^ {2}- name: (\S+)$/gm)].map(m => m[1]);
  const used = new Set([...spec.matchAll(/^ {6}tags: \[([^\]]+)\]/gm)].flatMap(m => m[1].split(',').map(s => s.trim())));
  for (const tag of used) assert.ok(declared.includes(tag), `tag "${tag}" is used but never declared under tags:`);

  // scripts/build-api-docs.mjs renders one section per entry in its own TAGS map and drops any
  // operation whose first tag is not in it — silently, which is how ten Coach routes went
  // missing from the published page while being perfectly well documented here.
  const docs = read(path.join(ROOT, 'scripts', 'build-api-docs.mjs'));
  const known = [.../const TAGS = \{([\s\S]*?)\n\}/.exec(docs)[1].matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  for (const tag of used) assert.ok(known.includes(tag), `tag "${tag}" renders nowhere — add it to TAGS in scripts/build-api-docs.mjs`);
});
