import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { muscleLevels3d, glbMeshNames, parseCssColor, NEUTRAL } from './muscle-3d.js'
import { MUSCLES, levelsOf, loadOfWorkouts, muscleBalanceWindow } from './muscles.js'
import { EXDB } from './exercises.js'
import { MONDAY } from './format.js'

const glb = readFileSync(fileURLToPath(new URL('../../public/anatomy/muscles.glb', import.meta.url)))
const NOW = Date.parse('2026-11-14T12:00:00Z')
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10)
const sq = EXDB.find(e => /squat/i.test(e.n || e.name || ''))?.id || EXDB[0].id
const bench = EXDB.find(e => /bench press/i.test(e.n || e.name || ''))?.id || EXDB[1].id
const w = (n, id, sets) => ({ id: 'w' + n + id, d: day(n), entries: [{ id, sets: Array.from({ length: sets }, () => ({ w: 60, r: 5, done: true })) }] })

describe('the 3D model (EP12)', () => {
  it('has one mesh for every muscle the 2D map draws, plus the neutral body', () => {
    const names = glbMeshNames(glb)
    for (const m of MUSCLES) expect(names, m).toContain(m)
    expect(names).toContain(NEUTRAL)
    expect(names).toHaveLength(MUSCLES.length + 1)
  })
  it('carries its licence in the file itself', () => {
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + glb.readUInt32LE(12))))
    expect(json.asset.copyright).toMatch(/Z-Anatomy \(CC BY-SA 4\.0\)/)
    expect(json.asset.copyright).toMatch(/BodyParts3D/)
  })
  it('rejects a file that is not a GLB', () => {
    expect(() => glbMeshNames(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))).toThrow(/GLB/)
  })
})

describe('3D levels are the 2D map’s levels', () => {
  it('uses exactly the Muscle balance pipeline, window and week start included', () => {
    const workouts = [w(1, sq, 5), w(2, bench, 3), w(20, bench, 10)]
    for (const win of [7, 30]) {
      const expected = levelsOf(loadOfWorkouts(muscleBalanceWindow(workouts, win, NOW, day(0), MONDAY)))
      expect(muscleLevels3d(workouts, { win, now: NOW, today: day(0), ws: MONDAY })).toEqual(expected)
    }
    expect(Object.values(muscleLevels3d(workouts, { win: 30, now: NOW, today: day(0) })).some(l => l > 0)).toBe(true)
  })
  it('an empty history is all zero, never an error', () => {
    expect(Object.values(muscleLevels3d([], { now: NOW, today: day(0) })).every(l => l === 0)).toBe(true)
    expect(Object.values(muscleLevels3d(undefined, { now: NOW, today: day(0) })).every(l => l === 0)).toBe(true)
  })
})

describe('parseCssColor', () => {
  it('reads the forms getComputedStyle returns', () => {
    expect(parseCssColor('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0])
    expect(parseCssColor('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1])
    expect(parseCssColor('color(srgb 0.2 0.4 0.6)')).toEqual([0.2, 0.4, 0.6])
    expect(parseCssColor('color(srgb 0.2 0.4 0.6 / 0.5)')).toEqual([0.2, 0.4, 0.6])
    expect(parseCssColor('oklch(0.7 0.1 120)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
  })
})
