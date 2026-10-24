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

test('timer first: a short named countdown between two longer named ones is a move of its own, not a rest (fixture harness)', async () => {
  const { timerPhases } = await import('../src/segment.js')
  // A warm-up of 60, 30 and 45 s moves with no rests: the 30 s one is short next to both, but
  // its name is its own and the next move shows a different one.
  const blocks = timerPhases(framesOf([['JUMPING JACKS', 60], ['ARM CIRCLES', 30], ['HIGH KNEES', 45], ['BURPEES', 40], ['REST', 20], ['PLANK JACKS', 40]]))
  assert.deepEqual(blocks.map(b => [b.kind, b.key, b.dur]).slice(0, 3), [['work', 'jumping jacks', 60], ['work', 'arm circles', 30], ['work', 'high knees', 45]])
  // The same short countdown showing the next move's name is still the rest that announces it.
  const rest = timerPhases(framesOf([['SQUATS', 40], ['LUNGES', 20], ['LUNGES', 40], ['PUSH UPS', 20], ['PUSH UPS', 40], ['PLANK', 20], ['PLANK', 40]]))
  assert.deepEqual(rest.map(b => [b.kind, b.dur]).slice(0, 3), [['work', 40], ['rest', 20], ['work', 40]])
})

test('timer first: a Tabata\'s 10 s rest right after a countdown to 1 is a countdown of its own, not a stray 1 and 0', async () => {
  const { timerPhases } = await import('../src/segment.js')
  const blocks = timerPhases(framesOf([['SQUAT JUMPS', 20], ['REST', 10], ['PUSH UPS', 20], ['REST', 10], ['SQUAT JUMPS', 20], ['REST', 10], ['PUSH UPS', 20]]))
  assert.deepEqual(blocks.map(b => [b.kind, b.dur]).slice(0, 4), [['work', 20], ['rest', 10], ['work', 20], ['rest', 10]])
})

test('timer first: 30 on, 30 off — a workout ends on a move, so which of named and bare is the work', async () => {
  const { timerPhases } = await import('../src/segment.js')
  const moves = ['SQUATS', 'PUSH UPS', 'LUNGES', 'PLANK']
  // The name over the work, the rest a bare countdown: the video ends on a named countdown.
  const work = timerPhases(framesOf(moves.flatMap(e => [[e, 30], ['', 30]]).slice(0, -1)))
  assert.deepEqual(work.map(b => [b.kind, b.key]).slice(0, 3), [['work', 'squats'], ['rest', 'rest'], ['work', 'push ups']])
  // The name over the rest before each move: the video ends on a bare one, and the names announce.
  const rest = timerPhases(framesOf(moves.flatMap(e => [[e, 30], ['', 30]])))
  assert.deepEqual(rest.map(b => [b.kind, b.key]).slice(0, 2), [['rest', 'rest'], ['work', 'squats']])
})

test('a lone R or L in brackets is a side (OfV5kHgRpmM)', async () => {
  const { sideOf, sameName } = await import('../src/text.js')
  assert.deepEqual(sideOf('Side plank hold (R)'), { base: 'side plank hold', side: 'R' })
  assert.deepEqual(sideOf('SL glute bridge (L)'), { base: 'sl glute bridge', side: 'L' })
  assert.equal(sameName('sl glute bridge (r)', 'sl glute bridge (l)'), false)
  assert.equal(sameName('sl glute bridge r', 'sl glute bridge l'), false)
  assert.deepEqual(sideOf('side plank hold r'), { base: 'side plank hold', side: 'R' })
})

test('a caption caught while it is typed out is the same name', async () => {
  const { sameName } = await import('../src/text.js')
  assert.equal(sameName('sumo sq', 'sumo squat'), true)
  assert.equal(sameName('straight leg cr', 'straight leg crunches'), true)
  assert.equal(sameName('push', 'push ups'), false, 'too short to tell')
  assert.equal(sameName('sl glute bridge right', 'sl glute bridge left'), false)
})

