import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segment, timerResets } from '../src/segment.js'
import { framesOf } from './synthetic.mjs'

const kinds = bs => bs.map(b => `${b.kind}:${b.key}:${b.dur}`)

test('consecutive seconds with the same caption are one block', () => {
  const bs = segment(framesOf([['BURPEES', 40], ['REST', 20], ['PLANK', 30]]))
  assert.deepEqual(kinds(bs), ['work:burpees:40', 'rest:rest:20', 'work:plank:30'])
  assert.equal(bs[0].start, 0); assert.equal(bs[1].start, 40); assert.equal(bs[2].end, 90)
})

test('a single misread frame is outvoted and does not split the block', () => {
  const bs = segment(framesOf([['BURPEES', 40], ['REST', 20]], { noise: { 10: { name: 'BURPEFS' }, 25: { name: 'XQZW' } } }))
  assert.deepEqual(kinds(bs), ['work:burpees:40', 'rest:rest:20'])
  assert.equal(bs[0].text, 'BURPEES')
  assert.ok(bs[0].variants.burpefs === 1)
  assert.ok(bs[0].conf < 0.9 && bs[0].conf > 0.8)
})

test('a caption that drops out for a second or two is bridged, a longer hole is a gap', () => {
  const bridged = segment(framesOf([['BURPEES', 40]], { noise: { 12: { name: '' }, 13: { name: '' } } }))
  assert.deepEqual(kinds(bridged), ['work:burpees:40'])
  const gap = segment(framesOf([['BURPEES', 20], [null, 15], ['PLANK', 20]]))
  assert.deepEqual(kinds(gap), ['work:burpees:20', 'gap::15', 'work:plank:20'])
})

test('a timer restart splits the same caption into two blocks', () => {
  // Same exercise twice in a row, no rest between: only the timer says so.
  const bs = segment(framesOf([['SIDE PLANK', 30], ['SIDE PLANK', 30]]))
  assert.deepEqual(kinds(bs), ['work:side plank:30', 'work:side plank:30'])
  assert.equal(bs[1].resets, true)
})

test('count-up timers reset too', () => {
  assert.deepEqual(timerResets([0, 1, 2, 3, 0, 1, 2]), [4])
  assert.deepEqual(timerResets([5, 4, 3, 2, 1, 5, 4]), [5])
  assert.deepEqual(timerResets([5, 4, null, 2, 1]), [])
})

test('"next: X" on a rest screen is a rest block carrying the hint', () => {
  const bs = segment(framesOf([['BURPEES', 40], ['REST - NEXT: PLANK', 20], ['PLANK', 40]]))
  assert.equal(bs[1].kind, 'rest')
  assert.equal(bs[1].next, 'plank')
  const up = segment(framesOf([['UP NEXT: JUMP SQUATS', 10], ['JUMP SQUATS', 30]]))
  assert.equal(up[0].kind, 'rest'); assert.equal(up[0].next, 'jump squats')
})

test('blocks shorter than three seconds are folded into the one before', () => {
  const bs = segment(framesOf([['BURPEES', 40], ['PLANK', 2], ['REST', 20]]))
  assert.deepEqual(kinds(bs), ['work:burpees:42', 'rest:rest:20'])
})

test('OCR dust (one or two characters) counts as no reading', () => {
  const bs = segment(framesOf([['BURPEES', 10], ['|i', 10], ['BURPEES', 10]]))
  assert.deepEqual(kinds(bs).map(k => k.split(':')[0]), ['work', 'gap', 'work'])
})

test('rest captions in other languages', () => {
  for (const word of ['PRZERWA', 'PAUSE', 'Descanso', 'GET READY']) {
    const bs = segment(framesOf([['BURPEES', 20], [word, 10]]))
    assert.equal(bs[1].kind, 'rest', word)
  }
})

test('empty input is no blocks', () => {
  assert.deepEqual(segment([]), [])
  assert.deepEqual(segment(undefined), [])
})

test('the left and the right side of one stretch stay two blocks, even with no timer', () => {
  const bs = segment(framesOf([['QUAD STRETCH LEFT', 30], ['QUAD STRETCH RIGHT', 30]], { timer: 'none' }).map(f => ({ ...f, timer: '' })))
  assert.deepEqual(kinds(bs), ['work:quad stretch left:30', 'work:quad stretch right:30'])
})

