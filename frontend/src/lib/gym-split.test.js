import { describe, it, expect } from 'vitest'
import { isGymSplit, brandAt, withExGym, gymSplitView, matchesContext, splitLabel, placesOf, onlyPlace, cleanBrand, currentGymId } from './gym-split.js'
import { lastEntryFor } from './history.js'
import { buildSessionExposures } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { migratedFixture } from './test-fixtures.js'
import { mergeStates, STAMPED_MAPS } from './sync-merge.js'
import { STAMPED_MAPS as API_STAMPED_MAPS } from '../../../api/sync-stamps.js'

// 0160 is a cable row in the catalogue; the numbers are what matters here.
const EX = '0160'
const set = (w, r = 10) => ({ w, r, done: true })
const workout = (id, d, gym, w, brand) => ({
  id, d, start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T11:00:00Z'),
  ...(gym ? { gym: { id: gym, name: gym === 'a' ? 'Gym A' : 'Gym B' } } : {}),
  entries: [{ id: EX, sets: [set(w), set(w), set(w)], target: { id: EX, sets: 3, reps: 10, weight: w }, ...(brand ? { brand } : {}) }, { id: '0025', sets: [set(60, 5)] }],
})
const v1 = over => ({
  unit: 'kg', activeEquipId: 'a',
  equipProfiles: [{ id: 'a', name: 'Gym A', equipment: [] }, { id: 'b', name: 'Gym B', equipment: [] }],
  workouts: [workout('w0', '2026-10-01', null, 12), workout('w1', '2026-10-05', 'a', 15), workout('w2', '2026-10-07', 'b', 10)],
  ...over,
})
// The profile as v2 holds it; the settings ride along as they are.
const base = over => { const st = v1(over); return { ...st, ...migratedFixture(st), exGym: st.exGym, activeEquipId: st.activeEquipId, equipProfiles: st.equipProfiles } }
const split = (brands) => ({ [EX]: { split: true, ...(brands ? { brands } : {}), _ts: 1 } })

