import { describe, expect, it } from 'vitest'
import { keepReset, localExtras, mergeBodyweight, mergeResetIds, mergeStampedMap, mergeStates, newerOf, resetIdsOf, RESET_ID_MAX, sinceReset, stampCustomEx, stampRoutines, stampWorkout, unionById } from './sync-merge.js'
import { mergeImport } from './import-csv.js'
import { convertBodyWeight, convertStateUnit, convertWeight } from './units.js'
import { retimeWorkout } from './workout-date.js'
import { inventoryFor, loadKindFor, withLoadKind, withPlatePairs, withStandardPlates } from './plates.js'

// A saved workout of the generic engine: exposures carrying the rows performed.
const ex = (id, w, r = 5) => ({ exerciseId: id, performance: { sets: [{ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: r }], resistance: { kind: 'external-load', value: w } }] } })
const workout = (id, d = '2026-09-01', start = 1) => ({ id, d, start, exposures: [] })
const routine = (id, name = id) => ({ id, name, ex: [] })
const base = (over = {}) => ({
  unit: 'kg', restSec: 90, lang: 'en', week: { 1: ['r1'] }, dayPlan: {},
  workouts: [], routines: [], bodyweight: [], customEx: [], favEx: [], exWeights: {}, exNotes: {}, barWeights: {},
  equipProfiles: [], gymCards: [], _ts: 0, ...over
})
const ids = xs => (xs || []).map(x => x.id)

describe('newerOf / unionById / mergeBodyweight', () => {
  it('picks the later _ts, first argument on a tie or missing stamps', () => {
    const a = { _ts: 5 }, b = { _ts: 9 }
    expect(newerOf(a, b)).toBe(b)
    expect(newerOf(b, a)).toBe(b)
    expect(newerOf({ _ts: 5 }, { _ts: 5 })).toEqual({ _ts: 5 })
    expect(newerOf({}, { })).toEqual({})
  })
  it('unions by id in the newer order, newer wins a shared id, dupes dropped', () => {
    const out = unionById([routine('a', 'A2'), routine('b'), routine('b')], [routine('c'), routine('a', 'A1')])
    expect(ids(out)).toEqual(['a', 'b', 'c'])
    expect(out[0].name).toBe('A2')
    expect(unionById(undefined, null)).toEqual([])
  })
  it('bodyweight: one entry per day, the later-edited one, sorted', () => {
    const out = mergeBodyweight([{ d: '2026-09-02', w: 80, t: 5 }], [{ d: '2026-09-01', w: 81, t: 1 }, { d: '2026-09-02', w: 79, t: 9 }])
    expect(out).toEqual([{ d: '2026-09-01', w: 81, t: 1 }, { d: '2026-09-02', w: 79, t: 9 }])
  })
})

