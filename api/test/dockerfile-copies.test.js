/* The api image copies its files one by one (api/Dockerfile), so a new module that server.js
 * imports but the Dockerfile leaves out builds fine and then crashes the container at start:
 * the source-tree tests never notice. This walks every relative import reachable from server.js
 * and checks each file is inside something the Dockerfile copies. (CI's images job caught
 * exactly this: api/addons/ was imported but never copied.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What the Dockerfile copies from the build context (api/), as paths relative to it. */
export function copiedPaths(dockerfile) {
  const out = [];
  for (const line of dockerfile.split('\n')) {
    const m = /^\s*COPY\s+(?!--from)(.+)$/i.exec(line);
    if (!m) continue;
    const args = m[1].trim().split(/\s+/).filter(a => !a.startsWith('--'));
    args.pop(); // the destination
    for (const a of args) out.push(a.replace(/^\.\//, '').replace(/\/$/, ''));
  }
  return out;
}

/** Every file reachable from `entry` through relative imports, relative to API. */
export function reachable(entry) {
  const seen = new Set();
  const visit = file => {
    const rel = path.relative(API, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^\s*import\s+['"](\.[^'"]+)['"]/gm;
    for (const m of src.matchAll(re)) {
      const spec = m[1] || m[2] || m[3];
      const target = path.resolve(path.dirname(file), spec);
      // Only what lives inside api/ ships in this image (../frontend imports are the phone build's).
      if (!target.startsWith(API + path.sep)) continue;
      if (fs.existsSync(target) && fs.statSync(target).isFile()) visit(target);
    }
  };
  visit(entry);
  return [...seen];
}

const inside = (file, copied) => copied.some(c => c === '.' || file === c || file.startsWith(c + '/'));

test('every module server.js reaches is copied into the api image', () => {
  const copied = copiedPaths(fs.readFileSync(path.join(API, 'Dockerfile'), 'utf8'));
  const files = reachable(path.join(API, 'server.js'));
  assert.ok(files.length > 20, 'the walk found the server\'s modules');
  const missing = files.filter(f => !inside(f, copied));
  assert.deepEqual(missing, [], 'imported by server.js but not copied by api/Dockerfile: ' + missing.join(', '));
});

test('the checker itself: a COPY list and an import graph are read as written', () => {
  assert.deepEqual(copiedPaths('FROM x\nCOPY package.json package-lock.json* ./\nCOPY a.js b.js ./\nCOPY coach ./coach\nCOPY --from=build /x /y\n'),
    ['package.json', 'package-lock.json*', 'a.js', 'b.js', 'coach']);
  assert.equal(inside('coach/core/x.js', ['coach']), true);
  assert.equal(inside('coachx/y.js', ['coach']), false);
  assert.equal(inside('addons/food.js', ['server.js', 'coach']), false);
});
