import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EXERCISE_GUIDES, PATTERNS } from '../../frontend/src/content/exercise-guides.js'
import { LEVELS } from '../../frontend/src/lib/experience.js'
import { classify, readCatalogue, seedLevels, serialize, outputFile } from './seed-level.mjs'

const rows = await readCatalogue()
const { levels, counts } = seedLevels(rows)

test('strength eligibility is independent of the available pattern evidence', () => {
  const { levels, counts } = seedLevels([
    { id: 'a', name: 'ambiguous drill', category: 'strength', target: 'glutes' },
    { id: 'b', name: 'forward lunge', category: 'mobility' },
    { id: 'c', variantOf: 'a' },
  ])
  assert.deepEqual(counts.strength, { total: 2, matched: 1 })
  assert.deepEqual(counts.canonical, { total: 2, matched: 1 })
  assert.deepEqual(counts.all, { total: 3, matched: 1 })
  assert.equal(levels.a, undefined)
  assert.equal(levels.c, undefined)
})

test('coverage, guide authority, alias parity and committed output', async () => {
  assert.ok(counts.strength.matched / counts.strength.total >= 0.90, JSON.stringify(counts))
  for (const [id, {level,pattern}] of Object.entries(EXERCISE_GUIDES)) {
    assert.deepEqual(levels[id], {level,pattern})
  }
  for (const {id, variantOf} of rows.filter(row => row.variantOf)) {
    assert.deepEqual(levels[id], levels[variantOf])
  }
  for (const {level,pattern} of Object.values(levels)) {
    assert.ok(LEVELS.includes(level) && PATTERNS.includes(pattern))
  }
  assert.equal(await readFile(outputFile, 'utf8'), serialize(levels))
  const { EXERCISE_LEVELS } = await import('../../frontend/src/content/exercise-levels.js')
  assert.deepEqual(EXERCISE_LEVELS, levels)
})

test('movement names take precedence over incidental target muscles and starting position', () => {
  for (const [name,target,pattern] of [
    ['split squat','glutes','lunge'], ['incline bench press','front delts','push-h'],
    ['cable upright row','traps','pull-v'], ['leg curl','hamstrings','isolation'],
    ['plank with arm lift (push up position)','abs','core'],
    ['walking on treadmill','cardiovascular system',undefined],
    ['hamstring stretch','hamstrings',undefined], ['unknown exercise','glutes',undefined],
  ]) assert.equal(classify({name,target})?.pattern, pattern, name)
})

test('an unrecognized activity stays unknown and named difficulty overrides equipment hints', () => {
  assert.equal(classify({name: 'forward press shoulders mobilization', target: 'front delts'}), null)
  assert.equal(classify({name: 'standing one arm chest stretch', target: 'pectorals'}), null)
  assert.deepEqual(classify({name: 'side plank (beginner)', target: 'abs'}), {level: 'beginner', pattern: 'core'})
  assert.deepEqual(classify({name: 'scissors (advanced)', target: 'abs'}), {level: 'advanced', pattern: 'core'})
  assert.throws(() => seedLevels([{id: 'a', variantOf: 'missing'}]), /Missing canonical/)
})

test('leg-raise direction, curl-ups and named strength work inside cardio', () => {
  for (const [name,target,pattern] of [
    ['standing side leg raise','abductors','isolation'],
    ['side lying leg raise','abductors','isolation'],
    ['machine abduction leg raise','abductors','isolation'],
    ['side plank with leg raise','abductors','core'],
    ['curl-up','abs','core'],
  ]) assert.equal(classify({name,target})?.pattern, pattern, name)
  for (const id of ['2157','0617']) assert.equal(levels[id]?.pattern, 'isolation', id)
  const fixture = [
    {id:'a',category:'cardio',name:'incline jack plank',target:'abs'},
    {id:'b',category:'cardio',name:'skipping rope',target:'cardiovascular system'},
    {id:'c',category:'cardio',name:'jumping jacks',target:'cardiovascular system'},
  ]
  assert.deepEqual(seedLevels(fixture).counts.strength, {total:1, matched:1})
})
