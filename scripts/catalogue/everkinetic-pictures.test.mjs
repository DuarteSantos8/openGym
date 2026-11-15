// node --test scripts/catalogue/everkinetic-pictures.test.mjs: the matcher maps only what it is sure of.
import test from 'node:test'
import assert from 'node:assert/strict'
import { words, catalogueIndex, matchOne, notice, AUTHOR, LICENSE } from './everkinetic-pictures.mjs'

const cat = [
  { id: '0025', name: 'barbell bench press', equipment: 'barbell' },
  { id: '0289', name: 'dumbbell bench press', equipment: 'dumbbell' },
  { id: '0294', name: 'dumbbell biceps curl', equipment: 'dumbbell', femaleVariant: '9001' },
  { id: '9001', name: 'dumbbell biceps curl', equipment: 'dumbbell' },
  { id: '1557', name: 'dumbbell walking lunges', equipment: 'dumbbell' },
  { id: '4295', name: 'dumbbell walking lunge', equipment: 'dumbbell' },
]
const idx = catalogueIndex(cat)
const ek = (title, equipment = []) => ({ title, equipment })

test('words: plural, hyphen and synonym folding', () => {
  assert.deepEqual(words('Biceps Curls With Dumbbells'), ['bicep', 'curl', 'dumbbell'])
  assert.deepEqual(words('Push-ups'), ['push', 'up'])
})

test('a name plus its equipment maps to exactly one catalogue exercise', () => {
  assert.equal(matchOne(ek('Bench Press', ['bench', 'barbell']), idx), '0025')
  assert.equal(matchOne(ek('Dumbbell Biceps Curls', ['dumbbells']), idx), '0294')
})

test('female drawings are not exercises, an ambiguous name maps to nothing, no name to nothing', () => {
  assert.notEqual(matchOne(ek('Dumbbell Biceps Curls', ['dumbbells']), idx), '9001')
  assert.equal(matchOne(ek('Walking Lunges', ['dumbbells']), idx), null)
  assert.equal(matchOne(ek('Bench Press', []), idx), null) // no equipment: barbell or dumbbell?
  assert.equal(matchOne(ek(''), idx), null)
})

test('NOTICE names the author, the licence and the change, and lists every file', () => {
  const n = notice({ '0025': [{ f: 'files/0042-relaxation.webp', pose: 'start', source: 'https://x' }] }, cat)
  assert.match(n, new RegExp(AUTHOR.replace(/[()]/g, '\\$&')))
  assert.equal(LICENSE, 'CC-BY-SA-4.0')
  assert.match(n, /CC BY-SA 4\.0/)
  assert.match(n, /resized to fit 480×480 px/)
  assert.match(n, /files\/0042-relaxation\.webp/)
})
