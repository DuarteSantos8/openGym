import { describe, it, expect } from 'vitest'
import {
  cleanCircuit, defaultCircuit, circuitOf, setCircuit, roundsPerStation, stationsOf, stepAt, stepCount,
  startRun, tickRun, doneStep, skipStep, pauseRun, resumeRun, stopRun, leftOf, runStep, logStation,
  trimUnlogged, runResult, nextProgram, programAdvance, applyProgramAdvances, withoutAdvances, previousResult, compareResult, stationSuggestions, lockCues,
  plannedLength, nextWorkAfter, PREP_SEC, RUNWALK, RUNWALK_WARM, rememberRegular, restoreRegular,
} from './circuit.js'
import { setSupersetMeta } from './superset-meta.js'
import { cleanupSg } from './history.js'

const S = (id, mode = 'reps', extra = {}) => ({ idx: Number(id), id: String(id), mode, reps: 10, w: 0, sec: 0, ...extra })
const steps = (cfg, st) => Array.from({ length: Math.min(60, stepCount(cfg, st.length)) }, (_, i) => stepAt(cfg, st, i))

describe('cleanCircuit', () => {
  it('drops anything that is not a circuit', () => {
    expect(cleanCircuit(null)).toBe(null)
    expect(cleanCircuit({ mode: 'superset' })).toBe(null)
  })
  it('clamps and keeps only the mode\'s fields', () => {
    expect(cleanCircuit({ mode: 'emom', every: 5, count: 500, rounds: 3 })).toEqual({ mode: 'emom', every: 10, count: 99 })
    expect(cleanCircuit({ mode: 'amrap', cap: 'x' })).toEqual({ mode: 'amrap', cap: 600 })
    expect(defaultCircuit('tabata')).toEqual({ mode: 'intervals', work: 20, rest: 10, rounds: 8 })
  })
  it('reads a run/walk level from the ladder', () => {
    expect(cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 3 })).toMatchObject({ level: 3, n: 0, ...RUNWALK[2] })
    expect(cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 99 }).level).toBe(RUNWALK.length)
  })
})

describe('group storage', () => {
  it('writes onto every member and reads it back from a session', () => {
    const ex = [{ id: 'a', sg: 'g' }, { id: 'b', sg: 'g' }, { id: 'c' }]
    setCircuit(ex, 'g', { mode: 'amrap', cap: 900 })
    expect(ex[0].sgCircuit).toEqual({ mode: 'amrap', cap: 900 })
    expect(ex[2].sgCircuit).toBeUndefined()
    const entries = ex.map(e => ({ id: e.id, sg: e.sg, target: e }))
    expect(circuitOf(entries, [0, 1], { onTarget: true })).toEqual({ mode: 'amrap', cap: 900 })
    setCircuit(ex, 'g', null)
    expect(ex[1].sgCircuit).toBeUndefined()
  })
  it('sizes the rows a station needs', () => {
    expect(roundsPerStation({ mode: 'emom', count: 10 }, 3)).toBe(4)
    expect(roundsPerStation({ mode: 'circuit', rounds: 5 }, 2)).toBe(5)
    expect(roundsPerStation({ mode: 'amrap', cap: 60 }, 2)).toBe(1)
  })
  it('reads stations from the open rows', () => {
    const entries = [{ id: 'x', target: { mode: 'reps', reps: 8 }, sets: [{ w: 20, r: 12, done: true }, { w: 22, r: 10 }] }, { id: 'y', target: { mode: 'time', sec: 30 }, sets: [{ sec: 40 }] }]
    const st = stationsOf(entries, [0, 1], c => c.mode)
    expect(st[0]).toMatchObject({ idx: 0, reps: 10, w: 22, mode: 'reps' })
    expect(st[1]).toMatchObject({ mode: 'time', sec: 40 })
  })
})