describe('mergeStates', () => {
  const A = () => base({
    _ts: 200, restSec: 120, week: { 1: ['rA'] },
    workouts: [workout('w1'), workout('wA', '2026-09-03')],
    routines: [routine('shared', 'from A'), routine('onlyA')],
    bodyweight: [{ d: '2026-09-01', w: 80, t: 10 }],
    customEx: [{ id: 'cA', name: 'A ex' }], favEx: ['x', 'y'],
    exWeights: { sq: { w: 100 }, bp: { w: 60 } }, exNotes: { sq: 'A note' }, barWeights: { sq: 20 },
    gymCards: [{ id: 'g1', value: '1' }], _rev: 7
  })
  const B = () => base({
    _ts: 100, restSec: 60, week: { 1: ['rB'] },
    workouts: [workout('w1'), workout('wB', '2026-09-02')],
    routines: [routine('shared', 'from B'), routine('onlyB')],
    bodyweight: [{ d: '2026-09-01', w: 79, t: 20 }, { d: '2026-08-30', w: 82, t: 1 }],
    customEx: [{ id: 'cB', name: 'B ex' }], favEx: ['y', 'z'],
    exWeights: { sq: { w: 110 }, dl: { w: 140 } }, exNotes: { dl: 'B note' }, barWeights: { dl: 15 },
    gymCards: [{ id: 'g2', value: '2' }], _rev: 8
  })

  it('no entity of either side disappears, ids stay unique', () => {
    const m = mergeStates(A(), B())
    expect(ids(m.workouts).sort()).toEqual(['w1', 'wA', 'wB'])
    expect(ids(m.routines).sort()).toEqual(['onlyA', 'onlyB', 'shared'])
    expect(ids(m.customEx).sort()).toEqual(['cA', 'cB'])
    expect(ids(m.gymCards).sort()).toEqual(['g1', 'g2'])
    expect(m.bodyweight.map(b => b.d)).toEqual(['2026-08-30', '2026-09-01'])
    expect(m.favEx).toEqual(['x', 'y', 'z'])
    expect(new Set(ids(m.workouts)).size).toBe(m.workouts.length)
  })

  it('the newer copy decides settings, week, and a shared id; the other way round too', () => {
    const m = mergeStates(A(), B())
    expect(m.restSec).toBe(120)
    expect(m.week).toEqual({ 1: ['rA'] })
    expect(m.routines.find(r => r.id === 'shared').name).toBe('from A')
    const m2 = mergeStates(B(), { ...A(), _ts: 50 })
    expect(m2.restSec).toBe(60)
    expect(m2.week).toEqual({ 1: ['rB'] })
    expect(m2.routines.find(r => r.id === 'shared').name).toBe('from B')
  })

  it('bodyweight keeps the later-edited entry of a day, exWeights the larger weight, notes union', () => {
    const m = mergeStates(A(), B())
    expect(m.bodyweight.find(b => b.d === '2026-09-01')).toEqual({ d: '2026-09-01', w: 79, t: 20 })
    expect(m.exWeights).toEqual({ sq: { w: 110 }, bp: { w: 60 }, dl: { w: 140 } })
    expect(m.exNotes).toEqual({ sq: 'A note', dl: 'B note' })
    expect(m.barWeights).toEqual({ sq: 20, dl: 15 })
  })

  // A workout edited after it was logged is stamped with the time of the edit (stampWorkout).
  // Whichever copy is newer as a whole, the edited version replaces the old one by id, and the
  // old one can no longer come back over it.
  describe('a workout edited after it was logged', () => {
    const set = (w, id = 'sq') => ex(id, w)
    const logged = (exposures, over = {}) => ({ ...workout('w1'), exposures, ...over })

    it('keeps the edit when the other copy is newer as a whole but still has the old version', () => {
      const edited = base({ _ts: 100, workouts: [stampWorkout(logged([set(80)]), 100)] })
      const stale = base({ _ts: 200, workouts: [logged([set(100)])], bodyweight: [{ d: '2026-09-02', w: 80, t: 200 }] })
      for (const m of [mergeStates(edited, stale), mergeStates(stale, edited)]) {
        expect(m.workouts).toHaveLength(1)
        expect(m.workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(80)
        expect(m.bodyweight).toHaveLength(1)   // the newer copy's own change is kept too
      }
    })

    it('keeps the later of two edits of the same workout, the newer copy\'s on a tie', () => {
      const a = base({ _ts: 300, workouts: [stampWorkout(logged([set(80)]), 150)] })
      const b = base({ _ts: 100, workouts: [stampWorkout(logged([set(90)]), 250)] })
      expect(mergeStates(a, b).workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(90)
      expect(mergeStates(b, a).workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(90)
      const tie = base({ _ts: 100, workouts: [stampWorkout(logged([set(70)]), 250)] })
      expect(mergeStates(b, { ...tie, _ts: 50 }).workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(90)
    })

    it('a date move replaces the other copy by id too', () => {
      const moved = retimeWorkout(logged([set(80)]), '2026-08-20', '07:00')
      stampWorkout(moved, 100)
      const m = mergeStates(base({ _ts: 100, workouts: [moved] }), base({ _ts: 200, workouts: [logged([set(80)])] }))
      expect(m.workouts).toHaveLength(1)
      expect(m.workouts[0].d).toBe('2026-08-20')
    })

    it('an edit of a workout the other copy deleted brings it back, edited', () => {
      const edited = base({ _ts: 100, workouts: [stampWorkout(logged([set(80)]), 100)] })
      const deleted = base({ _ts: 200, workouts: [] })
      expect(mergeStates(deleted, edited).workouts.map(w => w.exposures[0].performance.sets[0].resistance.value)).toEqual([80])
    })

    it('sign-in keeps the preferred side\'s version as it is', () => {
      const server = base({ _ts: 100, workouts: [logged([set(100)])] })
      const device = base({ _ts: 50, workouts: [stampWorkout(logged([set(80)]), 300)] })
      expect(mergeStates(server, device, { prefer: 'a' }).workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(100)
    })

    // The kept load may be the typo the edit corrected: the other copy's must not bring it back.
    it('does not resurrect a kept load the edit took away, from either side', () => {
      const edited = base({ _ts: 100, workouts: [stampWorkout(logged([set(80)]), 100)], exWeights: { sq: { w: 80, d: '2026-09-01' } } })
      const stale = base({ _ts: 200, workouts: [logged([set(1000)])], exWeights: { sq: { w: 1000, d: '2026-09-01' } } })
      expect(mergeStates(edited, stale).exWeights.sq).toEqual({ w: 80, d: '2026-09-01' })
      expect(mergeStates(stale, edited).exWeights.sq).toEqual({ w: 80, d: '2026-09-01' })
    })

    it('keeps a heavier set the other copy logged since, and its own kept load when that is better', () => {
      const edited = base({ _ts: 100, workouts: [stampWorkout(logged([set(80)]), 100)], exWeights: { sq: { w: 85, d: '2026-08-01' } } })
      const other = base({ _ts: 200, workouts: [logged([set(1000)]), { ...workout('w2', '2026-09-03'), exposures: [set(90)] }], exWeights: { sq: { w: 1000, d: '2026-09-01' } } })
      expect(mergeStates(other, edited).exWeights.sq).toEqual({ w: 90, d: '2026-09-03' })
      const noLater = base({ _ts: 200, workouts: [logged([set(1000)])], exWeights: { sq: { w: 1000, d: '2026-09-01' } } })
      expect(mergeStates(noLater, edited).exWeights.sq).toEqual({ w: 85, d: '2026-08-01' })
    })

    it('keeps assisted-machine kept loads ordered by less help', () => {
      const edited = base({ _ts: 100, workouts: [stampWorkout(logged([set(20, '0017')]), 100)], exWeights: { '0017': { w: 20, d: '2026-09-01' } } })
      const stale = base({ _ts: 200, workouts: [logged([set(30, '0017')])], exWeights: { '0017': { w: 30, d: '2026-09-01' } } })
      expect(mergeStates(stale, edited).exWeights['0017']).toEqual({ w: 20, d: '2026-09-01' })
    })

    it('leaves the kept loads alone when only the date, the length or the note changed', () => {
      const moved = stampWorkout(logged([set(80)], { note: 'moved' }), 100)
      const other = base({ _ts: 200, workouts: [logged([set(80)])], exWeights: { sq: { w: 120, d: '2026-08-01' } } })
      expect(mergeStates(other, base({ _ts: 100, workouts: [moved], exWeights: {} })).exWeights.sq).toEqual({ w: 120, d: '2026-08-01' })
    })
  })

  it('is commutative on the union fields and idempotent', () => {
    const ab = mergeStates(A(), B()), ba = mergeStates(B(), A())
    for (const f of ['workouts', 'routines', 'customEx', 'gymCards']) expect(ids(ab[f]).sort()).toEqual(ids(ba[f]).sort())
    expect(ab.bodyweight).toEqual(ba.bodyweight)
    expect([...ab.favEx].sort()).toEqual([...ba.favEx].sort())
    expect(ab.exWeights).toEqual(ba.exWeights)
    const again = mergeStates(A(), ab)
    expect(ids(again.workouts)).toEqual(ids(ab.workouts))
    expect(ids(again.routines)).toEqual(ids(ab.routines))
    expect(mergeStates(A(), A()).workouts).toEqual(A().workouts)
  })

  it('sorts workouts by day and start, takes the later _ts, drops _rev, does not touch inputs', () => {
    const a = A(), b = B()
    const m = mergeStates(a, b)
    expect(m.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(m._ts).toBe(200)
    expect('_rev' in m).toBe(false)
    expect(a).toEqual(A())
    expect(b).toEqual(B())
    m.workouts[0].exposures.push('x')
    expect(a.workouts[0].exposures).toEqual([])
  })

  it('tolerates a missing side and missing lists', () => {
    expect(mergeStates(A(), null)).toEqual(A())
    expect(mergeStates(null, B())).toEqual(B())
    const sparse = { _ts: 5, workouts: null, routines: undefined }
    const m = mergeStates(sparse, { _ts: 1, workouts: [workout('w')], bodyweight: undefined })
    expect(ids(m.workouts)).toEqual(['w'])
    expect(m.bodyweight).toEqual([])
  })

  it('a workout without an id is kept once by day and start', () => {
    const legacy = { d: '2026-09-01', start: 5, exposures: [] }
    const m = mergeStates({ _ts: 2, workouts: [legacy] }, { _ts: 1, workouts: [{ ...legacy }, { d: '2026-09-01', start: 6, exposures: [] }] })
    expect(m.workouts).toHaveLength(2)
  })

  // Editing the date of a pre-id workout changes the very thing it is keyed by, so the other
  // device's untouched copy has to be recognised as the same record. retimeWorkout freezes the
  // old day-and-start as the id, which is what makes that hold.
  it('a legacy workout moved to another day replaces its untouched copy', () => {
    const legacy = { d: '2026-09-01', start: 5, exposures: [], prs: [] }
    const moved = retimeWorkout(legacy, '2026-08-20', '07:00')
    const m = mergeStates({ _ts: 2, workouts: [moved] }, { _ts: 1, workouts: [{ ...legacy }] })
    expect(m.workouts).toHaveLength(1)
    expect(m.workouts[0].d).toBe('2026-08-20')
  })

  // Why the id is the old key rather than a fresh one: a new id shares nothing with the copy
  // on the other device, so the union keeps both and the workout comes back twice.
  it('a fresh id on the same edit would have duplicated it', () => {
    const legacy = { d: '2026-09-01', start: 5, exposures: [], prs: [] }
    const renamed = { ...legacy, id: 'brand-new', d: '2026-08-20' }
    const m = mergeStates({ _ts: 2, workouts: [renamed] }, { _ts: 1, workouts: [{ ...legacy }] })
    expect(m.workouts).toHaveLength(2)
  })

  // The report that started this: desktop adopted the server copy at T0, the phone logged a
  // workout at T1, the desktop then changed one setting at T2 and pushed its whole document.
  it('the desktop setting and the phone workout both survive', () => {
    const t0 = base({ _ts: 1000, workouts: [workout('w1')], restSec: 90 })
    const server = { ...t0, _ts: 1001, workouts: [workout('w1'), workout('from-phone', '2026-09-05')], _rev: 4 }
    const desktop = { ...t0, _ts: 1002, restSec: 75 }
    const m = mergeStates(desktop, server)
    expect(ids(m.workouts)).toEqual(['w1', 'from-phone'])
    expect(m.restSec).toBe(75)
    expect(m._ts).toBe(1002)
  })
})

describe('sign-in adoption helpers', () => {
  const server = { _ts: 100, unit: 'lb', restSec: 60, workouts: [{ id: 'w1', d: '2026-09-01' }], bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }], routines: [{ id: 'r1', name: 'A' }], week: { 1: ['r1'] } }
  const local = { _ts: 900, unit: 'kg', restSec: 90, workouts: [{ id: 'w9', d: '2026-09-11' }], bodyweight: [{ d: '2026-09-11', w: 81, t: 2 }, { d: '2026-09-01', w: 79, t: 9 }], routines: [{ id: 'rg', name: 'Guest' }], customEx: [{ id: 'c1', name: 'x' }], week: { 2: ['rg'] } }
  it('localExtras counts what the device has that the server does not', () => {
    // the new day, and 09-01: the device's weigh-in of a day the server has too, entered later
    // and different (79 kg is 174.2 lb, not the server's 80 lb)
    expect(localExtras(local, server)).toEqual({ workouts: 1, bodyweight: 2, customEx: 1 })
    expect(localExtras(server, server)).toEqual({ workouts: 0, bodyweight: 0, customEx: 0 })
    expect(localExtras(null, server)).toEqual({ workouts: 0, bodyweight: 0, customEx: 0 })
  })
  it('mergeStates with prefer keeps the preferred side\'s settings and plan although the other is newer', () => {
    const m = mergeStates(server, local, { prefer: 'a' })
    expect(m.unit).toBe('lb'); expect(m.restSec).toBe(60); expect(m.week).toEqual({ 1: ['r1'] })
    expect(m.workouts.map(w => w.id)).toEqual(['w1', 'w9'])
    expect(m.routines.map(r => r.id).sort()).toEqual(['r1', 'rg'])
    expect(m.customEx.map(e => e.id)).toEqual(['c1'])
    // the weigh-in both sides have for the same day: the later `t` wins, as between devices —
    // in the profile's unit (79 kg)
    expect(m.bodyweight.find(e => e.d === '2026-09-01').w).toBe(174.2)
    expect(mergeStates(server, local).unit).toBe('kg')   // without prefer the newer copy decides
  })
})

describe('prescription engine records', () => {
  it('unions prescriptions and 1RMs, and keeps the newer device per progression track', () => {
    const base = { workouts: [], bodyweight: [], exWeights: {} }
    const a = { ...base, _ts: 1, prescriptions: { p1: { id: 'p1' } }, oneRepMaxes: { o1: { id: 'o1' } }, progression: { t1: { trackId: 't1', cyclesCompleted: 0 }, t2: { trackId: 't2', cyclesCompleted: 5 } } }
    const b = { ...base, _ts: 2, prescriptions: { p2: { id: 'p2' } }, oneRepMaxes: { o2: { id: 'o2' } }, progression: { t1: { trackId: 't1', cyclesCompleted: 1 } } }
    const out = mergeStates(a, b)
    expect(Object.keys(out.prescriptions).sort()).toEqual(['p1', 'p2'])
    expect(Object.keys(out.oneRepMaxes).sort()).toEqual(['o1', 'o2'])
    expect(out.progression).toEqual({ t1: { trackId: 't1', cyclesCompleted: 1 }, t2: { trackId: 't2', cyclesCompleted: 5 } })
  })

  it('keeps the progression state for the latest merged completion on a shared track', () => {
    const base = { bodyweight: [], exWeights: {} }
    const aState = { trackId: 't1', cyclesCompleted: 1, lastCompletedLogId: 'log-a' }
    const bState = { trackId: 't1', cyclesCompleted: 2, lastCompletedLogId: 'log-b' }
    const a = { ...base, _ts: 2, workouts: [{ id: 'a', d: '2026-09-01', start: 9, exposures: [{ exposureId: 'log-a', trackId: 't1' }] }], progression: { t1: aState } }
    const b = { ...base, _ts: 1, workouts: [{ id: 'b', d: '2026-09-01', start: 12, exposures: [{ exposureId: 'log-b', trackId: 't1' }] }], progression: { t1: bState } }
    expect(mergeStates(a, b).progression.t1).toEqual(bState)
  })

  it('uses an exposure completion time over its session start time', () => {
    const base = { bodyweight: [], exWeights: {} }
    const aState = { trackId: 't1', lastCompletedLogId: 'log-a' }
    const bState = { trackId: 't1', lastCompletedLogId: 'log-b' }
    const a = { ...base, _ts: 2, workouts: [{ id: 'a', d: '2026-09-01', start: 9, exposures: [{ exposureId: 'log-a', completedAt: '2026-09-01T12:00:00.000Z' }] }], progression: { t1: aState } }
    const b = { ...base, _ts: 1, workouts: [{ id: 'b', d: '2026-09-01', start: 10, exposures: [{ exposureId: 'log-b', completedAt: '2026-09-01T11:00:00.000Z' }] }], progression: { t1: bState } }
    expect(mergeStates(a, b).progression.t1).toEqual(aState)
  })
})

// A conflict used to hand every routine both sides had to the copy whose WHOLE state was newer.
// The phone edits the push day, then the desktop toggles a setting: the desktop's copy is newer,
// and the phone's edit was gone. Each routine now carries its own edit time.
describe('routines keep the version edited last', () => {
  const r = (id, reps, ts) => ({ id, name: id, ex: [{ id: 'bench', sets: 3, reps }], ...(ts != null ? { _ts: ts } : {}) })

  it('the older copy\'s routine wins when it was edited after the newer copy\'s', () => {
    const phone = base({ _ts: 100, routines: [r('push', 15, 90), r('pull', 8, 10)] })
    const desk = base({ _ts: 200, restSec: 60, routines: [r('push', 10, 20), r('pull', 12, 150)] })
    const m = mergeStates(phone, desk)
    expect(m.restSec).toBe(60)                                              // settings: the newer copy
    expect(m.routines.find(x => x.id === 'push').ex[0].reps).toBe(15)      // edited later on the phone
    expect(m.routines.find(x => x.id === 'pull').ex[0].reps).toBe(12)      // edited later on the desk
    expect(ids(m.routines)).toEqual(['push', 'pull'])                       // the newer copy's order
    expect(mergeStates(desk, phone).routines).toEqual(m.routines)
  })

  it('without stamps, or on a tie, the newer copy\'s version stays', () => {
    const a = base({ _ts: 100, routines: [r('push', 15)] })
    const b = base({ _ts: 200, routines: [r('push', 10)] })
    expect(mergeStates(a, b).routines[0].ex[0].reps).toBe(10)
    const c = base({ _ts: 100, routines: [r('push', 15, 50)] })
    const d = base({ _ts: 200, routines: [r('push', 10, 50)] })
    expect(mergeStates(c, d).routines[0].ex[0].reps).toBe(10)
  })

  it('sign-in (prefer) keeps the preferred side\'s plan whatever the stamps say', () => {
    const server = base({ _ts: 100, routines: [r('push', 10, 10)] })
    const device = base({ _ts: 200, routines: [r('push', 15, 90)] })
    expect(mergeStates(server, device, { prefer: 'a' }).routines[0].ex[0].reps).toBe(10)
  })

  it('stampRoutines stamps a new or edited routine and leaves the rest alone', () => {
    const prev = [r('push', 10, 5), r('pull', 8, 6), r('legs', 5, 7)]
    const next = JSON.parse(JSON.stringify(prev))
    next[0].ex[0].reps = 12                     // edited
    next.push(r('core', 20))                    // new
    next.splice(2, 1)                           // legs deleted
    stampRoutines(prev, next, 1000)
    expect(next.map(x => x._ts)).toEqual([1000, 6, 1000])
    // the stamp alone is not an edit: a routine that only carries a different _ts keeps it
    const again = JSON.parse(JSON.stringify(next))
    again[1]._ts = 99
    stampRoutines(next, again, 2000)
    expect(again.map(x => x._ts)).toEqual([1000, 99, 1000])
  })
})

// Structural Balance's per-role exercise choices. Each carries the time it was made and a clear
// is a stamped `id: null`, so the choice made last survives a conflict either way round — the
// newer copy's map used to win wholesale (a role picked on the phone vanished once the desktop
// logged a set), and a plain key union brought a cleared role back from the other device.
describe('balanceOverrides keep the choice made last', () => {
  const pick = (id, ts) => ({ id, _ts: ts })

  it('a role chosen on the older copy survives the newer copy\'s earlier choice', () => {
    const phone = base({ _ts: 100, balanceOverrides: { 'poliquin:dips': pick('0009', 90) } })
    const desk = base({ _ts: 200, restSec: 60, workouts: [workout('w2')], balanceOverrides: { 'poliquin:dips': pick('0251', 20) } })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.restSec).toBe(60)
      expect(m.balanceOverrides['poliquin:dips']).toEqual(pick('0009', 90))
    }
  })

  it('a clear is not undone by the other device\'s older choice, and a later choice beats a clear', () => {
    const cleared = base({ _ts: 100, balanceOverrides: { 'atg:pullups': pick(null, 80) } })
    const stale = base({ _ts: 300, balanceOverrides: { 'atg:pullups': pick('0017', 40) } })
    expect(mergeStates(cleared, stale).balanceOverrides['atg:pullups']).toEqual(pick(null, 80))
    expect(mergeStates(stale, cleared).balanceOverrides['atg:pullups']).toEqual(pick(null, 80))
    const later = base({ _ts: 50, balanceOverrides: { 'atg:pullups': pick('0652', 95) } })
    expect(mergeStates(cleared, later).balanceOverrides['atg:pullups']).toEqual(pick('0652', 95))
  })

  it('roles set on different devices are all kept; a tie or an unstamped entry goes to the newer copy', () => {
    const a = base({ _ts: 100, balanceOverrides: { 'poliquin:dips': pick('0009', 10), 'atg:nordicCurl': '0599' } })
    const b = base({ _ts: 200, balanceOverrides: { 'poliquin:barbellCurl': pick('0031', 30), 'atg:nordicCurl': '3193' } })
    const m = mergeStates(a, b)
    expect(Object.keys(m.balanceOverrides).sort()).toEqual(['atg:nordicCurl', 'poliquin:barbellCurl', 'poliquin:dips'])
    expect(m.balanceOverrides['atg:nordicCurl']).toBe('3193')
    expect(mergeStampedMap({ k: pick('x', 5) }, { k: pick('y', 5) }).k.id).toBe('x')
  })

  it('prefer keeps the preferred side\'s choice; one side without the map keeps the other\'s', () => {
    const server = base({ _ts: 10, balanceOverrides: { 'poliquin:dips': pick('0251', 5) } })
    const local = base({ _ts: 90, balanceOverrides: { 'poliquin:dips': pick('0009', 80), 'atg:pullups': pick('0017', 80) } })
    const m = mergeStates(server, local, { prefer: 'a' })
    expect(m.balanceOverrides).toEqual({ 'poliquin:dips': pick('0251', 5), 'atg:pullups': pick('0017', 80) })
    const bare = base({ _ts: 500 })
    expect(mergeStates(bare, local).balanceOverrides).toEqual(local.balanceOverrides)
    expect(mergeStates(bare, base({ _ts: 1 })).balanceOverrides).toBeUndefined()
  })

  it('the merged map is a copy, not the input', () => {
    const a = base({ _ts: 100, balanceOverrides: { k: pick('x', 1) } })
    const m = mergeStates(a, base({ _ts: 50 }))
    m.balanceOverrides.k.id = 'changed'
    expect(a.balanceOverrides.k.id).toBe('x')
  })
})

// Plate loading (lib/plates.js): an exercise's loading and each unit's plate inventory are
// stamped like a Structural Balance override, the way back to the default included, so the
// change made last survives a conflict either way round. A plain key union let the copy that was
// newer as a whole undo a choice made on the other device, and brought a reset list back.
describe('plate loading keeps the choice made last', () => {
  const SQUAT = '0043'   // barbell: per side unless you say otherwise

  it('a load kind picked on the older copy survives the newer copy\'s earlier pick', () => {
    const phone = base({ _ts: 100, loadKind: withLoadKind({}, SQUAT, 'none', 90) })
    const desk = base({ _ts: 200, workouts: [workout('w2')], loadKind: withLoadKind({}, SQUAT, 'single', 20) })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(ids(m.workouts)).toEqual(['w2'])
      expect(loadKindFor(m, SQUAT)).toBe('none')
    }
  })

  it('going back to the equipment\'s loading is not undone by an older pick, and a later pick beats it', () => {
    const back = base({ _ts: 100, loadKind: withLoadKind({}, SQUAT, null, 80) })
    const stale = base({ _ts: 300, loadKind: withLoadKind({}, SQUAT, 'single', 40) })
    expect(loadKindFor(mergeStates(back, stale), SQUAT)).toBe('pairs')
    expect(loadKindFor(mergeStates(stale, back), SQUAT)).toBe('pairs')
    const later = base({ _ts: 50, loadKind: withLoadKind({}, SQUAT, 'single', 95) })
    expect(loadKindFor(mergeStates(back, later), SQUAT)).toBe('single')
  })

  it('exercises set on different devices are all kept; a bare kind from the first builds loses to a stamped one', () => {
    const a = base({ _ts: 100, loadKind: { ...withLoadKind({}, 'a', 'single', 10), c: 'none' } })
    const b = base({ _ts: 200, loadKind: { ...withLoadKind({}, 'b', 'none', 30), c: withLoadKind({}, 'c', 'single', 5).c } })
    const m = mergeStates(b, a)
    expect(Object.keys(m.loadKind).sort()).toEqual(['a', 'b', 'c'])
    expect(m.loadKind.c).toEqual({ kind: 'single', _ts: 5 })
  })

  it('a unit\'s plate list is kept whole as last counted; the other unit\'s comes along', () => {
    const home = withPlatePairs({ unit: 'lb' }, 45, 1, 90)
    const phone = base({ _ts: 100, unit: 'lb', plates: home })
    const desk = base({ _ts: 200, unit: 'lb', workouts: [workout('w2')], plates: { ...withPlatePairs({ unit: 'lb' }, 25, 2, 20), kg: { 20: 1, _ts: 15 } } })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.plates.lb).toEqual(home.lb)
      expect(inventoryFor(m).find(p => p.w === 45).n).toBe(1)
      expect(inventoryFor(m).find(p => p.w === 25).n).toBe(6)   // not the desk's 2: one list, not a mix
      expect(m.plates.kg).toEqual({ 20: 1, _ts: 15 })
    }
  })

  it('"Back to the standard set" wins against the other device\'s older list', () => {
    const own = { unit: 'lb', plates: withPlatePairs({ unit: 'lb' }, 45, 1, 40) }
    const reset = base({ _ts: 100, unit: 'lb', plates: withStandardPlates(own, 80) })
    const stale = base({ _ts: 300, unit: 'lb', plates: own.plates })
    for (const m of [mergeStates(reset, stale), mergeStates(stale, reset)]) {
      expect(inventoryFor(m)).toEqual(inventoryFor({ unit: 'lb' }))
    }
  })

  it('sign-in keeps the server\'s choices and adds what only the device has', () => {
    const server = base({ _ts: 10, loadKind: withLoadKind({}, SQUAT, 'single', 5), plates: { kg: { 20: 1, _ts: 5 } } })
    const local = base({ _ts: 90, loadKind: withLoadKind(withLoadKind({}, SQUAT, 'none', 80), 'b', 'single', 80), plates: { kg: { 20: 4, _ts: 80 }, lb: { 45: 2, _ts: 80 } } })
    const m = mergeStates(server, local, { prefer: 'a' })
    expect(m.loadKind).toEqual({ [SQUAT]: { kind: 'single', _ts: 5 }, b: { kind: 'single', _ts: 80 } })
    expect(m.plates).toEqual({ kg: { 20: 1, _ts: 5 }, lb: { 45: 2, _ts: 80 } })
    expect(mergeStates(base({ _ts: 500 }), base({ _ts: 1 })).plates).toBeUndefined()
  })
})

