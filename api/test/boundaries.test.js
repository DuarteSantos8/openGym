import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const importsOf = dir => fs.readdirSync(dir).filter(f => f.endsWith('.js')).flatMap(f =>
  [...fs.readFileSync(new URL(f, dir), 'utf8').matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map(m => ({ file: f, spec: m[1] })));

// api/engine is pure: it imports only its own files. Anything it needs from the catalogue, the
// Coach or storage is the caller's job to pass in (see the header of api/engine/index.js).
test('api/engine imports nothing from outside its own folder', () => {
  const offenders = importsOf(new URL('../engine/', import.meta.url))
    .filter(({ spec }) => !/^\.\/[^/]+$/.test(spec)).map(({ file, spec }) => `${file}: ${spec}`);
  assert.deepEqual(offenders, []);
});

// api/migration reaches only the engine; the exercise catalogue is a parameter, not an import.
test('api/migration imports only its own files and api/engine', () => {
  const offenders = importsOf(new URL('../migration/', import.meta.url))
    .filter(({ spec }) => !/^\.\/[^/]+$/.test(spec) && !/^\.\.\/engine\/[^/]+$/.test(spec)).map(({ file, spec }) => `${file}: ${spec}`);
  assert.deepEqual(offenders, []);
});