test('a side word misread by one character is still a side', async () => {
  const { sideOf } = await import('../src/text.js')
  assert.deepEqual(sideOf('QUAD STRETCH RIGH1'), { base: 'quad stretch', side: 'R' })
  assert.deepEqual(sideOf('Quad stretch 1EFT'), { base: 'quad stretch', side: 'L' })
  assert.deepEqual(sideOf('Side plank left side'), { base: 'side plank', side: 'L' })
  assert.deepEqual(sideOf('Lunge prawa'), { base: 'lunge', side: 'R' })
  assert.deepEqual(sideOf('Burpees'), { base: 'burpees', side: null })
  assert.deepEqual(sideOf('Hip lift'), { base: 'hip lift', side: null }, 'a real word one edit from "left" is not a side')
  assert.deepEqual(sideOf('Figure eight'), { base: 'figure eight', side: null })
})

test('debris at the edges of a caption is dropped (the corner of a frame, a progress arrow)', async () => {
  const { cleanCaption } = await import('../src/text.js')
  assert.equal(cleanCaption("o ARM CIRCLES -!"), 'ARM CIRCLES')
  assert.equal(cleanCaption(") FRONT LOADED DEADLIF%‘_-!"), 'FRONT LOADED DEADLIF%‘_-!')
  assert.equal(cleanCaption('PUSH UP'), 'PUSH UP', 'a real two-letter word stays')
  assert.equal(cleanCaption('E A - N'), '')
  const bs = segment(framesOf([['o ARM CIRCLES -!', 4], ["ARM CIRCLES '", 7]], { timer: 'none' }).map(f => ({ ...f, timer: '' })))
  assert.deepEqual(kinds(bs), ['work:arm circles:11'])
})

test('one misread timer digit is not a restart', () => {
  // "12" read as "72" for one frame: the next reading is back on the countdown.
  assert.deepEqual(timerResets([15, 14, 13, 72, 11, 10, 9]), [])
  assert.deepEqual(timerResets([3, 2, 1, 15, 14, 13]), [3], 'a real restart carries on from its new value')
})

test('readings Tesseract itself doubts are no reading', () => {
  const bs = segment(framesOf([['BURPEES', 20], ['ak-sl', 10, { }], ['BURPEES', 20]], { timer: 'none' })
    .map((f, i) => ({ ...f, timer: '', nameConf: i >= 20 && i < 30 ? 20 : 90 })))
  assert.deepEqual(kinds(bs).map(k => k.split(':')[0]), ['work', 'gap', 'work'])
})

test('countdowns are runs: misreads ignored, a run caught late starts with its neighbours (B7-F2UcHmqk)', async () => {
  const { countdownRuns } = await import('../src/segment.js')
  const f = []
  const push = (vals) => vals.forEach(v => f.push({ t: f.length, name: '', timer: v == null ? '' : String(v) }))
  const cd = (from, misread = {}) => Array.from({ length: from + 1 }, (_, i) => misread[from - i] ?? from - i)
  push(cd(29, { 14: 4, 27: 271 })); push(cd(29)); push([null, null, null, null, null, null]); push(cd(23)); push(cd(29))
  const runs = countdownRuns(f)
  assert.deepEqual(runs.map(r => [r.start, r.end - r.start]), [[0, 30], [30, 30], [60, 30], [90, 30]])
})

test('timer first: a short countdown between two long ones is a rest that names the next work (B7-F2UcHmqk)', async () => {
  const { timerPhases } = await import('../src/segment.js')
  const f = []
  const run = (n, name, nameFor = n) => { for (let i = n; i >= 0; i--) f.push({ t: f.length, name: n - i < nameFor ? name : '', nameConf: 90, timer: String(i) }) }
  for (let r = 0; r < 2; r++) for (const e of ['GOBLET SQUAT', 'SUMO DEADLIFT', 'CALF RAISES']) { run(19, e, 4); run(39, '') }
  const blocks = timerPhases(f)
  assert.deepEqual(blocks.map(b => [b.kind, b.key, b.dur]).slice(0, 4), [['rest', 'rest', 20], ['work', 'goblet squat', 40], ['rest', 'rest', 20], ['work', 'sumo deadlift', 40]])
  // A warm-up with no rests: the next move is announced in the last ten seconds of this one.
  const g = []
  const move = name => { for (let i = 29; i >= 0; i--) g.push({ t: g.length, name: i < 10 && name ? name : '', nameConf: 90, timer: String(i) }) }
  move('ARM CIRCLES'); move('SWING STEP'); move('TOE TOUCH'); move('')
  assert.deepEqual(timerPhases(g).map(b => [b.kind, b.key, b.dur]), [['gap', '', 30], ['work', 'arm circles', 30], ['work', 'swing step', 30], ['work', 'toe touch', 30]])
})
