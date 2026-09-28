import { afterEach, expect, it } from 'vitest'
import { CATALOGUE, EXDB, EXIDX, registerCustom } from './exercises.js'
import { OLYMPIC_LIFT_METADATA } from './exercise-muscle-batch-1.js'
import { musclesOf, MUSCLES } from './muscles.js'

afterEach(() => registerCustom([]))

const catalogueNames = {
  '0295': 'dumbbell clean',
  '0518': 'kettlebell alternating hang clean',
  '0525': 'kettlebell bottoms up clean from the hang position',
  '0526': 'kettlebell double alternating hang clean',
  '0535': 'kettlebell hang clean',
  '0552': 'kettlebell two arm clean',
  '0648': 'power clean',
  '0067': 'barbell one arm snatch',
  '3888': 'dumbbell one arm snatch',
  '0529': 'kettlebell double snatch',
  '0542': 'kettlebell one arm snatch',
  '0028': 'barbell clean and press',
  '0537': 'kettlebell one arm clean and jerk',
  '0527': 'kettlebell double jerk',
  '0538': 'kettlebell one arm jerk',
  '0776': 'snatch pull'
}

it('matches current catalogue names and classifies the audited lift family', () => {
  expect(Object.keys(OLYMPIC_LIFT_METADATA)).toEqual(Object.keys(catalogueNames))
  for (const [id, name] of Object.entries(catalogueNames)) {
    expect(EXDB.find(exercise => exercise.id === id)?.n, id).toBe(name)
    expect(CATALOGUE.find(exercise => exercise.id === id)).toMatchObject(OLYMPIC_LIFT_METADATA[id])
    expect(OLYMPIC_LIFT_METADATA[id].bp).toBe('full body')
  }
})

it('keeps every overlay mapping canonical, multi-primary, and weighted for the lower body', () => {
  for (const [id, mapping] of Object.entries(OLYMPIC_LIFT_METADATA)) {
    expect(mapping.primaries.length, id).toBeGreaterThan(1)
    expect(mapping.primaries.every(muscle => MUSCLES.includes(muscle)), id).toBe(true)
    expect(mapping.secondaries.every(muscle => MUSCLES.includes(muscle) && !mapping.primaries.includes(muscle)), id).toBe(true)
    expect(new Set([...mapping.primaries, ...mapping.secondaries]).size, id).toBe(mapping.primaries.length + mapping.secondaries.length)
    expect(musclesOf(EXIDX[id]), id).toMatchObject({ quadriceps: 1, gluteal: 1 })
  }
})

it('distinguishes overhead pressing from a pull and keeps trunk bracing secondary', () => {
  expect(EXIDX['0028'].primaries).toContain('triceps')
  expect(EXIDX['0776'].primaries).not.toContain('triceps')
  expect(EXIDX['0067'].primaries).toContain('deltoids')
  expect(EXIDX['0648'].secondaries).toContain('abs')
  expect(EXIDX['0648'].primaries).not.toContain('abs')
})

it('preserves raw catalogue records and user corrections instead of overwriting saved metadata', () => {
  const raw = EXDB.find(exercise => exercise.id === '0648')
  expect(raw.bp).toBe('upper legs')
  expect(raw.primaries).toBeUndefined()
  registerCustom([{ ...raw, primaries: ['hamstring'], secondaries: [], bp: 'upper legs' }])
  expect(EXIDX['0648']).toMatchObject({ primaries: ['hamstring'], secondaries: [], bp: 'upper legs' })
  registerCustom([])
  expect(EXIDX['0648']).toMatchObject(OLYMPIC_LIFT_METADATA['0648'])
})

it('does not classify clean-grip squats as Olympic clean movements or duplicate covered jerk metadata', () => {
  expect(OLYMPIC_LIFT_METADATA['0029']).toBeUndefined()
  expect(OLYMPIC_LIFT_METADATA['1433']).toBeUndefined()
  expect(OLYMPIC_LIFT_METADATA['0786']).toBeUndefined()
  expect(EXIDX['0786'].primaries).toContain('deltoids')
})
