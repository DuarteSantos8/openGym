// The Huawei watch's snapshot (lib/huawei-snapshot.js): the Garmin's shape, with the whole workout,
// and cut to fit what the frames carry (16 x 960 characters, each non-ASCII one counted as 6).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { huaweiSnapshot, wireLength, HUAWEI_MAX_WIRE, HUAWEI_ACKED_MAX } from './huawei-snapshot.js'
import { garminSnapshot } from './garmin-snapshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const wearSnap = () => JSON.parse(readFileSync(join(here, '..', '..', 'android', 'wear', 'src', 'test', 'resources', 'snapshot.json'), 'utf8'))
const wire = v => wireLength(JSON.stringify(v))

const row = (done, extra = {}) => ({ w: 50, r: 8, sec: null, done, warmup: false, ...extra })
const ex = (n, name, extra = {}) => ({
  id: String(1000 + n), name, mode: 'reps', restSec: null, last: '50×8, 50×8, 50×7', step: 2.5, best: { w: 55, r: 6 },
  sets: [row(false), row(false), row(false), row(false)], muscles: { chest: 1, triceps: 0.4 }, ...extra,
})
const workout = (names, extra = {}) => ({
  v: 1, unit: 'kg', restSec: 90, now: 1761743000000,
  active: { id: 'w-1', name: 'Push day', unit: 'kg', cur: 0, restSec: 90, rest: null, entries: names.map((n, k) => ex(k, n)), muscleNames: { chest: 'Chest', triceps: 'Triceps' }, ...extra },
  ready: null,
  settings: { restHaptics: true, lang: 'en', show: { hr: true, last: true, next: true } },
})
const LATIN = ['Barbell Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Triceps Pushdown', 'Cable Fly']

describe('wireLength', () => {
  it('counts every character outside 0x20..0x7E as 6 (\\uXXXX), as the frames write it', () => {
    expect(wireLength('abc "x"')).toBe(7)
    expect(wireLength('é')).toBe(6)
    expect(wireLength('胸')).toBe(6)
    expect(wireLength('\u007f')).toBe(6)
    expect(wireLength('\u001f')).toBe(6)
    // a character outside the BMP is two UTF-16 units, each its own \uXXXX
    expect(wireLength('😀')).toBe(12)
    // and it is the escape rule: the length of the escaped text
    const esc = s => s.replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    for (const s of ['plain', 'Prensa de banca é ñ', '深蹲 привет مرحبا', '😀 x\u007f']) expect(wireLength(s)).toBe(esc(s).length)
  })
})

