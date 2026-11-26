import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('./speech.js', () => ({ speak: vi.fn(() => Promise.resolve(true)), voiceOpts: S => ({ rate: S?.speechRate === 'fast' ? 1.25 : 1, pitch: 1, voice: '' }) }))
const { speak } = await import('./speech.js')
const { nextSetAfter, setCueText, restStartText, cues, bindCueState, cuesOn, sampleCue } = await import('./spoken-cues.js')

const BENCH = '0025', SQUAT = '0043'
const set = (w, r, done = false, extra = {}) => ({ w, r, done, ...extra })
const entry = (id, sets, target = { mode: 'reps' }, extra = {}) => ({ id, target, sets, ...extra })
const S = (entries, extra = {}) => ({ unit: 'kg', spokenCues: true, active: { cur: 0, entries }, ...extra })

afterEach(() => { speak.mockClear(); bindCueState(null) })

describe('what comes next after a rest', () => {
  test('the same exercise, then the next one down the list', () => {
    const a = { entries: [entry(BENCH, [set(80, 8, true), set(80, 8)]), entry(SQUAT, [set(100, 5)])] }
    expect(nextSetAfter(a, 0)).toEqual({ idx: 0, i: 1 })
    a.entries[0].sets[1].done = true
    expect(nextSetAfter(a, 0)).toEqual({ idx: 1, i: 0 })
  })
  test('round and round a superset', () => {
    const a = { entries: [entry(BENCH, [set(80, 8, true), set(80, 8)], undefined, { sg: 'g' }), entry(SQUAT, [set(100, 5), set(100, 5)], undefined, { sg: 'g' })] }
    expect(nextSetAfter(a, 0)).toEqual({ idx: 1, i: 0 })
    a.entries[1].sets[0].done = true
    expect(nextSetAfter(a, 1)).toEqual({ idx: 0, i: 1 })
  })
  test('nothing left, nothing next', () => {
    expect(nextSetAfter({ entries: [entry(BENCH, [set(80, 8, true)])] }, 0)).toBe(null)
  })
})

describe('the line for a set', () => {
  test('set number, weight and reps', () => {
    const e = entry(BENCH, [set(40, 5, true, { phase: 'warmup' }), set(80, 8, true), set(82.5, 8)])
    expect(setCueText(S([e]), e, 2)).toBe('Set 2, 82.5 kilos, 8 reps')
    expect(setCueText(S([e]), e, 0)).toBe('Warm-up, 40 kilos, 5 reps')
    expect(setCueText(S([e], { unit: 'lb' }), e, 1)).toBe('Set 1, 80 pounds, 8 reps')
  })
  test('bodyweight, holds, per side and cardio', () => {
    const pull = entry('pullup', [set(0, 1)])
    expect(setCueText(S([pull]), pull, 0)).toBe('Set 1, 1 rep')
    const plank = entry('plank', [{ sec: 45, done: false }], { mode: 'time', sec: 45 })
    expect(setCueText(S([plank]), plank, 0)).toBe('Set 1, 45 seconds')
    const lunge = entry('lunge', [{ w: 20, r: 16, done: false, sides: { L: { w: 20, r: 8 }, R: { w: 20, r: 8 } } }])
    expect(setCueText(S([lunge]), lunge, 0)).toBe('Set 1, 20 kilos, 8 reps per side')
    const run = entry('run', [{ min: 20, speed: 10, done: false }], { mode: 'cardio' })
    expect(setCueText(S([run]), run, 0)).toBe('Set 1, 20 minutes')
  })
  test('another exercise is named first', () => {
    const st = S([entry(BENCH, [set(80, 8, true)]), entry(SQUAT, [set(100, 5)])])
    expect(restStartText(st, 0)).toMatch(/^.+\. Set 1, 100 kilos, 5 reps$/)
  })
  test('the Settings sample', () => {
    expect(sampleCue('kg')).toBe('Set 3, 80 kilos, 8 reps')
  })
})

