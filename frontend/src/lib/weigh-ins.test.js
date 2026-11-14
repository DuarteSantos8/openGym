// #859: several weigh-ins a day, each with its time; one value per day for everything that reads it.
import { describe, expect, it } from 'vitest'
import {
  absorbLegacyEdit, addWeighIn, allReadings, cleanTime, dailyModeOf, dailyValue, dayOf, defaultTimeFor, editWeighIn,
  mergeDay, readingAt, readingsOf, removeWeighIn, restoreWeighIn, settleAll, settleDay, timeOf,
} from './weigh-ins.js'
import { mergeBodyweight, mergeStates, stampChange, stampDeletions } from './sync-merge.js'
import { weeklyWeights, weightRate, weighInAt } from './bodyweight.js'
import { bodyCSV, csvCounts } from './export-csv.js'
import { convertStateUnit } from './units.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ms = (d, hm) => new Date(`${d}T${hm}:00`).getTime()
const day = (S, d) => S.bodyweight.find(b => b.d === d)

// What v1.4.3 does with a day (lib/sync-merge.js then): the whole entry, the later `t` winning,
// a typed one over one read in. And how its sheet edits a day: in place.
const oldMerge = (a, b) => {
  const byDay = new Map()
  for (const e of [...a, ...b]) {
    const cur = byDay.get(e.d)
    if (!cur || (!!cur.src !== !!e.src ? !e.src : (e.t || 0) > (cur.t || 0))) byDay.set(e.d, e)
  }
  return [...byDay.values()].sort((x, y) => (x.d < y.d ? -1 : 1))
}
const oldEdit = (S, d, w, t) => { const ex = S.bodyweight.find(b => b.d === d); ex.w = w; ex.t = t; delete ex.src }

describe('times', () => {
  it('reads and writes local HH:MM', () => {
    expect(cleanTime('7:05')).toBe('07:05')
    expect(cleanTime('23:59:30')).toBe('23:59')
    for (const bad of ['24:00', '12:60', '', null, 'noon']) expect(cleanTime(bad)).toBeNull()
    const t = new Date(2026, 9, 28, 6, 4).getTime()
    expect([dayOf(t), timeOf(t)]).toEqual(['2026-10-28', '06:04'])
    expect(readingAt('2026-10-28', '06:04')).toBe(t)
    expect(new Date(readingAt('2026-10-28', null)).getHours()).toBe(12)
  })

  // The day and the time are the clock where the weigh-in was made: a late one stays on its
  // evening, whatever the time zone, and is never moved by the zone the app is opened in later.
  it('keeps a late-evening weigh-in on its own day', () => {
    const S = { bodyweight: [] }
    const late = new Date(2026, 9, 27, 23, 50).getTime()
    addWeighIn(S, { d: dayOf(late), at: timeOf(late), w: 81, t: late })
    expect(S.bodyweight.map(b => [b.d, b.ins[0].at])).toEqual([['2026-10-27', '23:50']])
  })

  it('starts the sheet on now today, else the day\'s first time, else 08:00', () => {
    const S = { bodyweight: [{ d: '2026-10-20', w: 80, t: 1, ins: [{ id: 'a', at: '06:40', w: 80, t: 1 }] }, { d: '2026-10-21', w: 80, t: 1 }] }
    const now = new Date(2026, 9, 28, 19, 5).getTime()
    expect(defaultTimeFor(S, '2026-10-28', '2026-10-28', now)).toBe('19:05')
    expect(defaultTimeFor(S, '2026-10-20', '2026-10-28', now)).toBe('06:40')
    expect(defaultTimeFor(S, '2026-10-21', '2026-10-28', now)).toBe('08:00')
    expect(defaultTimeFor(S, '2026-10-22', '2026-10-28', now)).toBe('08:00')
  })
})

