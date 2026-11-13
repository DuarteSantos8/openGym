// Circuits, AMRAP, EMOM and intervals (#560, #725, #765): a group of exercises that runs on the
// clock instead of set by set. Pure and framework-free, so the timing rules are tested here and
// the player (components/CircuitPlayer.jsx, store/useCircuit.js) only shows what this decides.
//
// Where it lives: on the members of a group, like a superset's name and rest (lib/superset-meta.js):
// every member of group `sg` carries the same `sgCircuit` ({ mode, rounds, ... }), so a reorder,
// a copy or the routine copied into a session keeps it with no second structure. A group of one is
// allowed for a circuit (a one-exercise EMOM is the most common EMOM there is), lib/history.js
// cleanupSg leaves its tag alone. The superset's own `sgRest` is the rest between rounds.
//
// The modes:
//   circuit    rounds over the stations; a reps station ends when you tap Done, a timed one by
//              itself; an optional rest between stations (`gap`) and the group's round rest.
//   amrap      the stations again and again until the time cap (`cap`) runs out; the score is
//              full rounds plus the reps of the round you were in.
//   emom       an interval every `every` seconds, `count` of them; interval n is station n mod
//              the number of stations, so one exercise and an alternating EMOM are the same thing.
//              Whatever is left of the interval after Done is the rest. No drift: interval n starts
//              at start + n × every, whatever happened before.
//   intervals  work / rest × rounds over the stations (Tabata is 20/10 × 8). `program: 'runwalk'`
//              is a run/walk ladder that moves up a level after every few finished sessions.
//
// The run is a list of steps (get ready, work, rest), each fixed in length or open (until Done).
// A step that ends by the clock hands over at its end time, never at the tick that noticed it, so
// a phone that was locked for three minutes wakes up exactly where the clock is.
import { isWarmupRow } from './workout-model.js'

export const CIRCUIT_MODES = ['circuit', 'amrap', 'emom', 'intervals']
export const PREP_SEC = 10
// The run/walk ladder (our own): run seconds, walk seconds, repeats; a 5 minute brisk walk first.
// Three finished sessions on a level move it up one (RUNWALK_SESSIONS).
export const RUNWALK = [
  { work: 60, rest: 90, rounds: 8 },
  { work: 90, rest: 90, rounds: 7 },
  { work: 120, rest: 90, rounds: 6 },
  { work: 180, rest: 90, rounds: 5 },
  { work: 300, rest: 120, rounds: 4 },
  { work: 480, rest: 120, rounds: 3 },
  { work: 600, rest: 120, rounds: 2 },
  { work: 900, rest: 120, rounds: 2 },
  { work: 1500, rest: 0, rounds: 1 },
  { work: 1800, rest: 0, rounds: 1 },
]
export const RUNWALK_WARM = 300
export const RUNWALK_SESSIONS = 3

const LIMITS = {
  rounds: [1, 50, 3], cap: [60, 3600, 600], every: [10, 600, 60], count: [1, 99, 10],
  work: [5, 3600, 20], rest: [0, 600, 10], gap: [0, 300, 0],
}
const clampInt = (v, [lo, hi, def]) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def
}

/** A clean config, or null for anything that is not a circuit. Only the fields the mode reads. */
export function cleanCircuit(c) {
  if (!c || typeof c !== 'object' || !CIRCUIT_MODES.includes(c.mode)) return null
  const mode = c.mode
  if (mode === 'circuit') return { mode, rounds: clampInt(c.rounds, LIMITS.rounds), gap: clampInt(c.gap, LIMITS.gap) }
  if (mode === 'amrap') return { mode, cap: clampInt(c.cap, LIMITS.cap) }
  if (mode === 'emom') return { mode, every: clampInt(c.every, LIMITS.every), count: clampInt(c.count, LIMITS.count) }
  if (c.program === 'runwalk') {
    const level = clampInt(c.level, [1, RUNWALK.length, 1])
    const n = clampInt(c.n, [0, RUNWALK_SESSIONS - 1, 0])
    return { mode, program: 'runwalk', level, n, ...RUNWALK[level - 1] }
  }
  return { mode, work: clampInt(c.work, LIMITS.work), rest: clampInt(c.rest, LIMITS.rest), rounds: clampInt(c.rounds, [1, 50, 8]) }
}

