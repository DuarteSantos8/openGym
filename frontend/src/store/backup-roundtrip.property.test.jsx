// @vitest-environment happy-dom
/* A backup brings back everything it was made from: for any profile (fast-check generates them,
 * with per-side and timed sets, notes in any script, emoji and quotes, weigh-ins, custom
 * exercises, kg or lb), Settings' "Export backup" and "Export with photos & videos", read back by
 * "Import backup" on another device, leave the same workouts, routines, weigh-ins and custom
 * exercises in the store, and the same once more after the app restarts from what it saved.
 *
 * Everything on the way is the real code: exportBackupZip and readBackupFile (lib/backup-media.js),
 * the store's importBackup and its persist to localStorage. Only the server is left out: this is
 * the device with no account, where the backup file is the only copy there is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => { throw new Error('offline') }), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { DEF, useStore } from './useStore.js'
import { exportBackupZip, readBackupFile } from '../lib/backup-media.js'

const clone = v => JSON.parse(JSON.stringify(v))
const RUNS = { numRuns: Number(process.env.PROPERTY_RUNS) || 40 }
const memoryMedia = () => { const m = new Map(); return { get: async h => m.get(h) || null, put: async (h, r) => { m.set(h, r) } } }

// ---- generated profiles ----------------------------------------------------------------------
const text = fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom('Bankdrücken', 'жим лёжа', '深蹲', 'Leg day 💪', 'say "hi" \\ there', ''))
const day = fc.integer({ min: 0, max: 400 }).map(n => new Date(Date.UTC(2025, 0, 1) + n * 864e5).toISOString().slice(0, 10))
const kg = fc.integer({ min: 0, max: 1200 }).map(x => x / 4)
const set = fc.oneof(
  fc.record({ w: kg, r: fc.integer({ min: 0, max: 50 }), done: fc.boolean() }),
  fc.record({ w: kg, sec: fc.integer({ min: 1, max: 600 }), done: fc.constant(true) }),
  fc.record({ w: kg, r: fc.integer({ min: 1, max: 20 }), done: fc.constant(true), L: fc.record({ w: kg, r: fc.integer({ min: 1, max: 20 }) }), R: fc.record({ w: kg, r: fc.integer({ min: 1, max: 20 }) }) }),
  fc.record({ w: kg, r: fc.integer({ min: 1, max: 20 }), done: fc.constant(true), warm: fc.constant(true) }),
)
const exId = fc.constantFrom('0025', '0043', '0032', '0027', '1460', 'c-own')
const workout = fc.record({
  d: day, start: fc.integer({ min: 1.7e12, max: 1.8e12 }), dur: fc.integer({ min: 60, max: 3 * 3600 }),
  name: text, note: fc.option(text, { nil: undefined }),
  entries: fc.array(fc.record({ id: exId, sets: fc.array(set, { minLength: 1, maxLength: 6 }), note: fc.option(text, { nil: undefined }) }), { minLength: 1, maxLength: 5 }),
})
const profile = fc.record({
  unit: fc.constantFrom('kg', 'lb'),
  restSec: fc.integer({ min: 15, max: 600 }),
  workouts: fc.array(workout, { maxLength: 12 }),
  routines: fc.array(fc.record({ name: text, ex: fc.array(fc.record({ id: exId, sets: fc.integer({ min: 1, max: 8 }), reps: fc.integer({ min: 1, max: 30 }) }), { minLength: 1, maxLength: 6 }) }), { maxLength: 5 }),
  bodyweight: fc.uniqueArray(fc.record({ d: day, w: fc.integer({ min: 300, max: 2000 }).map(x => x / 10) }), { selector: b => b.d, maxLength: 20 }),
  favEx: fc.uniqueArray(exId, { maxLength: 3 }),
}).map(p => Object.assign(clone(DEF), {
  unit: p.unit, restSec: p.restSec, favEx: p.favEx, _ts: 1.79e12,
  workouts: p.workouts.map((w, i) => ({ id: `w${i}`, d: w.d, start: w.start, end: w.start + w.dur * 1000, name: w.name, ...(w.note != null ? { note: w.note } : {}), entries: w.entries.map(e => ({ ...e, ...(e.note == null ? { note: undefined } : {}) })) })),
  routines: p.routines.map((r, i) => ({ id: `r${i}`, ...r })),
  bodyweight: p.bodyweight.map((b, i) => ({ ...b, t: 1.7e12 + i })),
  customEx: [{ id: 'c-own', name: 'Own lift', custom: true, eq: 'barbell', bp: 'chest' }],
}))

// What the user sees of a profile: the data, without bookkeeping stamps the import adds.
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === '_ts' || k === '_f' || k === '_u' || k === 't' ? undefined : v)))
const view = S => strip({ unit: S.unit, restSec: S.restSec, favEx: S.favEx, workouts: S.workouts, routines: S.routines, bodyweight: S.bodyweight, customEx: S.customEx })

// Another device with its own, different history: the import must replace it, not mix it in.
const otherDevice = () => Object.assign(clone(DEF), { unit: 'kg', _ts: 1.6e12, workouts: [{ id: 'old', d: '2024-01-01', start: 1, end: 2, entries: [] }] })

beforeEach(() => { localStorage.clear(); useStore.setState({ S: otherDevice(), user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

const restore = async file => {
  const { state } = await readBackupFile(file)
  useStore.getState().importBackup(state)
  return useStore.getState().S
}
const saved = () => JSON.parse(localStorage.getItem('gym_state_v1'))

describe('a backup brings back everything it was made from', () => {
  it('as JSON (Export backup), and still after a restart', async () => {
    await fc.assert(fc.asyncProperty(profile, async P => {
      useStore.setState({ S: otherDevice() })
      const json = JSON.stringify(P, null, 2)   // Settings.jsx doExport
      const S = await restore(new File([json], 'opengym-backup.json', { type: 'application/json' }))
      expect(view(S)).toEqual(view(P))
      expect(view(saved())).toEqual(view(P))
    }), RUNS)
  })

  it('as a zip with photos and videos', async () => {
    await fc.assert(fc.asyncProperty(profile, async P => {
      useStore.setState({ S: otherDevice() })
      const { blob } = await exportBackupZip(P, { media: memoryMedia(), now: new Date(1.79e12) })
      const S = await restore(new File([blob], 'opengym-backup.zip'))
      expect(view(S)).toEqual(view(P))
    }), RUNS)
  })

  it('a backup of a backup is the same backup', async () => {
    await fc.assert(fc.asyncProperty(profile, async P => {
      useStore.setState({ S: otherDevice() })
      const once = await restore(new File([JSON.stringify(P)], 'a.json'))
      const twice = await restore(new File([JSON.stringify(once)], 'b.json'))
      expect(view(twice)).toEqual(view(once))
    }), RUNS)
  })
})
