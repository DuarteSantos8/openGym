import { describe, expect, it } from 'vitest'
import { cleanSettings, settingsFor, splitNote, joinNote, settingsLine, noteWithoutSettings, withSettings, withNoteText, noteRoom, settingLabel, knownKeys, SETTINGS_MAX, KEY_MAX, VALUE_MAX } from './machine-settings.js'
import { exNoteFor } from './history.js'

describe('cleanSettings', () => {
  it('trims both halves and drops a pair missing either', () => {
    expect(cleanSettings([{ k: '  Seat ', v: ' 5 ' }, { k: 'Pad', v: '' }, { k: '', v: '3' }, null, 'x', { k: 'Leg  position', v: 'M' }]))
      .toEqual([{ k: 'Seat', v: '5' }, { k: 'Leg position', v: 'M' }])
  })

  it('keeps a name given twice once, in its first place with its last value', () => {
    expect(cleanSettings([{ k: 'Seat', v: '5' }, { k: 'Pad', v: '2' }, { k: 'seat', v: '6' }]))
      .toEqual([{ k: 'Seat', v: '6' }, { k: 'Pad', v: '2' }])
  })

  it('cuts names and values to length, and keeps at most the maximum', () => {
    const [p] = cleanSettings([{ k: 'x'.repeat(40), v: 'y'.repeat(40) }])
    expect(p.k).toHaveLength(KEY_MAX)
    expect(p.v).toHaveLength(VALUE_MAX)
    const many = Array.from({ length: 12 }, (_, i) => ({ k: 'K' + i, v: String(i) }))
    expect(cleanSettings(many)).toHaveLength(SETTINGS_MAX)
  })

  it('takes numbers as text, and keeps ":" and "·" out of the way of the line', () => {
    expect(cleanSettings([{ k: 'Seat', v: 5 }])).toEqual([{ k: 'Seat', v: '5' }])
    expect(cleanSettings([{ k: 'Seat: high', v: 'a · b' }])).toEqual([{ k: 'Seat high', v: 'a b' }])
    expect(cleanSettings([{ k: 'Time', v: '1:30' }])).toEqual([{ k: 'Time', v: '1:30' }])
  })

  it('reads anything that is not a list as none', () => {
    expect(cleanSettings(undefined)).toEqual([])
    expect(cleanSettings({ k: 'Seat', v: '5' })).toEqual([])
  })
})

describe('the settings line in a standing note', () => {
  it('reads the first line as settings when every part is "Name: value"', () => {
    expect(splitNote('Seat: 5 · Leg position: M\nKeep the bar low')).toEqual({ pairs: [{ k: 'Seat', v: '5' }, { k: 'Leg position', v: 'M' }], rest: 'Keep the bar low' })
    expect(splitNote('Seat: 5')).toEqual({ pairs: [{ k: 'Seat', v: '5' }], rest: '' })
    expect(splitNote('Time: 1:30')).toEqual({ pairs: [{ k: 'Time', v: '1:30' }], rest: '' })
  })

  it('leaves any other note a plain note', () => {
    for (const n of ['Seat height, pin 4', 'Seat: 5 · and then some', 'Warm up first\nSeat: 5', ': 5', 'Seat: ', '']) {
      expect(splitNote(n)).toEqual({ pairs: [], rest: n.trim() })
    }
    expect(splitNote(undefined)).toEqual({ pairs: [], rest: '' })
  })

  it('writes and reads back the same pairs', () => {
    const pairs = [{ k: 'Seat', v: '5' }, { k: 'Backrest', v: '3' }]
    expect(settingsLine(pairs)).toBe('Seat: 5 · Backrest: 3')
    expect(splitNote(joinNote(pairs, 'Cue: chest up'))).toEqual({ pairs, rest: 'Cue: chest up' })
    expect(joinNote([], ' only a note ')).toBe('only a note')
    expect(joinNote([], '')).toBe('')
  })
})