/** The defaults a mode opens with when it is picked. */
export function defaultCircuit(mode) {
  if (mode === 'runwalk') return cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1 })
  if (mode === 'tabata') return cleanCircuit({ mode: 'intervals', work: 20, rest: 10, rounds: 8 })
  if (mode === 'circuit') return cleanCircuit({ mode, rounds: 3, gap: 15 })
  return cleanCircuit({ mode })
}

/** The circuit of the group around `unit` (indices into `list`), or null. `onTarget` for session entries. */
export function circuitOf(list, unit, { onTarget = false } = {}) {
  for (const idx of unit || []) {
    const item = list?.[idx]
    const f = (onTarget ? item?.target : item) || {}
    const c = cleanCircuit(f.sgCircuit)
    if (c) return c
  }
  return null
}

/** Writes `cfg` onto every member of group `sg` in a routine's `ex` (null clears it). */
export function setCircuit(ex, sg, cfg) {
  const clean = cleanCircuit(cfg)
  for (const e of ex || []) {
    if (!e || !sg || e.sg !== sg) continue
    if (clean) e.sgCircuit = { ...clean }; else delete e.sgCircuit
  }
  return ex
}

/**
 * Plan → routine → Routine type (views/RoutineEdit.jsx) puts every exercise into one group and gives
 * each as many sets as the clock has rounds. Before that, each exercise keeps what it was as a
 * regular routine (`preType`: its sets and its own superset), so picking Regular again gives the
 * routine back the way it was instead of eight sets of everything in one giant superset. Switching
 * from one type to another keeps the first copy. Mutates and returns `ex`.
 */
export function rememberRegular(ex) {
  for (const e of ex || []) {
    if (!e || e.preType) continue
    e.preType = { sets: e.sets, sg: e.sg || null, ...(e.sgName ? { sgName: e.sgName } : {}), ...(e.sgRest ? { sgRest: e.sgRest } : {}) }
  }
  return ex
}
/** Back to a regular routine: the clock off, each exercise's own sets and superset back. An exercise
 *  added while it ran on the clock leaves the routine's group. The caller tidies the groups. */
export function restoreRegular(ex) {
  const typeSg = new Set((ex || []).filter(e => e?.sgCircuit && e.sg).map(e => e.sg))
  for (const e of ex || []) {
    if (!e) continue
    delete e.sgCircuit
    const was = e.preType
    delete e.preType
    if (!was || typeof was !== 'object') { if (typeSg.has(e.sg)) { delete e.sg; delete e.sgName; delete e.sgRest } continue }
    if (Number(was.sets) > 0) e.sets = was.sets
    if (was.sg) e.sg = was.sg; else delete e.sg
    if (was.sgName) e.sgName = was.sgName; else delete e.sgName
    if (was.sgRest) e.sgRest = was.sgRest; else delete e.sgRest
  }
  return ex
}

/** How many rows each station needs before the run starts (AMRAP grows them as it goes). */
export function roundsPerStation(cfg, stations) {
  const n = Math.max(1, stations || 1)
  if (!cfg) return 0
  if (cfg.mode === 'emom') return Math.ceil(cfg.count / n)
  if (cfg.mode === 'amrap') return 1
  return cfg.rounds
}

/* ---------- the plan: stations and steps ---------- */

/**
 * The stations of a group in a running session: what each one asks for in one round. `mode` is
 * the exercise's own (reps, time, cardio); `sec` a timed station's own length in a circuit/AMRAP.
 */