describe('a day\'s readings and its one value', () => {
  const S = () => {
    const s = { bodyweight: [] }
    addWeighIn(s, { d: '2026-10-28', at: '21:30', w: 81.4, t: 3 })
    addWeighIn(s, { d: '2026-10-28', at: '07:10', w: 80.2, t: 2 })
    addWeighIn(s, { d: '2026-10-28', at: '13:00', w: 80.9, t: 4 })
    return s
  }

  it('sorts them by time and takes the first (morning) one by default', () => {
    const s = S()
    expect(readingsOf(day(s, '2026-10-28')).map(r => r.at)).toEqual(['07:10', '13:00', '21:30'])
    expect(day(s, '2026-10-28')).toMatchObject({ w: 80.2, t: 4 })
    expect(s.bodyweight).toHaveLength(1)
  })

  it.each([['first', 80.2], ['avg', 80.83], ['last', 81.4]])('%s gives %s', (mode, w) => {
    const s = S()
    s.bwDaily = mode
    settleAll(s)
    expect(day(s, '2026-10-28').w).toBe(w)
    expect(dailyValue(readingsOf(day(s, '2026-10-28')), mode)).toBe(w)
  })

  it('reads an old day as one reading without a time, or the time it was typed on its day', () => {
    expect(readingsOf({ d: '2026-10-28', w: 80, t: 5, src: 'hc' })).toEqual([{ id: '0', at: null, w: 80, t: 5, src: 'hc' }])
    expect(readingsOf({ d: '2026-10-28', w: 80, t: ms('2026-10-28', '07:42') })[0].at).toBe('07:42')
    expect(readingsOf({ d: '2026-10-28' })).toEqual([])
  })

  it('reads anything unknown as the default mode', () => {
    expect(dailyModeOf({})).toBe('first')
    expect(dailyModeOf({ bwDaily: 'median' })).toBe('first')
    expect(dailyModeOf({ bwDaily: 'avg' })).toBe('avg')
  })

  it('corrects the weigh-in at the same time instead of adding one, and refuses no weight', () => {
    const s = S()
    addWeighIn(s, { d: '2026-10-28', at: '07:10', w: 80, t: 9 })
    expect(readingsOf(day(s, '2026-10-28')).map(r => [r.at, r.w])).toEqual([['07:10', 80], ['13:00', 80.9], ['21:30', 81.4]])
    expect(addWeighIn(s, { d: '2026-10-28', at: '08:00', w: 0 })).toBeNull()
    expect(addWeighIn(s, { d: 'today', at: '08:00', w: 80 })).toBeNull()
  })

  it('lists every reading of the log, oldest first', () => {
    const s = S()
    addWeighIn(s, { d: '2026-10-27', at: null, w: 82, t: 1 })
    expect(allReadings(s.bodyweight).map(r => [r.d, r.at, r.w])).toEqual([
      ['2026-10-27', null, 82], ['2026-10-28', '07:10', 80.2], ['2026-10-28', '13:00', 80.9], ['2026-10-28', '21:30', 81.4],
    ])
  })
})