test('two moves that share all but their first word are two moves (cDq-nFmD0rI)', async () => {
  const { sameName } = await import('../src/text.js')
  assert.equal(sameName('neck stretch alternate both sides', 'elbow stretch alternate both sides'), false)
  assert.equal(sameName('drop sit up', 'drop sit uh'), true)
})

test('30 s on, 30 s off: the captions say which is the rest, whatever the layout', async () => {
  const { timerPhases } = await import('../src/segment.js')
  const run = (f, n, name, from = 0, to = n + 1) => { for (let i = n; i >= 0; i--) f.push({ t: f.length, name: n - i >= from && n - i < to ? name : '', nameConf: 90, timer: String(i) }) }
  // The name over the whole rest, nothing during the work (Juice & Toya, at 30/30).
  const a = []
  for (const e of ['SQUATS', 'LUNGES', 'BURPEES']) { run(a, 29, e); run(a, 29, '') }
  assert.deepEqual(timerPhases(a).map(b => [b.kind, b.key]), [['rest', 'rest'], ['work', 'squats'], ['rest', 'rest'], ['work', 'lunges'], ['rest', 'rest'], ['work', 'burpees']])
  // "REST" with a "next up" over the rest, the name during the work (Rowan Row, at 30/30).
  const b = []
  for (const e of ['SQUATS', 'LUNGES', 'BURPEES']) { run(b, 29, 'NEXT UP ' + e); run(b, 29, e) }
  assert.deepEqual(timerPhases(b).map(x => [x.kind, x.key]), [['rest', 'next up squats'], ['work', 'squats'], ['rest', 'next up lunges'], ['work', 'lunges'], ['rest', 'next up burpees'], ['work', 'burpees']])
  // The name during the work only, a bare "REST" between (no announcement).
  const c = []
  for (const e of ['SQUATS', 'LUNGES', 'BURPEES']) { run(c, 29, e); run(c, 29, 'REST') }
  assert.deepEqual(timerPhases(c).map(x => [x.kind, x.key]).filter(x => x[0] === 'work'), [['work', 'squats'], ['work', 'lunges'], ['work', 'burpees']])
})

test('a lone capital in front of a caption in capitals is part of it (cDq-nFmD0rI)', async () => {
  const { cleanCaption } = await import('../src/text.js')
  assert.equal(cleanCaption('V UPS'), 'V UPS')
  assert.equal(cleanCaption('o ARM CIRCLES -!'), 'ARM CIRCLES')
  assert.equal(cleanCaption('I - T-SPINE OPENER I'), 'T-SPINE OPENER')
})

test('a move nobody could read, one round after a named one of its length, is that move (B7-F2UcHmqk)', async () => {
  const { fillFromRounds } = await import('../src/segment.js')
  const w = (start, key) => ({ kind: 'work', key, text: key, start, dur: 40, end: start + 40, conf: 0.8, variants: {} })
  const g = start => ({ kind: 'gap', key: '', text: '', start, dur: 40, end: start + 40, timed: true, conf: 0, variants: {} })
  const out = fillFromRounds([w(0, 'goblet squat'), w(60, 'sumo deadlift'), w(120, 'calf raises'), w(180, 'push ups'), w(240, 'goblet squat'), g(300), w(360, 'calf raises'), w(420, 'push ups')])
  assert.equal(out[5].key, 'sumo deadlift')
  assert.equal(out[5].inferred, true)
})

test('a short mixed-case word after a caption in capitals is debris (cDq-nFmD0rI)', async () => {
  const { cleanCaption } = await import('../src/text.js')
  assert.equal(cleanCaption('SUMO SQUAT Ll'), 'SUMO SQUAT')
  assert.equal(cleanCaption('PIKE PUSH UPS Bl'), 'PIKE PUSH UPS')
  assert.equal(cleanCaption('Push ups'), 'Push ups')
})