export function stationsOf(entries, unit, modeOf) {
  return (unit || []).map(idx => {
    const e = entries?.[idx] || {}
    const rows = (e.sets || []).filter(s => !isWarmupRow(s))
    const first = rows.find(s => !s.done) || rows[0] || {}
    const target = e.target || {}
    const mode = modeOf ? modeOf({ ...target, id: e.id }) : (target.mode || 'reps')
    return {
      idx,
      id: e.id,
      mode,
      reps: Math.max(0, Math.round(Number(first.r ?? target.reps) || 0)),
      w: Number(first.w) || 0,
      sec: Math.max(0, Math.round(Number(first.sec ?? target.sec) || 0)),
      // A carry or a sled station (#1011): its metres per round.
      m: Math.max(0, Math.round(Number(first.m ?? target.m) || 0)),
      // Rows already ticked before the clock started (by hand, or a run before this one): the
      // run's rounds are written after them, never over them.
      base: rows.filter(s => s.done).length,
    }
  })
}

/** How many steps the run has (Infinity for AMRAP, which ends on its cap). */
export function stepCount(cfg, n) {
  if (!cfg || !n) return 0
  if (cfg.mode === 'amrap') return Infinity
  return 1 + bodyCount(cfg, n)
}
const warmOf = cfg => (cfg.program === 'runwalk' ? RUNWALK_WARM : 0)
function bodyCount(cfg, n) {
  if (cfg.mode === 'emom') return cfg.count
  if (cfg.mode === 'circuit') return cfg.rounds * n + (cfg.gap > 0 ? cfg.rounds * (n - 1) : 0) + Math.max(0, cfg.rounds - 1) * (cfg.roundRest > 0 ? 1 : 0)
  // intervals: work and rest after every work but the last; the warm-up walk first
  return (warmOf(cfg) ? 1 : 0) + cfg.rounds * n + (cfg.rest > 0 ? cfg.rounds * n - 1 : 0)
}

/**
 * Step `i` of the run: { k: 'prep' | 'work' | 'rest', m (station), r (round), sec (null: open),
 * round (a rest between rounds), warm (the run/walk warm-up) }. `stations` from stationsOf;
 * `cfg.roundRest` the group's rest between rounds. Null past the end.
 */
export function stepAt(cfg, stations, i) {
  const n = stations?.length || 0
  if (!cfg || !n || i < 0 || i >= stepCount(cfg, n)) return null
  if (i === 0) return { k: 'prep', m: 0, r: 0, sec: PREP_SEC }
  let j = i - 1
  const own = m => { const s = stations[m]; return s && (s.mode === 'time' && s.sec > 0) ? s.sec : null }
  if (cfg.mode === 'amrap') {
    const m = j % n
    return { k: 'work', m, r: Math.floor(j / n), sec: own(m) }
  }
  if (cfg.mode === 'emom') return { k: 'work', m: j % n, r: Math.floor(j / n), sec: cfg.every, emom: true }
  if (cfg.mode === 'circuit') {
    const gap = cfg.gap > 0
    const rr = cfg.roundRest > 0
    const perRound = n + (gap ? n - 1 : 0)
    const block = perRound + (rr ? 1 : 0)
    const r = Math.floor(j / block)
    const p = j % block
    if (p === perRound) return { k: 'rest', m: 0, r: r + 1, sec: cfg.roundRest, round: true }
    if (!gap) return { k: 'work', m: p, r, sec: own(p) }
    return p % 2 === 0 ? { k: 'work', m: p / 2, r, sec: own(p / 2) } : { k: 'rest', m: (p + 1) / 2, r, sec: cfg.gap }
  }
  // intervals
  const warm = warmOf(cfg)
  if (warm) { if (j === 0) return { k: 'rest', m: 0, r: 0, sec: warm, warm: true }; j -= 1 }
  if (cfg.rest > 0) {
    const w = Math.floor(j / 2)
    const m = w % n, r = Math.floor(w / n)
    if (j % 2 === 0) return { k: 'work', m, r, sec: cfg.work }
    const next = w + 1
    const round = next % n === 0
    return { k: 'rest', m: next % n, r: Math.floor(next / n), sec: round && cfg.roundRest > 0 ? cfg.roundRest : cfg.rest, round }
  }
  return { k: 'work', m: j % n, r: Math.floor(j / n), sec: cfg.work }
}