describe('custom exercises keep the version edited last', () => {
  const photo = hash => ({ kind: 'image', hash: hash.repeat(64), mime: 'image/webp', size: 10, width: 4, height: 3, at: 1 })
  const cx = (over = {}) => ({ id: 'c1', n: 'sandbag carry', bp: 'back', custom: true, ...over })

  it('a photo added on A survives a merge with B, which is newer as a whole', () => {
    const A = base({ _ts: 100, customEx: [cx({ media: photo('a'), _ts: 90 })] })
    const B = base({ _ts: 200, customEx: [cx({ _ts: 10 })], workouts: [workout('wB')] })
    const out = mergeStates(A, B)
    expect(out.customEx[0].media.hash).toBe('a'.repeat(64))
    expect(ids(out.workouts)).toEqual(['wB'])
    expect(mergeStates(B, A).customEx[0].media.hash).toBe('a'.repeat(64))
  })

  it('on a tie, or without stamps, the newer copy\'s version stays', () => {
    const A = base({ _ts: 100, customEx: [cx({ url: 'https://a.example/', _ts: 7 })] })
    const B = base({ _ts: 200, customEx: [cx({ url: 'https://b.example/', _ts: 7 })] })
    expect(mergeStates(A, B).customEx[0].url).toBe('https://b.example/')
    const C = base({ _ts: 100, customEx: [cx({ url: 'https://a.example/' })] })
    const D = base({ _ts: 200, customEx: [cx({ url: 'https://b.example/' })] })
    expect(mergeStates(C, D).customEx[0].url).toBe('https://b.example/')
  })

  it('sign-in (prefer) keeps the preferred side\'s version whatever the stamps say', () => {
    const server = base({ _ts: 100, customEx: [cx({ _ts: 1 })] })
    const device = base({ _ts: 50, customEx: [cx({ media: photo('d'), _ts: 99 })] })
    expect(mergeStates(server, device, { prefer: 'a' }).customEx[0].media).toBeUndefined()
  })

  it('stampCustomEx stamps a new or edited exercise and leaves the rest alone', () => {
    const prev = [cx({ _ts: 5 }), cx({ id: 'c2', n: 'b', _ts: 5 })]
    const next = JSON.parse(JSON.stringify(prev))
    next[0].media = photo('e')
    next.push(cx({ id: 'c3', n: 'new' }))
    stampCustomEx(prev, next, 1000)
    expect(next.map(c => c._ts)).toEqual([1000, 5, 1000])
    // Only the stamp differing is no edit.
    const again = JSON.parse(JSON.stringify(next))
    again[1]._ts = 6
    stampCustomEx(next, again, 2000)
    expect(again.map(c => c._ts)).toEqual([1000, 6, 1000])
  })
})