describe('the Huawei snapshot', () => {
  it('is the Garmin snapshot with the whole workout: same fields, every exercise, its index', () => {
    const snap = wearSnap()
    const h = huaweiSnapshot(snap)
    const g = garminSnapshot(snap)
    expect(h.active.entries.map(e => e.i)).toEqual([0, 1])
    expect(h.active.count).toBe(2)
    for (const k of ['progress', 'volume', 'id', 'name', 'cur', 'rest']) expect(h.active[k]).toEqual(g.active[k])
    expect(h.active.entries[0].sets).toEqual(g.active.entries[0].sets)
    expect(h.v).toBe(g.v)
    expect(h.streak).toEqual(g.streak)
    expect(h.settings.lang).toBe('de')
    // what the Garmin leaves out stays: records, last time, muscles and their names, the type
    expect(h.active.entries[0].best).toEqual({ w: 57.5, r: 6 })
    expect(h.active.entries[0].last).toBe('55×8, 57.5×6')
    expect(h.active.entries[0].muscles).toEqual({ chest: 1, 'front-delts': 0.4, triceps: 0.4 })
    expect(h.active.muscleNames.chest).toBe('Chest')
    expect(h.active.healthType).toBe('strength_training')
  })

  it('sends a whole six-exercise workout, with no window', () => {
    const snap = workout(LATIN)
    snap.active.cur = 2
    const h = huaweiSnapshot(snap)
    expect(h.active.entries.map(e => e.i)).toEqual([0, 1, 2, 3, 4, 5])
    expect(h.active.entries.every(e => e.best && e.last && e.muscles)).toBe(true)
    expect(wire(h)).toBeLessThan(HUAWEI_MAX_WIRE)
    expect(wire(garminSnapshot(snap))).toBeLessThan(wire(h))
  })

  it('carries the settings the other watches read, each only when the phone has it', () => {
    const snap = workout(LATIN.slice(0, 2))
    snap.settings = {
      ...snap.settings, show: { clip: true, hr: true, last: false, kcal: true, next: true, zones: false, rest: 'plain' }, weighIn: true,
      workoutNote: true, lastBw: 81.5, checkin: true, checkinDay: '2026-11-24', birthYear: 1988,
      forgotten: { askMin: 30, graceMin: 2, leaveGym: true }, accent: '#30D158', onAccent: '#000000', crown: 'weight', effort: 'rir', autoHolds: true,
    }
    expect(huaweiSnapshot(snap).settings).toEqual({
      restHaptics: true, lang: 'en', accent: '#30d158', onAccent: '#000000', crown: 'weight', effort: 'rir', autoHolds: true, askMin: 30,
      show: { clip: true, hr: true, last: false, kcal: true, next: true, zones: false, rest: 'plain' },
      weighIn: true, workoutNote: true, lastBw: 81.5, checkin: true, checkinDay: '2026-11-24', birthYear: 1988, forgotten: { graceMin: 2, leaveGym: true },
    })
    // a phone that has none of it: nothing invented, the language still there
    expect(huaweiSnapshot({ v: 1, unit: 'kg', active: null, ready: null }).settings).toEqual({ restHaptics: true, lang: 'en' })
    expect(huaweiSnapshot({ v: 1, unit: 'kg', active: null, ready: null, settings: { weighIn: 'x', birthYear: 'y', forgotten: {} } }).settings).toEqual({ restHaptics: true, lang: 'en' })
  })

  it('lists today with its exercises, also while a workout runs, and the others by name with their folder', () => {
    const snap = workout(LATIN.slice(0, 2))
    snap.ready = {
      today: { routineIds: ['r1'], name: 'Pull', healthType: 'strength_training', muscleNames: { back: 'Back' }, entries: [ex(1, 'Row', { sets: [row(false, { warmup: true }), row(false)] })] },
      others: [{ routineIds: ['r2'], name: 'Legs', folder: 'Gym', entries: [ex(1, 'Squat')] }, { routineIds: ['r3'], name: 'Core', entries: [] }],
    }
    const h = huaweiSnapshot(snap)
    expect(h.ready.today.entries).toHaveLength(1)
    expect(h.ready.today.entries[0].sets).toEqual([{ w: 50, r: 8, warmup: true }, { w: 50, r: 8 }])
    expect(h.ready.today.healthType).toBe('strength_training')
    expect(h.ready.others).toEqual([{ routineIds: ['r2'], name: 'Legs', entries: [], folder: 'Gym' }, { routineIds: ['r3'], name: 'Core', entries: [] }])
  })

  it('names up to 60 applied ids (the watch outbox holds 60), the newest', () => {
    const acked = Array.from({ length: 70 }, (_, i) => 'h' + i)
    const h = huaweiSnapshot({ ...workout(LATIN.slice(0, 1)), acked })
    expect(HUAWEI_ACKED_MAX).toBe(60)
    expect(h.acked).toEqual(acked.slice(-60))
  })

  it('over the cap, the least needed goes first and the exercise up now keeps every set', () => {
    const snap = workout(Array.from({ length: 12 }, (_, k) => 'Exercise number ' + k + ' with a rather long name'))
    snap.active.cur = 5
    const full = huaweiSnapshot(snap)
    expect(full.active.entries).toHaveLength(12)
    // a little tighter: records and last time go, the workout stays whole
    const tight = huaweiSnapshot(snap, { max: wire(full) - 300 })
    expect(tight.active.entries).toHaveLength(12)
    expect(tight.active.entries[5].last).toBeDefined()
    // records and muscles go first: the watch does not read them yet
    expect(tight.active.entries.some(e => e.muscles)).toBe(false)
    expect(tight.active.entries.every(e => e.last)).toBe(true)
    // far tighter: the exercises nearest the one up now, then the ones after it, then before it
    const small = huaweiSnapshot(snap, { max: 1500 })
    expect(small.active.entries.map(e => e.i)).toEqual(expect.arrayContaining([5, 6]))
    expect(small.active.entries.length).toBeLessThan(12)
    // after the one up now come the ones after it; the ones before it only once the whole rest is in
    const kept = small.active.entries.map(e => e.i)
    expect(kept.every((i, k) => k === 0 || i === kept[k - 1] + 1)).toBe(true)
    if (kept[0] < 5) expect(kept.at(-1)).toBe(11)
    expect(small.active.entries[0].sets).toHaveLength(4)
    expect(small.active.count).toBe(12)
    expect(wire(small)).toBeLessThanOrEqual(1500)
    // and the cut order ends where the Garmin's does: the block up now alone, never less than itself
    expect(huaweiSnapshot(snap, { max: 300 }).active.entries.map(e => e.i)).toEqual([5])
  })

  it('cuts a superset the way the Garmin does: the block up now stays whole', () => {
    const snap = workout(Array.from({ length: 8 }, (_, k) => 'Move ' + k))
    snap.active.entries.forEach((e, k) => { if (k >= 2 && k <= 4) e.group = 'g' })
    snap.active.cur = 3
    const h = huaweiSnapshot(snap, { max: 1100 })
    expect(wire(h)).toBeLessThanOrEqual(1100)
    expect(h.active.entries.map(e => e.i)).toEqual(expect.arrayContaining([2, 3, 4]))
    expect(h.active.entries.length).toBeLessThan(8)
  })

  it('a long Chinese, Russian or Arabic workout still fits the frames', () => {
    const names = {
      zh: n => '杠铃卧推训练动作第' + n + '号带有一个很长的名称和说明文字',
      ru: n => 'Жим штанги лёжа на горизонтальной скамье, вариант ' + n,
      ar: n => 'تمرين ضغط الصدر بالبار على المقعد المسطح رقم ' + n,
    }
    for (const [lang, name] of Object.entries(names)) {
      const snap = workout(Array.from({ length: 14 }, (_, k) => name(k)))
      snap.active.cur = 6
      snap.active.entries.forEach(e => { e.last = name(0).slice(0, 12) + ' 50×8' })
      snap.active.muscleNames = { chest: name(1).slice(0, 8), triceps: name(2).slice(0, 8), back: name(3).slice(0, 8) }
      snap.settings.lang = lang
      snap.acked = Array.from({ length: 60 }, (_, i) => 'h1761743000000-' + i)
      const routine = (i, entries) => ({ routineIds: ['r' + i], name: name(i), folder: name(30 + (i % 3)), entries })
      snap.ready = { today: routine(1, snap.active.entries.map(e => ({ ...e }))), others: Array.from({ length: 20 }, (_, i) => routine(i + 2, [])) }
      const h = huaweiSnapshot(snap)
      expect(wire(h), lang).toBeLessThanOrEqual(HUAWEI_MAX_WIRE)
      expect(h.active.count).toBe(14)
      const up = h.active.entries.find(e => e.i === 6)
      expect(up.sets, lang).toHaveLength(4)
      expect(h.settings.lang).toBe(lang)
      // the whole text, once escaped, is no more than the 16 frames hold
      expect(wire(h)).toBeLessThan(16 * 960)
    }
  })
  // #4: the cut used to jump from the whole workout to the Garmin's two exercises
  it('shrinks gradually: as many whole exercises as fit, nearest the one up now first', () => {
    const rows = n => Array.from({ length: n }, (_, k) => row(k < 3, { sid: 's' + k + Math.random().toString(36).slice(2, 8), at: 1761742900000 + k }))
    const snap = workout(Array.from({ length: 30 }, (_, k) => 'Exercise number ' + k))
    snap.active.entries.forEach(e => { e.sets = rows(6) })
    snap.active.cur = 12
    snap.acked = Array.from({ length: 60 }, (_, i) => 'h1761743000000-' + i + '-123456')
    const h = huaweiSnapshot(snap)
    expect(wire(h)).toBeLessThanOrEqual(HUAWEI_MAX_WIRE)
    expect(h.active.entries.length).toBeGreaterThan(15)
    expect(h.active.count).toBe(30)
    // each entry's i is its place in the whole workout
    expect(h.active.entries.every(e => e.name === 'Exercise number ' + e.i)).toBe(true)
  })

  it('whatever the size, it fits, keeps the block up now whole, and drops no more than it must', () => {
    // plain rows only, so nothing but the exercises themselves can be cut
    const mk = () => {
      const snap = workout(Array.from({ length: 18 }, (_, k) => 'Move ' + k))
      snap.active.entries.forEach((e, k) => { delete e.best; delete e.last; delete e.muscles; if (k >= 7 && k <= 8) e.group = 'g' })
      delete snap.active.muscleNames
      snap.active.cur = 7
      return snap
    }
    const snap = mk()
    const whole = wire(huaweiSnapshot(snap, { max: 1e9 }))
    let prev = null
    for (let max = 700; max <= whole + 10; max += 7) {
      const h = huaweiSnapshot(snap, { max })
      const n = h.active.entries.length
      const idx = h.active.entries.map(e => e.i)
      expect(wire(h), 'max ' + max).toBeLessThanOrEqual(max)
      expect(idx, 'block up now at ' + max).toEqual(expect.arrayContaining([7, 8]))
      expect(h.active.entries.filter(e => e.i === 7 || e.i === 8).every(e => e.sets.length === 4)).toBe(true)
      expect(h.active.count).toBe(18)
      if (prev != null) expect(n).toBeGreaterThanOrEqual(prev)
      // a few characters more room never brings back more than one exercise
      if (prev != null) expect(n - prev, "max " + max).toBeLessThanOrEqual(1)
      prev = n
    }
    expect(prev).toBe(18)
  })

  // #5: what the watch does not read yet goes before what it shows ("Last time")
  it('drops records and muscles before last time, and last time before today\'s exercises', () => {
    const snap = workout(Array.from({ length: 10 }, (_, k) => 'Exercise ' + k))
    snap.ready = { today: { routineIds: ['r1'], name: 'Push', entries: snap.active.entries.map(e => ({ ...e })) }, others: [] }
    const size = max => huaweiSnapshot(snap, { max })
    const has = (h, k) => h.active.entries.filter(e => k in e).length
    const full = size(1e9)
    let sawBestGone = false
    for (let max = wire(full); max > 1500; max -= 25) {
      const x = size(max)
      const lastLost = has(x, 'last') < x.active.entries.length
      // last time goes only after records, muscles and today's exercises are gone
      if (lastLost) { expect(has(x, 'best')).toBe(0); expect(has(x, 'muscles')).toBe(0); expect(x.ready.today.entries).toEqual([]) }
      if (has(x, 'best') === 0 && !lastLost) sawBestGone = true
    }
    // and there is a size where records are gone and last time is still on every exercise
    expect(sawBestGone).toBe(true)
  })
})
