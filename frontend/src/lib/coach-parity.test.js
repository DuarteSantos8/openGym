/* The server's copies of three tiny reading rules, pinned against the frontend's originals.
 *
 * api/coach/payload.js re-implements modeOf, isBw and isPerSide because the api container has
 * no build step in common with the frontend and does not copy frontend/ into its image. That
 * trade-off is fine; what is not fine is the copy drifting, which is exactly what happened
 * when v1.2.4 taught the app about bodyweight work and per-side reps: the server kept reading
 * every set as a loaded rep set, so a push-up progression that was working would have looked
 * like a stalled bench press with the weight left at zero.
 *
 * This test only runs under vitest, which can load both runtimes. It compares behaviour over a
 * table of configs rather than comparing source, so the two are free to be written differently
 * as long as they answer the same.
 */
import { describe, it, expect } from 'vitest'
import { modeOf as uiModeOf, isBw as uiIsBw, isPerSide as uiIsPerSide } from './history.js'
import { modeOf as srvModeOf, isBw as srvIsBw, isPerSide as srvIsPerSide } from '../../../api/coach/core/payload.js'
import { exOr, EXDB } from './exercises.js'
import { muscleWeightsOf, loadOfWeeklyPlan } from './muscles.js'
import { weightsOf as srvWeightsOf, weeklyPlanSets, sessionsOf } from '../../../api/coach/core/muscle-weights.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'

// Real ids from the catalogue, so `eq`/`bp` are whatever the dataset actually says rather than
// whatever this test assumed. 0001 is a bodyweight sit-up; the others are looked up the same way.
const IDS = ['0001', '0025', '0043', 'no-such-exercise']

const CONFIGS = [
  {},
  { mode: 'reps' },
  { mode: 'time' },
  { mode: 'cardio' },
  { mode: 'nonsense' },
  { mode: '' },
  { bodyweight: true },
  { bodyweight: false },
  { bodyweight: true, mode: 'time' },
  { side: true },
  { side: false },
  { side: true, bodyweight: true, mode: 'reps' },
  { reps: 8, sets: 3 },
  { repsMax: 20, reps: 12 }
]

describe('server/client reading rules agree', () => {
  for (const id of IDS) {
    const ex = exOr(id)
    for (const base of CONFIGS) {
      const cfg = { ...base, id }
      const label = `${id} ${JSON.stringify(base)}`

      it(`modeOf — ${label}`, () => {
        expect(srvModeOf(cfg, ex)).toBe(uiModeOf(cfg))
      })

      it(`isBw — ${label}`, () => {
        expect(srvIsBw(cfg, ex)).toBe(uiIsBw(cfg))
      })

      it(`isPerSide — ${label}`, () => {
        expect(srvIsPerSide(cfg)).toBe(uiIsPerSide(cfg))
      })
    }
  }

  it('an explicit flag beats the catalogue, on both sides', () => {
    const bodyweightEx = exOr('0001')
    expect(uiIsBw({ id: '0001' })).toBe(true)
    expect(srvIsBw({ id: '0001' }, bodyweightEx)).toBe(true)
    // A dip done with a belt turns it off; the server must agree, or it keeps reading the
    // added load as no load.
    expect(uiIsBw({ id: '0001', bodyweight: false })).toBe(false)
    expect(srvIsBw({ id: '0001', bodyweight: false }, bodyweightEx)).toBe(false)
  })
})

// #311: the validator keeps a routine glyph only when it is one a routine can hold (or a legacy
// emoji), and the payload sends the plan's icons through the same filter. A glyph the app shows
// and the server does not know would be reset by every plan.
import { GLYPHS, KNOWN_GLYPHS, glyphOf } from './glyphs.js'
import { ICON_NAMES } from '../components/Icon.jsx'
import { ROUTINE_GLYPHS, LEGACY_ROUTINE_GLYPHS, glyphStr } from '../../../api/coach/core/glyphs.js'