describe('settingsFor / withSettings / withNoteText', () => {
  it('reads one exercise, none for another or without the map', () => {
    const S = { exNotes: { '0025': 'Seat: 5\nCue' } }
    expect(settingsFor(S, '0025')).toEqual([{ k: 'Seat', v: '5' }])
    expect(noteWithoutSettings(S, '0025')).toBe('Cue')
    expect(settingsFor(S, '0043')).toEqual([])
    expect(noteWithoutSettings(S, '0043')).toBe('')
    expect(settingsFor({}, '0025')).toEqual([])
  })

  it('sets the line, keeps the note under it, and leaves no key for an exercise with nothing', () => {
    const before = { '0025': 'Seat: 5\nCue', '0043': 'a plain note' }
    const next = withSettings(before, '0043', [{ k: 'Pad', v: '3' }, { k: 'Seat', v: '' }])
    expect(next).toEqual({ '0025': 'Seat: 5\nCue', '0043': 'Pad: 3\na plain note' })
    expect(before['0043']).toBe('a plain note')
    expect(withSettings(next, '0025', [])).toEqual({ '0025': 'Cue', '0043': 'Pad: 3\na plain note' })
    expect(withSettings({ '0025': 'Seat: 5' }, '0025', [])).toEqual({})
    expect(withSettings(undefined, '0025', [{ k: 'Seat', v: '5' }])).toEqual({ '0025': 'Seat: 5' })
  })

  it('edits the note text without touching the line', () => {
    expect(withNoteText({ a: 'Seat: 5\nold' }, 'a', 'new')).toEqual({ a: 'Seat: 5\nnew' })
    expect(withNoteText({ a: 'Seat: 5\nold' }, 'a', '')).toEqual({ a: 'Seat: 5' })
    expect(withNoteText({ a: 'old' }, 'a', '')).toEqual({})
    expect(withNoteText({}, 'a', 'new')).toEqual({ a: 'new' })
  })

  it('never cuts a note: when line and text do not fit together, nothing changes', () => {
    const notes = { a: 'Seat: 5' }
    expect(withNoteText(notes, 'a', 'x'.repeat(100), 20)).toBe(notes)
    expect(withNoteText(notes, 'a', 'x'.repeat(12), 20)).toEqual({ a: 'Seat: 5' + String.fromCharCode(10) + 'x'.repeat(12) })
    const long = { a: 'x'.repeat(19) }
    expect(withSettings(long, 'a', [{ k: 'Seat', v: '5' }], 20)).toBe(long)
    expect(noteRoom({ exNotes: notes }, 'a', 20)).toBe(12)
    // A full 2000-character note: adding a setting is refused, saving without settings keeps every character.
    const full = { a: 'y'.repeat(2000) }
    expect(withSettings(full, 'a', [{ k: 'Seat', v: '5' }], 2000)).toBe(full)
    expect(withSettings(full, 'a', [], 2000)).toEqual(full)
    expect(withNoteText(full, 'a', 'y'.repeat(2000), 2000)).toEqual(full)
    expect(noteRoom({}, 'a', 20)).toBe(20)
  })

  it('shows the workout the note without the line, as it always did without one', () => {
    expect(exNoteFor({ exNotes: { a: 'Seat: 5\nCue' } }, 'a')).toBe('Cue')
    expect(exNoteFor({ exNotes: { a: 'Seat: 5' } }, 'a')).toBe(null)
    expect(exNoteFor({ exNotes: { a: ' Cue ' } }, 'a')).toBe('Cue')
  })
})

describe('settingLabel / knownKeys', () => {
  it('labels a pair as a tag shows it', () => {
    expect(settingLabel({ k: 'Seat', v: '5' })).toBe('Seat: 5')
  })

  it('lists the names used elsewhere, most used first, without the given ones', () => {
    const S = { exNotes: {
      a: 'Seat: 5 · Pad: 2',
      b: 'seat: 3 · Backrest: 1\nsome note',
      c: 'Seat: 4 · Pad: 1',
      d: 'Not: settings, just text'
    } }
    expect(knownKeys(S)).toEqual(['Seat', 'Pad', 'Backrest'])
    expect(knownKeys(S, ['SEAT'])).toEqual(['Pad', 'Backrest'])
    expect(knownKeys({})).toEqual([])
  })
})