// QA, v1.3.9 (t9): a copy converted to lb met the other device's kg copy, and the merge compared
// the numbers as they were — the server ended in kg with lb numbers in it.
describe('two copies in different units', () => {
  const lifted = (id, w) => ({ id, d: '2026-09-20', start: 1, end: 2, exposures: [ex('0025', w)] })
  const kg = base({ _ts: 300, workouts: [lifted('w1', 60), lifted('w-kg', 70)], bodyweight: [{ d: '2026-09-27', w: 81, t: 300 }], exWeights: { '0025': { w: 55, d: '2026-09-20' } } })
  const lb = { ...convertStateUnit(base({ _ts: 200, workouts: [lifted('w1', 60)], exWeights: { '0025': { w: 55, d: '2026-09-20' } } }), 'lb'), unitSet: { at: 200, convert: true } }

  it('the unit chosen last stays, and the other copy is converted into it before anything is compared', () => {
    for (const m of [mergeStates(kg, lb), mergeStates(lb, kg)]) {
      expect(m.unit).toBe('lb')
      expect(m.unitSet).toEqual({ at: 200, convert: true })
      expect(m.workouts.find(w => w.id === 'w-kg').exposures[0].performance.sets[0].resistance.value).toBe(convertWeight(70, 'kg', 'lb'))
      expect(m.workouts.find(w => w.id === 'w1').exposures[0].performance.sets[0].resistance.value).toBe(convertWeight(60, 'kg', 'lb'))
      expect(m.bodyweight[0].w).toBe(convertBodyWeight(81, 'kg', 'lb'))
      // the kept load is compared in one unit: 70 kg lifted since beats the 55 kg in both copies
      expect(m.exWeights['0025'].w).toBe(convertWeight(55, 'kg', 'lb'))
    }
  })

  it('with no switch stamped on either side, the newer copy\'s unit stays', () => {
    const old = { ...convertStateUnit(base({ _ts: 100, workouts: [lifted('w1', 60)] }), 'lb') }
    const m = mergeStates(old, kg)
    expect(m.unit).toBe('kg')
    expect(m.workouts.find(w => w.id === 'w1').exposures[0].performance.sets[0].resistance.value).toBe(60)
  })

  it('a label-only switch relabels the other copy instead of converting it', () => {
    const relabelled = { ...base({ _ts: 200 }), unit: 'lb', unitSet: { at: 200, convert: false } }
    const m = mergeStates(kg, relabelled)
    expect(m.unit).toBe('lb')
    expect(m.workouts.find(w => w.id === 'w-kg').exposures[0].performance.sets[0].resistance.value).toBe(70)
    expect(m.bodyweight[0].w).toBe(81)
  })

  it('with prefer (sign-in), the preferred side\'s unit stays', () => {
    const m = mergeStates(lb, kg, { prefer: 'a' })
    expect(m.unit).toBe('lb')
    expect(m.workouts.find(w => w.id === 'w-kg').exposures[0].performance.sets[0].resistance.value).toBe(convertWeight(70, 'kg', 'lb'))
  })
})