test('a side in brackets or a set counter ends a caption; short small-letter debris after capitals goes (IEJMnNGAGY4)', async () => {
  const { cleanCaption } = await import('../src/text.js')
  assert.equal(cleanCaption('NEXT GLUTE BRIDGE (1,2) g Iy'), 'NEXT GLUTE BRIDGE')
  assert.equal(cleanCaption('NEXT HEEL ELEVATED SQUATS (1 2 ~N -'), 'NEXT HEEL ELEVATED SQUATS')
  assert.equal(cleanCaption('NEXT LEAN IN LATERAL RAISE (L) S WS W b -'), 'NEXT LEAN IN LATERAL RAISE (L)')
  assert.equal(cleanCaption('SIDE PLANK DIPS (right) - bl'), 'SIDE PLANK DIPS (right)')
  assert.equal(cleanCaption('NEXT RENEGADE ROW to PUSH ur'), 'NEXT RENEGADE ROW to PUSH')
  assert.equal(cleanCaption('DIAMOND PUSH UP (20SEC NORMAL 20SEC KNEE DOWN)'), 'DIAMOND PUSH UP')
  // Mixed case is left alone: its small words are words.
  assert.equal(cleanCaption('Push up to Down Dog'), 'Push up to Down Dog')
})

test('a styled NEXT label OCR reads as NXT, NXTI, NXTH or NXTT still announces the move after it (Y2eOW7XYWxc)', async () => {
  const { restOf } = await import('../src/text.js')
  for (const label of ['NXT', 'NXTI', 'NXTH', 'NXTT', 'NXTL', 'NXT I']) {
    const r = restOf(`${label} PLANK HAND WALK`)
    assert.equal(r.rest, true, label)
    assert.match(r.next, /plank hand walk$/, label)
  }
  // Ordinary words that merely start with the same letters are not a label.
  assert.equal(restOf('NXTREME SQUATS').rest, false)
  assert.equal(restOf('NEXT LEVEL BURPEES').next, 'level burpees')
})

test('one move read two ways in two rounds is one move; moves that only share their kit are not (zBTz636KeMA)', async () => {
  const { sameName } = await import('../src/text.js')
  assert.ok(sameName('lunge combo dnve right', 'lunge combo drnive right'))
  assert.ok(sameName('bent knee gruneh', 'bent knee crunch'))
  assert.ok(!sameName('dumbbell floor press', 'dumbbell push press'))
  assert.ok(!sameName('bent over row', 'bent over underhand row'))
  assert.ok(!sameName('lunge combo drive left', 'lunge combo drive right'))
})

test('"Warm up complete" is a section label, not a three-second move (zBTz636KeMA)', async () => {
  const { sectionTitle } = await import('../src/text.js')
  assert.equal(sectionTitle('Warm Up GComplete'), 'warmup')
  assert.equal(sectionTitle('Cool down complete'), 'stretch')
  assert.equal(sectionTitle('Dynamic chest stretch'), null)
})

test('a NOW: label in front of the move is not part of its name (UIPvIYsjfpo)', async () => {
  const { cleanCaption } = await import('../src/text.js')
  assert.equal(cleanCaption('NOW: NECK PULSES'), 'NECK PULSES')
  assert.equal(cleanCaption('NOW CHEST EXPANSIONS (Lateral)'), 'CHEST EXPANSIONS (Lateral)')
  assert.equal(cleanCaption('NOW: 3 x PUSH UP 3 x MTN CLIMBERS'), 'PUSH UP 3 x MTN CLIMBERS')
  // A move that really starts with the word, and a lone label, stay as they are.
  assert.equal(cleanCaption('NOW'), 'NOW')
})

