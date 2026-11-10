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
