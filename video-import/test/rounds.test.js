import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRounds } from '../src/rounds.js'

test('a repeating sequence is rounds of its pattern', () => {
  const r = detectRounds(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'].map(x => x.repeat(5)))
  assert.equal(r.period, 3); assert.equal(r.rounds, 3)
  assert.deepEqual(r.pattern, ['aaaaa', 'bbbbb', 'ccccc'])
})

test('the smallest period wins', () => {
  assert.deepEqual(detectRounds(['burpees', 'burpees', 'burpees', 'burpees']), { period: 1, rounds: 4, pattern: ['burpees'] })
  const ab = detectRounds(['burpees', 'plank', 'burpees', 'plank', 'burpees', 'plank'])
  assert.equal(ab.period, 2); assert.equal(ab.rounds, 3)
})

test('OCR variants still repeat', () => {
  const r = detectRounds(['burpees', 'mountain climbers', 'burpees', 'mountain c1imbers', 'burpes', 'mountain climbers'])
  assert.equal(r.period, 2); assert.equal(r.rounds, 3)
})

test('one exercise missing from the last round is still rounds', () => {
  const seq = ['burpees', 'plank', 'squats', 'lunges', 'burpees', 'plank', 'squats', 'lunges', 'burpees', 'plank', 'squats']
  const r = detectRounds(seq)
  assert.equal(r.period, 4); assert.equal(r.rounds, 3)
})

test('names that never repeat are one round', () => {
  const r = detectRounds(['burpees', 'plank', 'squats', 'lunges', 'crunches'])
  assert.equal(r.period, 0); assert.equal(r.rounds, 1)
  assert.deepEqual(detectRounds([]), { period: 0, rounds: 1, pattern: [] })
})
