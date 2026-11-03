/* Your bars (Discord: "Add short olympic bar (15kg)"): one weight per bar type for the whole
   profile, S.barDefaults[unit][eq]. Precedence everywhere a bar weight is read: the exercise's own
   barWeights entry (0 = no bar), then your bar for the type, then the built-in default. */
import { describe, expect, it } from 'vitest'
import { barWeightFor, barTypeWeight, ownBarDefault, withBarDefault, withStandardBars, plateSplit } from './bar.js'
import { baseWeightFor, rowLoad, dropGrid } from './plates.js'
import { barFloor } from './history.js'
import { convertStateUnit } from './units.js'
import { mergeStates, stampChange, stampEdits, stampRestore } from './sync-merge.js'
import * as Server from '../../../api/sync-stamps.js'
import { EXDB } from './exercises-data.js'

const idOf = eq => EXDB.find(e => e.eq === eq).id
const OLY = idOf('olympic barbell'), BB = idOf('barbell'), EZ = idOf('ez barbell'), DB = idOf('dumbbell')
const clone = v => JSON.parse(JSON.stringify(v))

describe('precedence: exercise override, then your bar, then the built-in', () => {
  const S = { unit: 'kg', barDefaults: { kg: { 'olympic barbell': 15 } }, barWeights: {} }

  it('an exercise without its own bar uses yours for the type', () => {
    expect(ownBarDefault(S, 'olympic barbell')).toBe(15)
    expect(barTypeWeight(S, 'olympic barbell')).toBe(15)
    expect(barWeightFor(S, OLY)).toBe(15)
    expect(baseWeightFor(S, OLY)).toBe(15)
    expect(barFloor(S, OLY)).toBe(15)
  })

  it('other bar types keep the built-in', () => {
    expect(ownBarDefault(S, 'barbell')).toBeNull()
    expect(barWeightFor(S, BB)).toBe(20)
    expect(barWeightFor(S, EZ)).toBe(10)
  })

  it('the exercise own bar wins, and its "no bar" 0 stays 0', () => {
    expect(barWeightFor({ ...S, barWeights: { [OLY]: 20 } }, OLY)).toBe(20)
    expect(baseWeightFor({ ...S, barWeights: { [OLY]: 20 } }, OLY)).toBe(20)
    expect(barWeightFor({ ...S, barWeights: { [OLY]: 0 } }, OLY)).toBe(0)
    expect(baseWeightFor({ ...S, barWeights: { [OLY]: 0 } }, OLY)).toBe(0)
  })

  it('is kept per unit: a lb profile reads its own list, not a converted kg one', () => {
    const lb = { unit: 'lb', barDefaults: { kg: { 'olympic barbell': 15 } } }
    expect(barWeightFor(lb, OLY)).toBe(45)
    expect(barWeightFor({ unit: 'lb', barDefaults: { lb: { 'olympic barbell': 35 } } }, OLY)).toBe(35)
  })

  it('ignores junk and non-bar equipment', () => {
    for (const v of [0, -5, '15', null, NaN, Infinity]) {
      expect(barWeightFor({ unit: 'kg', barDefaults: { kg: { 'olympic barbell': v } } }, OLY), String(v)).toBe(20)
    }
    expect(baseWeightFor({ unit: 'kg', barDefaults: { kg: { dumbbell: 5 } } }, DB)).toBe(0)
    expect(barWeightFor({ unit: 'kg', barDefaults: 'x' }, OLY)).toBe(20)
  })

  it('feeds the plate math and the drop steps; logged totals stay totals', () => {
    expect(plateSplit(60, barWeightFor(S, OLY))).toBe(22.5)
    expect(rowLoad('pairs', 60, baseWeightFor(S, OLY), [{ w: 20, n: 9 }, { w: 2.5, n: 9 }]).perSide).toBe(22.5)
    const grid = dropGrid({ ...S, plates: { kg: { 20: 2, 10: 2, _ts: 1 } } }, { id: OLY })
    expect(grid(50)).toBe(35)          // 15 kg bar + 10 a side; 20 a side would be 55
    expect(grid(12)).toBe(15)          // never under the bar
  })
})

describe('withBarDefault / withStandardBars', () => {
  it('sets, clears and drops what equals the built-in', () => {
    let S = { unit: 'kg' }
    S.barDefaults = withBarDefault(S, 'olympic barbell', 15)
    expect(S.barDefaults).toEqual({ kg: { 'olympic barbell': 15 } })
    S.barDefaults = withBarDefault(S, 'barbell', 20)            // the built-in: nothing to store
    expect(S.barDefaults).toEqual({ kg: { 'olympic barbell': 15 } })
    S.barDefaults = withBarDefault(S, 'olympic barbell', 0)
    expect(S.barDefaults).toEqual({})
  })

  it('the standard bars come back for this unit only', () => {
    const S = { unit: 'lb', barDefaults: { kg: { barbell: 15 }, lb: { barbell: 35, 'ez barbell': 15 } } }
    expect(withStandardBars(S)).toEqual({ kg: { barbell: 15 } })
    expect(S.barDefaults.lb).toEqual({ barbell: 35, 'ez barbell': 15 })   // not mutated
  })
})

