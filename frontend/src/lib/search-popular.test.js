// A muscle search opens on the lifts people actually do at the gym, not on the alphabetically
// first stretches (Discord, 2026-10-27: "chest" listed stretches first).
import { expect, it } from 'vitest'
import { CATALOGUE, searchExercises } from './exercises.js'

const top = (q, n = 5) => searchExercises(CATALOGUE, q).slice(0, n)

it('"chest" opens on the bench press family, no stretch in the first ten', () => {
  const first = top('chest', 10)
  expect(first.map(e => e.id)).toContain('0025')
  expect(first.some(e => ['stretching', 'mobility', 'yoga', 'rehab'].includes(e.cat))).toBe(false)
})

it('"back", "biceps" and "shoulders" lead with staples', () => {
  expect(top('back', 8).map(e => e.id)).toEqual(expect.arrayContaining(['0652']))
  expect(top('biceps', 8).map(e => e.id)).toEqual(expect.arrayContaining(['0031']))
  expect(top('shoulders', 8).map(e => e.id)).toEqual(expect.arrayContaining(['0334']))
})

it('asking for a stretch still gets stretches first', () => {
  const first = top('chest stretch', 3)
  expect(first.every(e => /stretch/.test(e.n))).toBe(true)
})

it('a named lift is unchanged: "bench press" still starts with the barbell bench press', () => {
  expect(top('bench press', 1)[0].id).toBe('0025')
})

// Discord, 2026-11-04: "plank" opened on jack plank and plank jack; the front plank sat sixth.
it('a bare word that means one exercise opens on it: plank, crunch, row', () => {
  expect(top('plank', 1)[0].id).toBe('0463')
  expect(top('planks', 1)[0].id).toBe('0463')
  expect(top('crunch', 1)[0].id).toBe('0274')
  expect(top('row', 1)[0].id).toBe('0027')
  // A more precise search still gets what it says.
  expect(top('side plank', 1)[0].id).toBe('0715')
  expect(top('plank jack', 1)[0].id).toBe('3930')
})
