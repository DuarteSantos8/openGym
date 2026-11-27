/* api/sync-stamps.js is a hand copy of the stamping rules here (sync-merge.js), for the server's
   PUT /api/data. The two must agree; and what the server stamps for a writer that does not stamp
   its own changes (an older app, an API planner) must hold in this side's merge. */
import { describe, expect, it } from 'vitest'
import * as S from '../../../api/sync-stamps.js'
import { highestStamp, mergeDeletions, mergeEdits, mergeOptionalEntries, mergeStates, stampChange, stampEntry, stampEdits, stampRestore, stampOptionalCollections, visibleOptionalEntries } from './sync-merge.js'
import { normalizeEntry } from './nutrition/entry.js'

const clone = v => JSON.parse(JSON.stringify(v))
it('optional stamping preserves malformed retained elements during unrelated edits on both sides', () => {
  const raw = [null, false, 17, [], { opaque: true }]
  const prev = { nutritionEntries: [...raw, { id: 'food', label: 'Before', _ts: 10, _f: { label: 10 } }] }
  const next = clone(prev); next.nutritionEntries.at(-1).label = 'After'
  const client = clone(next), server = clone(next)
  stampOptionalCollections(prev, client, 20); S.stampOptionalCollections(prev, server, 20)
  expect(client.nutritionEntries.slice(0, raw.length)).toEqual(raw)
  expect(server.nutritionEntries).toEqual(client.nutritionEntries)
  expect(visibleOptionalEntries(client, 'nutritionEntries').map(e => e.id)).toEqual(['food'])
  expect(client.nutritionEntries.at(-1)._f).toEqual({ label: 20 })
  const unchanged = clone(prev), serverUnchanged = clone(prev)
  stampOptionalCollections(prev, unchanged, 30); S.stampOptionalCollections(prev, serverUnchanged, 30)
  expect(unchanged).toEqual(prev); expect(serverUnchanged).toEqual(prev)
  for (const stamp of [stampOptionalCollections, S.stampOptionalCollections]) {
    const legacy = { workouts: [], _ts: 7 }, before = JSON.stringify(legacy)
    stamp(clone(legacy), legacy, 20)
    expect(JSON.stringify(legacy)).toBe(before)
  }
})
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }

describe('api/sync-stamps.js matches sync-merge.js', () => {
  it('on random records and entries', () => {
    for (let seed = 1; seed < 300; seed++) {
      const R = rng(seed)
      const n = () => Math.floor(R() * 1000) * (R() < 0.3 ? -1 : 1)
      const recs = () => ({ workouts: { a: n(), b: n() }, favEx: { x: n() }, bodyweight: R() < 0.5 ? { '2026-10-01': n() } : undefined })
      const a = recs(), b = recs()
      expect(S.mergeDeletions(a, b)).toEqual(mergeDeletions(a, b))
      const ea = { restSec: n(), 'week.1': n() }, eb = { restSec: n(), queue: n() }
      expect(S.mergeEdits(ea, eb)).toEqual(mergeEdits(ea, eb))
      const doc = { _ts: n(), edited: ea, deleted: a, routines: [{ id: 'r', _ts: n(), _f: { name: n() } }], plates: { kg: { _ts: n() } } }
      expect(S.highestStamp(doc)).toBe(highestStamp(doc))
      const old = { id: 'r', name: 'A', ex: [1], _f: { ex: 5 }, ...(R() < 0.5 ? { _u: { ex: [1, 5, 5] } } : {}) }
      const x = { id: 'r', name: R() < 0.5 ? 'A' : 'B', ex: [1, R() < 0.5 ? 2 : 1], ...(R() < 0.3 ? { _u: { name: [0, 4], ex: [1, 5, 5] } } : {}) }
      expect(S.stampEntry(clone(old), clone(x), 99)).toEqual(stampEntry(clone(old), clone(x), 99))
    }
  })
})

