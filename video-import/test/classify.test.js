import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segment } from '../src/segment.js'
import { classify } from '../src/classify.js'
import { framesOf, hiitScript } from './synthetic.mjs'

const summary = d => d.sections.map(s => [s.kind, s.rows.map(r => `${r.key}|${r.sec}|${r.rest}|${r.rounds}${r.side ? '|side' : ''}`)])

test('warm-up, an interval block and a stretch', () => {
  const draft = classify(segment(framesOf(hiitScript())))
  assert.deepEqual(summary(draft), [
    ['warmup', ['jumping jacks|60|0|1', 'arm circles|30|0|1', 'high knees|45|0|1']],
    ['interval', ['burpees|40|20|3', 'mountain climbers|40|20|3', 'jump squats|40|20|3', 'plank jacks|40|20|3']],
    ['stretch', ['quad stretch|30|0|1|side', 'child s pose|45|0|1']]
  ])
  const iv = draft.sections[1]
  assert.equal(iv.rounds, 3); assert.equal(iv.work, 40); assert.equal(iv.rest, 20)
  // Every row knows where it came from, for the thumbnail and the review table.
  const burpees = iv.rows[0]
  assert.equal(burpees.occurrences.length, 3)
  assert.equal(burpees.name, 'Burpees')
  assert.ok(burpees.thumbT >= burpees.occurrences[0].start && burpees.thumbT < burpees.occurrences[0].start + 40)
  assert.ok(new Set(draft.sections.flatMap(s => s.rows.map(r => r.id))).size === 9)
})

test('30 s of rest and noisy readings give the same structure', () => {
  const frames = framesOf(hiitScript({ rest: 30, work: 45, rounds: 2 }), { noise: { 200: { name: 'BURPFES' }, 300: { name: '' }, 301: { name: '' } } })
  const iv = classify(segment(frames)).sections.find(s => s.kind === 'interval')
  assert.equal(iv.rounds, 2)
  assert.deepEqual(iv.rows.map(r => [r.sec, r.rest, r.rounds]), [[45, 30, 2], [45, 30, 2], [45, 30, 2], [45, 30, 2]])
})

test('rest with no caption at all (only the timer) still reads as rest', () => {
  const s = [['WARM UP JOG', 60]]
  for (let r = 0; r < 2; r++) for (const e of ['BURPEES', 'PLANK']) { s.push([e, 40]); s.push([null, 20]) }
  const iv = classify(segment(framesOf(s))).sections.find(x => x.kind === 'interval')
  assert.ok(iv, 'an interval section')
  assert.deepEqual(iv.rows.map(r => [r.key, r.sec, r.rest, r.rounds]), [['burpees', 40, 20, 2], ['plank', 40, 20, 2]])
})

test('a longer rest between rounds keeps one section', () => {
  const s = []
  for (let r = 0; r < 3; r++) {
    for (const e of ['BURPEES', 'PLANK', 'SQUATS']) { s.push([e, 40]); s.push(['REST', 20]) }
    s.pop(); s.push(['REST', 90])
  }
  const d = classify(segment(framesOf(s)))
  const iv = d.sections.filter(x => x.kind === 'interval')
  assert.equal(iv.length, 1)
  assert.deepEqual(iv[0].rows.map(r => [r.key, r.rounds, r.rest]), [['burpees', 3, 20], ['plank', 3, 20], ['squats', 3, 20]])
  assert.equal(iv[0].rounds, 3)
  assert.equal(iv[0].roundRest, 90)
})

test('the name on a rest screen fills in a block OCR could not read', () => {
  const s = [['WARM UP', 30]]
  for (const e of ['BURPEES', 'PLANK', 'SQUATS']) { s.push([`REST NEXT: ${e}`, 20]); s.push([null, 40]) }
  s.push(['REST', 20])
  const d = classify(segment(framesOf(s)))
  const rows = d.sections.flatMap(x => x.rows)
  for (const e of ['burpees', 'plank', 'squats']) assert.ok(rows.some(r => r.key === e), e)
})