/** The next work step after step `i` (what "Up next" shows), or null. */
export function nextWorkAfter(cfg, stations, i) {
  for (let k = i + 1; k < i + 4 + (stations?.length || 0) * 2; k++) {
    const s = stepAt(cfg, stations, k)
    if (!s) return null
    if (s.k === 'work') return s
  }
  return null
}

/** The whole run's length in seconds when every step is fixed (EMOM, intervals; AMRAP: its cap), else null. */
export function plannedLength(cfg, stations) {
  if (!cfg) return null
  if (cfg.mode === 'amrap') return cfg.cap
  const total = stepCount(cfg, stations.length)
  let sec = 0
  for (let i = 1; i < total; i++) { const s = stepAt(cfg, stations, i); if (s.sec == null) return null; sec += s.sec }
  return sec
}

/* ---------- the run ---------- */

/**
 * A new run, waiting on its first step (get ready). Plain data: it is kept across a reload.
 * `adj` holds what you changed on the player (reps, weight per station) for the rounds to come.
 */
export function startRun({ wid, sg, unit, cfg, stations, roundRest = 0 }, now = Date.now()) {
  const c = { ...cleanCircuit(cfg), ...(roundRest > 0 ? { roundRest: Math.round(roundRest) } : {}) }
  return { v: 1, wid: wid ?? null, sg: sg ?? null, unit: [...unit], cfg: c, stations, i: 0, at: now, startedAt: now, paused: null, capEndsAt: null, split: null, log: [], ended: null, adj: {} }
}

export const runStep = run => (run ? stepAt(run.cfg, run.stations, run.i) : null)

/** When the current step ends by the clock (ms), or null for an open step / a paused run. */
export function stepEndsAt(run) {
  const s = runStep(run)
  if (!s || s.sec == null) return null
  return run.at + s.sec * 1000
}

/** Seconds left in the current step (or on the AMRAP cap for an open step), at `now`. */
export function leftOf(run, now = Date.now()) {
  const t = run?.paused ?? now
  const end = stepEndsAt(run)
  if (end != null) return Math.max(0, Math.ceil((end - t) / 1000))
  if (run?.capEndsAt) return Math.max(0, Math.ceil((run.capEndsAt - t) / 1000))
  return null
}

/** Seconds since the work began (after get ready), for an open count-up. */
export function elapsedOf(run, now = Date.now()) {
  const t = run?.paused ?? now
  return run?.workFrom == null ? 0 : Math.max(0, Math.floor((t - run.workFrom) / 1000))
}

function begin(run, i, at, events) {
  const step = stepAt(run.cfg, run.stations, i)
  if (!step) { run.ended = run.ended || 'done'; run.endedAt = at; events.push({ type: 'end', reason: 'done', at }); return }
  run.i = i
  run.at = at
  run.split = null
  if (step.k !== 'prep' && run.workFrom == null) run.workFrom = at
  // The AMRAP cap starts with the first work step, never during get ready.
  if (run.cfg.mode === 'amrap' && step.k === 'work' && run.capEndsAt == null) run.capEndsAt = at + run.cfg.cap * 1000
  events.push({ type: 'step', step, i, at })
}

function closeWork(run, at, events, { skipped = false } = {}) {
  const step = runStep(run)
  if (!step || step.k !== 'work') return
  // An EMOM interval is logged at Done (its split); its end only moves the clock on.
  if (step.emom && run.split && run.log.at(-1)?.i === run.i) return
  const from = run.at
  // EMOM: the work ended at Done (the split), the rest of the minute was rest.
  const to = step.emom && run.split ? run.split : at
  const now = stationNow(run, step.m) || {}
  const entry = { i: run.i, m: step.m, r: step.r, from, to, reps: now.reps || 0, ...(now.w ? { w: now.w } : {}), ...(skipped ? { skipped: true } : {}) }
  run.log.push(entry)
  events.push({ type: skipped ? 'skip' : 'work', ...entry, sec: Math.max(1, Math.round((to - from) / 1000)) })
}

