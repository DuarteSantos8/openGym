// #261: a note on a day you did not train. The helpers, how two devices merge their notes, and
// that the server's copy of the sync rules (api/sync-stamps.js) treats the map the same way.
import { describe, expect, it } from 'vitest'
import * as Server from '../../../api/sync-stamps.js'
import { DAY_NOTE_TAGS, DAY_NOTE_LABEL, DAY_NOTE_ICON, canNoteDay, dayNoteLine, dayNoteOf, excusedOn, readDayNote, withDayNote } from './day-notes.js'
import { highestStamp, localExtras, mergeStates, resetIdsOf, stampChange, STAMPED_MAPS } from './sync-merge.js'
import { NOTE_MAX } from './history.js'
import { buildReminderNotifications } from './mobile.js'

const base = (over = {}) => ({
  unit: 'kg', week: {}, dayPlan: {}, workouts: [], routines: [], bodyweight: [], customEx: [], favEx: [],
  exWeights: {}, exNotes: {}, barWeights: {}, equipProfiles: [], gymCards: [], _ts: 0, ...over,
})
const clone = o => JSON.parse(JSON.stringify(o))

describe('day notes: reading and writing', () => {
  it('reads a quick pick, a text, or both; junk and cleared entries read as none', () => {
    expect(readDayNote({ tag: 'sick', _ts: 1 })).toEqual({ tag: 'sick', text: '' })
    expect(readDayNote({ text: '  Flight  ', _ts: 1 })).toEqual({ tag: null, text: 'Flight' })
    expect(readDayNote({ tag: 'travel', text: 'Lisbon' })).toEqual({ tag: 'travel', text: 'Lisbon' })
    expect(readDayNote({ tag: 'hungover', text: '   ' })).toBeNull()
    expect(readDayNote({ _ts: 5 })).toBeNull()
    for (const junk of [null, undefined, 'sick', 3, ['sick']]) expect(readDayNote(junk)).toBeNull()
    expect(readDayNote({ text: 'x'.repeat(NOTE_MAX + 50) }).text).toHaveLength(NOTE_MAX)
  })

  it('every quick pick has a label and an icon', () => {
    for (const k of DAY_NOTE_TAGS) { expect(DAY_NOTE_LABEL[k]).toBeTruthy(); expect(DAY_NOTE_ICON[k]).toBeTruthy() }
  })

  it('writes a stamped entry per day, and an empty note as a stamped clear', () => {
    const m = withDayNote({ '2026-10-01': { tag: 'rest', _ts: 3 } }, '2026-10-02', { tag: 'sick', text: ' flu ' }, 10)
    expect(m).toEqual({ '2026-10-01': { tag: 'rest', _ts: 3 }, '2026-10-02': { tag: 'sick', text: 'flu', _ts: 10 } })
    const cleared = withDayNote(m, '2026-10-02', { tag: null, text: '  ' }, 11)
    expect(cleared['2026-10-02']).toEqual({ _ts: 11 })
    expect(withDayNote(undefined, '2026-10-03', null, 12)).toEqual({ '2026-10-03': { _ts: 12 } })
    expect(dayNoteOf({ dayNotes: cleared }, '2026-10-02')).toBeNull()
    expect(excusedOn({ dayNotes: cleared }, '2026-10-01')).toBe(true)
    expect(excusedOn({}, '2026-10-01')).toBe(false)
  })

  it('only today and earlier days take a note', () => {
    expect(canNoteDay('2026-10-09', '2026-10-09')).toBe(true)
    expect(canNoteDay('2026-09-30', '2026-10-09')).toBe(true)
    expect(canNoteDay('2026-10-10', '2026-10-09')).toBe(false)
    expect(canNoteDay('nope', '2026-10-09')).toBe(false)
  })

  it('reads as one line: the pick, the text, or both', () => {
    expect(dayNoteLine({ tag: 'sick', text: '' })).toBe('Sick')
    expect(dayNoteLine({ tag: null, text: 'Wedding' })).toBe('Wedding')
    expect(dayNoteLine({ tag: 'travel', text: 'Lisbon' }, s => s.toUpperCase())).toBe('TRAVELLING · Lisbon')
    expect(dayNoteLine(null)).toBe('')
  })
})