test('chapter-style hints decide the section', () => {
  const blocks = [
    { start: 0, end: 60, dur: 60, kind: 'work', key: 'cat cow', text: 'Cat Cow', conf: 0.9, variants: { 'cat cow': 1 } },
    { start: 60, end: 120, dur: 60, kind: 'work', key: 'hamstring hold', text: 'Hamstring Hold', conf: 0.9, variants: { 'hamstring hold': 1 } }
  ]
  const d = classify(blocks, { hints: [{ start: 0, end: 60, kind: 'warmup' }, { start: 60, end: 120, kind: 'stretch' }] })
  assert.deepEqual(d.sections.map(s => s.kind), ['warmup', 'stretch'])
})

test('a video with no intervals is one plain section, not a warm-up', () => {
  const d = classify(segment(framesOf([['GOBLET SQUAT', 120], ['PUSH UPS', 90], ['ROWS', 100]])))
  assert.deepEqual(d.sections.map(s => s.kind), ['other'])
  assert.equal(d.sections[0].rows.length, 3)
})

test('nothing in, nothing out', () => {
  assert.deepEqual(classify([]), { sections: [] })
})

test('names shown only before each exercise ("NEXT" screens) move onto the exercise (a real layout, B7-F2UcHmqk)', () => {
  // 18 s of "NEXT · GOBLET SQUAT" with a preview, then 42 s of the exercise with no caption at all.
  const s = [[null, 60]]
  for (let r = 0; r < 2; r++) for (const e of ['GOBLET SQUAT', 'FRONT LOADED DEADLIFT', 'SUITCASE SQUAT', 'CALF RAISES']) { s.push([e, 18]); s.push([null, 42]) }
  const d = classify(segment(framesOf(s)))
  assert.equal(d.layout, 'preview')
  const iv = d.sections.find(x => x.kind === 'interval')
  assert.ok(iv, JSON.stringify(d.sections.map(x => x.kind)))
  assert.deepEqual(iv.rows.map(r => [r.key, r.sec, r.rest, r.rounds]), [
    ['goblet squat', 40, 20, 2], ['front loaded deadlift', 40, 20, 2], ['suitcase squat', 40, 20, 2], ['calf raises', 40, 20, 2]
  ])
  assert.ok(iv.rows[0].occurrences[0].start >= 78, 'the row points at the exercise, not at its announcement')
})

test('captions on the exercise itself are not mistaken for the NEXT layout', () => {
  const d = classify(segment(framesOf(hiitScript())))
  assert.equal(d.layout, undefined)
})

test('one block cut in two by a few seconds of OCR nonsense is one section again (B7-F2UcHmqk, upper body)', async () => {
  const { mergeIntervals } = await import('../src/classify.js')
  const row = (key, sec = 40, rest = 20, rounds = 1, conf = 0.85) => ({ key, name: key, conf, sec, rest, rounds, side: false, variants: [key], occurrences: [{ start: 0, dur: sec }] })
  const a = { kind: 'interval', start: 0, end: 360, rounds: 1, rows: [row('wide bent over row'), row('skull crushers'), row('push ups'), row('wide chest press')] }
  const junk = { kind: 'other', start: 360, end: 367, rounds: 1, rows: [row('ak ul', 7, 0, 1, 0.25)] }
  const b = { kind: 'interval', start: 367, end: 800, rounds: 1, rows: [row('wide bent over row'), row('skull crushers', 45), row('push ups'), row('wide chest press'), row('rainbow press')] }
  const legs = { kind: 'interval', start: 800, end: 1200, rounds: 2, rows: [row('goblet squat', 40, 20, 2), row('sumo deadlift', 40, 20, 2)] }
  const out = mergeIntervals([a, junk, b, legs])
  assert.equal(out.length, 2, 'the two upper-body pieces join; legs stay their own block')
  assert.deepEqual(out[0].rows.map(r => [r.key, r.rounds]), [
    ['wide bent over row', 2], ['skull crushers', 2], ['push ups', 2], ['wide chest press', 2], ['ak ul', 1], ['rainbow press', 1]
  ])
  assert.equal(out[0].rows[1].sec, 45, '40 and 45 average to 42.5, which a video means as 45')
  assert.equal(out[0].rounds, 2)
  assert.equal(out[0].end, 800)
})