/**
 * Moves the clock to `now`: every fixed step whose time ran out is closed at its own end and the
 * next one begins there, and the AMRAP cap ends the run at the cap. `{ run, events }`, run copied.
 */
export function tickRun(prev, now = Date.now()) {
  if (!prev || prev.ended || prev.paused != null) return { run: prev, events: [] }
  const run = { ...prev, log: [...prev.log] }
  const events = []
  for (let guard = 0; guard < 2000 && !run.ended; guard++) {
    const end = stepEndsAt(run)
    const cap = run.capEndsAt
    if (cap != null && now >= cap && (end == null || cap <= end)) {
      // Time: an open station is the partial one (its reps are asked for afterwards).
      const step = runStep(run)
      run.ended = 'cap'; run.endedAt = cap
      run.partial = step?.k === 'work' ? { m: step.m, r: step.r } : null
      events.push({ type: 'end', reason: 'cap', at: cap })
      break
    }
    if (end == null || now < end) break
    closeWork(run, end, events)
    begin(run, run.i + 1, end, events)
  }
  return { run, events }
}

/**
 * Done on the current station. An open step closes now and the next begins; an EMOM interval
 * only notes when you finished (the rest of it is rest). Get ready and rests: go now.
 */
export function doneStep(prev, now = Date.now()) {
  const ticked = tickRun(prev, now)
  if (!ticked.run || ticked.run.ended || ticked.run.paused != null) return ticked
  const run = { ...ticked.run, log: [...ticked.run.log] }
  const events = [...ticked.events]
  const step = runStep(run)
  if (step.k === 'work' && step.emom) {
    if (!run.split) { run.split = now; closeWork(run, now, events); events.push({ type: 'split', i: run.i, at: now }) }
    return { run, events }
  }
  if (step.k === 'work') closeWork(run, now, events)
  begin(run, run.i + 1, now, events)
  return { run, events }
}

/** Skip: a station is left out (nothing logged), a rest or get ready ends now. */
export function skipStep(prev, now = Date.now()) {
  const ticked = tickRun(prev, now)
  if (!ticked.run || ticked.run.ended || ticked.run.paused != null) return ticked
  const run = { ...ticked.run, log: [...ticked.run.log] }
  const events = [...ticked.events]
  const step = runStep(run)
  if (step.k === 'work') {
    // An EMOM interval you already finished keeps its reps: Skip just starts the next one now.
    if (step.emom && run.split) closeWork(run, now, events)
    else closeWork(run, now, events, { skipped: true })
  }
  begin(run, run.i + 1, now, events)
  return { run, events }
}

export function pauseRun(run, now = Date.now()) {
  if (!run || run.ended || run.paused != null) return run
  return { ...tickRun(run, now).run, paused: now }
}

/** Resume: every clock of the run moves out by the time it stood still. */
export function resumeRun(run, now = Date.now()) {
  if (!run || run.paused == null) return run
  const d = Math.max(0, now - run.paused)
  const mv = v => (v == null ? v : v + d)
  return { ...run, paused: null, at: run.at + d, split: mv(run.split), capEndsAt: mv(run.capEndsAt), workFrom: mv(run.workFrom), startedAt: run.startedAt + d,
    log: run.log.map(x => ({ ...x })) }
}

/** Stop here: the run ends now with what was logged. */
export function stopRun(prev, now = Date.now()) {
  if (!prev || prev.ended) return { run: prev, events: [] }
  const t = prev.paused ?? now
  const { run: r0, events } = tickRun({ ...prev, paused: null }, t)
  const run = { ...r0, log: [...r0.log] }
  if (!run.ended) {
    const step = runStep(run)
    run.ended = 'stopped'; run.endedAt = t
    run.partial = step?.k === 'work' && !step.emom ? { m: step.m, r: step.r } : null
    // An EMOM interval you finished before stopping counts.
    if (step?.k === 'work' && step.emom && run.split) closeWork(run, t, events)
    events.push({ type: 'end', reason: 'stopped', at: t })
  }
  return { run, events }
}