describe('the moments', () => {
  const st = S([entry(BENCH, [set(80, 8, true), set(80, 8)])])
  test('off, or no workout running, says nothing', () => {
    bindCueState(() => ({ ...st, spokenCues: false }))
    cues.restStarted(0); cues.restOver(); cues.count(3)
    bindCueState(() => ({ ...st, active: null }))
    cues.restOver()
    expect(speak).not.toHaveBeenCalled()
    expect(cuesOn({ spokenCues: true, active: {} })).toBe(true)
  })
  test('a rest: the next set, 10 seconds on a long rest only, then over', () => {
    bindCueState(() => st)
    cues.restStarted(0)
    cues.restLeft(11, 90); cues.restLeft(10, 90); cues.restLeft(10, 15)
    cues.restOver()
    expect(speak.mock.calls.map(c => c[0])).toEqual(['Set 2, 80 kilos, 8 reps', 'Last set of barbell bench press.', '10 seconds', 'Rest is over'])
  })
  test('holds count 3, 2, 1 and go, each cutting off the one before', () => {
    bindCueState(() => ({ ...st, speechRate: 'fast' }))
    cues.count(4); cues.count(3); cues.count(2); cues.count(1); cues.go()
    expect(speak.mock.calls.map(c => c[0])).toEqual(['3', '2', '1', 'Go!'])
    expect(speak.mock.calls.every(c => c[1].queue === false && c[1].rate === 1.25)).toBe(true)
  })
})

const { _setClipPlayer, _resetCueQueue, isLastSet, speechMs } = await import('./spoken-cues.js')
const { _resetPicks } = await import('./voice-styles.js')
describe('styles, the last set, records and clips (v1.4.5 Voice)', () => {
  afterEach(() => { _resetCueQueue(); _resetPicks(); vi.useRealTimers() })
  const two = () => S([entry(BENCH, [set(80, 8, true), set(80, 8), set(80, 8)])])

  test('the last work set of an exercise', () => {
    const a = { entries: [entry(BENCH, [set(40, 5, false, { phase: 'warmup' }), set(80, 8, true), set(80, 8)])] }
    expect(isLastSet(a, { idx: 0, i: 2 })).toBe(true)
    expect(isLastSet(a, { idx: 0, i: 0 })).toBe(false)
    a.entries[0].sets[1].done = false
    expect(isLastSet(a, { idx: 0, i: 1 })).toBe(false)
  })
  test('a style adds its line after the next set, and its own line for the last set', () => {
    const st = { ...two(), cueStyle: 'hype', cueLevel: 'every' }
    bindCueState(() => st)
    cues.restStarted(0)
    const said = speak.mock.calls.map(c => c[0])
    expect(said[0]).toBe('Set 2, 80 kilos, 8 reps')
    expect(['LET’S GO! YOU’RE ON FIRE!', 'WHAT A SET! CATCH YOUR BREATH, CHAMP!']).toContain(said[1])
    speak.mockClear()
    st.active.entries[0].sets[1].done = true
    cues.restStarted(0)
    expect(['LAST SET! EMPTY THE TANK!', 'FINAL SET! THIS IS YOUR MOMENT!']).toContain(speak.mock.calls[2][0])
  })
  // TestFlight 11-08: the voice was only heard with the end-of-rest sound on (and its "Play even
  // on silent"): a line asked for the silent switch to be kept whenever that sound was off.
  test('the voice is heard with the end-of-rest sound off and the phone on silent', () => {
    bindCueState(() => ({ ...two(), sound: false, soundOnSilent: false }))
    cues.restStarted(0)
    cues.restOver()
    expect(speak.mock.calls.length).toBeGreaterThan(0)
    for (const c of speak.mock.calls) expect(c[1].onSilent).toBe(true)
  })
  test('just the facts says what it always said, and nothing on a record of no exercise', () => {
    bindCueState(() => two())
    cues.record(); cues.restOver()
    expect(speak.mock.calls.map(c => c[0])).toEqual(['Rest is over'])
  })
  test('own lines, and a record in a style', () => {
    bindCueState(() => ({ ...two(), cueStyle: 'own', cueLines: { record: ['Who even are you?'], restOver: ['  Up!  '] } }))
    cues.record(); cues.restOver(); cues.restLeft(10, 60)
    expect(speak.mock.calls.map(c => c[0])).toEqual(['Who even are you?', 'Up!'])
  })
  test('a clip plays instead of the line, and a line after it waits for it to end', async () => {
    vi.useFakeTimers()
    const played = []
    _setClipPlayer(async clip => { played.push(clip.id); return true })
    const m = { kind: 'audio', hash: 'a'.repeat(64), mime: 'audio/wav', size: 100, width: 1, height: 1, dur: 2 }
    bindCueState(() => ({ ...two(), cueStyle: 'drill', sounds: [{ id: 'c1', name: 'Mate', m, voice: 'restOver' }] }))
    cues.restOver()
    await vi.advanceTimersByTimeAsync(0)
    expect(played).toEqual(['c1'])
    expect(speak).not.toHaveBeenCalled()
    cues.restLeft(10, 60)
    expect(speak).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2200)
    expect(speak).toHaveBeenCalledTimes(1)
  })
  test('a clip whose file is not here: the line instead', async () => {
    _setClipPlayer(async () => false)
    const m = { kind: 'audio', hash: 'b'.repeat(64), mime: 'audio/wav', size: 100, width: 1, height: 1, dur: 1 }
    bindCueState(() => ({ ...two(), sounds: [{ id: 'c2', name: 'x', m, voice: 'restOver' }] }))
    cues.restOver()
    await new Promise(r => setTimeout(r, 5))
    expect(speak.mock.calls.map(c => c[0])).toEqual(['Rest is over'])
  })
  test('a clip waits for the line before it', async () => {
    vi.useFakeTimers()
    const played = []
    _setClipPlayer(async clip => { played.push(clip.id); return true })
    const m = { kind: 'audio', hash: 'c'.repeat(64), mime: 'audio/wav', size: 100, width: 1, height: 1, dur: 1 }
    bindCueState(() => ({ ...two(), sounds: [{ id: 'c3', name: 'x', m, voice: 'restStart' }] }))
    cues.restStarted(0)
    expect(speak).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(played).toEqual([])
    await vi.advanceTimersByTimeAsync(speechMs('Set 2, 80 kilos, 8 reps'))
    expect(played).toEqual(['c3'])
  })
})