describe('steps', () => {
  it('circuit: stations, the gap between them, the round rest, no rest after the last round', () => {
    const cfg = { mode: 'circuit', rounds: 2, gap: 15, roundRest: 60 }
    const st = [S(1), S(2, 'time', { sec: 30 })]
    const all = steps(cfg, st)
    expect(all.map(s => s.k + (s.round ? 'R' : '') + (s.sec ?? '-'))).toEqual(['prep' + PREP_SEC, 'work-', 'rest15', 'work30', 'restR60', 'work-', 'rest15', 'work30'])
    expect(all[5]).toMatchObject({ m: 0, r: 1 })
    expect(stepAt(cfg, st, all.length)).toBe(null)
  })
  it('emom: every interval the next station, fixed length', () => {
    const all = steps({ mode: 'emom', every: 60, count: 5 }, [S(1), S(2)])
    expect(all.length).toBe(6)
    expect(all.slice(1).map(s => `${s.m}/${s.r}`)).toEqual(['0/0', '1/0', '0/1', '1/1', '0/2'])
    expect(all.every((s, i) => !i || (s.sec === 60 && s.emom))).toBe(true)
  })
  it('intervals: work and rest, none after the last; the round rest at a round\'s end', () => {
    const all = steps({ mode: 'intervals', work: 20, rest: 10, rounds: 2, roundRest: 45 }, [S(1), S(2)])
    expect(all.map(s => s.k[0] + s.sec)).toEqual(['p10', 'w20', 'r10', 'w20', 'r45', 'w20', 'r10', 'w20'])
    expect(plannedLength({ mode: 'intervals', work: 20, rest: 10, rounds: 8 }, [S(1)])).toBe(8 * 20 + 7 * 10)
  })
  it('run/walk opens with the warm-up walk', () => {
    const cfg = cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1 })
    const all = steps(cfg, [S('0685', 'cardio')])
    expect(all[1]).toMatchObject({ k: 'rest', warm: true, sec: RUNWALK_WARM })
    expect(all[2]).toMatchObject({ k: 'work', sec: 60 })
    expect(all.filter(s => s.k === 'work').length).toBe(8)
  })
  it('amrap never runs out of steps', () => {
    const st = [S(1), S(2), S(3)]
    expect(stepCount({ mode: 'amrap', cap: 60 }, 3)).toBe(Infinity)
    expect(stepAt({ mode: 'amrap', cap: 60 }, st, 301)).toMatchObject({ k: 'work', m: 0, r: 100 })
    expect(nextWorkAfter({ mode: 'amrap', cap: 60 }, st, 3)).toMatchObject({ m: 0, r: 1 })
  })
})