/** What the player shows for station `m` this round: its plan with your changes on the player. */
export function stationNow(run, m) {
  const s = run?.stations?.[m]
  if (!s) return null
  const a = run.adj?.[m] || {}
  return { ...s, ...(a.reps != null ? { reps: a.reps } : {}), ...(a.w != null ? { w: a.w } : {}) }
}

/* ---------- writing it into the session ---------- */

/**
 * Logs one finished station into the session entries (a draft): the r-th work row of the
 * station's exercise is ticked with the reps and weight it was done at, a timed one with the
 * seconds it ran, cardio with its minutes. Rows are added when the plan had fewer (AMRAP, and a
 * routine whose set count did not match the rounds).
 */
export function logStation(entries, station, r, { reps, w, sec, at }) {
  const e = entries?.[station.idx]
  if (!e) return
  if (!Array.isArray(e.sets)) e.sets = []
  const workIdx = () => e.sets.map((s, i) => (isWarmupRow(s) ? -1 : i)).filter(i => i >= 0)
  const at0 = (Number(station.base) || 0) + r
  let rows = workIdx()
  while (rows.length <= at0) {
    const last = rows.length ? e.sets[rows[rows.length - 1]] : {}
    const { done: _d, at: _a, rpe: _r, note: _n, ...shape } = last || {}
    e.sets.push({ ...shape, done: false })
    rows = workIdx()
  }
  const row = e.sets[rows[at0]]
  row.done = true
  row.at = at
  if (station.mode === 'time') row.sec = Math.max(1, Math.round(sec))
  else if (station.mode === 'cardio') row.min = Math.max(0.1, Math.round(sec / 6) / 10)
  else if (station.mode === 'distance') { if (station.m > 0 && !(row.m > 0)) row.m = station.m }
  else row.r = Math.max(0, Math.round(reps))
  if (station.mode !== 'cardio' && w != null) row.w = w
}

/** The work rows a finished run left unticked go: the circuit is over, nothing is owed. */
export function trimUnlogged(entries, unit) {
  for (const idx of unit || []) {
    const e = entries?.[idx]
    if (!e || !Array.isArray(e.sets)) continue
    e.sets = e.sets.filter(s => isWarmupRow(s) || s.done)
  }
}

/* ---------- the result ---------- */

/**
 * What the workout keeps of a run: `{ sg, mode, ids, rounds, extra, roundTimes, sec, cfg, ended }`.
 * `rounds` full rounds done (every station logged), `extra` the reps of the round after them (the
 * AMRAP score's "+ 4"), `roundTimes` the seconds each full round took from its first station to
 * its last, rests between stations included, the round rest not. `partialReps` from the player's
 * "how many did you get" for the station the cap caught you in.
 */
export function runResult(run, { partialReps = 0, name = '' } = {}) {
  const n = run.stations.length
  const work = run.log.filter(x => !x.skipped)
  const byRound = new Map()
  for (const x of work) { const g = byRound.get(x.r) || []; g.push(x); byRound.set(x.r, g) }
  let rounds = 0
  const roundTimes = []
  for (let r = 0; byRound.has(r) && new Set(byRound.get(r).map(x => x.m)).size === n; r++) {
    rounds++
    const g = byRound.get(r)
    roundTimes.push(Math.max(1, Math.round((Math.max(...g.map(x => x.to)) - Math.min(...g.map(x => x.from))) / 1000)))
  }
  let extra = 0
  for (const x of byRound.get(rounds) || []) if (run.stations[x.m]?.mode === 'reps') extra += Math.max(0, Math.round(x.reps || 0))
  extra += Math.max(0, Math.round(Number(partialReps) || 0))
  const from = run.workFrom ?? run.startedAt
  const sec = Math.max(0, Math.round(((run.endedAt ?? from) - from) / 1000))
  const { roundRest: _rr, ...cfg } = run.cfg
  const clean = String(name || '').trim().slice(0, 40)
  return {
    sg: run.sg, mode: run.cfg.mode, ids: run.stations.map(s => s.id), rounds, extra, roundTimes, sec, cfg,
    ended: run.ended || 'stopped', ...(clean ? { name: clean } : {}),
    stations: run.stations.map((s, m) => ({ id: s.id, done: work.filter(x => x.m === m).length })),
  }
}