describe('day notes across devices', () => {
  it('notes written on different days on two devices are both kept', () => {
    const phone = base({ _ts: 100, dayNotes: withDayNote({}, '2026-10-01', { tag: 'sick' }, 90) })
    const desk = base({ _ts: 200, workouts: [{ id: 'w', d: '2026-10-03', start: 1, entries: [] }], dayNotes: withDayNote({}, '2026-10-02', { tag: 'travel' }, 20) })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(dayNoteOf(m, '2026-10-01')).toEqual({ tag: 'sick', text: '' })
      expect(dayNoteOf(m, '2026-10-02')).toEqual({ tag: 'travel', text: '' })
      expect(m.workouts.map(w => w.id)).toEqual(['w'])
    }
  })

  it('the same day keeps the note written last, whichever copy is newer as a whole', () => {
    const phone = base({ _ts: 100, dayNotes: withDayNote({}, '2026-10-01', { tag: 'injured', text: 'knee' }, 90) })
    const desk = base({ _ts: 300, dayNotes: withDayNote({}, '2026-10-01', { tag: 'rest' }, 40) })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) expect(dayNoteOf(m, '2026-10-01')).toEqual({ tag: 'injured', text: 'knee' })
  })

  it('a removed note stays removed against the other device\'s older copy, and a later note beats the removal', () => {
    const removed = base({ _ts: 100, dayNotes: withDayNote({}, '2026-10-01', null, 80) })
    const stale = base({ _ts: 300, dayNotes: withDayNote({}, '2026-10-01', { tag: 'sick' }, 40) })
    for (const m of [mergeStates(removed, stale), mergeStates(stale, removed)]) expect(dayNoteOf(m, '2026-10-01')).toBeNull()
    const later = base({ _ts: 50, dayNotes: withDayNote({}, '2026-10-01', { text: 'actually travelling' }, 95) })
    expect(dayNoteOf(mergeStates(removed, later), '2026-10-01')).toEqual({ tag: null, text: 'actually travelling' })
  })

  it('a copy from before notes existed (no dayNotes at all) loses none of them', () => {
    const mine = base({ _ts: 100, dayNotes: withDayNote({}, '2026-10-01', { tag: 'sick' }, 90) })
    const old = base({ _ts: 500 })
    for (const m of [mergeStates(mine, old), mergeStates(old, mine)]) expect(excusedOn(m, '2026-10-01')).toBe(true)
  })

  it('a change that writes a note stamps it after everything the copy has seen', () => {
    const prev = base({ _ts: 1000, dayNotes: withDayNote({}, '2026-10-01', { tag: 'rest' }, 900) })
    const next = clone(prev)
    next.dayNotes = withDayNote(next.dayNotes, '2026-10-02', { tag: 'sick' }, 5)   // a clock far behind
    const at = stampChange(prev, next, 5)
    expect(at).toBeGreaterThan(1000)
    expect(next.dayNotes['2026-10-02']._ts).toBe(at)
    expect(next.dayNotes['2026-10-01']._ts).toBe(900)
    expect(highestStamp(next)).toBe(at)
  })

  it('"Reset everything" wipes the notes of a copy that has not seen the reset', () => {
    const before = base({ _ts: 1000, dayNotes: withDayNote({}, '2026-10-01', { tag: 'sick' }, 900) })
    const reset = base({ _ts: 2000, resetAt: 2000, resetIds: resetIdsOf(before) })
    expect(reset.resetIds.dayNotes).toEqual(['2026-10-01'])
    const stale = clone(before); stale._ts = 2100
    for (const m of [mergeStates(reset, stale), mergeStates(stale, reset)]) expect(dayNoteOf(m, '2026-10-01')).toBeNull()
  })

  it('sign-in counts notes the device has that the server does not', () => {
    const server = base({ dayNotes: withDayNote({}, '2026-10-01', { tag: 'sick' }, 5) })
    const local = base({ dayNotes: { ...withDayNote({}, '2026-10-01', { tag: 'rest' }, 9), ...withDayNote({}, '2026-10-02', { tag: 'travel' }, 9), '2026-10-03': { _ts: 9 } } })
    expect(localExtras(local, server).setup).toBe(1)
  })

  it('the server\'s sync rules know the map: same list, same highest stamp, never stamped as a setting', () => {
    expect(Server.STAMPED_MAPS).toEqual(STAMPED_MAPS)
    const doc = { _ts: 5, dayNotes: { '2026-10-01': { tag: 'sick', _ts: 77 } } }
    expect(Server.highestStamp(doc)).toBe(77)
    expect(highestStamp(doc)).toBe(77)
    // an older app (no stamps of its own) pushing over a copy with notes: the notes come back
    // from the stored copy, and no `edited.dayNotes` stamp is made up for them
    const cur = { _ts: 10, unit: 'kg', workouts: [], dayNotes: { '2026-10-01': { tag: 'sick', _ts: 9 } } }
    const next = { _ts: 11, unit: 'kg', workouts: [], restSec: 60 }
    Server.stampPut(cur, next, { overRead: true, now: 20 })
    expect(next.dayNotes).toEqual(cur.dayNotes)
    expect(next.edited?.dayNotes).toBeUndefined()
  })
})

describe('the workout-day reminder on a noted day (mobile)', () => {
  it('skips today once it carries a note', () => {
    const S = base({ routines: [{ id: 'r', name: 'Push', ex: [] }], week: { 0: 'r', 1: 'r', 2: 'r', 3: 'r', 4: 'r', 5: 'r', 6: 'r' }, reminder: { on: true, time: '18:00' } })
    const now = new Date(2026, 9, 9, 9, 0)
    expect(buildReminderNotifications(S, now)[0].schedule.at.getDate()).toBe(9)
    const noted = { ...S, dayNotes: withDayNote({}, '2026-10-09', { tag: 'sick' }, 1) }
    expect(buildReminderNotifications(noted, now)[0].schedule.at.getDate()).toBe(10)
  })
})
