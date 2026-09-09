#!/usr/bin/env node
/* Does api/coach/core/ still load under plain node?
 *
 * The core is imported by two runtimes: the server under bare node, and the phone under Vite.
 * Vite forgives things node does not — `?raw`, `import.meta.glob`, JSON without an import
 * attribute — so a change made with the frontend in mind can leave vitest green and kill the
 * server at startup. mcp/scripts/check-node-loadable.mjs exists because exactly that happened
 * once. Run by bare `node` on purpose — being outside vitest IS the check.
 */
import { readdirSync } from 'node:fs';

const CORE = new URL('../coach/core/', import.meta.url);
const files = readdirSync(CORE).filter(f => f.endsWith('.js')).sort();
const adapters = readdirSync(new URL('adapters/', CORE)).filter(f => f.endsWith('.js')).sort().map(f => 'adapters/' + f);

let failed = 0;
for (const m of [...files, ...adapters]) {
  try {
    await import(new URL(m, CORE));
    console.log(`  ok    core/${m}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  core/${m} — ${e.message}`);
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
console.log('\napi/coach/core loads under plain node.');
