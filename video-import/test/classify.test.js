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

test('a cool-down of holds the timer counts but no caption names becomes one row per hold (B7-F2UcHmqk)', () => {
  // Intervals, then four 30-second stretches shown only by a countdown: no name on screen.
  const s = []
  for (let r = 0; r < 2; r++) for (const e of ['BURPEES', 'PLANK', 'SQUATS']) { s.push([e, 40]); s.push(['REST', 20]) }
  s.pop()
  const frames = framesOf(s)
  let t = frames.length
  for (let h = 0; h < 4; h++) for (let i = 0; i < 30; i++) frames.push({ t: t++, name: '', nameConf: 0, timer: String(30 - i) })
  const d = classify(segment(frames))
  const cool = d.sections.find(x => x.kind === 'stretch')
  assert.ok(cool, JSON.stringify(d.sections.map(x => x.kind)))
  assert.deepEqual(cool.rows.map(r => [r.key, r.sec]), [['', 30], ['', 30], ['', 30], ['', 30]], 'four holds, never merged into one 120 s row')
  assert.ok(cool.rows.every(r => r.thumbT >= r.occurrences[0].start))
})

test('two unknowns are never the same exercise', async () => {
  const { sameName } = await import('../src/text.js')
  assert.equal(sameName('', ''), false)
  assert.equal(sameName('burpees', ''), false)
})

test('the video’s parts from its chapters keep two blocks apart and name them (B7-F2UcHmqk)', () => {
  const s = [[null, 30]]
  for (let r = 0; r < 2; r++) for (const e of ['GOBLET SQUAT', 'SUMO DEADLIFT', 'CALF RAISES']) { s.push([e, 40]); s.push(['REST', 20]) }
  for (let r = 0; r < 2; r++) for (const e of ['SKULL CRUSHERS', 'PUSH UPS', 'BENT OVER ROW']) { s.push([e, 40]); s.push(['REST', 20]) }
  const frames = framesOf(s)
  const split = 30 + 6 * 60
  const parts = [{ start: 30, end: split, label: 'Group 1: Lower body' }, { start: split, end: frames.length, label: 'Group 2: Upper body' }]
  const d = classify(segment(frames), { parts })
  const iv = d.sections.filter(x => x.kind === 'interval')
  assert.deepEqual(iv.map(x => [x.label, x.rows.length, x.rounds]), [['Group 1: Lower body', 3, 2], ['Group 2: Upper body', 3, 2]])
})

test('the section keeps one beat: 35 s and 45 s readings of a 40 s exercise are 40 s (B7-F2UcHmqk)', async () => {
  const { harmonise } = await import('../src/classify.js')
  const row = (name, start, sec, rest = 20) => ({ name, key: name, sec, rest, rounds: 2, occurrences: [{ start, dur: sec }, { start: start + 300, dur: sec }] })
  const s = harmonise([{ kind: 'interval', rows: [row('a', 0, 45), row('b', 60, 35), row('c', 120, 40), row('d', 180, 40), row('e', 240, 65)] }])
  assert.deepEqual(s[0].rows.map(r => r.sec), [40, 40, 40, 40, 40], 'the last of a round reads long too: it runs into the next part')
  assert.equal(s[0].work, 40)
})

test('a long stretch with no names is cut by the rhythm of the picture’s cuts (B7-F2UcHmqk)', async () => {
  const { harmonise, periodicSplit, cutsOf } = await import('../src/classify.js')
  // The real cuts of the cool-down: a move (20 s), its "next" preview (10 s), over and over.
  const cuts = [3441, 3446, 3450, 3464, 3469, 3489, 3499, 3519, 3529, 3549, 3559, 3579, 3588, 3599, 3609, 3619, 3623, 3643, 3650, 3662]
  assert.deepEqual(periodicSplit(3450, 3685, cuts).map(([x, y]) => y - x), [19, 30, 30, 30, 29, 31, 31, 35])
  const one = (name, start, sec) => ({ name, key: name, sec, rest: 0, rounds: 1, occurrences: [{ start, dur: sec }], thumbT: start + 5 })
  const out = harmonise([{ kind: 'stretch', rows: [one('snow angels', 3450, 235)] }], { cuts })
  assert.equal(out[0].rows.length, 8)
  assert.equal(out[0].rows[0].name, 'snow angels')
  assert.ok(out[0].rows.slice(1).every(r => r.unnamed))
  assert.equal(out[0].rows[1].thumbT, 3469 + 10, 'the still is from the move, not its announcement')
  // A different video, a different hold: 45 s moves with one cut each.
  const other = Array.from({ length: 8 }, (_, i) => 1000 + i * 45)
  assert.deepEqual(periodicSplit(1000, 1360, other).map(([x, y]) => y - x), Array(8).fill(45))
  // Cuts with no rhythm, and no other section keeping a beat: left whole for the user.
  assert.equal(periodicSplit(0, 300, [10, 37, 41, 150, 260]), null)
  assert.equal(harmonise([{ kind: 'stretch', rows: [one('x', 0, 300)] }], { cuts: [10, 37, 41, 150, 260] })[0].rows.length, 1)
  assert.deepEqual(cutsOf([0, 1, 2, 1, 80, 2, 1, 90, 85, 1]), [4, 7])
})