// #1210: only a rest announced the next set, so the workout's first exercise (nothing precedes
// it) and every circuit member but the round's first (no rest between members) went unsaid.
describe('the first exercise and a circuit’s members (#1210)', () => {
  test('a workout that begins names its first set', () => {
    bindCueState(() => S([entry(BENCH, [set(80, 8), set(80, 8)]), entry(SQUAT, [set(100, 5)])]))
    cues.began()
    expect(speak.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(/^.+\. Set 1, 80 kilos, 8 reps$/)])
  })
  test('began says nothing with cues off, no workout, or nothing left', () => {
    bindCueState(() => ({ ...S([entry(BENCH, [set(80, 8)])]), spokenCues: false }))
    cues.began()
    bindCueState(() => ({ unit: 'kg', spokenCues: true, active: null }))
    cues.began()
    bindCueState(() => S([entry(BENCH, [set(80, 8, true)])]))
    cues.began()
    expect(speak).not.toHaveBeenCalled()
  })
  test('a superset member with no rest between is announced, named', () => {
    const st = S([entry(BENCH, [set(80, 8, true), set(80, 8)], undefined, { sg: 'g' }), entry(SQUAT, [set(100, 5), set(100, 5)], undefined, { sg: 'g' })])
    st.active.cur = 1   // the flow already moved to the partner (views/Workout.jsx)
    bindCueState(() => st)
    cues.movedOn(0)
    expect(speak.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(/^.+\. Set 1, 100 kilos, 5 reps$/)])
  })
  test('the round’s first member again says its next set', () => {
    const st = S([entry(BENCH, [set(80, 8, true), set(80, 8)], undefined, { sg: 'g' }), entry(SQUAT, [set(100, 5, true), set(100, 5)], undefined, { sg: 'g' })])
    st.active.cur = 0
    bindCueState(() => st)
    cues.movedOn(1)
    expect(speak.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(/^.+\. Set 2, 80 kilos, 8 reps$/)])
  })
})