describe('routine glyphs', () => {
  it('the server offers exactly the glyphs the picker offers, each a real icon', () => {
    expect([...ROUTINE_GLYPHS].sort()).toEqual([...GLYPHS].sort())
    ROUTINE_GLYPHS.forEach(g => expect(ICON_NAMES).toContain(g))
  })
  it('the server keeps every icon key a routine can hold, and the app shows each as itself', () => {
    expect([...ROUTINE_GLYPHS, ...LEGACY_ROUTINE_GLYPHS].sort()).toEqual([...KNOWN_GLYPHS].sort())
    KNOWN_GLYPHS.forEach(g => {
      expect(glyphStr(g)).toBe(g)
      expect(glyphOf(g)).toBe(g)
    })
  })
})

describe('muscle weights', () => {
  it('every catalogue exercise weighs the same on both sides', () => {
    const bad = EXDB.filter(e => JSON.stringify(srvWeightsOf(LIB_BY_ID.get(e.id))) !== JSON.stringify(muscleWeightsOf(exOr(e.id)))).map(e => e.id)
    expect(bad).toEqual([])
  })

  it('custom exercises weigh the same on both sides', () => {
    for (const ex of [
      { id: 'c1', n: 'My row', bp: 'back' },
      { id: 'c2', n: 'Mine', bp: 'chest', muscleWeights: { chest: 1, triceps: 0.5 } },
      { id: 'c3', n: 'Odd', bp: 'nonsense' },
      { id: 'c4', n: 'Shoulders', bp: 'shoulders', tg: 'shoulders', sm: ['upper back'], mv: 2 },
      { id: 'c6', n: 'Deleted', bp: 'back', muscleSnapshot: { mv: 2, bp: 'chest', muscleWeights: { quadriceps: 1, 'upper-back': 0.5 } } },
      { id: 'c7', n: 'Snap groups', muscleSnapshot: { muscleGroups: ['biceps', 'shoulders'] } },
      { id: 'c8', n: 'Groups', bp: 'back', muscleGroups: ['chest', 'triceps'] },
      { id: 'c9', n: 'Muscles', muscles: 'abs' },
      { id: 'c5', n: 'Parts', primaries: ['chest'], secondaries: ['triceps'] },
    ]) expect(srvWeightsOf(ex)).toEqual(muscleWeightsOf(ex))
  })

  const routines = [
    { id: 'a', ex: [{ id: '0025', sets: 3 }, { id: 'c1', sets: 2 }] },
    { id: 'b', ex: [{ id: '0043', sets: 4 }, { id: '0027' }] },
    { id: 'c', ex: [{ id: '0001', sets: 2 }] },
  ]
  const customEx = [{ id: 'c1', n: 'My row', bp: 'back', muscleWeights: { lats: 1, biceps: 0.5 } }]
  const base = { routines, customEx }
  const loop = (target, ids) => ({ ...base, weekTarget: target, rotation: { id: 'rot', sequence: ['a', 'b', 'rest', 'c'], label: '' },
    queue: { ids, since: 1, startsOn: '2026-08-17', rotationId: 'rot' } })

  it('the planned week matches the Stats card', () => {
    for (const S of [
      { ...base, week: { 1: ['a'], 3: ['b'], 5: ['c'] } },
      { ...base, week: { 1: ['a'], 3: ['a', 'b'], 5: ['gone'] } },
      { ...base, week: { 1: ['a'] }, queue: { ids: ['b', 'c'], since: 1, startsOn: '2026-08-17' } },
      loop(4, ['a', 'b', 'c']),
      loop(null, ['a', 'b', 'c']),
    ]) expect(weeklyPlanSets(S)).toEqual(loadOfWeeklyPlan(S))
  })

  it('sessionsOf gives one map per weekday session, none for a rotation', () => {
    const S = { ...base, week: { 1: ['a'], 3: ['a', 'b'], 5: ['gone'] } }
    const s = sessionsOf(S)
    expect(s).toHaveLength(2)
    expect(s[1]).toEqual(weeklyPlanSets({ ...base, week: { 1: ['a', 'b'] } }))
    expect(sessionsOf(loop(4, ['a', 'b']))).toBeNull()
  })
})