describe('the run', () => {
  const T = 1_000_000
  it('hands over at each step\'s own end, however late the tick', () => {
    let run = startRun({ sg: 'g', unit: [0], cfg: { mode: 'emom', every: 60, count: 3 }, stations: [S(0)] }, T)
    // asleep for 2.5 minutes after get ready
    const { run: r, events } = tickRun(run, T + 10_000 + 150_000)
    expect(r.i).toBe(3)
    expect(r.at).toBe(T + 10_000 + 120_000)
    expect(events.filter(e => e.type === 'work').map(e => e.sec)).toEqual([60, 60])
    expect(leftOf(r, T + 10_000 + 150_000)).toBe(30)
    run = tickRun(r, T + 10_000 + 181_000).run
    expect(run.ended).toBe('done')
  })
  it('emom: Done notes the split, the interval keeps its length', () => {
    let run = startRun({ unit: [0], cfg: { mode: 'emom', every: 60, count: 2 }, stations: [S(0)] }, T)
    run = doneStep(run, T + 1000).run          // go now from get ready
    expect(runStep(run).k).toBe('work')
    const d = doneStep(run, T + 1000 + 18_000)
    // logged at Done, so the set is ticked while the rest of the minute runs
    expect(d.events.map(e => e.type)).toEqual(['work', 'split'])
    expect(d.events[0].sec).toBe(18)
    const { events } = tickRun(d.run, T + 1000 + 60_000)
    expect(events.filter(e => e.type === 'work')).toEqual([])
    expect(runResult(stopRun(tickRun(d.run, T + 1000 + 60_000).run, T + 1000 + 61_000).run).stations[0].done).toBe(1)
  })
  it('pause moves every clock out', () => {
    let run = startRun({ unit: [0], cfg: { mode: 'amrap', cap: 60 }, stations: [S(0)] }, T)
    run = tickRun(run, T + 10_000).run
    expect(run.capEndsAt).toBe(T + 70_000)
    run = pauseRun(run, T + 20_000)
    expect(leftOf(run, T + 40_000)).toBe(50)
    run = resumeRun(run, T + 50_000)
    expect(run.capEndsAt).toBe(T + 100_000)
  })
  it('amrap: open stations by Done, the cap ends it with the round you were in', () => {
    let run = startRun({ unit: [0, 1], cfg: { mode: 'amrap', cap: 60 }, stations: [S(0, 'reps', { reps: 5 }), S(1, 'reps', { reps: 7 })] }, T)
    run = tickRun(run, T + PREP_SEC * 1000).run
    let t = T + PREP_SEC * 1000
    for (let k = 0; k < 5; k++) { t += 10_000; run = doneStep(run, t).run }
    const { run: done, events } = tickRun(run, t + 30_000)
    expect(done.ended).toBe('cap')
    expect(done.partial).toEqual({ m: 1, r: 2 })
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'cap' })
    const res = runResult(done, { partialReps: 3 })
    expect(res.rounds).toBe(2)
    expect(res.extra).toBe(5 + 3)
    expect(res.roundTimes).toEqual([20, 20])
  })
  it('skip logs nothing for a station, a rest just ends', () => {
    let run = startRun({ unit: [0, 1], cfg: { mode: 'circuit', rounds: 1, gap: 20 }, stations: [S(0), S(1)] }, T)
    run = skipStep(run, T).run
    const s = skipStep(run, T + 5000)
    expect(s.events[0]).toMatchObject({ type: 'skip', m: 0 })
    expect(runStep(s.run)).toMatchObject({ k: 'rest', sec: 20 })
    const stopped = stopRun(s.run, T + 6000).run
    expect(stopped.ended).toBe('stopped')
    expect(runResult(stopped).rounds).toBe(0)
  })
  it('your reps on the player go into the log', () => {
    let run = startRun({ unit: [0], cfg: { mode: 'circuit', rounds: 2 }, stations: [S(0)] }, T)
    run = doneStep(run, T).run
    run = { ...run, adj: { 0: { reps: 12 } } }
    const { events } = doneStep(run, T + 9000)
    expect(events[0]).toMatchObject({ type: 'work', reps: 12 })
  })
})

describe('the session', () => {
  it('ticks the round\'s row, adds rows when the plan had fewer, trims what is left', () => {
    const entries = [{ id: 'a', sets: [{ w: 0, r: 5, warmup: true, phase: 'warmup' }, { w: 10, r: 8, done: false }] }]
    const st = { idx: 0, id: 'a', mode: 'reps' }
    logStation(entries, st, 0, { reps: 9, w: 12, at: 5 })
    logStation(entries, st, 2, { reps: 7, at: 6 })
    expect(entries[0].sets.slice(1).map(s => [s.r, s.w, s.done])).toEqual([[9, 12, true], [9, 12, false], [7, 12, true]])
    trimUnlogged(entries, [0])
    expect(entries[0].sets.length).toBe(3)
  })
  it('timed and cardio stations keep their time', () => {
    const entries = [{ id: 't', sets: [{ sec: 30 }] }, { id: 'c', sets: [{ min: 1 }] }]
    logStation(entries, { idx: 0, mode: 'time' }, 0, { sec: 29.6, at: 1 })
    logStation(entries, { idx: 1, mode: 'cardio' }, 0, { sec: 90, at: 1 })
    expect(entries[0].sets[0].sec).toBe(30)
    expect(entries[1].sets[0].min).toBe(1.5)
  })
})