describe('a unit switch', () => {
  it('keeps your bars per unit and an override that is the standard bar a standard bar', () => {
    const S = { unit: 'kg', barDefaults: { kg: { barbell: 15 }, lb: { barbell: 35 } }, barWeights: { [BB]: 20, [EZ]: 10 } }
    const lb = convertStateUnit(S, 'lb')
    expect(lb.barDefaults).toEqual(S.barDefaults)
    expect(lb.barWeights[BB]).toBe(45)             // a 20 kg bar is a 45 lb one, not your 35
    expect(lb.barWeights[EZ]).toBeUndefined()      // the built-in either way
    expect(barWeightFor(lb, BB)).toBe(45)
    expect(barWeightFor({ ...lb, barWeights: {} }, BB)).toBe(35)
  })

  it('an override that lands on your bar for the type drops out', () => {
    const lb = convertStateUnit({ unit: 'kg', barDefaults: { lb: { barbell: 35 } }, barWeights: { [BB]: 15.88 } }, 'lb')
    expect(lb.barWeights[BB]).toBeUndefined()
    expect(barWeightFor(lb, BB)).toBe(35)
  })
})

describe('sync', () => {
  const T = Date.UTC(2026, 9, 14, 8)
  const base = { _ts: T, unit: 'kg', restSec: 90, workouts: [], routines: [], customEx: [], bodyweight: [], barWeights: {} }

  it('is a stamped setting: set on one device, it survives the other device\'s later, unrelated change', () => {
    const phone = clone(base)
    phone.barDefaults = { kg: { 'olympic barbell': 15 } }
    phone._ts = stampChange(base, phone, T + 1000)
    stampEdits(base, phone, phone._ts)
    expect(phone.edited.barDefaults).toBe(phone._ts)
    const desk = clone(base)
    desk.restSec = 120
    desk._ts = T + 5000
    stampEdits(base, desk, desk._ts)
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.barDefaults).toEqual({ kg: { 'olympic barbell': 15 } })
      expect(m.restSec).toBe(120)
    }
  })

  it('the later change wins, a clear included', () => {
    const a = clone(base); a.barDefaults = { kg: { barbell: 15 } }; stampEdits(base, a, T + 1000); a._ts = T + 1000
    const b = clone(a); delete b.barDefaults; stampEdits(a, b, T + 2000); b._ts = T + 2000
    expect(mergeStates(a, b).barDefaults).toBeUndefined()
    expect(mergeStates(b, a).barDefaults).toBeUndefined()
  })

  it('a copy that never had the key (an older app) does not drop it', () => {
    const now = clone(base); now.barDefaults = { kg: { barbell: 15 } }; stampEdits(base, now, T + 1000); now._ts = T + 1000
    const old = clone(base); old.workouts = [{ id: 'w1', d: '2026-10-14', start: T + 3000, entries: [] }]; old._ts = T + 3000
    for (const m of [mergeStates(old, now), mergeStates(now, old)]) {
      expect(m.barDefaults).toEqual({ kg: { barbell: 15 } })
      expect(m.workouts.map(w => w.id)).toEqual(['w1'])
    }
  })

  it('the server puts it back for a writer that does not know it', () => {
    const cur = clone(base); cur.barDefaults = { kg: { barbell: 15 } }; cur.edited = { barDefaults: T + 1000 }; cur._ts = T + 1000
    const old = clone(base); old.restSec = 60; old._ts = T + 2000
    Server.stampPut(cur, old, { overRead: true, now: T + 3000 })
    expect(old.barDefaults).toEqual({ kg: { barbell: 15 } })
  })

  it('a restored backup brings it back', () => {
    const backup = clone(base); backup.barDefaults = { kg: { barbell: 15 } }
    const cur = clone(base); cur.edited = { barDefaults: T + 500 }; cur._ts = T + 500
    const next = stampRestore(clone(backup), [cur], T + 9000)
    expect(next.edited.barDefaults).toBe(T + 9000)
    expect(mergeStates(next, cur).barDefaults).toEqual({ kg: { barbell: 15 } })
    expect(mergeStates(cur, next).barDefaults).toEqual({ kg: { barbell: 15 } })
  })
})
