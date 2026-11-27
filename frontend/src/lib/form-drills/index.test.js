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

  // The drills added together, and the neighbours each must not take rows from: lateral against
  // front raise, pull-up against hanging leg raise, chest-supported against seated row, squat and
  // split squat against side lunge, rear fly against upright row, triceps against straight-arm pushdown.
  it.each([
    ['0310', 'front-raise'], ['0978', 'front-raise'], ['0334', 'lateral-raise'], ['0335', null], ['0392', null],
    ['0120', 'upright-row'], ['0246', 'upright-row'], ['2500', 'rear-fly'], ['0775', null], ['0363', null],
    ['0238', 'straight-arm-pulldown'], ['1229', 'straight-arm-pulldown'], ['0199', 'straight-arm-pulldown'], ['0200', 'triceps-pushdown'], ['5844', null],
    ['9819', 'hanging-leg-raise'], ['0475', 'hanging-leg-raise'], ['1326', 'pull-up'], ['0826', null], ['3891', null], ['0011', null],
    ['0861', 'seated-cable-row'], ['3896', 'seated-cable-row'], ['9698', 'chest-supported-row'], ['1350', null], ['0214', null], ['0213', null],
    ['0734', 'wall-sit'], ['7559', 'wall-sit'], ['0463', 'plank'], ['0731', null], ['1546', null],
    ['2972', 'side-lunge'], ['2569', 'side-lunge'], ['4789', 'side-lunge'], ['2966', 'squat'], ['2290', 'split-squat'], ['3350', null], ['10052', null],
    ['0791', 'hip-abduction'], ['3853', 'hip-abduction'], ['11266', 'hip-abduction'], ['0597', null], ['0790', null], ['0837', null],
  ])('gives exercise %s to %s and no other drill', (id, drill) => {
    expect(EXIDX[id]).toBeTruthy()
    expect(drillFor(EXIDX[id])?.id ?? null).toBe(drill)
    expect(DRILLS.filter(d => d.matches(EXIDX[id])).map(d => d.id)).toEqual(drill ? [drill] : [])
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
