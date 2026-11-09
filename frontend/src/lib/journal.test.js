import { describe, it, expect } from 'vitest'
import { collectNotes, filterNotes, normFilter, filterIsEmpty, kindCounts, notedExercises, foldersOf, withFolder, gymNoteFor, gymNoteText, withGymNote, gymNoteKey, readGymNoteKey } from './journal.js'

const S = {
  workouts: [
    { id: 'w1', d: '2026-10-01', name: 'Push', note: 'Felt strong', entries: [
      { id: '0025', note: 'Grip a notch wider', notePin: true, sets: [{ w: 60, r: 8, done: true, note: 'left shoulder twinge' }, { w: 60, r: 8, done: true }] },
    ] },
    { id: 'w2', d: '2026-11-02', name: 'Legs', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true, note: 'depth ok' }] }] },
  ],
  measurements: [{ d: '2026-10-15', waist: 80, note: 'After the holidays' }],
  dayNotes: { '2026-10-20': { tag: 'sick', text: 'Flu', _ts: 1 }, '2026-10-21': { _ts: 2 } },
  recoverySessions: { r1: { d: '2026-10-25', kind: 'sauna', min: 20, note: 'Hot one', _ts: 3 }, r2: { d: '2026-10-26', kind: 'cold', min: 3, _ts: 3 } },
  exNotes: { '0025': 'Seat 4' },
  routines: [{ id: 'R', name: 'Push day', ex: [{ id: '0025', note: 'Brace before each rep' }, { id: '0043' }] }],
  equipProfiles: [{ id: 'g1', name: 'Big gym' }, { id: 'g2', name: 'Home' }],
  activeEquipId: 'g1',
  gymNotes: { 'g1|0025': { text: 'Bench 3 wobbles', _ts: Date.parse('2026-10-03T10:00:00') }, 'g1|*': { text: 'Locker 12', _ts: 4 }, 'gone|0025': { text: 'old gym', _ts: 5 }, 'g2|0025': { _ts: 6 } },
}

describe('collectNotes', () => {
  const notes = collectNotes(S)
  it('reads every kind, dated ones newest first, then the undated', () => {
    expect(notes.map(n => n.kind)).toEqual(['set', 'recovery', 'day', 'body', 'workout', 'exercise', 'set', 'standing', 'tip', 'gym', 'gym'])
    expect(notes[0]).toMatchObject({ d: '2026-11-02', exId: '0043', text: 'depth ok', setNo: 1, title: 'Legs' })
  })
  it('keeps a workout note together with its exercise and set notes', () => {
    const oct1 = notes.filter(n => n.d === '2026-10-01')
    expect(oct1.map(n => n.kind)).toEqual(['workout', 'exercise', 'set'])
    expect(oct1[1].pinned).toBe(true)
  })
  it('skips a cleared day note, a recovery session without a note and a pin at a gym that is gone', () => {
    expect(notes.some(n => n.d === '2026-10-21')).toBe(false)
    expect(notes.filter(n => n.kind === 'recovery')).toHaveLength(1)
    expect(notes.filter(n => n.kind === 'gym').map(n => n.text)).toEqual(['Bench 3 wobbles', 'Locker 12'])
  })
  it('gives a gym pin its gym name and, for an exercise, the exercise', () => {
    const [ex, all] = notes.filter(n => n.kind === 'gym')
    expect(ex).toMatchObject({ gymId: 'g1', exId: '0025', title: 'Big gym', since: '2026-10-03' })
    expect(all.exId).toBeUndefined()
  })
  it('stable keys', () => {
    expect(new Set(notes.map(n => n.key)).size).toBe(notes.length)
  })
})

