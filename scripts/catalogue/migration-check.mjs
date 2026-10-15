#!/usr/bin/env node
// No-data-loss check for a catalogue change, run by the maintainer against COPIES of real user data:
//
//   node scripts/catalogue/migration-check.mjs <old-tree> <state.json>...
//
// <old-tree> is a checkout of the previous release (frontend/src inside). For every state file it
// loads the old and the new catalogue code side by side and compares, for every exercise id the
// state mentions anywhere: that the new catalogue still knows it, that its name, body part,
// equipment and target did not change meaning, and that the numbers people see (best weight,
// estimated 1RM, muscle volume per workout) come out identical. Nothing is written.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const NEW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src')
const [oldTree, ...files] = process.argv.slice(2)
const OLD = path.resolve(oldTree, 'frontend/src')
const load = async (root) => ({
  ex: await import(pathToFileURL(path.join(root, 'lib/exercises.js'))),
  hist: await import(pathToFileURL(path.join(root, 'lib/history.js'))),
  orm: await import(pathToFileURL(path.join(root, 'lib/onerm.js'))),
  mus: await import(pathToFileURL(path.join(root, 'lib/muscles.js'))),
})
const o = await load(OLD), n = await load(NEW)

const idsIn = S => {
  const ids = new Set()
  const add = id => { if (typeof id === 'string' && id) ids.add(id) }
  ;(S.routines || []).forEach(r => (r?.ex || []).forEach(e => add(e?.id)))
  ;(S.workouts || []).forEach(w => (w?.entries || []).forEach(e => add(e?.id)))
  ;(S.active?.entries || []).forEach(e => add(e?.id))
  ;(S.favourites || S.favs || []).forEach(add)
  Object.keys(S.exWeights || {}).forEach(add)
  Object.keys(S.exNotes || {}).forEach(add)
  return [...ids]
}
const custom = S => new Set((S.customEx || []).map(c => c?.id))
let problems = 0, checked = 0
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
  const S = raw.state || raw
  const own = custom(S)
  o.ex.registerCustom(S.customEx); n.ex.registerCustom(S.customEx)
  const say = m => { problems++; console.log(`${path.basename(f)}: ${m}`) }
  for (const id of idsIn(S)) {
    checked++
    const a = o.ex.EXIDX[id], b = n.ex.EXIDX[id]
    if (own.has(id)) continue
    if (a && !b) { say(`${id} "${a.n}" is gone from the new catalogue`); continue }
    if (!a && !b) continue // unknown before and after (a plan from elsewhere): still rendered as unknown
    if (a && b) {
      for (const k of ['n', 'bp', 'eq', 'tg']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) say(`${id}: ${k} changed ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`)
      const bw = [o.hist.bestWeightFor(S, id), n.hist.bestWeightFor(S, id)]
      if (bw[0] !== bw[1]) say(`${id}: best weight ${bw[0]} -> ${bw[1]}`)
      const rm = [o.orm.best1RM(S, id), n.orm.best1RM(S, id)]
      if (JSON.stringify(rm[0]) !== JSON.stringify(rm[1])) say(`${id}: best 1RM ${JSON.stringify(rm[0])} -> ${JSON.stringify(rm[1])}`)
    }
  }
  for (const w of S.workouts || []) {
    for (const en of w?.entries || []) {
      const a = o.mus.muscleWeightsOf ? o.mus.muscleWeightsOf(o.ex.EXIDX[en.id] || en) : null
      const b = n.mus.muscleWeightsOf ? n.mus.muscleWeightsOf(n.ex.EXIDX[en.id] || en) : null
      if (JSON.stringify(a) !== JSON.stringify(b)) say(`workout ${w.id || w.d} ${en.id}: muscle weights differ`)
    }
  }
  console.log(`${path.basename(f)}: ${idsIn(S).length} ids, ${(S.workouts || []).length} workouts checked`)
}
console.log(problems ? `${problems} problem(s)` : `OK: ${checked} references, nothing lost or changed`)
process.exit(problems ? 1 : 0)