describe('edit, delete and Undo of one weigh-in', () => {
  const base = () => {
    const s = { bodyweight: [] }
    addWeighIn(s, { d: '2026-10-28', at: '07:10', w: 80.2, t: 10, id: 'am' })
    addWeighIn(s, { d: '2026-10-28', at: '21:30', w: 81.4, t: 11, id: 'pm' })
    return s
  }

  it('deletes one, leaving the day with the rest and a record of the removal', () => {
    const s = base()
    const undo = removeWeighIn(s, '2026-10-28', 'am', 20)
    expect(day(s, '2026-10-28')).toMatchObject({ w: 81.4, t: 20, gone: { am: 20 } })
    expect(readingsOf(day(s, '2026-10-28')).map(r => r.id)).toEqual(['pm'])
    expect(undo).toMatchObject({ d: '2026-10-28', reading: { id: 'am', w: 80.2 }, day: null })
    expect(restoreWeighIn(s, undo, 30)).toBe(true)
    expect(readingsOf(day(s, '2026-10-28')).map(r => [r.id, r.t])).toEqual([['am', 30], ['pm', 11]])
    expect(day(s, '2026-10-28')).toMatchObject({ w: 80.2, t: 30 })
    expect(day(s, '2026-10-28').gone).toBeUndefined()
  })

  it('deleting the last one takes the day, which the store records and Undo brings back', () => {
    const s = { bodyweight: [{ d: '2026-10-28', w: 80, t: 5 }] }
    const prev = clone(s)
    const undo = removeWeighIn(s, '2026-10-28', '0', 20)
    expect(s.bodyweight).toEqual([])
    stampDeletions(prev, s, 20)
    expect(s.deleted.bodyweight).toEqual({ '2026-10-28': 20 })
    const before = clone(s)
    restoreWeighIn(s, undo, 30)
    expect(s.bodyweight).toEqual([{ d: '2026-10-28', w: 80, t: 5 }])
    stampDeletions(before, s, 30)
    expect(s.deleted.bodyweight['2026-10-28']).toBe(-30)
  })

  it('edits the weight and the time, and moves one to another day', () => {
    const s = base()
    editWeighIn(s, '2026-10-28', 'pm', { w: 81, at: '20:15' }, 40)
    expect(readingsOf(day(s, '2026-10-28')).map(r => [r.id, r.at, r.w, r.t])).toEqual([['am', '07:10', 80.2, 10], ['pm', '20:15', 81, 40]])
    editWeighIn(s, '2026-10-28', 'am', { d: '2026-10-27' }, 50)
    expect(s.bodyweight.map(b => [b.d, b.w, readingsOf(b).map(r => r.id)])).toEqual([['2026-10-27', 80.2, ['am']], ['2026-10-28', 81, ['pm']]])
    expect(day(s, '2026-10-28').gone).toEqual({ am: 50 })
  })

  it('turns an old day into readings when it is edited, keeping it as reading 0', () => {
    const s = { bodyweight: [{ d: '2026-10-20', w: 80, t: 5, src: 'hc' }] }
    editWeighIn(s, '2026-10-20', '0', { w: 79.6, at: '07:00' }, 60)
    expect(s.bodyweight).toEqual([{ d: '2026-10-20', w: 79.6, t: 60, ins: [{ id: '0', at: '07:00', w: 79.6, t: 60 }] }])
  })
})