describe('filters', () => {
  const notes = collectNotes(S)
  it('by kind, exercise and dates', () => {
    expect(filterNotes(notes, { kinds: ['set'] })).toHaveLength(2)
    expect(filterNotes(notes, { exId: '0025' }).map(n => n.kind)).toEqual(['exercise', 'set', 'standing', 'tip', 'gym'])
    expect(filterNotes(notes, { from: '2026-10-10', to: '2026-10-31' }).map(n => n.kind)).toEqual(['recovery', 'day', 'body'])
  })
  it('a date range leaves out the notes without a day', () => {
    expect(filterNotes(notes, { from: '2000-01-01' }).every(n => n.d)).toBe(true)
  })
  it('text search ignores case and accents and finds the exercise name', () => {
    expect(filterNotes(notes, { q: 'HOLIDAYS' })).toHaveLength(1)
    expect(filterNotes([{ kind: 'set', text: 'presión baja', d: '2026-01-01' }], { q: 'presion' })).toHaveLength(1)
    expect(filterNotes(notes, { q: 'bench press' }, id => (id === '0025' ? 'Bench Press' : 'Squat')).length).toBeGreaterThan(0)
  })
  it('with photos', () => {
    const w = { ...S, workouts: [{ ...S.workouts[0], media: [{ kind: 'image', hash: 'a'.repeat(64), mime: 'image/jpeg', size: 9, width: 9, height: 9 }] }] }
    expect(filterNotes(collectNotes(w), { media: true }).map(n => n.kind)).toEqual(['workout', 'exercise', 'set'])
  })
  it('normFilter drops junk, swaps a backwards range, and every kind means no kind filter', () => {
    expect(normFilter({ kinds: ['set', 'nope'], from: '2026-12-01', to: '2026-01-01', q: '  x ', media: 'yes' })).toEqual({ kinds: ['set'], from: '2026-01-01', to: '2026-12-01', q: 'x' })
    expect(filterIsEmpty({ kinds: [], q: ' ' })).toBe(true)
  })
  it('counts per kind and the noted exercises, most noted first', () => {
    expect(kindCounts(notes).set).toBe(2)
    expect(notedExercises(notes)[0]).toEqual({ id: '0025', count: 5 })
  })
})

describe('folders are saved filters', () => {
  it('saves, renames and clears with a stamp', () => {
    let m = withFolder(undefined, 'f1', { name: '  Shoulder ', filter: { q: 'shoulder', bogus: 1 } }, 10)
    expect(m.f1).toEqual({ name: 'Shoulder', filter: { q: 'shoulder' }, _ts: 10 })
    m = withFolder(m, 'f2', { name: 'Alpha', filter: {} }, 11)
    expect(foldersOf({ journalFolders: m }).map(f => f.name)).toEqual(['Alpha', 'Shoulder'])
    m = withFolder(m, 'f1', null, 12)
    expect(m.f1).toEqual({ _ts: 12 })
    expect(foldersOf({ journalFolders: m }).map(f => f.id)).toEqual(['f2'])
  })
})

describe('gym pins', () => {
  it('shows only at the active gym', () => {
    expect(gymNoteFor(S, '0025')).toMatchObject({ text: 'Bench 3 wobbles', gym: { id: 'g1' } })
    expect(gymNoteFor(S)).toMatchObject({ text: 'Locker 12' })
    expect(gymNoteFor({ ...S, activeEquipId: 'g2' }, '0025')).toBeNull()
    expect(gymNoteFor({ ...S, activeEquipId: null }, '0025')).toBeNull()
  })
  it('writes and clears with a stamp', () => {
    const m = withGymNote({}, 'g2', '0043', '  Rack 2 ', 7)
    expect(m['g2|0043']).toEqual({ text: 'Rack 2', _ts: 7 })
    expect(withGymNote(m, 'g2', '0043', '', 8)['g2|0043']).toEqual({ _ts: 8 })
    expect(gymNoteText({ gymNotes: m }, 'g2', '0043')).toBe('Rack 2')
  })
  it('keys', () => {
    expect(gymNoteKey('g1')).toBe('g1|*')
    expect(readGymNoteKey('g1|0025')).toEqual({ gymId: 'g1', exId: '0025' })
    expect(readGymNoteKey('nope')).toBeNull()
  })
})
