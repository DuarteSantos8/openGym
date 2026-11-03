import { describe, expect, test } from 'vitest'
import { setNoteOf, withSetNote, SET_NOTE_MAX } from './set-notes.js'

describe('a note on one set', () => {
  test('is kept trimmed and short, and a blank one is no note', () => {
    expect(withSetNote({ w: 80, r: 8 }, '  grip slipped \n')).toEqual({ w: 80, r: 8, note: 'grip slipped' })
    expect(withSetNote({ w: 80, r: 8, note: 'x' }, '  ')).toEqual({ w: 80, r: 8 })
    expect(withSetNote({}, 'a'.repeat(300)).note).toHaveLength(SET_NOTE_MAX)
    expect(setNoteOf({ note: ' easy ' })).toBe('easy')
    expect(setNoteOf({})).toBe('')
    expect(setNoteOf(null)).toBe('')
  })
})