describe('sync', () => {
  const D = '2026-10-28'
  const phone = () => {
    const s = { bodyweight: [] }
    addWeighIn(s, { d: D, at: '07:10', w: 80.2, t: 100, id: 'am' })
    return s
  }

  it('joins the readings two devices added to the same day', () => {
    const a = phone(), b = phone()
    addWeighIn(a, { d: D, at: '13:00', w: 80.8, t: 200, id: 'noon' })
    addWeighIn(b, { d: D, at: '21:30', w: 81.4, t: 300, id: 'pm' })
    for (const out of [mergeBodyweight(a.bodyweight, b.bodyweight), mergeBodyweight(b.bodyweight, a.bodyweight)]) {
      expect(out).toHaveLength(1)
      expect(readingsOf(out[0]).map(r => r.id)).toEqual(['am', 'noon', 'pm'])
      expect(out[0]).toMatchObject({ w: 80.2, t: 300 })
    }
    expect(mergeBodyweight(a.bodyweight, b.bodyweight, 'last')[0].w).toBe(81.4)
  })

  it('keeps a removal against a copy that still has the reading, and the later edit of one', () => {
    const a = phone(), b = phone()
    addWeighIn(a, { d: D, at: '21:30', w: 81.4, t: 200, id: 'pm' })
    b.bodyweight = clone(a.bodyweight)
    removeWeighIn(a, D, 'pm', 300)
    editWeighIn(b, D, 'am', { w: 80 }, 250)
    const out = mergeBodyweight(a.bodyweight, b.bodyweight)
    expect(readingsOf(out[0]).map(r => [r.id, r.w])).toEqual([['am', 80]])
    expect(out[0].gone).toEqual({ pm: 300 })
    // Edited again after the removal: it comes back.
    editWeighIn(b, D, 'pm', { w: 81 }, 400)
    expect(readingsOf(mergeBodyweight(a.bodyweight, b.bodyweight)[0]).map(r => r.id)).toEqual(['am', 'pm'])
  })

  it('joins an old day with a day of readings made from it', () => {
    const old = { d: D, w: 80, t: ms(D, '07:00') }
    const s = { bodyweight: [clone(old)] }
    addWeighIn(s, { d: D, at: '21:00', w: 81, t: ms(D, '21:00'), id: 'pm' })
    const out = mergeBodyweight([old], s.bodyweight)
    expect(readingsOf(out[0]).map(r => [r.id, r.at, r.w])).toEqual([['0', '07:00', 80], ['pm', '21:00', 81]])
  })

  // The compatibility promise: an older app passes a day through whole, and its own edit of the
  // day is read as a correction of the reading it showed.
  describe('with an app from before (1.4.3)', () => {
    it('a merge there keeps the extra readings: the day travels whole', () => {
      const server = phone()
      addWeighIn(server, { d: D, at: '21:30', w: 81.4, t: 200, id: 'pm' })
      const older = { bodyweight: [{ d: D, w: 80.2, t: 100 }, { d: '2026-10-27', w: 82, t: 50 }] }
      const merged = oldMerge(older.bodyweight, clone(server.bodyweight))
      expect(readingsOf(merged.find(b => b.d === D)).map(r => r.id)).toEqual(['am', 'pm'])
      // …and back on an updated device nothing is lost.
      const back = mergeBodyweight(server.bodyweight, merged)
      expect(readingsOf(back.find(b => b.d === D)).map(r => r.id)).toEqual(['am', 'pm'])
    })

    it('its edit of the day corrects the reading it showed, and the others stay', () => {
      const s = phone()
      addWeighIn(s, { d: D, at: '21:30', w: 81.4, t: 200, id: 'pm' })
      const older = clone(s)
      oldEdit(older, D, 79.8, 500)                                     // the one value it shows: the morning's
      const out = mergeBodyweight(s.bodyweight, older.bodyweight)
      expect(readingsOf(out[0]).map(r => [r.id, r.w])).toEqual([['am', 79.8], ['pm', 81.4]])
      expect(out[0]).toMatchObject({ w: 79.8, t: 500 })
      // The same edit with the profile on "last": it was the evening one it showed.
      const last = clone(s); last.bwDaily = 'last'; settleAll(last)
      const olderLast = clone(last)
      oldEdit(olderLast, D, 81, 500)
      expect(readingsOf(mergeBodyweight(last.bodyweight, olderLast.bodyweight, 'last')[0]).map(r => [r.id, r.w])).toEqual([['am', 80.2], ['pm', 81]])
    })

    it('an edit that only resaved the same number changes nothing', () => {
      const e = { d: D, w: 80.2, t: 900, ins: [{ id: 'am', at: '07:10', w: 80.2, t: 100 }] }
      expect(absorbLegacyEdit(clone(e))).toEqual(e)
      expect(settleDay(clone(e))).toMatchObject({ w: 80.2, t: 100 })
    })

    it('its delete of the day removes the whole day, as it always did', () => {
      const s = phone()
      addWeighIn(s, { d: D, at: '21:30', w: 81.4, t: 200, id: 'pm' })
      const older = clone(s)
      const prev = clone(older)
      older.bodyweight = []
      stampDeletions(prev, older, 600)
      older._ts = 600; s._ts = 300
      expect(mergeStates(older, s).bodyweight).toEqual([])
    })
  })

  it('stamps the readings a change made with the change\'s time, so the day stays explained', () => {
    const prev = phone()
    const next = clone(prev)
    addWeighIn(next, { d: D, at: '21:30', w: 81.4, t: 150, id: 'pm' })
    const now = stampChange(prev, next, 1000)
    const e = day(next, D)
    expect(e.t).toBe(now)
    expect(e.ins.map(r => [r.id, r.t])).toEqual([['am', 100], ['pm', now]])
    // So a merge later reads no older-app edit into it.
    expect(absorbLegacyEdit(clone(e))).toEqual(e)
    const after = clone(next)
    removeWeighIn(after, D, 'am', 1)
    const t2 = stampChange(next, after, 1)
    expect(day(after, D).gone).toEqual({ am: t2 })
    expect(day(after, D).t).toBe(t2)
  })

  it('follows the merged daily-value setting', () => {
    const a = phone(), b = phone()
    addWeighIn(a, { d: D, at: '21:30', w: 81.4, t: 200, id: 'pm' })
    b.bwDaily = 'avg'; b.edited = { bwDaily: 900 }; b._ts = 900; a._ts = 800
    const out = mergeStates(a, b)
    expect(out.bwDaily).toBe('avg')
    expect(day(out, D).w).toBe(80.8)
  })

  it('a day with no reading left is gone', () => {
    expect(mergeDay({ d: D, w: 80, t: 5, ins: [{ id: 'a', w: 80, t: 5 }] }, { d: D, w: 80, t: 9, ins: [], gone: { a: 9 } })).toBeNull()
  })
})