describe('after the run', () => {
  it('moves the run/walk ladder after three finished sessions only', () => {
    let c = cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1 })
    c = nextProgram(c, { ended: 'stopped' })
    expect(c.n).toBe(0)
    c = nextProgram(nextProgram(nextProgram(c, { ended: 'done' }), { ended: 'done' }), { ended: 'done' })
    expect(c).toMatchObject({ level: 2, n: 0, work: RUNWALK[1].work })
  })
  it('notes the step up for the save and takes it only from where it was noted', () => {
    const third = cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1, n: 2 })
    const done = { sg: 'g', ended: 'done' }
    const a = programAdvance(third, done, 'r1')
    expect(a).toMatchObject({ rid: 'r1', sg: 'g', from: { level: 1, n: 2 }, to: { level: 2, n: 0, work: RUNWALK[1].work } })
    // stopped early, not a run/walk, or no routine: nothing to take
    expect(programAdvance(third, { sg: 'g', ended: 'stopped' }, 'r1')).toBe(null)
    expect(programAdvance({ mode: 'intervals', work: 20, rest: 10, rounds: 8 }, done, 'r1')).toBe(null)
    expect(programAdvance(third, done, null)).toBe(null)
    const routines = [{ id: 'r1', ex: [{ id: '0685', sg: 'g', sgCircuit: { ...third } }, { id: 'x', sg: 'h' }] }]
    expect(applyProgramAdvances(routines, [{ mode: 'intervals' }, { mode: 'intervals', advance: a }])).toBe(1)
    expect(routines[0].ex[0].sgCircuit).toMatchObject({ level: 2, n: 0 })
    expect(routines[0].ex[1].sgCircuit).toBeUndefined()
    // the same session saved again (a reopen): the ladder does not move twice
    expect(applyProgramAdvances(routines, [{ advance: a }])).toBe(0)
    expect(routines[0].ex[0].sgCircuit).toMatchObject({ level: 2, n: 0 })
    // and the saved workout does not carry the step
    expect(withoutAdvances([{ mode: 'intervals', rounds: 8, advance: a }])).toEqual([{ mode: 'intervals', rounds: 8 }])
  })
  it('compares with the same circuit last time', () => {
    const today = { mode: 'circuit', ids: ['a', 'b'], rounds: 3, roundTimes: [60, 70, 75], extra: 0 }
    const workouts = [{ id: 1, circuits: [{ mode: 'circuit', ids: ['a', 'b'], rounds: 3, roundTimes: [62, 71, 87] }] }, { id: 2, circuits: [{ mode: 'amrap', ids: ['a', 'b'] }] }]
    const last = previousResult(workouts, today)
    expect(last.roundTimes[2]).toBe(87)
    expect(compareResult(today, last)).toEqual({ kind: 'round', round: 3, delta: -12 })
    expect(compareResult({ mode: 'amrap', rounds: 5, extra: 3 }, { rounds: 5, extra: 1 })).toEqual({ kind: 'reps', delta: 2 })
    expect(compareResult({ mode: 'amrap', rounds: 6, extra: 0 }, { rounds: 5, extra: 9 })).toEqual({ kind: 'rounds', delta: 1 })
  })
  it('suggests a rep more for unloaded stations that hit every round', () => {
    const run = { cfg: { mode: 'circuit' }, log: [{}], ended: 'done', stations: [S(0, 'reps', { reps: 10 }), S(1, 'reps', { reps: 10, w: 20 }), S(2, 'time', { sec: 30 }), S(3, 'reps', { reps: 10 })] }
    const entries = [
      { id: '0', sets: [{ r: 10, done: true }, { r: 11, done: true }] },
      { id: '1', sets: [{ r: 10, w: 20, done: true }] },
      { id: '2', sets: [{ sec: 30, done: true }] },
      { id: '3', sets: [{ r: 10, done: true }, { r: 8, done: true }] },
    ]
    expect(stationSuggestions(run, entries)).toEqual([
      { idx: 0, id: '0', field: 'reps', from: 10, to: 11 },
      { idx: 2, id: '2', field: 'sec', from: 30, to: 35 },
    ])
  })
})