// #1393: a line about each set, by how much the lifter wants said.
const { _setLangState } = await import('./i18n-core.js')
const de = (await import('../locales/de.js')).default
describe('a line about each set, by level (#1393)', () => {
  afterEach(() => { _resetCueQueue(); _resetPicks(); _setLangState('en', {}, null, null) })
  const tgt = { mode: 'reps', sets: 3, reps: 8 }
  const past = reps => ({ workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: BENCH, sets: reps.map(r => set(80, r, true)) }] }] })
  const three = (rows, extra = {}) => ({ ...S([entry(BENCH, rows, tgt)], extra), ...extra })
  const said = () => speak.mock.calls.map(c => c[0])

  test('a beat at the default level: the facts and what beat last time', () => {
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], past([8, 8, 8])))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps', '1 rep more than last time.'])
  })
  test('a hit at the default level says the style line, at "end" only the facts', () => {
    const rows = () => [set(80, 8, true), set(80, 8), set(80, 8), set(80, 8)]
    bindCueState(() => three(rows(), { cueStyle: 'calm' }))
    cues.restStarted(0, 0)
    expect(said()[0]).toBe('Set 2, 80 kilos, 8 reps')
    expect(['Breathe. You earned this break.', 'Shoulders down, slow breaths.']).toContain(said()[1])
    speak.mockClear()
    bindCueState(() => three(rows(), { cueStyle: 'calm', cueLevel: 'end' }))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps'])
  })
  test('short at "every": the short line, then the style line', () => {
    bindCueState(() => three([set(80, 5, true), set(80, 8), set(80, 8), set(80, 8)], { cueStyle: 'calm', cueLevel: 'every' }))
    cues.restStarted(0, 0)
    expect(said().length).toBe(3)
    expect(said()[1]).toBe('A bit short of the plan. Stay steady on the next one.')
    expect(['Breathe. You earned this break.', 'Shoulders down, slow breaths.']).toContain(said()[2])
  })
  test('the line before the last set of an exercise', () => {
    bindCueState(() => three([set(80, 8, true), set(80, 8, true), set(80, 8)]))
    cues.restStarted(0, 1)
    expect(said()[1]).toMatch(/^Last set of .+\.$/)
  })
  test('a new exercise with a last time says what it was', () => {
    const st = { ...S([entry(SQUAT, [set(100, 8, true)], tgt), entry(BENCH, [set(80, 8), set(80, 8)], tgt)]), ...past([8]) }
    bindCueState(() => st)
    cues.restStarted(0, 0)
    expect(said()[1]).toBe('Last time, 80 kilos for 8 reps.')
  })
  test('a record set says one record line and no outcome line', () => {
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], past([8, 8, 8])))
    cues.record(0, 0)
    cues.restStarted(0, 0)
    expect(said().length).toBe(2)
    expect(said()[0]).toMatch(/^That’s a new best on .+\.$/)
    expect(said()[1]).toBe('Set 2, 80 kilos, 8 reps')
    // the record belongs to that set only
    speak.mockClear()
    cues.restStarted(0, 1)
    expect(said().length).toBe(1)
  })
  test('a record in a style is that style’s line once, not twice', () => {
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], { ...past([8, 8, 8]), cueStyle: 'calm' }))
    cues.record(0, 0)
    cues.restStarted(0, 0)
    expect(said().length).toBe(2)
    expect(['That’s a new record. Quietly brilliant.', 'New personal best. Well done, really.']).toContain(said()[0])
    expect(said().some(x => /new best on/.test(x))).toBe(false)
  })
  test('a record in your own lines says only your own', () => {
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], { cueStyle: 'own', cueLines: { record: ['Who even are you?'] } }))
    cues.record(0, 0)
    expect(said()).toEqual(['Who even are you?'])
    speak.mockClear()
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], { cueStyle: 'own' }))
    cues.record(0, 0)
    expect(speak).not.toHaveBeenCalled()
  })
  test('a rest restarted (+15 s) does not say the news again, a record set gets no outcome line then', () => {
    const rows = () => [set(80, 9, true, { at: 5 }), set(80, 8), set(80, 8), set(80, 8)]
    bindCueState(() => three(rows(), past([8, 8, 8])))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps', '1 rep more than last time.'])
    speak.mockClear()
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps'])
    speak.mockClear()
    cues.record(0, 0); speak.mockClear()
    cues.restStarted(0, 0); speak.mockClear()
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps'])
  })
  test('a set ticked again after an untick says its news again', () => {
    bindCueState(() => three([set(80, 9, true, { at: 5 }), set(80, 8), set(80, 8), set(80, 8)], past([8, 8, 8])))
    cues.restStarted(0, 0)
    speak.mockClear()
    bindCueState(() => three([set(80, 9, true, { at: 9 }), set(80, 8), set(80, 8), set(80, 8)], past([8, 8, 8])))
    cues.restStarted(0, 0)
    expect(said()[1]).toBe('1 rep more than last time.')
  })
  test('a record marker with no rest after it does not leak into the next workout', () => {
    const rows = () => [set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)]
    bindCueState(() => three(rows(), past([8, 8, 8])))
    cues.record(0, 0)
    cues.began()
    speak.mockClear()
    cues.restStarted(0, 0)
    expect(said()[1]).toBe('1 rep more than last time.')
  })
  test('your own lines: no spoken news at all', () => {
    bindCueState(() => three([set(80, 5, true), set(80, 8), set(80, 8), set(80, 8)], { cueStyle: 'own', cueLines: { restStart: ['Go on.'] } }))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps', 'Go on.'])
  })
  test('the end of the workout says the minutes the summary shows', () => {
    const st = S([entry(BENCH, [set(80, 8, true, { at: 1_000_000 + 52 * 60000 })], tgt)])
    bindCueState(() => st)
    // w.end is cut at a pause or a late watch Finish; the summary reads w.end - w.start
    cues.finished(st, { start: 1_000_000, end: 1_000_000 + (47 * 60 + 40) * 1000 })
    expect(said()).toEqual(['Done in 47 minutes.'])
    speak.mockClear()
    cues.finished(st, { start: 0, end: 30_000 })
    expect(speak).not.toHaveBeenCalled()
    const none = S([entry(BENCH, [set(80, 8)], tgt)])
    cues.finished(none, { start: 0, end: 3_600_000 })
    expect(speak).not.toHaveBeenCalled()
  })
  test('your own lines: no closer either', () => {
    const st = S([entry(BENCH, [set(80, 8, true)], tgt)], { cueStyle: 'own' })
    bindCueState(() => st)
    cues.finished(st, { start: 0, end: 3_600_000 })
    expect(speak).not.toHaveBeenCalled()
  })
  test('a progression step says the weight that beat last time, never the plan', () => {
    const w = [set(82.5, 5, true), set(82.5, 5), set(82.5, 5), set(82.5, 5)]
    bindCueState(() => ({ ...S([entry(BENCH, w, { mode: 'reps', sets: 3, reps: 5 })]), workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: BENCH, sets: [set(80, 5, true)] }] }] }))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 82.5 kilos, 5 reps', '2.5 kilos more than last time.'])
  })
  test('a longer hold says the seconds', () => {
    const plank = entry('plank', [{ sec: 50, done: true }, { sec: 40, done: false }], { mode: 'time', sec: 45, sets: 2 })
    bindCueState(() => ({ ...S([plank]), workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: 'plank', sets: [{ sec: 45, done: true }] }] }] }))
    cues.restStarted(0, 0)
    expect(said()[1]).toBe('5 seconds more than last time.')
  })
  test('less help on an assisted machine is not a beat to say', () => {
    const rows = [set(35, 8, true), set(35, 8), set(35, 8)]
    bindCueState(() => ({ ...S([entry(BENCH, rows, { mode: 'reps', sets: 3, reps: 8, assisted: true })]), workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: BENCH, sets: [set(40, 8, true)] }] }] }))
    cues.restStarted(0, 0)
    expect(said()).toEqual(['Set 2, 35 kilos, 8 reps'])
  })
  test('a per-side set says reps per side, for last time and for the beat', () => {
    const side = (l, r, done = false) => ({ w: 20, r: l + r, done, sides: { L: { w: 20, r: l, done }, R: { w: 20, r: r, done } } })
    const lunge = entry('lunge', [side(9, 9, true), side(9, 9)], { mode: 'reps', sets: 2, reps: 9, side: true })
    const st = { ...S([lunge]), workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: 'lunge', sets: [side(8, 8, true), side(8, 8, true)] }] }] }
    bindCueState(() => st)
    cues.restStarted(0, 0)
    expect(said()[1]).toBe('1 rep per side more than last time.')
    speak.mockClear()
    const fresh = entry('lunge', [side(8, 8), side(8, 8)], { mode: 'reps', sets: 2, reps: 8, side: true })
    bindCueState(() => ({ ...st, active: { cur: 0, entries: [fresh] } }))
    cues.began()
    expect(said()[1]).toBe('Last time, 20 kilos for 8 reps per side.')
  })
  test('weights are said in the unit the exercise is shown in, last time too', () => {
    const pinned = { exUnit: { [BENCH]: { unit: 'lb', _ts: 1 } } }
    const hist = { workouts: [{ id: 'w0', d: '2026-01-01', entries: [{ id: BENCH, sets: [set(20, 8, true)] }] }] }
    bindCueState(() => ({ ...S([entry(BENCH, [set(20, 8), set(20, 8)], tgt)]), ...pinned, ...hist }))
    cues.began()
    expect(said()).toEqual(['barbell bench press. Set 1, 44.1 pounds, 8 reps', 'Last time, 44.1 pounds for 8 reps.'])
    speak.mockClear()
    bindCueState(() => ({ ...S([entry(BENCH, [set(22.5, 8, true), set(22.5, 8)], tgt)]), ...pinned, ...hist }))
    cues.restStarted(0, 0)
    expect(said()[1]).toMatch(/^5\.\d+ pounds more than last time\.$/)
  })
  test('a workout logged into the past says the last time before its day', () => {
    const wk = (id, d, r) => ({ id, d, start: 1, entries: [{ id: BENCH, sets: [set(60, r, true)] }] })
    const st = { ...S([entry(BENCH, [set(60, 8), set(60, 8)], tgt)]), workouts: [wk('w1', '2026-01-01', 7), wk('w2', '2026-01-10', 9)] }
    st.active.backfill = {}; st.active.d = '2026-01-05'; st.active.start = 5
    bindCueState(() => st)
    cues.began()
    expect(said()[1]).toBe('Last time, 60 kilos for 7 reps.')
  })
  test('a line that needs the exercise’s name is not said without one', () => {
    const nameless = [set(80, 8, true), set(80, 8, true), set(80, 8)]
    bindCueState(() => ({ ...S([entry('zzzz', nameless, tgt)]) }))
    cues.restStarted(0, 1)
    expect(said()).toEqual(['Set 3, 80 kilos, 8 reps'])
    speak.mockClear()
    cues.record(0, 1)
    expect(speak).not.toHaveBeenCalled()
  })
  test('an own clip for the moment plays instead of the news line, which is skipped', async () => {
    vi.useFakeTimers()
    const played = []
    _setClipPlayer(async clip => { played.push(clip.id); return true })
    const m = { kind: 'audio', hash: 'd'.repeat(64), mime: 'audio/wav', size: 100, width: 1, height: 1, dur: 1 }
    const rows = () => [set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)]
    bindCueState(() => three(rows(), { ...past([8, 8, 8]), sounds: [{ id: 'k1', name: 'x', m, voice: 'restStart' }] }))
    cues.restStarted(0, 0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(said()).toEqual(['Set 2, 80 kilos, 8 reps'])
    expect(played).toEqual(['k1'])
    // the last set: the "last set" clip wins over "Last set of ..."
    speak.mockClear(); played.length = 0; _resetCueQueue()
    bindCueState(() => three([set(80, 8, true), set(80, 8, true), set(80, 8)], { sounds: [{ id: 'k2', name: 'x', m, voice: 'lastSet' }] }))
    cues.restStarted(0, 1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(said()).toEqual(['Set 3, 80 kilos, 8 reps'])
    expect(played).toEqual(['k2'])
    vi.useRealTimers()
  })
  test('a German app says the German line', () => {
    _setLangState('de', de, null, null)
    bindCueState(() => three([set(80, 9, true), set(80, 8), set(80, 8), set(80, 8)], past([8, 8, 8])))
    cues.restStarted(0, 0)
    expect(said()[1]).toMatch(/mehr als letztes Mal/)
  })
})
