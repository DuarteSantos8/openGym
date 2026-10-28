// What is behind the doors (seasonal/advent-doors.js): the same for a day all year long, every
// kind there, every string translated, every stretch a real catalogue hold.
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DOOR_LIST, DOOR_STRINGS, SPECIAL, STRETCH, doorFor } from './advent-doors.js'
import { EXIDX } from '../lib/exercises.js'

describe('the doors', () => {
  it('deterministic: a day of a year always opens to the same thing', () => {
    for (let d = 1; d <= 24; d++) expect(doorFor(d, 2026)).toBe(doorFor(d, 2026))
    expect(doorFor(2, 2026)).toMatchObject({ kind: 'challenge' })
  })

  it('door 24 is the special one every year; the other 23 are all different', () => {
    for (const y of [2026, 2027, 2031]) {
      expect(doorFor(24, y)).toBe(SPECIAL)
      expect(new Set(Array.from({ length: 23 }, (_, i) => doorFor(i + 1, y))).size).toBe(23)
    }
  })

  it('turns from one year to the next, so December 1 is not always the same fact', () => {
    expect(doorFor(1, 2027)).not.toBe(doorFor(1, 2026))
    expect(doorFor(1, 2025)).toBeTruthy()           // before the first year too
  })

  it('every kind is in there', () => {
    const kinds = new Set(DOOR_LIST.map(d => d.kind))
    for (const k of ['fact', 'joke', 'tip', 'challenge', 'stretch', 'stat']) expect(kinds.has(k), k).toBe(true)
    for (const d of DOOR_LIST) if (['fact', 'joke', 'tip', 'challenge'].includes(d.kind)) expect(d.text).toBeTruthy()
  })

  it('no em dashes, the copy rule', () => {
    for (const s of DOOR_STRINGS) expect(s).not.toMatch(/—/)
  })

  it('every string behind a door is in every locale pack', async () => {
    const dir = join(__dirname, '..', 'locales')
    for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
      const pack = (await import(pathToFileURL(join(dir, f)).href)).default
      expect(DOOR_STRINGS.filter(k => !pack[k]), f).toEqual([])
    }
  })

  it('the stretch routine is made of catalogue holds', () => {
    for (const [id, sets, sec] of STRETCH) {
      expect(EXIDX[id], id).toBeTruthy()
      expect(EXIDX[id].n, id).toMatch(/stretch|pose/i)
      expect(sets).toBeGreaterThan(0)
      expect(sec).toBeGreaterThan(0)
    }
  })
})