describe('lockCues', () => {
  const words = { work: (n) => 'Go ' + n, rest: (n) => 'Rest ' + n, end: () => 'Time' }
  it('books the fixed boundaries ahead, up to the end', () => {
    const run = startRun({ unit: [0], cfg: { mode: 'intervals', work: 20, rest: 10, rounds: 2 }, stations: [S(0)] }, 0)
    const c = lockCues(run, words, id => 'x' + id)
    expect(c.at).toBe(PREP_SEC * 1000)
    expect(c.title).toBe('Go x0')
    expect(c.cues).toEqual([{ dt: 20_000, title: 'Rest x0' }, { dt: 30_000, title: 'Go x0' }, { dt: 50_000, title: 'Time' }])
  })
  it('stops at an open station, and AMRAP books its cap', () => {
    const run = startRun({ unit: [0], cfg: { mode: 'circuit', rounds: 2 }, stations: [S(0)] }, 0)
    expect(lockCues(run, words, String).cues).toEqual([])
    const amrap = doneStep(startRun({ unit: [0], cfg: { mode: 'amrap', cap: 300 }, stations: [S(0)] }, 0), 1000).run
    expect(lockCues(amrap, words, String)).toEqual({ at: 301_000, title: 'Time', cues: [] })
  })
})

// QA 1.4.5: Routine type → Intervals → Regular left every exercise at 8 sets in one superset.
describe('routine type round trip (rememberRegular / restoreRegular)', () => {
  // The steps RoutineEdit's pickRoutineType and saveGroup take.
  const toType = (ex, cfg) => {
    rememberRegular(ex)
    for (const e of ex) e.sg = 'sgT'
    setSupersetMeta(ex, 'sgT', { name: '', rest: 0 })
    setCircuit(ex, 'sgT', cfg)
    const n = roundsPerStation(cfg, ex.length)
    for (const e of ex) e.sets = n
    cleanupSg(ex)
    return ex
  }
  const regular = () => [
    { id: '0025', sets: 4, reps: 8 },
    { id: '0047', sets: 3, reps: 10, sg: 'sgA', sgName: 'Arms', sgRest: 60 },
    { id: '0048', sets: 3, reps: 10, sg: 'sgA', sgName: 'Arms', sgRest: 60 },
    { id: '0334', sets: 2, reps: 12 },
  ]
  it('Intervals and back gives the routine its own sets and supersets again', () => {
    const ex = toType(regular(), defaultCircuit('intervals'))
    expect(ex.every(e => e.sg === 'sgT' && e.sets === 8)).toBe(true)
    restoreRegular(ex); cleanupSg(ex)
    expect(ex).toEqual(regular())
  })
  it('a type changed to another type still remembers the regular routine', () => {
    const ex = toType(regular(), defaultCircuit('intervals'))
    setCircuit(ex, 'sgT', defaultCircuit('amrap'))
    rememberRegular(ex)   // already remembered: kept as it was
    restoreRegular(ex); cleanupSg(ex)
    expect(ex).toEqual(regular())
  })
  it('an exercise added while on the clock leaves the group when it goes back', () => {
    const ex = toType(regular(), defaultCircuit('emom'))
    ex.push({ id: '0251', sets: 8, reps: 10, sg: 'sgT', sgCircuit: { ...ex[0].sgCircuit } })
    restoreRegular(ex); cleanupSg(ex)
    expect(ex[4]).toEqual({ id: '0251', sets: 8, reps: 10 })
    expect(ex.slice(0, 4)).toEqual(regular())
  })
})

// Night QA 146: a farmer's walk station read "0 reps · 24 kg" and was saved with r: 0.
describe('a distance station', () => {
  it('carries its metres and logs them, no reps', () => {
    const entries = [{ id: '2133', target: { mode: 'distance', m: 20, weight: 24 }, sets: [{ m: 20, w: 24, done: false }, { m: 20, w: 24, done: false }] }]
    const [st] = stationsOf(entries, [0], c => c.mode)
    expect(st).toMatchObject({ mode: 'distance', m: 20, w: 24 })
    logStation(entries, st, 0, { reps: 0, w: 24, at: 5 })
    expect(entries[0].sets[0]).toMatchObject({ m: 20, w: 24, done: true })
    expect(entries[0].sets[0].r).toBeUndefined()
  })
})