describe('gym split (#988)', () => {
  it('reads every session for an exercise that is not split', () => {
    const S = base()
    expect(gymSplitView(S, EX)).toBe(S)
    expect(lastEntryFor(S, EX).sets[0].w).toBe(10)
  })

  it('reads only the gym the session is at once split, other exercises untouched', () => {
    const S = base({ exGym: split() })
    expect(lastEntryFor(S, EX).sets[0].w).toBe(15)
    expect(lastEntryFor({ ...S, activeEquipId: 'b' }, EX).sets[0].w).toBe(10)
    // The running session's gym wins over the active profile.
    expect(lastEntryFor({ ...S, active: { gym: { id: 'b' }, entries: [] } }, EX).sets[0].w).toBe(10)
    expect(lastEntryFor(S, '0025').sets[0].w).toBe(60)
    expect(gymSplitView(S, EX).workouts.length).toBe(3)
  })

  it('falls back to the sessions from before any gym, never to another gym', () => {
    const S = base({ exGym: split(), equipProfiles: [{ id: 'c', name: 'New' }], activeEquipId: 'c' })
    expect(lastEntryFor(S, EX).sets[0].w).toBe(12)
    const noOld = { ...S, workouts: S.workouts.slice(1) }
    expect(lastEntryFor(noOld, EX)).toBe(null)
  })

  it('a brand matches the same brand at any gym, and the gym when no brand is set', () => {
    expect(matchesContext({ gym: 'b', brand: 'Life Fitness' }, { gym: 'a', brand: 'life fitness' })).toBe(true)
    expect(matchesContext({ gym: 'a', brand: 'Matrix' }, { gym: 'a', brand: 'Life Fitness' })).toBe(false)
    expect(matchesContext({ gym: 'a', brand: '' }, { gym: 'a', brand: 'Life Fitness' })).toBe(true)
    expect(matchesContext({ gym: 'a', brand: 'Matrix' }, { gym: 'a', brand: '' })).toBe(true)
    expect(matchesContext({ gym: 'b', brand: '' }, { gym: 'a', brand: '' })).toBe(false)
    const S = base({ exGym: split({ a: 'Life Fitness' }), workouts: [...v1().workouts, workout('w3', '2026-10-09', 'b', 14, 'Life Fitness')] })
    expect(lastEntryFor(S, EX).sets[0].w).toBe(14)
  })

  it('progression follows the gym too', () => {
    // v2: Start reads the gym's own sessions, and the engine replays the track over those alone.
    const cfg = { id: EX, sets: 3, reps: 10, weight: 15, prog: 'linear', inc: 2.5 }
    const P = migratedFixture({ ...v1(), routines: [{ id: 'r', name: 'Pull', ex: [cfg] }],
      workouts: v1().workouts.map(w => ({ ...w, routineIds: ['r'], entries: w.entries.map(e => ({ ...e, rid: 'r' })) })) })
    const weightAt = gym => {
      const draft = { ...P, exGym: split(), activeEquipId: gym, prescriptions: { ...P.prescriptions } }
      const [x] = buildSessionExposures(draft, draft.routines[0], { now: Date.parse('2026-10-10T10:00:00Z'), newId: v => v })
      return draft.prescriptions[x.prescriptionId].rows.at(-1).load.value
    }
    expect(weightAt('a')).toBeGreaterThan(weightAt('b'))
    expect(weightAt('b')).toBeLessThan(15)
    // Finished at Gym A, the track advances from Gym A's last log, not from Gym B's newer state.
    const draft = { ...P, exGym: split(), activeEquipId: 'a', prescriptions: { ...P.prescriptions } }
    const [x] = buildSessionExposures(draft, draft.routines[0], { now: Date.parse('2026-10-10T10:00:00Z'), newId: v => v })
    const p = draft.prescriptions[x.prescriptionId]
    const rows = p.rows.map(r => ({ w: r.load.value, r: 10, done: true }))
    const live = { id: 'n', d: '2026-10-10', start: 1, gym: { id: 'a', name: 'Gym A' }, exposures: [x], entries: [{ id: EX, exposureId: x.exposureId, sets: rows }] }
    const { progression } = buildCompletedSession(live, draft, { end: 2, newId: v => v, unit: 'kg' })
    expect(progression[x.trackId].values.load.value).toBeGreaterThan(15)
  })

  it('withExGym sets the switch and a brand per gym, stamped, without mutating', () => {
    const m0 = {}
    const m1 = withExGym(m0, EX, { split: true }, 5)
    expect(m0).toEqual({})
    expect(isGymSplit({ exGym: m1 }, EX)).toBe(true)
    const m2 = withExGym(m1, EX, { brand: '  Life   Fitness ', gymId: 'a' }, 6)
    expect(m2[EX]).toEqual({ split: true, brands: { a: 'Life Fitness' }, _ts: 6 })
    expect(brandAt({ exGym: m2 }, EX, 'a')).toBe('Life Fitness')
    expect(brandAt({ exGym: m2 }, EX, 'b')).toBe('')
    const m3 = withExGym(m2, EX, { brand: '', gymId: 'a' }, 7)
    expect(m3[EX]).toEqual({ split: true, _ts: 7 })
    expect(cleanBrand('x'.repeat(80)).length).toBe(40)
  })

  it('the workout card names the gym and brand only for a split exercise', () => {
    expect(splitLabel(base(), EX, 'Gym A')).toBe('')
    expect(splitLabel(base({ exGym: split({ a: 'Matrix' }) }), EX, 'Gym A')).toBe('Gym A · Matrix')
    expect(currentGymId({ activeEquipId: 'a', active: { gym: { id: 'b' } } })).toBe('b')
  })

  it('a finished workout keeps the brand an entry was done on', () => {
    const active = { id: 'x', d: '2026-11-01', start: 1, entries: [{ id: EX, sets: [set(15)] }, { id: '0025', sets: [set(60)] }], gym: { id: 'a', name: 'Gym A' } }
    // The saved workout (v2 finish-session.js): each row on an exposure of its own.
    const finish = (A, brandFor) => buildCompletedSession({ ...A, entries: A.entries.map((e, i) => ({ ...e, exposureId: 'x' + i })), exposures: A.entries.map((e, i) => ({ exposureId: 'x' + i, exerciseId: e.id, mode: 'reps' })) },
      { prescriptions: {} }, { end: 2, newId: v => v, unit: 'kg', brandFor }).session
    const w = finish(active, id => (id === EX ? 'Matrix' : ''))
    expect(w.exposures[0].brand).toBe('Matrix')
    expect('brand' in w.exposures[1]).toBe(false)
    // One already on the entry (an edited workout) is kept.
    const again = finish({ ...active, entries: [{ ...active.entries[0], brand: 'Old' }, active.entries[1]] }, () => 'New')
    expect(again.exposures[0].brand).toBe('Old')
  })

  it('history lists the places and shows one at a time', () => {
    const S = base({ workouts: [...v1().workouts, workout('w3', '2026-10-09', 'b', 14, 'Matrix')] })
    expect(placesOf(S, EX).map(p => [p.key, p.label, p.n])).toEqual([['b:matrix', 'Matrix', 1], ['g:b', 'Gym B', 1], ['g:a', 'Gym A', 1]])
    const onlyA = onlyPlace(S, EX, 'g:a')
    expect(onlyA.workouts.filter(w => w.exposures.some(x => x.exerciseId === EX)).map(w => w.id)).toEqual(['w1'])
    expect(onlyPlace(S, EX, '')).toBe(S)
  })

  it('syncs per exercise, the newer choice winning, on both sides', () => {
    expect(STAMPED_MAPS).toContain('exGym')
    expect(API_STAMPED_MAPS).toEqual(STAMPED_MAPS)
    const local = { _ts: 2, exGym: { [EX]: { split: true, _ts: 20 }, a: { split: false, _ts: 1 } } }
    const remote = { _ts: 3, exGym: { [EX]: { split: false, _ts: 10 }, a: { split: true, _ts: 5 } } }
    const m = mergeStates(local, remote)
    expect(m.exGym[EX].split).toBe(true)
    expect(m.exGym.a.split).toBe(true)
  })
})