describe('a removal and an add-back with the same stamp', () => {
  // QA round 2 (2026-10-06): two phones lifted their clocks from one highest stamp, so one's Undo
  // (-H-2) and the other's removal (+H-2) tied, and the first argument won: the device (local
  // first) and the server (stored first) kept opposite records.
  const H = 1_800_000_000_000
  it('merges the same in either order, on both sides: the add-back wins', () => {
    const a = { routines: { R: -(H + 2) } }, b = { routines: { R: H + 2 } }
    for (const f of [mergeDeletions, S.mergeDeletions]) {
      expect(f(a, b)).toEqual({ routines: { R: -(H + 2) } })
      expect(f(b, a)).toEqual({ routines: { R: -(H + 2) } })
    }
  })
  it('the routine put back with Undo is kept whichever phone merges first', () => {
    const R = { id: 'R', name: 'Push', ex: [], _ts: H - 10 }
    const base = { _ts: H, unit: 'kg', workouts: [], routines: [R], week: { 1: ['R'] } }
    const A = { ...clone(base), routines: [{ ...R, _ts: H + 2 }], deleted: { routines: { R: -(H + 2) } } }
    const B = { ...clone(base), routines: [], week: {}, deleted: { routines: { R: H + 2 } } }
    const ab = mergeStates(A, B), ba = mergeStates(B, A)
    expect(ab.deleted).toEqual(ba.deleted)
    expect(ab.routines.map(r => r.id)).toEqual(['R'])
    expect(ba.routines.map(r => r.id)).toEqual(['R'])
  })
})

