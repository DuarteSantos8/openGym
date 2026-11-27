// The drill registry: every drill keeps the contract (README.md), declares strings every locale
// has, answers an empty camera without throwing, and drillFor() finds the drill for an exercise.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DRILLS, checkDrill, drillById, drillFor, drillStrings, standardFor } from './index.js'
import { EXDB, EXIDX } from '../exercises.js'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales')
const packs = await Promise.all(readdirSync(localesDir).filter(f => f.endsWith('.js')).map(async f => [f, (await import(pathToFileURL(join(localesDir, f)).href)).default]))

describe.each(DRILLS.map(d => [d.id, d]))('drill %s', (id, drill) => {
  it('keeps the contract', () => {
    expect(checkDrill(drill)).toEqual([])
    expect(drillById(id)).toBe(drill)
  })

  it('has its declared strings in every locale', () => {
    for (const [file, pack] of packs) {
      const missing = drillStrings(drill).filter(s => !(s in pack))
      expect({ file, missing }).toEqual({ file, missing: [] })
    }
  })

  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = drill.create({ standard: drill.defaultStandard })
    const out = tr.push({ t: 0, aspect: 0.75, joints: {} })
    expect(out).toMatchObject({ count: 0, inFrame: false, justCounted: false, justMissed: false, reached: false, highlight: [] })
    expect(typeof out.hint).toBe('string')
    expect(out.hint).not.toBe('')
    const res = tr.result()
    expect(res).toMatchObject({ count: 0, missed: 0, reps: [], details: [] })
    expect(res.tiles.length).toBeLessThanOrEqual(3)
    expect(typeof res.cue).toBe('string')
    expect(typeof res.cueId).toBe('string')
  })

  it('says no to nothing and to exercises that are not objects', () => {
    expect(drill.matches(null)).toBe(false)
    expect(drill.matches(undefined)).toBe(false)
    expect(drill.matches('3593')).toBe(false)
  })
})

describe('the registry', () => {
  it('has unique ids', () => {
    expect(new Set(DRILLS.map(d => d.id)).size).toBe(DRILLS.length)
  })

  it('finds the drill for an exercise, none for one no drill judges', () => {
    expect(drillFor(EXIDX['3593'])).toBe(drillById('squat'))
    expect(drillFor(EXIDX['0289'])).toBe(null)
    expect(drillFor(null)).toBe(null)
    expect(drillById('bench')).toBe(null)
  })

  it('judges no catalogue exercise with two drills', () => {
    const twice = EXDB
      .map(ex => [ex.id, ex.n, DRILLS.filter(d => d.matches(ex)).map(d => d.id)])
      .filter(([, , ids]) => ids.length > 1)
    expect(twice).toEqual([])
  })

  // The owner's own plan: the drill each of its exercises gets, and the ones left without one
  // (a bench press, a deadlift from the floor, a hip thrust, a dead bug, a machine fly: no drill
  // reads them reliably from a 2D pose yet).
  it.each([
    ['3593', 'squat'], ['2966', 'squat'], ['1459', 'romanian-deadlift'], ['2290', 'split-squat'],
    ['1326', 'pull-up'], ['0499', 'inverted-row'], ['2500', 'rear-fly'], ['9698', 'chest-supported-row'],
    ['0200', 'triceps-pushdown'], ['0313', 'curl'], ['0334', 'lateral-raise'], ['0715', 'side-plank'],
    ['0289', null], ['0047', null], ['0032', null], ['2146', null], ['0276', null], ['0596', null],
  ])('puts exercise %s under %s', (id, drill) => {
    expect(EXIDX[id]).toBeTruthy()
    expect(drillFor(EXIDX[id])?.id ?? null).toBe(drill)
    expect(DRILLS.filter(d => d.matches(EXIDX[id])).length).toBe(drill ? 1 : 0)
  })

  // Let in by a drill's name test, but not what its signal judges: the registry turns them away.
  it.each(['1352', '1148', '9002', '4923', '1090', '1130', '3237', '4161', '3581'])('gives exercise %s no drill', id => {
    expect(EXIDX[id]).toBeTruthy()
    expect(drillFor(EXIDX[id])).toBe(null)
  })

  it('keeps a standard that is the drill’s and falls back to its default otherwise', () => {
    expect(standardFor('squat', 'below')).toBe('below')
    expect(standardFor(drillById('squat'), 'knee-deep')).toBe('parallel')
    expect(standardFor('squat')).toBe('parallel')
    expect(standardFor('bench', 'below')).toBe(null)
  })

  it('names what is wrong with a definition', () => {
    expect(checkDrill(null)).toEqual(['not an object'])
    const bad = checkDrill({ id: 'Bad Id', kind: 'sets', views: ['top'], standards: [{ id: 'a', label: 'A' }], defaultStandard: 'b', misses: { x: {} } })
    expect(bad).toEqual(expect.arrayContaining([
      'id: lower-case letters, digits and dashes', 'kind: reps or hold', 'views: side, diagonal and/or front, best first',
      'defaultStandard: one of the standards', 'misses: { reason: { line, say, row } }', 'create: a function',
    ]))
  })
})
