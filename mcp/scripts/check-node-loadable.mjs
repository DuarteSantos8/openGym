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
  'history.js', 'muscles.js', 'onerm.js', 'progression.js', 'queue.js',
  'import-csv.js', 'log-workout.js', 'finish-workout.js', 'dumbbells.js', 'backfill.js', 'workout-date.js', 'sync-merge.js',
  'routine-write.js', 'routines.js'
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
let tools = null
let seed = null
for (const entry of ['../src/state.js', '../src/tools.js', '../src/write-tools.js', '../src/routine-tools.js', '../src/server.js', '../src/remote.js', '../src/http.js']) {
  try {
    const m = await import(new URL(entry, import.meta.url))
    if (m.TOOLS) tools = m.TOOLS
    if (m._seedStateForTests) seed = m._seedStateForTests
    console.log(`  ok    mcp/${entry.replace('../', '')}`)
  } catch (e) {
    failed++
    console.error(`  FAIL  mcp/${entry.replace('../', '')} — ${e.message}`)
  }
}

// Importing is not running. A lib module can import cleanly under plain node and still reach a
// Vite-only or browser-only path the first time a handler asks it for something (i18n's t() is
// the shape that bit us before, and it is called, not imported). So call one handler for real.
if (tools && seed) {
  try {
    seed({
      unit: 'kg', routines: [{ id: 'r1', name: 'Check', ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 8, weight: 50 }] }],
      week: {}, dayPlan: {}, exWeights: {}, customEx: [], bodyweight: [],
      workouts: [{ id: 'w1', d: '2026-01-02', start: 1, end: 2, name: 'Check', routineId: 'r1', entries: [{ id: '0025', target: { id: '0025', sets: 1, mode: 'reps', reps: 8, weight: 50 }, sets: [{ w: 50, r: 8, done: true }] }] }]
    })
    const t = tools.find(x => x.name === 'get_week_plan')
    const out = t.handler({})
    if (!out || typeof out.today !== 'string') throw new Error('get_week_plan returned no plan')
    console.log('  ok    get_week_plan() runs (queue + history + labels, not just imported)')
  } catch (e) {
    failed++
    console.error(`  FAIL  calling a tool handler — ${e.message}`)
  }
}

if (failed) {
  console.error(`\n${failed} module(s) do not load under plain node — the MCP server would not start.`)
  process.exit(1)
}
console.log('\nthe whole MCP import graph loads under plain node.')