describe('what the server stamps holds in the merge', () => {
  const T = 1_800_000_000_000
  const change = (prev, wall, mut) => { const n = clone(prev); mut(n); n._ts = stampChange(prev, n, wall); return n }
  const doc0 = () => ({ _ts: T, restSec: 90, queue: { label: 'US W1' }, edited: { queue: T },
    routines: [{ id: 'r1', name: 'A', ex: [], _ts: T }, { id: 'r2', name: 'B', ex: [], _ts: T }],
    workouts: [{ id: 'w1', d: '2026-10-01', start: T - 2e6, end: T - 1e6 }], favEx: [] })

  it('a planner\'s new week and removed routine survive a phone that reconnects with an older change', () => {
    const cur = doc0()
    const phone = change(cur, T + 60e3, S2 => { S2.workouts.push({ id: 'w2', d: '2026-10-06', start: T, end: T + 60e3 }) })   // offline
    const planned = clone(cur)
    planned.queue = { label: 'US W2' }
    planned.routines = planned.routines.filter(r => r.id !== 'r2')
    planned._ts = T + 30e3
    S.stampPut(cur, planned, { overRead: true, now: T + 30e3 })
    // the phone's later push gets the 409 and merges (phone's _ts is newer)
    const m = mergeStates(phone, planned)
    expect(m.queue).toEqual({ label: 'US W2' })
    expect(m.routines.map(r => r.id)).toEqual(['r1'])
    expect(m.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2'])
  })

  it('an older app\'s offline delete and setting hold against an older change from an updated device', () => {
    const cur = doc0()
    const rc = change(cur, T + 5000, S2 => { S2.restSec = 60 })        // updated device, offline, not pushed yet
    const old = clone(cur); delete old.edited
    old.restSec = 180; old.workouts = []; old._ts = T + 9000              // v1.3.9, later
    S.stampPut(cur, old, { overRead: true, now: T + 9000 })
    const m = mergeStates(rc, old)
    expect(m.restSec).toBe(180)
    expect(m.workouts).toEqual([])
  })

  it('an older app\'s push keeps the removals on record, and an entry it brings back stays', () => {
    const cur = change(doc0(), T + 1000, S2 => { S2.workouts = [] })    // the RC deleted w1
    const old = clone(doc0()); delete old.edited                       // v1.3.9 offline, union brings w1 back
    old.favEx = []; old._ts = T + 2000
    S.stampPut(cur, old, { overRead: true, now: T + 2000 })
    expect(Object.keys(old.deleted.workouts)).toEqual(['w1'])
    expect(old.deleted.workouts.w1).toBeLessThan(0)   // kept, as added back: never flips back and forth
    const rcAgain = change(cur, T + 1500, S2 => { S2.restSec = 70 })
    expect(mergeStates(rcAgain, old).workouts.map(w => w.id)).toEqual(['w1'])
    expect(mergeStates(old, rcAgain).workouts.map(w => w.id)).toEqual(['w1'])
  })

  // RC review 2026-10-07: v1.3.9's exercise sheet saved a routine without the pyramid it does not
  // know, and the updated phone took that on its next merge.
  it('an older app\'s routine save keeps the pyramid on the updated phone too', () => {
    const cur = doc0()
    cur.routines[0].ex = [{ id: 'sq', sets: 4, reps: 12, weight: 40, pyramid: [12, 10, 8, 'max'] }]
    const rc = change(cur, T + 5000, S2 => { S2.restSec = 75 })   // the updated phone, not pushed yet
    const old = clone(cur); delete old.edited
    old.routines[0].ex = [{ id: 'sq', sets: 4, reps: 12, weight: 45 }]; old._ts = T + 9000
    S.stampPut(cur, old, { overRead: true, now: T + 9000 })
    for (const m of [mergeStates(rc, old), mergeStates(old, rc)]) {
      expect(m.routines[0].ex).toEqual([{ id: 'sq', sets: 4, reps: 12, weight: 45, pyramid: [12, 10, 8, 'max'] }])
      expect(m.restSec).toBe(75)
    }
  })

  // RC review 2026-10-07: an older app back from offline set the rest timer back on every device.
  it('an older app\'s older copy after a dead spot does not undo a setting the updated phone changed since', () => {
    const cur = change(doc0(), T + 1000, S2 => { S2.restSec = 60 })     // the updated phone, pushed
    const old = clone(doc0()); old.restSec = 90; old._ts = T + 9000         // v1.3.9 merged its older copy
    old.workouts.push({ id: 'w9', d: '2026-10-07', start: T + 8000, end: T + 9000 })
    S.stampPut(cur, old, { overRead: true, now: T + 9000 })
    expect(old.restSec).toBe(60)
    const later = change(cur, T + 2000, S2 => { S2.queue = { label: 'US W3' } })   // the phone, offline meanwhile
    for (const m of [mergeStates(later, old), mergeStates(old, later)]) {
      expect(m.restSec).toBe(60)
      expect(m.workouts.map(w => w.id).sort()).toEqual(['w1', 'w9'])
    }
  })
})

describe('the write ids are no setting', () => {
  it('neither a change nor a restored backup stamps them', () => {
    const prev = { _ts: 1, _wid: 'a', _wids: ['x'], restSec: 90 }
    const next = { ...clone(prev), _wid: 'b', _wids: ['x', 'a'] }
    expect(stampEdits(prev, next, 5).edited).toBeUndefined()
    expect(Object.keys(stampRestore({ _wid: 'b', _wids: ['a'], restSec: 60 }, [], 9).edited)).not.toContain('_wid')
  })
})


describe('optional collection helper parity', () => {
  it('uses identical field merge, deletion, stamping and projection rules on both sides', async () => {
    const C = await import('./sync-merge.js')
    expect(S.OPTIONAL_COLLECTIONS).toEqual(C.OPTIONAL_COLLECTIONS)
    for (const key of C.OPTIONAL_COLLECTIONS) for (let seed = 1; seed <= 100; seed++) {
      const R = rng(seed), time = () => Math.floor(R() * 4) + 1
      const entry = () => ({ id: 'a', schemaVersion: 1, value: Math.floor(R() * 4), _ts: time(), _f: { value: time(), schemaVersion: 1 } })
      const a = { [key]: [entry()], deleted: { [key]: { a: R() < 0.5 ? 3 : -3 } } }
      const b = { [key]: [entry(), { id: 'b', value: seed, _ts: 1 }], deleted: { [key]: { a: R() < 0.5 ? 4 : -4 } } }
      expect(S.mergeOptionalEntries(a[key], b[key])).toEqual(C.mergeOptionalEntries(a[key], b[key]))
      expect(S.mergeOptionalCollections(a, b, {})).toEqual(C.mergeOptionalCollections(a, b, {}))
      expect(S.visibleOptionalEntries(a, key)).toEqual(C.visibleOptionalEntries(a, key))
      expect(S.stampOptionalCollections(a, clone(b), 20)).toEqual(C.stampOptionalCollections(a, clone(b), 20))
      expect(S.highestStamp(a)).toBe(C.highestStamp(a))
      expect(S.mergeDeletions(a.deleted, b.deleted)).toEqual(C.mergeDeletions(a.deleted, b.deleted))
    }
  })
})

describe('nutrition amount groups merge atomically on client and API', () => {
  const food = fields => ({
    id: '22d16a0e-fdb7-4956-b785-a1ffe219b60c', schemaVersion: 1,
    createdAt: '2026-02-01T03:30:00.000Z', createdBy: 'file-import', source: 'OpenNutriTracker',
    externalId: 'beans', day: '2026-02-01', timeZone: 'UTC', meal: 'lunch', label: 'Beans',
    ...fields,
  })
  const grams = (at = 10, serving = true) => food({
    amountG: 50, ...(serving ? { serving: { label: 'bowl', count: 1, size: 50, unit: 'g' } } : {}),
    _ts: at, _f: { amountG: at, ...(serving ? { serving: at } : {}) },
  })
  const millilitres = (at = 20, serving = false) => food({
    amountMl: 250, ...(serving ? { serving: { label: 'glass', count: 1, size: 250, unit: 'mL' } } : {}),
    _ts: at, _f: { amountMl: at, ...(serving ? { serving: at } : {}) },
  })
  const bothOrders = (a, b, check) => {
    const ab = mergeOptionalEntries([a], [b]), ba = mergeOptionalEntries([b], [a])
    expect(ab).toEqual(ba)
    expect(S.mergeOptionalEntries([a], [b])).toEqual(ab)
    expect(S.mergeOptionalEntries([b], [a])).toEqual(ab)
    check(ab[0])
    return ab[0]
  }
  it('chooses the newest complete dimension in either argument order and keeps field evidence', () => {
    const merged = bothOrders(grams(10), millilitres(20), row => {
      expect(row).toMatchObject({ amountMl: 250, _f: { amountG: 10, amountMl: 20, serving: 10 } })
      expect(row).not.toHaveProperty('amountG')
      expect(row).not.toHaveProperty('serving')
      expect(normalizeEntry(row).supported).toBe(true)
    })
    expect(mergeOptionalEntries([merged], [millilitres(20)])).toEqual([merged])
    expect(S.mergeOptionalEntries([merged], [millilitres(20)])).toEqual([merged])
  })
  it('reverses the winner with the timestamps, including atomic serving removal', () => {
    bothOrders(grams(30, false), millilitres(20, true), row => {
      expect(row).toMatchObject({ amountG: 50 })
      expect(row).not.toHaveProperty('amountMl')
      expect(row).not.toHaveProperty('serving')
      expect(normalizeEntry(row).supported).toBe(true)
    })
  })
  it('breaks equal group timestamps deterministically and converges with a third copy', () => {
    const a = grams(10), b = millilitres(10), third = food({ amountG: 75, fatG: 3, _ts: 15, _f: { amountG: 15, fatG: 15 } })
    const first = bothOrders(a, b, row => expect(normalizeEntry(row).supported).toBe(true))
    const left = mergeOptionalEntries([first], [third])
    const right = mergeOptionalEntries([third], mergeOptionalEntries([b], [a]))
    const reverse = mergeOptionalEntries([third], [first])
    expect(left).toEqual(right)
    expect(left).toEqual(reverse)
    expect(S.mergeOptionalEntries([first], [third])).toEqual(left)
    expect(left[0].amountG).toBe(75)
    expect(left[0].fatG).toBe(3)
    expect(left[0]).not.toHaveProperty('amountMl')
    expect(normalizeEntry(left[0]).supported).toBe(true)
  })
  it('settles a cleared portion the same way whichever device syncs first', () => {
    const cleared = food({ serving: { label: 'bowl', count: 1, size: 50, unit: 'g' }, _ts: 30, _f: { amountG: 30, serving: 30 } })
    const copies = [grams(10), millilitres(20, true), cleared]
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      const results = orders.flatMap(([x, y, z]) => [
        merge(merge([copies[x]], [copies[y]]), [copies[z]]),
        merge([copies[x]], merge([copies[y]], [copies[z]])),
      ])
      for (const r of results) expect(r).toEqual(results[0])
      expect(results[0][0]).not.toHaveProperty('amountG')
      expect(results[0][0]).not.toHaveProperty('amountMl')
    }
  })
  it('keeps a malformed portion whole while it is newest, and lets a newer portion replace it whole', () => {
    const malformed = at => food({ amountG: 50, amountMl: 250, _ts: at, _f: { amountG: at, amountMl: at } })
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      const newest = merge([malformed(30)], [grams(20)])[0]
      expect(newest.amountG).toBe(50)
      expect(newest.amountMl).toBe(250)
      expect(newest).not.toHaveProperty('serving')
      const older = merge([malformed(10)], [grams(20)])[0]
      expect(older).toMatchObject({ amountG: 50, serving: { label: 'bowl', count: 1, size: 50, unit: 'g' } })
      expect(older).not.toHaveProperty('amountMl')
    }
  })
  it('gives one result for coherent, malformed, finely rounded and legacy copies in every sync order', () => {
    const copies = [
      food({ amountG: 50, _ts: 10, _f: { amountG: 10 } }),
      food({ amountMl: 250, _ts: 20, _f: { amountMl: 20 } }),
      food({ amountG: 50, amountMl: 250, _ts: 5, _f: { amountG: 5, amountMl: 5 } }),
      // servingAmount rounds the count first, so 1.0004 x 50 is a readable 50 g (normalizeEntry agrees).
      food({ amountG: 50, serving: { label: 'bowl', count: 1.0004, size: 50, unit: 'g' }, _ts: 15, _f: { amountG: 15, serving: 15 } }),
      // A copy from before schemaVersion settles as a portion too.
      (({ schemaVersion, ...legacy }) => legacy)(food({ amountG: 80, _ts: 18, _f: { amountG: 18 } })),
      // Version 0 is legacy input too.
      food({ schemaVersion: 0, amountMl: 90, serving: { label: 'cup', count: 1, size: 90, unit: 'mL' }, _ts: 8, _f: { amountMl: 8, serving: 8 } }),
    ]
    expect(normalizeEntry(copies[3]).supported).toBe(true)
    const orders = [[0, 1, 2, 3, 4, 5], [4, 5, 2, 0, 1, 3], [3, 2, 4, 1, 0, 5], [5, 1, 3, 0, 4, 2], [2, 3, 0, 5, 1, 4]]
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      const results = orders.flatMap(o => {
        const rows = o.map(i => [copies[i]])
        return [rows.reduce((acc, r) => merge(acc, r)), rows.reduceRight((acc, r) => merge(r, acc))]
      })
      for (const r of results) expect(r).toEqual(results[0])
      expect(results[0][0].amountMl).toBe(250)
      expect(results[0][0]).not.toHaveProperty('amountG')
    }
  })

  it('merges explicit legacy nulls like cleared amounts, preserving the winning representation', () => {
    const base = { nutritionEntries: [food({ amountG: 50 })] }
    stampOptionalCollections({}, base, 1)
    for (const middle of [{ amountG: null, amountMl: 100 }, { amountG: null }]) {
      const copies = [{ amountMl: null }, middle, { amountG: 75 }].map((values, i) => {
        const next = clone(base)
        delete next.nutritionEntries[0].amountG
        Object.assign(next.nutritionEntries[0], values)
        expect(normalizeEntry(next.nutritionEntries[0]).supported).toBe(true)
        stampOptionalCollections(base, next, i + 2)
        return next.nutritionEntries
      })
      for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
        const [a, b, c] = copies
        const reference = merge(merge(a, b), c)
        for (const [x, y, z] of [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]]) {
          expect(merge(x, merge(y, z))).toEqual(reference)
          expect(merge(merge(x, y), z)).toEqual(reference)
          expect(merge(reference, x)).toEqual(reference)
        }
        expect(reference[0].amountG).toBe(75)
        expect(reference[0]).not.toHaveProperty('amountMl')
        expect(normalizeEntry(reference[0]).supported).toBe(true)
      }
    }
  })

  it('preserves the newest opaque future portion across mixed-schema merge orders and replay', () => {
    const legacyG = { id: 'r', amountG: 100, _ts: 10, note: 'retain me' }
    const legacyMl = { id: 'r', schemaVersion: 0, amountMl: 200, _ts: 20 }
    const future = { id: 'r', schemaVersion: 2, _ts: 30, nextAmount: 'opaque' }
    const futureEdit = { ...future, amountMl: 'future representation', _ts: 40 }
    // A later future edit clears the amount with an explicit stamp; replaying futureEdit must not bring it back.
    const futureClear = { id: 'r', schemaVersion: 2, nextAmount: 'opaque', _ts: 50, _f: { schemaVersion: 30, nextAmount: 30, amountMl: 50 } }
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      for (const copies of [[legacyG, legacyMl, future], [legacyMl, future, futureEdit], [legacyMl, futureEdit, futureClear]]) {
        const [a, b, c] = copies.map(row => [row])
        const reference = merge(merge(a, b), c)
        for (const [x, y, z] of [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]]) {
          expect(merge(x, merge(y, z))).toEqual(reference)
          expect(merge(merge(x, y), z)).toEqual(reference)
          expect(merge(reference, x)).toEqual(reference)
        }
        expect(reference[0]).toMatchObject({ schemaVersion: 2, nextAmount: 'opaque' })
        expect(reference[0]).not.toHaveProperty('amountG')
        if (copies.includes(futureClear)) expect(reference[0]).not.toHaveProperty('amountMl')
        else if (copies.includes(futureEdit)) expect(reference[0].amountMl).toBe(futureEdit.amountMl)
        else {
          expect(reference[0]).not.toHaveProperty('amountMl')
          expect(reference[0].note).toBe('retain me')
        }
      }
    }
  })

  it('lets a newer supported portion, such as a restored backup, replace a future portion whole', () => {
    const server = { nutritionEntries: [food({ schemaVersion: 2, amountMl: 'future representation', _ts: 30, _f: { schemaVersion: 30, amountMl: 30 } })] }
    const backup = { nutritionEntries: [food({ amountG: 50, serving: { label: 'bowl', count: 1, size: 50, unit: 'g' } })] }
    stampRestore(backup, [server], 60)
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      const restored = merge(server.nutritionEntries, backup.nutritionEntries)
      expect(merge(backup.nutritionEntries, server.nutritionEntries)).toEqual(restored)
      expect(restored[0]).toMatchObject({ schemaVersion: 1, amountG: 50 })
      expect(restored[0]).not.toHaveProperty('amountMl')
      expect(normalizeEntry(restored[0]).supported).toBe(true)
      // Replaying the older future copy afterwards keeps the restore.
      expect(merge(restored, server.nutritionEntries)).toEqual(restored)
    }
  })

  it('converges after independent edits to a common amount, serving and dimension', () => {
    const base = { nutritionEntries: [food({ amountG: 50, customField: 'kept' })] }
    stampOptionalCollections({}, base, 1)
    const edit = (fields, time) => {
      const copy = clone(base)
      delete copy.nutritionEntries[0].amountG
      Object.assign(copy.nutritionEntries[0], fields)
      stampOptionalCollections(base, copy, time)
      return copy.nutritionEntries
    }
    const portion = { label: 'bowl', count: 1, size: 50, unit: 'g' }
    const a = edit({ amountG: 50, serving: portion }, 3)
    const b = edit({ amountG: 75 }, 2)
    const c = edit({ amountMl: 100 }, 4)
    for (const merge of [mergeOptionalEntries, S.mergeOptionalEntries]) {
      expect(merge(a, b, 'importedActivities')[0]).toMatchObject({ amountG: 75, serving: portion })
      expect(merge([{ ...a[0], schemaVersion: 2 }], [{ ...b[0], schemaVersion: 2 }])[0])
        .toMatchObject({ amountG: 75, serving: portion })
      expect(merge(a, b)[0]).toMatchObject({ amountG: 50, serving: portion })
      let reference
      for (const [x, y, z] of [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]]) {
        const result = merge(merge(x, y), z)
        expect(result).toEqual(merge(x, merge(y, z)))
        expect(merge(merge(merge(result, z), x), y)).toEqual(result)
        expect(result[0]).toMatchObject({ amountMl: 100, customField: 'kept' })
        expect(normalizeEntry(result[0]).supported).toBe(true)
        reference ??= result
        expect(result).toEqual(reference)
      }
    }
  })
})
