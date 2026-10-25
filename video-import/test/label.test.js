import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dominantLabel, stripLabel } from '../src/text.js'
import { draftFromFrames } from '../src/pipeline.js'

const many = (name, n) => Array.from({ length: n }, () => name)

test('a word that opens most of a video\'s captions is its label, whatever else it is', () => {
  const names = [...many('NOW: NECK PULSES', 40), ...many('NOW SIDE LUNGE', 30), ...many('NO PIKE SHOULDER TAP', 4), ...many('REST', 6), '', '']
  assert.equal(dominantLabel(names), 'now')
})

test('no label where the captions open with all sorts of words, or with one that means something', () => {
  const varied = [...many('BURPEES', 20), ...many('SQUATS', 20), ...many('PLANK HOLD', 20), ...many('LUNGES', 20)]
  assert.equal(dominantLabel(varied), null)
  assert.equal(dominantLabel(many('NEXT: BURPEES', 80)), null, 'NEXT is read as the announcement it is')
  assert.equal(dominantLabel(many('REST', 80)), null)
  assert.equal(dominantLabel(many('NOW: SQUATS', 10)), null, 'a handful of readings prove nothing')
  assert.equal(dominantLabel(many('PUSH UPS', 80)), null, 'a word of the exercises themselves is a move')
})

test('what the OCR makes of the label is stripped with it', () => {
  for (const [raw, want] of [
    ['NOW: IN AND OUT PUSH UP', 'IN AND OUT PUSH UP'],
    ['NO PIKE SHOULDER TAP', 'PIKE SHOULDER TAP'],
    ['OW SHOULDER ROTATIONS', 'SHOULDER ROTATIONS'],
    ['W IN AND OUT SQUAT', 'IN AND OUT SQUAT'],
    ['NOV SIDE LUNGES', 'SIDE LUNGES'],
    ['NOW:IN AND OUT PUSH UP', 'IN AND OUT PUSH UP'],
    ['NOW; LOW PLANK', 'LOW PLANK'],
    ['| NOW: LOW PLANK TO HIGH PLANK', 'LOW PLANK TO HIGH PLANK']
  ]) assert.equal(stripLabel(raw, 'now'), want, raw)
  // Nothing is left to name: the reading stays as it was. A caption without the label stays whole.
  assert.equal(stripLabel('NOW', 'now'), 'NOW')
  assert.equal(stripLabel('PLANK HOLD', 'now'), 'PLANK HOLD')
  assert.equal(stripLabel('', 'now'), '')
})

test('a video with a NOW label reads the same moves with or without it garbled (UIPvIYsjfpo)', async () => {
  const fs = await import('node:fs')
  const f = JSON.parse(fs.readFileSync(new URL('./fixtures/UIPvIYsjfpo.json', import.meta.url), 'utf8'))
  const { draft } = draftFromFrames(f.frames, f.inputs || {})
  const names = draft.sections.flatMap(s => s.rows).map(r => r.name).filter(Boolean)
  assert.ok(names.length > 30)
  assert.ok(!names.some(n => /^(now|no|ow|w|nov)\b/i.test(n)), 'no name starts with the label: ' + names.filter(n => /^(now|no|ow|w|nov)\b/i.test(n)).join(', '))
})
