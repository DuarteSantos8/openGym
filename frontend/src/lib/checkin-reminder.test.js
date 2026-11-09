// The app's copy of the check-in reminder rule. api/test/checkin-reminder.test.js runs the same
// cases on the server's copy (api/checkin-reminder.js): the two must agree.
import { describe, it, expect } from 'vitest'
import { dueKeys, dueKind, itemDue, reminderOf, lastLogged, buildCheckinNotifications, checkinNames, CHECKIN_ID_BASE } from './checkin-reminder.js'

const photo = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/jpeg', size: 10, width: 10, height: 10 }

describe('check-in reminder', () => {
  it('an item is due once its days have passed, then every few days while undone', () => {
    const item = { every: 14 }
    expect(itemDue(item, '2026-11-01', '2026-11-14')).toBe(false)
    expect(itemDue(item, '2026-11-01', '2026-11-15')).toBe(true)
    expect(itemDue(item, '2026-11-01', '2026-11-16')).toBe(false)
    expect(itemDue(item, '2026-11-01', '2026-11-18')).toBe(true)
    expect(itemDue({ every: 2 }, '2026-11-01', '2026-11-05')).toBe(true)
    expect(itemDue({ every: 14, since: '2026-11-10' }, null, '2026-11-24')).toBe(true)
    expect(itemDue({ every: 14, since: '2026-11-10' }, null, '2026-11-20')).toBe(false)
    expect(itemDue({ every: 7 }, null, '2026-11-20')).toBe(true)
  })
  const S = {
    checkinReminder: { on: true, time: '07:30', items: { weight: { every: 7 }, waist: { every: 14 }, 'pair:bp': { every: 7 }, photos: { every: 28 }, 'other:x': { every: 7 } } },
    customMeasurements: [{ id: 'x', name: 'Grip', unit: 'none' }],
    bodyweight: [{ d: '2026-11-01', w: 80 }],
    measurements: [{ d: '2026-10-25', waist: 82, bpSys: 120, bpDia: 80, other: [{ id: 'x', value: 0, unit: 'none' }] }],
    workouts: [{ d: '2026-10-11', media: [photo] }],
  }
  it('due keys read weigh-ins, measurements, blood pressure and photos', () => {
    expect(dueKeys(S, '2026-11-08').sort()).toEqual(['photos', 'waist', 'weight'])
    expect(dueKeys(S, '2026-11-10').sort()).toEqual(['other:x', 'pair:bp'])
    expect(dueKeys({ ...S, checkinReminder: { ...S.checkinReminder, on: false } }, '2026-11-08')).toEqual([])
    expect(dueKind(['photos'])).toBe('photos')
    expect(dueKind(['waist'])).toBe('measure')
    expect(dueKind(['waist', 'photos'])).toBe('both')
    expect(dueKind([])).toBe(null)
  })
  it('a photo filed under a day counts, a cleared one does not', () => {
    expect(lastLogged({ dayPhotos: { h: { d: '2026-10-30', m: photo, _ts: 1 }, g: { _ts: 2 } } }, 'photos')).toBe('2026-10-30')
  })
  it('settings keep their defaults and drop junk', () => {
    expect(reminderOf({ checkinReminder: { on: true, time: '25:00', items: { waist: { every: 0 }, hips: { every: 500 } } } }))
      .toEqual({ on: true, time: '07:30', items: { hips: { every: 90 } } })
  })
  it('queues one notification per due day at the time, none already gone today', () => {
    const now = new Date(2026, 10, 8, 9, 0)
    const ns = buildCheckinNotifications(S, { now, names: keys => checkinNames(S, keys) })
    expect(ns[0].schedule.at.getDate()).toBe(10)
    expect(ns[0].id).toBe(CHECKIN_ID_BASE + 2)
    expect(ns[0].body).toMatch(/ Blood pressure, Grip\.$/)
    const early = buildCheckinNotifications(S, { now: new Date(2026, 10, 8, 6, 0) })
    expect(early[0].schedule.at.getHours()).toBe(7)
    expect(early[0].title).toBe('Check-in time')
    expect(buildCheckinNotifications({ ...S, checkinReminder: { on: false } }, { now })).toEqual([])
  })
})
