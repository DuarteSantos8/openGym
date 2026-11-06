// QA 1.4.5: two devices change different new 1.4.5 fields of one profile at the same time, the way
// the store does it (stampChange on every update), then meet in the 409 merge. Nothing either side
// did may be lost, whichever copy is newer.
import { describe, expect, it } from 'vitest'
import { stampChange, mergeStates } from './sync-merge.js'
import { withRecovery, recoverySessionsOf } from './recovery-sessions.js'
import { withForm } from './daily-form.js'

const clone = o => JSON.parse(JSON.stringify(o))
// What the store does on update(): copy, change, stamp.
function edit(S, fn, wall) {
  const next = clone(S)
  fn(next)
  next._ts = stampChange(S, next, wall)
  return next
}

const base = () => ({
  _ts: 1000, unit: 'kg',
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }], _ts: 900 }],
  workouts: [{ id: 'w1', d: '2026-11-01', start: 1, end: 2, entries: [], _ts: 900 }],
  measurements: [], bodyweight: [], customEx: [], equipProfiles: [{ id: 'g1', name: 'Gym', equip: ['barbell'], _ts: 900 }],
  dayForm: {}, recoverySessions: {}, activities: {}, gymNotes: {}, journalFolders: {}, exGym: {}, sessionTargets: {}, exMedia: {},
})

describe('two devices, new 1.4.5 fields, one merge', () => {
  for (const order of ['phone newer', 'laptop newer']) {
    it(`keeps both sides' changes (${order})`, () => {
      const S = base()
      const phone = edit(S, s => {
        s.dayForm['2026-11-06'] = { sleep: 2, energy: 3, _ts: 1 }
        s.recoverySessions.rs1 = { d: '2026-11-05', kind: 'sauna', min: 20, _ts: 1 }
        s.activities.a1 = { d: '2026-11-05', sport: 'run', min: 42, src: 'manual', _ts: 1 }
        s.measurements.push({ d: '2026-11-06', bp: { sys: 121, dia: 79 }, pulse: 60, t: 1 })
        s.routines[0].fav = true
        s.routines[0].ex[0].tempo = '3-1-1-0'
        s.heightCm = 181
        s.deloadCycle = { every: 5, from: '2026-11-02' }
      }, order === 'phone newer' ? 5000 : 3000)
      const laptop = edit(S, s => {
        s.gymNotes.n1 = { text: 'seat 4', gymId: 'g1', exId: '0025', _ts: 1 }
        s.journalFolders.f1 = { name: 'Knee', q: { kind: 'set' }, _ts: 1 }
        s.exGym['0025'] = { split: true, brands: { g1: 'Life Fitness' }, _ts: 1 }
        s.sessionTargets['2026-11-07|r1'] = { rows: [{ ex: '0025', w: 60, r: 8 }], _ts: 1 }
        s.equipProfiles[0].kit = ['sandbag']
        s.workouts.push({ id: 'w2', d: '2026-11-06', start: 3, end: 4, entries: [], recovery: false, _ts: 1 })
        s.streakExcuse = { max: 4 }
        s.activities.a2 = { d: '2026-11-04', sport: 'football', min: 90, src: 'hc', _ts: 1 }
        s.activityStreak = true
      }, order === 'phone newer' ? 3000 : 5000)
      for (const [a, b] of [[phone, laptop], [laptop, phone]]) {
        const m = mergeStates(a, b)
        expect(m.dayForm['2026-11-06'].sleep).toBe(2)
        expect(m.recoverySessions.rs1.kind).toBe('sauna')
        expect(m.measurements.find(e => e.d === '2026-11-06')?.bp).toEqual({ sys: 121, dia: 79 })
        expect(m.routines[0].fav).toBe(true)
        expect(m.routines[0].ex[0].tempo).toBe('3-1-1-0')
        expect(m.heightCm).toBe(181)
        expect(m.deloadCycle).toEqual({ every: 5, from: '2026-11-02' })
        expect(m.gymNotes.n1.text).toBe('seat 4')
        expect(m.journalFolders.f1.name).toBe('Knee')
        expect(m.exGym['0025'].brands.g1).toBe('Life Fitness')
        expect(m.sessionTargets['2026-11-07|r1'].rows[0].w).toBe(60)
        expect(m.equipProfiles[0].kit).toEqual(['sandbag'])
        expect(m.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2'])
        expect(m.streakExcuse).toEqual({ max: 4 })
        expect(m.activities.a1.sport).toBe('run')
        expect(m.activities.a2.sport).toBe('football')
        expect(m.activityStreak).toBe(true)
      }
    })
  }

  it('a recovery session or a check-in deleted on one device stays deleted', () => {
    const S = edit(base(), s => {
      s.recoverySessions.rs1 = { d: '2026-11-05', kind: 'sauna', min: 20, _ts: 1 }
      s.dayForm['2026-11-06'] = { sleep: 2, _ts: 1 }
    }, 2000)
    // The way the app clears them: a stamped empty entry (RecoverySheet, the check-in sheet).
    const phone = edit(S, s => { s.recoverySessions = withRecovery(s.recoverySessions, 'rs1', null); s.dayForm = withForm(s.dayForm, '2026-11-06', {}) }, 4000)
    const laptop = edit(S, s => { s.gymNotes.n1 = { text: 'x', _ts: 1 } }, 3000)
    for (const [a, b] of [[phone, laptop], [laptop, phone]]) {
      const m = mergeStates(a, b)
      expect(recoverySessionsOf(m)).toEqual([])
      expect(m.dayForm['2026-11-06'].sleep).toBeUndefined()
      expect(m.gymNotes.n1.text).toBe('x')
    }
  })
})
