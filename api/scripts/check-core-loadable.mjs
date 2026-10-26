#!/usr/bin/env node
/* Do api/coach/core/, api/engine/ and api/migration/ still load under plain node?
 *
 * All three are imported by two runtimes: the server under bare node, and the phone under Vite.
 * Vite forgives things node does not — `?raw`, `import.meta.glob`, JSON without an import
 * attribute — so a change made with the frontend in mind can leave vitest green and kill the
 * server at startup. mcp/scripts/check-node-loadable.mjs exists because exactly that happened
 * once. Run by bare `node` on purpose — being outside vitest IS the check.
 */
import { readdirSync } from 'node:fs';

const CORE = new URL('../coach/core/', import.meta.url);
const ENGINE = new URL('../engine/', import.meta.url);
const MIGRATION = new URL('../migration/', import.meta.url);
const js = dir => readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const modules = [
  ...js(CORE).map(f => ['core/' + f, new URL(f, CORE)]),
  ...js(new URL('adapters/', CORE)).map(f => ['core/adapters/' + f, new URL('adapters/' + f, CORE)]),
  ...js(ENGINE).map(f => ['engine/' + f, new URL(f, ENGINE)]),
  ...js(MIGRATION).map(f => ['migration/' + f, new URL(f, MIGRATION)]),
];

let failed = 0;
for (const [name, url] of modules) {
  try {
    await import(url);
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name} — ${e.message}`);
  }
}
// And the server's own use of it, which pulls the whole graph transitively.
try {
  await import(new URL('../coach/jobs.js', import.meta.url));
  console.log('  ok    jobs.js');
} catch (e) {
  failed++;
  console.error(`  FAIL  jobs.js — ${e.message}`);
}

if (failed) {
  console.error(`\n${failed} module(s) do not load under plain node — the api would not start.`);
  process.exit(1);
}
console.log('\napi/coach/core, api/engine and api/migration load under plain node.');
