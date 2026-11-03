import { describe, expect, it } from 'vitest'
import { tagUrl, parseTagUrl, routeTag, tagDebouncer } from './nfc-tags.js'

const TODAY = '2026-10-27' // a Tuesday
const plan = (extra = {}) => ({
  routines: [{ id: 'push', name: 'Push', ex: [{ id: '0025' }] }, { id: 'empty', name: 'Empty', ex: [] }],
  week: { 2: ['push'] }, dayPlan: {}, workouts: [], queue: { ids: [] },
  ...extra,
})
const known = id => ['0025', '0032', 'mine1'].includes(id)

describe('tagUrl / parseTagUrl', () => {
  it('round-trips every kind of sticker', () => {
    for (const tag of [
      { kind: 'checkin', start: true, card: null },
      { kind: 'checkin', start: false, card: null },
      { kind: 'checkin', start: false, card: 'lq3k2abcd' },
      { kind: 'exercise', id: '0025' },
      { kind: 'exercise', id: 'mk9x1z_custom-2' },
    ]) expect(parseTagUrl(tagUrl(tag))).toEqual(tag)
  })

  it('writes short https links on opengym.ch', () => {
    expect(tagUrl({ kind: 'checkin', start: true })).toBe('https://opengym.ch/nfc?do=start')
    expect(tagUrl({ kind: 'checkin', start: false, card: 'c1' })).toBe('https://opengym.ch/nfc?do=checkin&card=c1')
    expect(tagUrl({ kind: 'exercise', id: '0025' })).toBe('https://opengym.ch/nfc?ex=0025')
    // NTAG213 holds 137 bytes of NDEF: even a long custom id stays far below.
    expect(tagUrl({ kind: 'exercise', id: 'x'.repeat(64) }).length).toBeLessThan(110)
  })

  it('refuses to write what it could not read back', () => {
    expect(() => tagUrl({ kind: 'exercise', id: '../etc' })).toThrow()
    expect(() => tagUrl({ kind: 'exercise', id: '' })).toThrow()
    expect(() => tagUrl({ kind: 'nope' })).toThrow()
    // A card id that is not one is left off, not written.
    expect(tagUrl({ kind: 'checkin', card: 'a b' })).toBe('https://opengym.ch/nfc?do=checkin')
  })

  it('reads the opengym:// forms, from opengym.ch/nfc and written by hand', () => {
    expect(parseTagUrl('opengym://nfc?do=start')).toEqual({ kind: 'checkin', start: true, card: null })
    expect(parseTagUrl('opengym://nfc?ex=0032')).toEqual({ kind: 'exercise', id: '0032' })
    expect(parseTagUrl('opengym://checkin')).toEqual({ kind: 'checkin', start: false, card: null })
    expect(parseTagUrl('opengym://checkin?start=1&card=c1')).toEqual({ kind: 'checkin', start: true, card: 'c1' })
    expect(parseTagUrl('opengym://start')).toEqual({ kind: 'checkin', start: true, card: null })
    expect(parseTagUrl('opengym://exercise/0025')).toEqual({ kind: 'exercise', id: '0025' })
    expect(parseTagUrl('OPENGYM://exercise/0025/')).toEqual({ kind: 'exercise', id: '0025' })
  })

  it('takes www, a trailing slash and the .html page', () => {
    expect(parseTagUrl('https://www.opengym.ch/nfc/?do=start')).toEqual({ kind: 'checkin', start: true, card: null })
    expect(parseTagUrl('https://opengym.ch/nfc.html?ex=0025')).toEqual({ kind: 'exercise', id: '0025' })
  })

  it('answers null for anything that is not one of ours', () => {
    for (const raw of [
      null, undefined, 42, '', 'not a url', 'https://evil.example/nfc?do=start', 'https://opengym.ch.evil.example/nfc?do=start',
      'https://opengym.ch/privacy?do=start', 'https://opengym.ch/nfc', 'https://opengym.ch/nfc?do=launch-missiles',
      'https://opengym.ch/nfc?ex=', 'https://opengym.ch/nfc?ex=%3Cscript%3E', 'opengym://exercise/', 'opengym://exercise/a/b',
      'opengym://settings', 'opengym://checkin/extra', 'javascript:alert(1)', 'tel:123', 'opengym://nfc?ex=' + 'x'.repeat(65),
      'https://opengym.ch/nfc?ex=' + 'x'.repeat(600),
    ]) expect(parseTagUrl(raw), String(raw)).toBeNull()
  })
})