/** True when a run/walk session was finished as planned (every step, not stopped early). */
export const finishedAsPlanned = result => result?.ended === 'done'

/** The run/walk program after a session: three finished sessions move it up a level. */
export function nextProgram(cfg, result) {
  const c = cleanCircuit(cfg)
  if (!c || c.program !== 'runwalk' || !finishedAsPlanned(result)) return c
  const n = c.n + 1
  if (n < RUNWALK_SESSIONS) return { ...c, n }
  return cleanCircuit({ mode: 'intervals', program: 'runwalk', level: Math.min(RUNWALK.length, c.level + 1), n: 0 })
}

/**
 * What a finished run/walk session earns its routine, as a step to take once the workout is
 * saved: { rid, sg, from, to }, or null when it earns nothing (stopped early, not a run/walk, no
 * routine, already at the top). The finished run only notes it on the session (store/useCircuit.js
 * finish); the routine moves when the workout is finished and saved (applyProgramAdvances), so a
 * workout that is then discarded leaves the ladder where it was.
 */
export function programAdvance(cfg, result, rid) {
  const from = cleanCircuit(cfg)
  if (!from || from.program !== 'runwalk' || rid == null || !result?.sg) return null
  const to = nextProgram(cfg, result)
  if (!to || JSON.stringify(to) === JSON.stringify(from)) return null
  return { rid, sg: result.sg, from, to }
}

/**
 * The steps noted on a session's circuit results (programAdvance), taken on `routines` (mutated).
 * Only from where the step was noted: a routine edited since, or a step already taken (the same
 * session saved again after a reopen), is left as it is. Returns how many routines moved.
 */
export function applyProgramAdvances(routines, circuits) {
  let moved = 0
  for (const c of Array.isArray(circuits) ? circuits : []) {
    const a = c?.advance
    if (!a || !a.sg) continue
    const r = (routines || []).find(x => x && x.id === a.rid)
    const slot = r?.ex?.find(e => e && e.sg === a.sg)
    if (!slot || JSON.stringify(cleanCircuit(slot.sgCircuit)) !== JSON.stringify(cleanCircuit(a.from))) continue
    setCircuit(r.ex, a.sg, a.to)
    moved++
  }
  return moved
}

/** The circuit results as a saved workout keeps them: without the step for the routine. */
export const withoutAdvances = circuits => circuits.map(c => {
  if (!c || !('advance' in c)) return c
  const { advance: _a, ...rest } = c
  return rest
})

/** The last result of the same circuit (same mode, same exercises) before workout `beforeId`, or null. */
export function previousResult(workouts, result, beforeId = null) {
  const key = r => r.mode + '|' + (r.ids || []).join(',')
  const want = key(result)
  const list = Array.isArray(workouts) ? workouts : []
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i]
    if (!w || (beforeId != null && w.id === beforeId)) continue
    for (const c of w.circuits || []) if (key(c) === want) return c
  }
  return null
}

/**
 * Today against last time, one line's worth: AMRAP by score, the others by round time.
 * `{ kind: 'score', delta }` (reps of difference, rounds × stations' reps not needed: a round
 * counts as more than any extra), or `{ kind: 'round', round, delta }` for the round that moved
 * most (negative: faster), or null.
 */
export function compareResult(today, last) {
  if (!today || !last) return null
  if (today.mode === 'amrap') {
    if (today.rounds !== last.rounds) return { kind: 'rounds', delta: today.rounds - last.rounds }
    if (today.extra !== last.extra) return { kind: 'reps', delta: today.extra - last.extra }
    return { kind: 'same' }
  }
  let best = null
  const k = Math.min(today.roundTimes?.length || 0, last.roundTimes?.length || 0)
  for (let r = 0; r < k; r++) {
    const delta = today.roundTimes[r] - last.roundTimes[r]
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { kind: 'round', round: r + 1, delta }
  }
  return best && best.delta !== 0 ? best : (best ? { kind: 'same' } : null)
}