// QA, v1.3.9 (t8): "Reset everything" on one device; another pushed a change of its own, got the
// 409, merged, and the union brought the whole wiped profile back.
describe('a reset holds against a copy that has not seen it', () => {
  const R = 5000
  const reset = base({ _ts: R, resetAt: R, restSec: 90 })
  const w = (id, end, extra = {}) => ({ id, d: '2026-09-01', start: end - 10, end, exposures: [ex('0025', 100)], ...extra })
  const stale = base({
    _ts: 6000, restSec: 45,
    workouts: [w('old', 1000), w('new', 5500), w('old-edited', 1000, { _ts: 5600 }), w('backfilled', 1000, { _ts: 5700 })],
    routines: [{ id: 'r-old', name: 'old', ex: [], _ts: 100 }, { id: 'r-new', name: 'new', ex: [], _ts: 5800 }, { id: 'r-unstamped', name: 'x', ex: [] }],
    bodyweight: [{ d: '2026-08-01', w: 80, t: 100 }, { d: '2026-09-27', w: 81, t: 5900 }],
    customEx: [{ id: 'c-old', n: 'old', _ts: 100 }, { id: 'c-new', n: 'new', _ts: 5900 }],
    favEx: ['0025'], exNotes: { '0025': 'seat 4' }, gymCards: [{ id: 'g1', value: '123' }],
    exWeights: { '0025': { w: 140, d: '2026-08-01' }, '0100': { w: 30, d: '2026-08-01' } },
    loadKind: { '0025': { kind: 'single', _ts: 100 }, '0100': { kind: 'pairs', _ts: 5900 } },
  })

  it('without resetIds (a reset from before they were kept) keeps only what the other copy made after it, whichever copy is newer', () => {
    for (const m of [mergeStates(reset, stale), mergeStates(stale, reset)]) {
      expect(ids(m.workouts).sort()).toEqual(['backfilled', 'new', 'old-edited'])
      expect(ids(m.routines)).toEqual(['r-new'])
      expect(m.bodyweight.map(e => e.d)).toEqual(['2026-09-27'])
      expect(ids(m.customEx)).toEqual(['c-new'])
      expect(m.favEx || []).toEqual([])
      expect(m.exNotes || {}).toEqual({})
      expect(m.gymCards || []).toEqual([])
      expect(Object.keys(m.loadKind)).toEqual(['0100'])
      // the kept loads are those of the workouts that remain, not the ones from before the reset
      expect(m.exWeights).toEqual({ '0025': { w: 100, d: '2026-09-01' } })
      expect(m.restSec).toBe(90)       // the reset copy's settings, though the other is newer
      expect(m.resetAt).toBe(R)
      expect(m._ts).toBe(6000)
    }
  })

  it('two copies that both saw the reset merge as usual', () => {
    const after = { ...stale, resetAt: R }
    expect(ids(mergeStates(reset, after).workouts)).toHaveLength(4)
  })

  it('a later reset wins over an earlier one', () => {
    const later = base({ _ts: 9000, resetAt: 9000 })
    expect(mergeStates({ ...stale, resetAt: R }, later).workouts).toEqual([])
  })

  it('not on sign-in: the device\'s own exposures are not a copy of the account\'s history', () => {
    const m = mergeStates(reset, stale, { prefer: 'a' })
    expect(ids(m.workouts)).toHaveLength(4)
  })

  it('sinceReset leaves the copy it reads alone', () => {
    const before = JSON.stringify(stale)
    sinceReset(stale, R)
    sinceReset(stale, R, resetIdsOf(stale))
    expect(JSON.stringify(stale)).toBe(before)
  })
})

