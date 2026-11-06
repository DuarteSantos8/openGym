/* The api image carries only the files named on api/Dockerfile's COPY line (plus coach/). A
   root-level module that server.js imports and that line forgets is invisible to every test run
   from the source tree and shows up only when the published image boots — as
   ERR_MODULE_NOT_FOUND, on every instance that pulled it (oidc/ did that once). So the COPY lines are checked here, for
   server.js's own imports and for whatever those modules import from the api root in turn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(API, f), 'utf8');

// Every `./name.js` a file imports, statically or dynamically — root-level only; coach/ is
// copied as a whole directory.
const rootImports = src => [...src.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\/([^'"/]+\.js)['"]/g)].map(m => m[1]);

test('every root-level module server.js needs is on the Dockerfile COPY line', () => {
  const line = read('Dockerfile').split('\n').find(l => /^COPY\s+server\.js\b/.test(l));
  assert.ok(line, 'the COPY line that carries server.js');
  const copied = new Set(line.trim().split(/\s+/).slice(1, -1));

  const needed = new Set(['server.js']);
  const queue = ['server.js'];
  while (queue.length) {
    for (const dep of rootImports(read(queue.shift()))) {
      if (!needed.has(dep)) { needed.add(dep); queue.push(dep); }
    }
  }
  assert.ok(needed.has('media.js'), 'the walk finds the media store');
  const missing = [...needed].filter(f => !copied.has(f));
  assert.deepEqual(missing, [], `add ${missing.join(', ')} to the COPY line in api/Dockerfile`);
  for (const f of copied) assert.ok(fs.existsSync(path.join(API, f)), `${f} is copied but does not exist`);
});

test('the integrations directory is copied whole, like coach/', () => {
  const lines = read('Dockerfile').split('\n');
  assert.ok(lines.some(l => /^COPY\s+integrations\s+\.\/integrations\s*$/.test(l)), 'COPY integrations ./integrations in api/Dockerfile');
  assert.match(read('server.js'), /from '\.\/integrations\/index\.js'/);
});

// Every relative specifier a module imports, re-exports or loads with import('...').
const relImports = src => [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)].map(m => m[1]);

test('every local module and folder server.js reaches, at any depth, is copied into the image', () => {
  const lines = read('Dockerfile').split('\n');
  const files = new Set(lines.find(l => /^COPY\s+server\.js\b/.test(l)).trim().split(/\s+/).slice(1, -1));
  const dirs = new Set(lines.map(l => l.match(/^COPY\s+([\w-]+)\s+\.\/\1\/?\s*$/)?.[1]).filter(Boolean));

  const seen = new Set(['server.js']);
  const queue = ['server.js'];
  const outside = [];
  while (queue.length) {
    const file = queue.shift();
    for (const spec of relImports(read(file))) {
      const rel = path.relative(API, path.resolve(API, path.dirname(file), spec));
      if (rel.startsWith('..')) { outside.push(`${file} -> ${spec}`); continue; }
      if (seen.has(rel) || !fs.existsSync(path.join(API, rel))) continue;
      seen.add(rel);
      if (/\.m?js$/.test(rel)) queue.push(rel);
    }
  }
  assert.ok(seen.has('oidc/config.js') && seen.has('coach/jobs.js'), 'the walk reaches into the folders');
  assert.deepEqual(outside, [], 'the image only holds api/, so nothing may import from outside it');
  const missing = [...seen].filter(f => {
    const top = f.split(path.sep)[0];
    return top === f ? !files.has(f) : !dirs.has(top);
  });
  assert.deepEqual(missing, [], `copy these in api/Dockerfile: ${missing.join(', ')}`);
});
