#!/usr/bin/env node
/* Does the server's import graph still load under plain node?
 *
 * This exists because the test suite cannot answer that question. `npm test` runs vitest, and
 * vitest resolves modules through Vite — `import.meta.glob`, `?raw`, a stray `.jsx` import all
 * work there. The server does not run under Vite. So a Vite-only import can land in a shared
 * lib module, leave all 33 tests green, and still kill the server at startup. That is exactly
 * what happened once: `history.js` began importing `t` from `i18n.js` (import.meta.glob over
 * the locale packs, plus React), and the server died on `import` with the suite none the wiser.
 *
 * Run by bare `node` on purpose — being outside vitest IS the check. Do not port this to a
 * vitest test file; that would make it pass unconditionally.
 *
 * Importing the two entry modules is enough on its own: everything the server touches hangs off
 * them, so a lib module that grows a browser-only dependency next year fails here without this
 * list being updated. The named list below only exists to point at the culprit instead of at a
 * stack trace ten frames deep.
 */
const LIB = new URL('../../frontend/src/lib/', import.meta.url)

// Every frontend/src/lib module the server reaches today. Named individually so a failure says
// which one, rather than which import chain.
const MODULES = [
  'i18n-core.js', 'format.js', 'exercises.js', 'exercises-data.js',
  'history.js', 'muscles.js', 'onerm.js'
]

let failed = 0
for (const m of MODULES) {
  try {
    await import(new URL(m, LIB))
    console.log(`  ok    ${m}`)
  } catch (e) {
    failed++
    console.error(`  FAIL  ${m} — ${e.message}`)
  }
}

// The real assertion: the server's own entry points, which pull the whole graph transitively.
// A module added to the graph later is covered by this even if the list above never learns it.
for (const entry of ['../src/state.js', '../src/tools.js']) {
  try {
    await import(new URL(entry, import.meta.url))
    console.log(`  ok    mcp/${entry.replace('../', '')}`)
  } catch (e) {
    failed++
    console.error(`  FAIL  mcp/${entry.replace('../', '')} — ${e.message}`)
  }
}

if (failed) {
  console.error(`\n${failed} module(s) do not load under plain node — the MCP server would not start.`)
  process.exit(1)
}
console.log('\nthe whole MCP import graph loads under plain node.')