describe('everything that reads one value per day', () => {
  // Three weeks, a morning and an evening weigh-in each day: the evening one 1 kg up.
  const S = mode => {
    const s = { bwDaily: mode, bodyweight: [] }
    for (let i = 0; i < 21; i++) {
      const d = dayOf(new Date(2026, 9, 1 + i, 12).getTime())
      addWeighIn(s, { d, at: '07:00', w: 85 - i * 0.1, t: i * 2 + 1 })
      addWeighIn(s, { d, at: '21:00', w: 86 - i * 0.1, t: i * 2 + 2 })
    }
    return s
  }
  const now = new Date(2026, 9, 21, 22).getTime()

  it('weekly means and the trend go by the day\'s value, one point per day', () => {
    const first = S('first'), avg = S('avg'), last = S('last')
    expect(weightRate(first.bodyweight, { now })).toMatchObject({ enough: true, n: 21 })
    expect(weightRate(first.bodyweight, { now }).perWeek).toBeCloseTo(-0.7, 5)
    expect(weightRate(avg.bodyweight, { now }).mean - weightRate(first.bodyweight, { now }).mean).toBeCloseTo(0.5, 5)
    expect(weightRate(last.bodyweight, { now }).mean - weightRate(first.bodyweight, { now }).mean).toBeCloseTo(1, 5)
    expect(weeklyWeights(first.bodyweight, 1).reduce((n, w) => n + w.n, 0)).toBe(21)
  })

  it('puts a day on the chart at the time of the weigh-in its value is', () => {
    const s = S('last')
    expect(new Date(weighInAt(s.bodyweight[0])).getHours()).toBe(21)
    expect(new Date(weighInAt(S('first').bodyweight[0])).getHours()).toBe(7)
    expect(new Date(weighInAt(S('avg').bodyweight[0])).getHours()).toBe(12)
  })

  it('converts every reading with the unit', () => {
    const lb = convertStateUnit(S('first'), 'lb')
    expect(lb.bodyweight[0].ins.map(r => r.w)).toEqual([187.4, 189.6])
    expect(lb.bodyweight[0].w).toBe(187.4)
  })
})

describe('CSV', () => {
  it('writes a row per weigh-in with its time, the day\'s measurements on its first row, and counts them', () => {
    const s = { unit: 'kg', bodyweight: [{ d: '2026-10-27', w: 82, t: 1 }], measurements: [{ d: '2026-10-28', waist: 90, t: 1 }] }
    addWeighIn(s, { d: '2026-10-28', at: '21:30', w: 81.4, t: 3 })
    addWeighIn(s, { d: '2026-10-28', at: '07:10', w: 80.2, t: 2 })
    const lines = bodyCSV(s).trim().split(/\r?\n/)
    expect(lines.slice(1)).toEqual(['2026-10-27,82,', '2026-10-28 07:10,80.2,90', '2026-10-28 21:30,81.4,'])
    expect(csvCounts(s).weighIns).toBe(3)
  })
})