describe('routeTag', () => {
  it('a start sticker starts today’s planned session', () => {
    expect(routeTag(plan(), { kind: 'checkin', start: true }, { today: TODAY })).toEqual({ do: 'start', ids: ['push'] })
  })

  it('never starts a second workout: a running one opens instead', () => {
    const S = plan({ active: { id: 'a', start: 1, entries: [] } })
    expect(routeTag(S, { kind: 'checkin', start: true }, { today: TODAY })).toEqual({ do: 'open-workout' })
  })

  it('nothing planned, or only an empty routine: the Start screen', () => {
    expect(routeTag(plan({ week: {} }), { kind: 'checkin', start: true }, { today: TODAY })).toEqual({ do: 'open-start' })
    expect(routeTag(plan({ week: { 2: ['empty'] } }), { kind: 'checkin', start: true }, { today: TODAY })).toEqual({ do: 'open-start' })
    expect(routeTag({}, { kind: 'checkin', start: true }, { today: TODAY })).toEqual({ do: 'open-start' })
  })

  it('a check-in sticker shows the membership code, on its card while that exists', () => {
    const S = plan({ gymCards: [{ id: 'c1' }, { id: 'c2' }] })
    expect(routeTag(S, { kind: 'checkin', start: false, card: 'c2' }, { today: TODAY })).toEqual({ do: 'checkin', card: 'c2' })
    expect(routeTag(S, { kind: 'checkin', start: false, card: 'gone' }, { today: TODAY })).toEqual({ do: 'checkin', card: null })
  })

  it('a check-in sticker with no code to show (none saved, or check-in off) opens Start, never starts', () => {
    expect(routeTag(plan(), { kind: 'checkin', start: false }, { today: TODAY })).toEqual({ do: 'open-start' })
    expect(routeTag(plan({ checkIn: false, gymCards: [{ id: 'c1' }] }), { kind: 'checkin', start: false }, { today: TODAY })).toEqual({ do: 'open-start' })
    expect(routeTag(plan({ active: { entries: [] } }), { kind: 'checkin', start: false }, { today: TODAY })).toEqual({ do: 'open-workout' })
  })

  it('a machine sticker jumps to its exercise in the running workout', () => {
    const S = plan({ active: { start: 1, cur: 0, entries: [{ id: '0025' }, { id: '0032' }] } })
    expect(routeTag(S, { kind: 'exercise', id: '0032' }, { hasExercise: known })).toEqual({ do: 'jump', idx: 1 })
  })

  it('offers to add an exercise that is not in the session, and knows when it cannot', () => {
    const S = plan({ active: { start: 1, cur: 0, entries: [{ id: '0025' }] } })
    expect(routeTag(S, { kind: 'exercise', id: 'mine1' }, { hasExercise: known })).toEqual({ do: 'offer-add', id: 'mine1' })
    expect(routeTag(S, { kind: 'exercise', id: 'deleted' }, { hasExercise: known })).toEqual({ do: 'unknown-exercise' })
  })

  it('outside a workout (or while editing a past one) a machine sticker opens the details', () => {
    expect(routeTag(plan(), { kind: 'exercise', id: '0025' }, { hasExercise: known })).toEqual({ do: 'details', id: '0025' })
    const editing = plan({ active: { editingWorkoutId: 'w1', entries: [{ id: '0032' }] } })
    expect(routeTag(editing, { kind: 'exercise', id: '0025' }, { hasExercise: known })).toEqual({ do: 'details', id: '0025' })
    const backfill = plan({ active: { backfill: true, entries: [] } })
    expect(routeTag(backfill, { kind: 'exercise', id: 'gone' }, { hasExercise: known })).toEqual({ do: 'unknown-exercise' })
  })

  it('ignores what it does not know', () => {
    expect(routeTag(plan(), null)).toEqual({ do: 'ignore' })
    expect(routeTag(null, { kind: 'checkin', start: true })).toEqual({ do: 'ignore' })
    expect(routeTag(plan(), { kind: 'weird' })).toEqual({ do: 'ignore' })
  })
})

describe('tagDebouncer', () => {
  it('drops the same sticker read again within a few seconds', () => {
    const fresh = tagDebouncer({ sameMs: 4000, anyMs: 1000 })
    expect(fresh('a', 10_000)).toBe(true)
    expect(fresh('a', 10_050)).toBe(false) // Android handing one tap over twice
    expect(fresh('a', 12_000)).toBe(false) // still held on it
    expect(fresh('a', 14_100)).toBe(true) // a real second tap
  })

  it('drops any sticker right after another, but not a different one a moment later', () => {
    const fresh = tagDebouncer({ sameMs: 4000, anyMs: 1000 })
    expect(fresh('a', 0)).toBe(true)
    expect(fresh('b', 500)).toBe(false)
    expect(fresh('b', 1500)).toBe(true)
    expect(fresh('a', 2600)).toBe(true)
  })

  it('a clock that went back does not lock it up', () => {
    const fresh = tagDebouncer()
    expect(fresh('a', 50_000)).toBe(true)
    expect(fresh('a', 1_000)).toBe(true)
  })
})
