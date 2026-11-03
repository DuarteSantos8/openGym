/* Algebra of the merge, checked on generated histories (fast-check, shrinking to the smallest
 * failing case). sync-fuzz.test.js drives whole devices against a server model on fixed seeds;
 * this file asks what any two or three copies must satisfy whatever the transport did, because
 * that is what "nothing is ever lost" rests on when a watch, a phone, a phone that was offline
 * and the server meet in whatever order the network allows:
 *
 *   - the order two copies meet in does not matter (merge(A, B) = merge(B, A)),
 *   - meeting a copy again changes nothing (merge(M, A) = M once M has A in it),
 *   - three copies end up the same whichever pair meets first,
 *   - and every workout and weigh-in logged anywhere is in the result unless a delete of it
 *     came later, with the sets of the device that edited it last.
 *
 * The copies are made the way the store makes them (useStore update: a mutation, then
 * stampChange), from one common base, on clocks that never tie.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { mergeStates, stampChange, stampWorkout } from './sync-merge.js'

const clone = o => JSON.parse(JSON.stringify(o))
const EXS = ['bench', 'squat', 'dead', 'row']
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03']
const base = () => ({
  unit: 'kg', workouts: [
    { id: 'w0', d: '2026-09-30', start: 1000, end: 2000, entries: [{ id: 'bench', sets: [{ w: 60, r: 5 }] }] },
  ], routines: [{ id: 'r0', name: 'Push', ex: [{ id: 'bench', sets: 3 }] }], customEx: [], bodyweight: [{ d: '2026-09-30', w: 80, t: 1 }],
  week: {}, dayPlan: {}, queue: null, restSec: 90, exNotes: {}, favEx: [], gymCards: [], equipProfiles: [], exWeights: {}, barWeights: {}, _ts: 10,
})

// One user action on a copy, as an op the generator can describe and shrink.
const op = fc.oneof(
  fc.record({ k: fc.constant('add'), ex: fc.constantFrom(...EXS), d: fc.constantFrom(...DAYS), w: fc.integer({ min: 20, max: 200 }), r: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ k: fc.constant('set'), pick: fc.nat(), w: fc.integer({ min: 20, max: 200 }), r: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ k: fc.constant('fix'), pick: fc.nat(), w: fc.integer({ min: 20, max: 200 }) }),
  fc.record({ k: fc.constant('del'), pick: fc.nat() }),
  fc.record({ k: fc.constant('weigh'), d: fc.constantFrom(...DAYS), w: fc.integer({ min: 600, max: 1000 }).map(x => x / 10) }),
  fc.record({ k: fc.constant('routine'), sets: fc.integer({ min: 1, max: 6 }) }),
)

// Applies ops on device `dev` (0, 1, 2) and returns the copy. Device clocks interleave (time t on
// device i is 10·t + i) so no two changes ever carry the same stamp.
function play(S0, ops, dev, log) {
  let S = clone(S0)
  ops.forEach((o, i) => {
    const prev = S
    const next = clone(prev)
    const wall = 100000 + (i + 1) * 30 + dev * 10 + dev
    const W = next.workouts
    if (o.k === 'add') {
      const id = `w${dev}-${i}`
      W.push({ id, d: o.d, start: wall - 50, end: wall, entries: [{ id: o.ex, sets: [{ w: o.w, r: o.r }] }] })
      log.push({ dev, k: 'add', id, t: wall })
    } else if ((o.k === 'set' || o.k === 'fix' || o.k === 'del') && W.length) {
      const w = W[o.pick % W.length]
      if (o.k === 'del') { next.workouts = W.filter(x => x !== w); log.push({ dev, k: 'del', id: w.id, t: wall }) }
      else {
        if (o.k === 'set') w.entries[0].sets.push({ w: o.w, r: o.r })
        else w.entries[0].sets[0].w = o.w
        stampWorkout(w, wall)
        log.push({ dev, k: 'edit', id: w.id, t: wall })
      }
    } else if (o.k === 'weigh') {
      next.bodyweight = [...next.bodyweight.filter(b => b.d !== o.d), { d: o.d, w: o.w, t: wall }]
    } else if (o.k === 'routine') {
      next.routines[0].ex[0].sets = o.sets
    } else return
    next._ts = stampChange(prev, next, wall)
    S = next
  })
  return S
}

// What the user sees of a copy: the data, without the bookkeeping that legitimately differs.
const view = S => ({
  workouts: [...(S.workouts || [])].map(w => ({ id: w.id, d: w.d, entries: w.entries })).sort((a, b) => a.id.localeCompare(b.id)),
  bodyweight: [...(S.bodyweight || [])].map(b => ({ d: b.d, w: b.w })).sort((a, b) => a.d.localeCompare(b.d)),
  routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, ex: r.ex })),
})
const merge = (a, b) => mergeStates(clone(a), clone(b))
const RUNS = { numRuns: Number(process.env.PROPERTY_RUNS) || 150 }
const histories = n => fc.array(fc.array(op, { maxLength: 8 }), { minLength: n, maxLength: n })

describe('merging copies of one account', () => {
  it('the order two copies meet in does not matter', () => {
    fc.assert(fc.property(histories(2), ([oa, ob]) => {
      const A = play(base(), oa, 0, []), B = play(base(), ob, 1, [])
      expect(view(merge(A, B))).toEqual(view(merge(B, A)))
    }), RUNS)
  })

  it('meeting a copy a second time changes nothing', () => {
    fc.assert(fc.property(histories(2), ([oa, ob]) => {
      const A = play(base(), oa, 0, []), B = play(base(), ob, 1, [])
      const M = merge(A, B)
      expect(view(merge(M, A))).toEqual(view(M))
      expect(view(merge(B, M))).toEqual(view(M))
      expect(view(merge(A, A))).toEqual(view(A))
    }), RUNS)
  })

  it('watch, phone and server end up the same whichever two meet first', () => {
    fc.assert(fc.property(histories(3), ([oa, ob, oc]) => {
      const [A, B, C] = [oa, ob, oc].map((o, i) => play(base(), o, i, []))
      const left = view(merge(merge(A, B), C))
      expect(view(merge(A, merge(B, C)))).toEqual(left)
      expect(view(merge(merge(C, A), B))).toEqual(left)
    }), RUNS)
  })

  it('nothing logged anywhere is lost unless it was deleted after its last edit', () => {
    fc.assert(fc.property(histories(3), ([oa, ob, oc]) => {
      const logs = [[], [], []]
      const copies = [oa, ob, oc].map((o, i) => play(base(), o, i, logs[i]))
      const M = view(merge(merge(copies[0], copies[1]), copies[2]))
      const ids = new Set(M.workouts.map(w => w.id))
      const all = logs.flat()
      const deleted = new Set(all.filter(e => e.k === 'del').map(e => e.id))
      // Every workout some device logged and no device deleted is there.
      for (const e of all) if (e.k === 'add' && !deleted.has(e.id)) expect(ids.has(e.id), `${e.id} was logged on device ${e.dev} and is gone`).toBe(true)
      // The base workout too, unless a device deleted it.
      if (!deleted.has('w0')) expect(ids.has('w0')).toBe(true)
      // A workout only one device ever touched comes out exactly as that device left it.
      for (const w of M.workouts) {
        const touched = new Set(all.filter(e => e.id === w.id).map(e => e.dev))
        if (touched.size === 1) {
          const [dev] = touched
          const own = view(copies[dev]).workouts.find(x => x.id === w.id)
          if (own) expect(w).toEqual(own)
        }
      }
      // No duplicates: one workout per id, one weigh-in per day.
      expect(new Set(M.workouts.map(w => w.id)).size).toBe(M.workouts.length)
      expect(new Set(M.bodyweight.map(b => b.d)).size).toBe(M.bodyweight.length)
    }), RUNS)
  })

  it('a delete wins over every edit made before it, on any device', () => {
    fc.assert(fc.property(histories(3), ([oa, ob, oc]) => {
      const logs = [[], [], []]
      const copies = [oa, ob, oc].map((o, i) => play(base(), o, i, logs[i]))
      const M = view(merge(copies[2], merge(copies[0], copies[1])))
      const all = logs.flat()
      for (const d of all.filter(e => e.k === 'del')) {
        const later = all.some(e => e.id === d.id && e.k !== 'del' && e.t > d.t)
        if (!later) expect(M.workouts.some(w => w.id === d.id), `${d.id} deleted on device ${d.dev} came back`).toBe(false)
      }
    }), RUNS)
  })

  it('a weigh-in keeps the value entered last for its day, whichever device entered it', () => {
    fc.assert(fc.property(histories(2), ([oa, ob]) => {
      const A = play(base(), oa, 0, []), B = play(base(), ob, 1, [])
      const M = view(merge(A, B))
      for (const b of M.bodyweight) {
        const cands = [A, B].flatMap(S => S.bodyweight.filter(x => x.d === b.d))
        const last = cands.reduce((p, x) => (x.t > p.t ? x : p))
        expect(b.w).toBe(last.w)
      }
    }), RUNS)
  })
})