// Review of the reset rule: judging by dates dropped a CSV import of old sessions, an Apple Health
// weigh-in history, a workout logged on a device whose clock runs behind, and anything undated.
// The reset now names what it wiped (resetIds), and only that goes.
describe('a reset names what it wiped', () => {
  const clone = v => JSON.parse(JSON.stringify(v))
  const R = Date.now()
  const w = (id, end, extra = {}) => ({ id, d: '2026-09-01', start: end - 10, end, exposures: [ex('0025', 100)], ...extra })
  // what the profile held when it was reset — on the resetting device and on the stale one alike
  const before = base({
    _ts: R - 1000,
    workouts: [w('old', R - 5000)], routines: [{ id: 'r-old', name: 'old', ex: [], _ts: R - 5000 }],
    bodyweight: [{ d: '2026-08-01', w: 80, t: R - 5000 }], customEx: [{ id: 'c-old', n: 'old', _ts: R - 5000 }],
    favEx: ['0025'], exNotes: { '0025': 'seat 4' }, gymCards: [{ id: 'g1', value: '123' }],
    loadKind: { '0025': { kind: 'single', _ts: R - 5000 } },
  })
  const reset = base({ _ts: R, resetAt: R, resetIds: resetIdsOf(before) })

  it('drops exactly the wiped exposures of a copy that has not seen the reset', () => {
    const stale = clone(before)
    stale._ts = R + 10
    for (const m of [mergeStates(reset, stale), mergeStates(stale, reset)]) {
      expect(m.workouts).toEqual([])
      expect(m.routines || []).toEqual([])
      expect(m.bodyweight).toEqual([])
      expect(m.customEx || []).toEqual([])
      expect(m.favEx || []).toEqual([])
      expect(m.exNotes || {}).toEqual({})
      expect(m.gymCards || []).toEqual([])
      expect(m.loadKind || {}).toEqual({})
      expect(m.exWeights).toEqual({})
      expect(m.resetAt).toBe(R)
    }
  })

  it('keeps a CSV import of old sessions and an old weigh-in history made on that device', () => {
    const stale = clone(before)
    mergeImport(stale, { kind: 'workouts', customEx: [], workouts: [{ id: 'iw1', d: '2024-03-01', start: Date.parse('2024-03-01') - 10, end: Date.parse('2024-03-01'), entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 100, r: 5, done: true }] }] }] })
    mergeImport(stale, { kind: 'bodyweight', bodyweight: [{ d: '2024-03-01', w: 80, t: Date.parse('2024-03-01') }] })
    const m = mergeStates(stale, reset)
    expect(ids(m.workouts)).toEqual(['iw1'])
    expect(m.bodyweight.map(e => e.d)).toEqual(['2024-03-01'])
  })

  it('keeps a workout logged after the reset on a device whose clock runs behind', () => {
    const stale = { ...clone(before), workouts: [...before.workouts, w('after-but-skewed', R - 60000)] }
    expect(ids(mergeStates(stale, reset).workouts)).toEqual(['after-but-skewed'])
  })

  it('keeps exposures with no date or stamp at all', () => {
    const stale = { ...clone(before), workouts: [{ id: 'undated', exposures: [] }], routines: [{ id: 'r-unstamped', name: 'x', ex: [] }], customEx: [{ id: 'c-unstamped', n: 'x' }] }
    const m = mergeStates(reset, stale)
    expect(ids(m.workouts)).toEqual(['undated'])
    expect(ids(m.routines)).toEqual(['r-unstamped'])
    expect(ids(m.customEx)).toEqual(['c-unstamped'])
  })

  it('the stamp only moves forward: with prefer, and with a copy that carries none', () => {
    const backup = base({ _ts: 5, workouts: [w('restored', 4)] })
    const m = mergeStates(backup, reset, { prefer: 'a' })
    expect(m.resetAt).toBe(R)
    expect(m.resetIds).toEqual(reset.resetIds)
    expect(ids(m.workouts)).toEqual(['restored'])
    // a copy restored with the stamp kept merges with one that saw the reset as usual
    const restored = { ...backup, resetAt: R, resetIds: reset.resetIds, _ts: R + 5 }
    const seen = base({ _ts: R + 1, resetAt: R, resetIds: reset.resetIds, workouts: [w('gym-today', R + 1)] })
    expect(ids(mergeStates(seen, restored).workouts).sort()).toEqual(['gym-today', 'restored'])
  })

  it('keepReset: a replace never takes the stamp back; the same reset\'s names are joined', () => {
    const cur = { resetAt: R, resetIds: { workouts: ['a'] } }
    expect(keepReset(cur, { workouts: [] })).toMatchObject({ resetAt: R, resetIds: { workouts: ['a'] } })
    expect(keepReset(cur, { resetAt: R + 1, resetIds: { workouts: ['b'] } }).resetIds).toEqual({ workouts: ['b'] })
    expect(keepReset(cur, { resetAt: R, resetIds: { workouts: ['b'] } }).resetIds).toEqual({ workouts: ['a', 'b'] })
    expect(keepReset({}, { workouts: [] })).toEqual({ workouts: [] })
  })

  it('names are joined across copies and bounded', () => {
    expect(mergeResetIds({ workouts: ['a', 'b'] }, { workouts: ['b', 'c'], routines: ['r'] })).toEqual({ workouts: ['a', 'b', 'c'], routines: ['r'] })
    const many = Array.from({ length: RESET_ID_MAX + 5 }, (_, i) => 'w' + i)
    const out = mergeResetIds({ workouts: many }, null).workouts
    expect(out).toHaveLength(RESET_ID_MAX)
    expect(out.at(-1)).toBe('w' + (RESET_ID_MAX + 4))
  })
})

// QA, v1.3.9: a weigh-in logged on the phone on a day the profile already had one was dropped on
// pairing without the question being asked.
describe('localExtras and the weigh-ins of a day both copies have', () => {
  const server = { unit: 'kg', workouts: [], bodyweight: [{ d: '2026-09-27', w: 80, t: 100 }] }
  it('counts a same-day weigh-in that differs and was entered later', () => {
    expect(localExtras({ unit: 'kg', bodyweight: [{ d: '2026-09-27', w: 81.5, t: 200 }] }, server).bodyweight).toBe(1)
  })
  it('not the same reading, nor one the server\'s later entry replaced', () => {
    expect(localExtras({ unit: 'kg', bodyweight: [{ d: '2026-09-27', w: 80, t: 200 }] }, server).bodyweight).toBe(0)
    expect(localExtras({ unit: 'kg', bodyweight: [{ d: '2026-09-27', w: 82, t: 50 }] }, server).bodyweight).toBe(0)
  })
  it('compares in the server\'s unit', () => {
    expect(localExtras({ unit: 'lb', bodyweight: [{ d: '2026-09-27', w: convertBodyWeight(80, 'kg', 'lb'), t: 200 }] }, server).bodyweight).toBe(0)
  })
})
