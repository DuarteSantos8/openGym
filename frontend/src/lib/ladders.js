// Calisthenics ladders (1.4.5, gm-builder): chains of bodyweight exercises from easier to harder,
// so "harder variation" (lib/progression.js) has a name. The `ladder` progression rule climbs the
// reps of a rung to the top of its range, then names the next rung; the workout offers to swap it
// into the routine with one tap.
//
// The built-in chains are our own picks from our own catalogue (catalogue/exercises), easiest
// first. Their names are English source strings looked up through t() in components/Ladders.jsx
// (check-source-strings.mjs only finds literals written inside t()).
//
// Your own chains: S.ladders = [{ id, name, steps: [exerciseId, …] }], one whole setting
// (lib/sync-merge.js: the last change wins whole), at most OWN_MAX chains of STEPS_MAX rungs. An
// exercise in one of your chains follows yours first, so you can reorder a built-in one by making
// your own copy.
import { EXIDX } from './exercises.js'

export const STEPS_MAX = 12
export const OWN_MAX = 24
export const NAME_MAX = 40

export const LADDERS = [
  // Wall, incline, knees, the floor, then narrow, archer and one arm.
  { id: 'push-up', steps: ['0659', '0493', '3211', '0662', '0283', '3294', '0725'] },
  // Rows under a bar, help from a band, the slow way down, chin-up, pull-up, archer, one arm.
  { id: 'pull-up', steps: ['0499', '0970', '4725', '1326', '0652', '3293', '0638'] },
  // Bench dips with bent knees, dips on bars, on rings, then the Korean dip.
  { id: 'dip', steps: ['0129', '0814', '0251', '0677', '3288'] },
  // Squat, split squat, a pistol with support, to a box, the full pistol, the shrimp.
  { id: 'squat', steps: ['1197', '0781', '1762', '2984', '1759', '3366'] },
  // Glute bridge to one leg, hip thrust to one leg, then the Nordic curl.
  { id: 'hinge', steps: ['2471', '2475', '2072', '2071', '7746'] },
  // Plank, hollow hold, hanging knee raise, hanging leg raise, L-sit, dragon flag.
  { id: 'core', steps: ['0463', '1246', '9819', '0472', '3419', '4058'] },
  // Pike push-up, feet up on a bench, wall walks, a handstand, handstand push-up.
  { id: 'handstand', steps: ['2921', '2831', '5234', '3302', '0471'] },
].map(l => ({ ...l, steps: l.steps.filter(id => EXIDX[id]) }))

const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)

/** Your own chains, cleaned: a name, 2 to STEPS_MAX distinct steps, a usable id. */
export function ownLadders (S) {
  const list = Array.isArray(S?.ladders) ? S.ladders : []
  const out = []
  for (const l of list) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(l.id)) continue
    const steps = [...new Set((Array.isArray(l.steps) ? l.steps : []).filter(x => typeof x === 'string' && x))].slice(0, STEPS_MAX)
    if (steps.length < 2 || out.some(o => o.id === l.id)) continue
    out.push({ id: l.id, name: clean(l.name) || 'Ladder', steps, own: true })
    if (out.length >= OWN_MAX) break
  }
  return out
}

/** Every chain: yours first, then the built-in ones. */
export const allLadders = S => [...ownLadders(S), ...LADDERS]

/** The chain an exercise is a rung of (yours first) and where: { ladder, index } or null. */
export function ladderOf (S, exId) {
  for (const l of allLadders(S)) {
    const i = l.steps.indexOf(exId)
    if (i >= 0) return { ladder: l, index: i }
  }
  return null
}

/** The next rung up from `exId`, or null at the top or outside any chain. */
export function nextRung (S, exId) {
  const at = ladderOf(S, exId)
  return at && at.index < at.ladder.steps.length - 1 ? at.ladder.steps[at.index + 1] : null
}

/** The rung below, or null. */
export function prevRung (S, exId) {
  const at = ladderOf(S, exId)
  return at && at.index > 0 ? at.ladder.steps[at.index - 1] : null
}

/** The highest rung of `ladder` you logged a done set of: its index, or -1 for none yet. */
export function reachedRung (S, ladder) {
  const done = new Set()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    for (const e of w?.entries || []) if (e?.id && (e.sets || []).some(s => s?.done)) done.add(e.id)
  }
  let top = -1
  ladder.steps.forEach((id, i) => { if (done.has(id)) top = i })
  return top
}

/** Save (add or replace by id) one of your chains in a state draft. Returns the saved chain or null. */
export function saveLadder (s, { id, name, steps }) {
  const lid = typeof id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(id) ? id : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const list = ownLadders(s)
  const next = { id: lid, name: clean(name) || 'Ladder', steps: [...new Set((steps || []).filter(x => typeof x === 'string' && x))].slice(0, STEPS_MAX) }
  if (next.steps.length < 2) return null
  const at = list.findIndex(l => l.id === lid)
  if (at >= 0) list[at] = next
  else if (list.length < OWN_MAX) list.push(next)
  else return null
  s.ladders = list.map(({ own, ...l }) => l)
  return next
}

/** Remove one of your chains. */
export function deleteLadder (s, id) {
  const list = ownLadders(s).filter(l => l.id !== id).map(({ own, ...l }) => l)
  if (list.length) s.ladders = list
  else delete s.ladders
}