/**
 * Next time, per station (the simple part of progression): a bodyweight or unloaded reps station
 * that hit its reps in every round it was done gets one more rep, a timed station of a circuit or
 * AMRAP five more seconds. Loaded stations are left to the progression engine, which already
 * moves their weight from these same sets. `[{ idx, id, field: 'reps' | 'sec', from, to }]`.
 */
export function stationSuggestions(run, entries) {
  const out = []
  // Only a run that went the distance says anything about next time.
  if (!run || run.ended === 'stopped') return out
  run.stations.forEach((s, m) => {
    const rows = (entries?.[s.idx]?.sets || []).filter(x => !isWarmupRow(x) && x.done)
    if (!rows.length) return
    if (s.mode === 'reps' && !(s.w > 0) && s.reps > 0 && rows.every(x => (Number(x.r) || 0) >= s.reps)) out.push({ idx: s.idx, id: s.id, field: 'reps', from: s.reps, to: s.reps + 1 })
    else if (s.mode === 'time' && s.sec > 0 && ['circuit', 'amrap'].includes(run.cfg.mode) && rows.every(x => (Number(x.sec) || 0) >= s.sec)) out.push({ idx: s.idx, id: s.id, field: 'sec', from: s.sec, to: s.sec + 5 })
  })
  return out
}

/* ---------- the phone asleep ---------- */

/**
 * The boundaries the phone rings while the page sleeps (lib/rest-alert.js cues): the end of the
 * current fixed step at `at`, then the next fixed ones, as `{ at, title, cues: [{ dt, title }] }`.
 * Stops at an open step (a reps station of a circuit), where only a tap moves on. AMRAP with an
 * open station: just the cap. null when nothing is fixed. `words` names the steps (i18n lives
 * in the caller): { work(name, step), rest(name, step), end() }.
 */
export function lockCues(run, words, nameOf, max = 16) {
  if (!run || run.ended || run.paused != null) return null
  const end = stepEndsAt(run)
  if (end == null) return run.capEndsAt ? { at: run.capEndsAt, title: words.end(), cues: [] } : null
  if (run.capEndsAt && run.capEndsAt <= end) return { at: run.capEndsAt, title: words.end(), cues: [] }
  const titleFor = i => {
    const s = stepAt(run.cfg, run.stations, i)
    if (!s) return words.end()
    const nm = nameOf(run.stations[s.m]?.id)
    return s.k === 'work' ? words.work(nm, s) : words.rest(nm, s)
  }
  const cues = []
  let t = end, i = run.i + 1
  while (cues.length < max) {
    const s = stepAt(run.cfg, run.stations, i)
    if (!s || s.sec == null) break
    const next = t + s.sec * 1000
    if (run.capEndsAt && next >= run.capEndsAt) { cues.push({ dt: run.capEndsAt - end, title: words.end() }); break }
    i += 1
    cues.push({ dt: next - end, title: titleFor(i) })
    t = next
    if (!stepAt(run.cfg, run.stations, i)) break
  }
  return { at: end, title: titleFor(run.i + 1), cues }
}

/**
 * The run's clock for the Lock Screen, the watch and the phone's notification, which know a rest
 * and a hold: `{ kind: 'rest' | 'hold', endsAt, total, left, paused }`, or null (no run, or an open
 * station with nothing to count down). Get ready and rests are a rest; a timed work step (an
 * interval, a timed station) a hold; an open AMRAP station counts down the cap.
 */
export function circuitClock(run, now = Date.now()) {
  if (!run || run.ended) return null
  const step = runStep(run)
  if (!step) return null
  let end = stepEndsAt(run), total = step.sec
  if (end == null && run.capEndsAt) { end = run.capEndsAt; total = run.cfg.cap }
  if (end == null) return null
  const restLike = step.k !== 'work' || (step.emom && run.split)
  const paused = run.paused != null
  return { kind: restLike ? 'rest' : 'hold', endsAt: end, total, left: Math.max(1, Math.ceil((end - (paused ? run.paused : now)) / 1000)), paused }
}