test('a countdown first read at 56 under a fading ring began at 59: the round length the author set (ScInpT_5dIQ)', async () => {
  const { countdownRuns } = await import('../src/segment.js')
  const f = []
  const at = (t, text) => { f[t] = { t, name: '', timer: text, timers: [text] } }
  for (let t = 0; t < 4 * 80; t++) f[t] = { t, name: '', timer: '', timers: [''] }
  for (let k = 0; k < 4; k++) {
    const base = k * 80
    for (let i = 0; i <= 56; i++) at(base + 3 + i, String(56 - i).padStart(2, '0'))   // 60 s work, its first 3 s unreadable
    for (let i = 0; i <= 19; i++) at(base + 60 + i, String(19 - i).padStart(2, '0'))  // 20 s rest
  }
  const runs = countdownRuns(f).filter(r => r.top + 1 >= 50)
  assert.deepEqual(runs.map(r => [r.start, r.top + 1]), [[0, 60], [80, 60], [160, 60], [240, 60]])
  // A countdown that really is 57 s has no round number to go to when the seconds before it belong to the last one.
  const g = f.map(x => ({ ...x }))
  for (let t = 60; t < 80; t++) g[t] = { t, name: '', timer: '', timers: [''] }
  for (let i = 0; i <= 22; i++) g[0 + 58 + i] = { t: 58 + i, name: '', timer: String(22 - i), timers: [String(22 - i)] }
  const runs2 = countdownRuns(g).filter(r => r.top + 1 >= 50)
  assert.ok(runs2.every(r => r.start >= 0))
})

test('a clean ten-second rest countdown in front of a long one is a rest, not the first ten seconds of it (pnd-jkJh-ls)', async () => {
  const { countdownRuns } = await import('../src/segment.js')
  const f = []
  const at = (t, n) => { f[t] = { t, name: '', timer: String(n).padStart(2, '0'), timers: [String(n).padStart(2, '0')] } }
  for (let t = 0; t < 8 * 60 + 5; t++) f[t] = { t, name: '', timer: '', timers: [''] }
  // 60 s works between 50 s ones, so 60 is a usual length; 50 s work then 10 s rest, many times.
  let t = 5
  for (let k = 0; k < 4; k++) { for (let v = 59; v >= 0; v--) at(t++, v) }                      // four 60 s works
  for (let k = 0; k < 6; k++) { for (let v = 49; v >= 0; v--) at(t++, v); for (let v = 9; v >= 0; v--) at(t++, v) }   // 50 s work, 10 s rest
  const runs = countdownRuns(f).filter(r => r.start >= 245)
  const lens = runs.map(r => r.top + 1)
  assert.ok(lens.filter(l => l === 50).length >= 5, 'the 50 s works stay 50 s: ' + lens.join(','))
  assert.ok(lens.filter(l => l === 10).length >= 5, 'the 10 s rests stay rests: ' + lens.join(','))
})

test('a stray single digit that the next seconds read exactly as 17, 16, 15… is the tens-digit-lost start of a 19 s countdown, not an 8 s one (ScInpT_5dIQ)', async () => {
  const { countdownRuns } = await import('../src/segment.js')
  const f = []
  for (let t = 0; t < 4 * 90; t++) f[t] = { t, name: '', timer: '', timers: [''] }
  const at = (t, text) => { f[t] = { t, name: '', timer: text, timers: [text] } }
  for (let k = 0; k < 4; k++) {
    const b = k * 90
    for (let i = 0; i <= 59; i++) at(b + i, String(59 - i).padStart(2, '0'))        // 60 s work
    at(b + 61, '8')                                                                  // a stray read of the rest's first seconds
    for (let i = 2; i <= 19; i++) at(b + 60 + i, String(19 - i).padStart(2, '0'))     // 17, 16 … 00 over the 20 s rest
  }
  const runs = countdownRuns(f)
  // The rest is one countdown of 19 s from its first readable second, not 8 s and a second one of 9.
  assert.deepEqual(runs.filter(r => r.top + 1 >= 8 && r.top + 1 <= 25).map(r => [r.start, r.top + 1]), [[61, 19], [151, 19], [241, 19], [331, 19]])
})
