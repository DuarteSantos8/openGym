// A workout typed out the way it sits in a notes app, one exercise per line:
//
//   Bench press 60x8, 60x8, 62.5x6
//   Squat 100kg 5x5
//   Dumbbell curl 12 kg: 12, 12, 10
//   Plank 3x60s
//   Treadmill 20 min 3 km
//
// Three steps, each pure so the sheet (components/TypedWorkoutSheet.jsx) can show every line as it
// was read before anything is saved:
//   readTypedWorkout(text)        the lines: a name, the sets, the words left over, what was unread
//   matchTypedName(S, name)       the exercise a typed name stands for
//   typedWorkoutInput(S, lines)   one row per line (exercise, sets, or the reason it cannot be
//                                 saved) and the description lib/log-workout.js turns into the
//                                 workout, the same path as the MCP log_workout tool, so limits,
//                                 PR badges, duplicates and backfill behave the same.
//
// Numbers and units read the same in every app language (decimal commas included); the name goes
// through the library search, which knows the translated names and your own other names.
import { allExercises, searchExercises, everydayScore, isCardio, isHold, EXIDX, canonicalExId } from './exercises.js'
import { exerciseCandidates } from './import-csv.js'
import { aliasMatches, nameKey } from './import-choices.js'
import { LOG_LIMITS } from './log-workout.js'
import { speedUnitOf, KMH_PER_MPH } from './speed.js'

export const TYPED_MAX_CHARS = 4000
const LB_TO_KG = 0.45359237

// What a number can carry right after it. Longest first, so "sets" is not "s" plus "ets".
const UNITS = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  rep: 'reps', reps: 'reps', r: 'reps', wdh: 'reps', rip: 'reps',
  set: 'sets', sets: 'sets', satz: 'sets', sätze: 'sets', serie: 'sets', series: 'sets', séries: 'sets',
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's', sek: 's', seg: 's',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min', minuten: 'min', minutos: 'min',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  km: 'km', kms: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  mi: 'mi', mile: 'mi', miles: 'mi',
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
}
const UNIT_ALT = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|')
// A number and maybe its unit (never followed by a letter, except the "x" of "60kgx8"), the "x",
// "@", a separator between groups of sets, a word, and last any other sign, so nothing typed
// passes unseen: "60x8-10" is not quietly 60x8.
const TOKEN = new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_ALT}))?(?!(?!x)\\p{L})|(x)(?!(?!x)\\p{L})|(@)|([,/|+])|(\\p{L}+)|(\\S)`, 'gu')
// Signs that only set numbers apart: "12 kg: 12, 12", "(60x8)".
// A dash is not one of them: "60x8-10" is a range, not 60x8 and a set of 10.
const QUIET = new Set([':', '(', ')', '.', '!', '?', '"', "'", '='])
// Words that glue numbers together without meaning anything themselves.
const FILLER = new Set(['of', 'and', 'then', 'with', 'for', 'by', 'each', 'per', 'side', 'total', 'à', 'a', 'de', 'mit', 'je', 'und'])
const BODYWEIGHT = new Set(['bw', 'bodyweight'])
const EFFORT_WORDS = new Set(['rpe', 'rir'])

const LIST_MARK = /^\s*(?:[-*•·–]+|\d{1,2}[.)])\s+/

/** A line's name and the text after it, a list marker ("- ", "2. ") taken off. */
export function splitTypedLine(line) {
  const text = String(line || '').replace(LIST_MARK, '').trim()
  // The sets start at the first number, or at a body-weight word ("Dips bw x 12").
  const m = /\d|(?:^|\s)(?:bw|body ?weight)\b/i.exec(text)
  const at = m ? m.index : -1
  const name = (at < 0 ? text : text.slice(0, at)).replace(/[\s:,;=–—-]+$/, '').trim()
  return { name, rest: at < 0 ? '' : text.slice(at).trim() }
}

// "62,5x6", "22,5 kg", "@ 22,5", "1,5 km" are decimals. "12,12,10" and "60x8, 60x8" are groups:
// a comma between digits is a decimal only with one or two digits after it and then a unit or
// the "x", or straight after an "@".
const DEC_UNIT = '(?:kg|kilo|lb|pound|x|km|mi|min|s\\b|sec)'
function normalize(rest) {
  return rest.toLowerCase()
    .replace(/body ?weight/g, 'bodyweight')
    .replace(/[×✕*]/g, 'x')
    .replace(new RegExp(`(\\d),(\\d{1,2})(?=\\s*${DEC_UNIT})`, 'g'), '$1.$2')
    .replace(/(@\s*\d+),(\d{1,2})(?!\d)/g, '$1.$2')
    // A clock time is seconds: "1:30" a minute and a half, "25:00" twenty-five minutes.
    .replace(/(\d{1,3}):([0-5]\d)(?!\d)/g, (_, m, s) => `${Number(m) * 60 + Number(s)}s`)
}

function tokenize(rest) {
  const out = []
  for (const m of normalize(rest).matchAll(TOKEN)) {
    if (m[1] != null) {
      const v = Number(m[1])
      const u = m[2] ? UNITS[m[2]] : null
      out.push(u === 'h' ? { t: 'num', v: v * 60, u: 'min' } : u === 'm' ? { t: 'num', v: v / 1000, u: 'km' } : { t: 'num', v, u })
    } else if (m[3]) out.push({ t: 'x' })
    else if (m[4]) out.push({ t: '@' })
    else if (m[5]) out.push({ t: 'sep' })
    else if (m[6] != null) {
      const w = m[6]
      if (w === 'at') out.push({ t: '@' })
      else if (BODYWEIGHT.has(w)) out.push({ t: 'bw' })
      else if (EFFORT_WORDS.has(w)) out.push({ t: 'effort', k: w })
      else if (!FILLER.has(w)) out.push({ t: 'word', w })
    } else if (!QUIET.has(m[7])) out.push({ t: 'sym', c: m[7] })
  }
  return out
}

const isNum = (k, ...units) => k?.t === 'num' && units.includes(k.u)
const isCount = k => isNum(k, null, 'reps', 'sets') && Number.isInteger(k.v)
const isPlain = k => isNum(k, null)
const isLoad = k => k?.t === 'bw' || isNum(k, null, 'kg', 'lb')
const isUnitLoad = k => k?.t === 'bw' || isNum(k, 'kg', 'lb')
const isTime = k => isNum(k, 's', 'min')
const loadOf = k => (k.t === 'bw' ? { w: 0, bw: true } : { w: k.v, u: k.u })
const timeOf = k => (k.u === 's' ? { sec: k.v } : { min: k.v })
// One past the limit at most: enough for the line to say it is too many, never a silent cut.
const times = (n, set) => Array.from({ length: Math.max(0, Math.min(n, LOG_LIMITS.maxSets + 1)) }, () => ({ ...set }))

// "AxB", both counts: which is the number of sets. Marked ones say so ("3 sets x 10",
// "10 reps x 3"); otherwise sets come first ("5x5", "3x12").
function setsReps(a, b) {
  if (a.u === 'reps' || b.u === 'sets') return [b.v, a.v]
  return [a.v, b.v]
}

// The patterns, tried at token `i`, longest first; each says how many tokens it took. `ctx`
// carries what the line said earlier: a weight given on its own ("12 kg: 12, 12, 10"), and
// whether the line reads as several "weight x reps" sets ("60x8, 60x8, 62.5x6").
function readAt(k, i, ctx) {
  const [a, b, c, d, e] = [k[i], k[i + 1], k[i + 2], k[i + 3], k[i + 4]]
  const x = t => t?.t === 'x'
  // 60x8x3, 50kg x 12 x 3: weight x reps x sets. 3x8x60kg: sets x reps x weight.
  if (isLoad(a) && x(b) && isCount(c) && x(d) && e) {
    if (isPlain(a) && Number.isInteger(a.v) && (isUnitLoad(e) || (isPlain(e) && a.v <= 10 && e.v > 10))) return { n: 5, sets: times(a.v, { ...loadOf(e), reps: c.v }) }
    if (isCount(e)) return { n: 5, sets: times(e.v, { ...loadOf(a), reps: c.v }) }
  }
  // 3x8 @ 60, 3x8 60kg, 3 x 10 bw: sets x reps at a weight
  if (isCount(a) && x(b) && isCount(c)) {
    if (d?.t === '@' && isLoad(e)) { const [s, r] = setsReps(a, c); return { n: 5, sets: times(s, { ...loadOf(e), reps: r }) } }
    // A plain number with no number after it is the weight too: "Squat 5x5 100 felt heavy".
    if (isUnitLoad(d) || (isPlain(d) && !ctx.list && !k.slice(i + 4).some(t => t.t === 'num' || t.t === 'x'))) { const [s, r] = setsReps(a, c); return { n: 4, sets: times(s, { ...loadOf(d), reps: r }) } }
  }
  // 100kg 5x5, 100 5x5, bw 3x10: a weight, then sets x reps
  if (isLoad(a) && isCount(b) && x(c) && isCount(d) && !x(e) && !isUnitLoad(e)) {
    const [s, r] = setsReps(b, d)
    return { n: 4, sets: times(s, { ...loadOf(a), reps: r }) }
  }
  // 3x60s, 3 x 1:30, 60s x 3, 3x2min: timed sets
  if (isCount(a) && x(b) && isTime(c)) return { n: 3, sets: times(a.v, timeOf(c)) }
  if (isTime(a) && x(b) && isCount(c)) return { n: 3, sets: times(c.v, timeOf(a)) }
  if (x(b) && isCount(c)) {
    // 60kg x 8, bw x 12; 60kg x 3 sets says the sets and leaves the reps out
    if (isUnitLoad(a)) return { n: 3, sets: c.u === 'sets' ? times(c.v, { ...loadOf(a), reps: null }) : [{ ...loadOf(a), reps: c.v }] }
    if (isNum(a, null, 'reps', 'sets')) {
      // Marked ("3 sets x 10"), or a weight said earlier on the line ("100kg: 5x5"): sets x reps.
      if (Number.isInteger(a.v) && (a.u || c.u || ctx.carry)) {
        const [s, r] = setsReps(a, c)
        ctx.carryUsed = true
        return { n: 3, sets: times(s, { ...(ctx.carry || {}), reps: r }) }
      }
      // Bare: 5x5 and 3x12 on their own are sets x reps (a body-weight lift, or the weight is
      // somewhere else on the line); 60x8 and 12.5x10, or any "AxB" in a list of them, a weight
      // and its reps. A set count is a whole number of ten or less.
      const sets = Number.isInteger(a.v) && a.v <= 10 && !ctx.list
      return { n: 3, sets: sets ? times(a.v, { reps: c.v }) : [{ w: a.v, u: null, reps: c.v }] }
    }
  }
  // 8 @ 60: one set at a weight
  if (isCount(a) && b?.t === '@' && isLoad(c)) return { n: 3, sets: [{ ...loadOf(c), reps: a.v, at: true }] }
  // @ 60 on its own: the weight of the line's sets that have none
  if (a?.t === '@' && isLoad(b)) { ctx.at = loadOf(b); return { n: 2, sets: [] } }
  // 3 sets of 10, 3 sets 10 reps
  if (isNum(a, 'sets') && Number.isInteger(a.v) && isNum(b, null, 'reps') && Number.isInteger(b.v)) {
    ctx.carryUsed = true
    return { n: 2, sets: times(a.v, { ...(ctx.carry || {}), reps: b.v }) }
  }
  // rpe 8, rir 2: the effort of the sets just read
  if (a?.t === 'effort' && isPlain(b)) return { n: 2, sets: [], effort: { [a.k]: b.v } }
  // 20 min 3 km, 3 km 20 min, 25:00 5 km: a stretch of cardio
  if (isTime(a) && isNum(b, 'km', 'mi')) return { n: 2, sets: [{ ...timeOf(a), dist: b.v, du: b.u }] }
  if (isNum(a, 'km', 'mi') && isTime(b)) return { n: 2, sets: [{ ...timeOf(b), dist: a.v, du: a.u }] }
  if (isNum(a, 'km', 'mi')) return { n: 1, sets: [{ dist: a.v, du: a.u }] }
  if (isTime(a)) return { n: 1, sets: [timeOf(a)] }
  // 60kg or bw on its own: the weight of the reps that follow
  if (isUnitLoad(a)) { const left = unusedCarry(ctx); ctx.carry = loadOf(a); ctx.carryUsed = false; return { n: 1, sets: left } }
  // 3 sets: that many, reps still to say
  if (isNum(a, 'sets') && Number.isInteger(a.v)) { ctx.carryUsed = true; return { n: 1, sets: times(a.v, { ...(ctx.carry || {}), reps: null }) } }
  // 12, 12 reps: one set, at the weight said before it
  if (isNum(a, null, 'reps') && Number.isInteger(a.v)) { ctx.carryUsed = true; return { n: 1, sets: [{ ...(ctx.carry || {}), reps: a.v }] } }
  return null
}

// A weight no reps took ("bench 60kg x 8, 80kg") is a set still missing its reps, so the sheet
// asks for them instead of the weight vanishing.
function unusedCarry(ctx) {
  const left = ctx.carry && !ctx.carryUsed ? [{ ...ctx.carry, reps: null }] : []
  ctx.carryUsed = true
  return left
}

/** One typed line as { line, name, sets, words, unread }. */
export function readTypedLine(line) {
  const { name, rest } = splitTypedLine(line)
  const k = tokenize(rest)
  const sets = [], words = [], unread = []
  // Several "AxB" groups on one line are weight x reps each, never sets x reps.
  const groups = k.filter(t => t.t === 'x').length
  const ctx = { carry: null, carryUsed: true, at: null, list: groups > 1 && k.some(t => t.t === 'sep') }
  // Two plain numbers and nothing else ("Curl 15 12") are a weight and its reps.
  if (k.length === 2 && isPlain(k[0]) && isPlain(k[1]) && Number.isInteger(k[1].v)) {
    return { line, name, sets: [{ w: k[0].v, u: null, reps: k[1].v }], words, unread }
  }
  let group = 0 // where the current group's sets start, for an effort said after them
  for (let i = 0; i < k.length;) {
    if (k[i].t === 'sep') { group = sets.length; i++; continue }
    const hit = readAt(k, i, ctx)
    if (!hit) {
      const tok = k[i]
      if (tok.t === 'word') words.push(tok.w)
      else unread.push(tok.t === 'sym' ? tok.c : tok.t === 'num' ? String(tok.v) : tok.t === 'effort' ? tok.k : tok.t)
      i++
      continue
    }
    if (hit.effort) {
      const target = sets.length > group ? sets.slice(group) : sets.slice(-1)
      if (!target.length) unread.push(Object.keys(hit.effort)[0])
      target.forEach(s => Object.assign(s, hit.effort))
    }
    sets.push(...hit.sets)
    i += hit.n
  }
  sets.push(...unusedCarry(ctx))
  // "8, 8, 6 @ 60": a weight given with "@" covers the sets before it that have none, and an
  // "@ 60" on its own every set of the line that has none.
  let at = ctx.at
  for (let j = sets.length - 1; j >= 0; j--) {
    const s = sets[j]
    if (s.at) { at = { w: s.w, u: s.u, ...(s.bw ? { bw: true } : {}) }; delete s.at }
    else if (s.w == null && s.dist == null && at) Object.assign(s, at)
  }
  return { line, name, sets: sets.slice(0, LOG_LIMITS.maxSets + 1), words, unread }
}

/** Every non-empty line of `text` (new lines or ";" between exercises), at most one past the limit. */
export function readTypedWorkout(text) {
  return String(text || '').slice(0, TYPED_MAX_CHARS).split(/[\n;]+/).map(s => s.trim()).filter(Boolean)
    .slice(0, LOG_LIMITS.maxExercises + 1).map(readTypedLine)
}

const ownOf = (S, id) => (S?.customEx || []).find(c => c?.id === id) || null
const exists = (S, id) => !!id && (!!EXIDX[id] || !!ownOf(S, id))
const exOf = (S, id) => ownOf(S, id) || EXIDX[id] || null

// The library search is the slow part, and the same names come back on every key: one cache per
// profile object (a new S, a new exercise or alias, starts over).
const MATCHES = new WeakMap()

/**
 * The exercise a typed name stands for, in this order:
 *  1. one of your own names for it, exactly: an other name (exAliases, an own exercise's
 *     aliases) or your own exercise's name;
 *  2. of the exercises the name could be, one you have trained, so "bench" is the bench press
 *     you always log and not the one the catalogue lists first;
 *  3. the catalogue's own answer for a gym name, as an import and the MCP log_workout read it
 *     (import-csv exerciseCandidates: "dips" is the triceps dip), when it is a curated alias or
 *     the exact name;
 *  4. the library search's hits, which know typos, shorthand and translated names: of its first
 *     few, the most everyday one, so "bench" is the bench press and not the bench dip.
 * `options`: the next likeliest few, for a quick change in the sheet.
 */
export function matchTypedName(S, name) {
  const key = nameKey(name)
  if (!key) return { id: null, options: [] }
  let cache = S && typeof S === 'object' ? MATCHES.get(S) : null
  if (S && typeof S === 'object' && !cache) MATCHES.set(S, cache = new Map())
  if (cache?.has(key)) return cache.get(key)
  const done = r => { cache?.set(key, r); return r }
  const mine = aliasMatches(S).get(key)
  if (exists(S, mine)) return done({ id: mine, options: [] })
  const own = (S?.customEx || []).filter(c => c?.id && nameKey(c.n) === key)
  if (own.length === 1) return done({ id: own[0].id, options: [] })
  const named = exerciseCandidates(name)
  const found = searchExercises(allExercises(S), name).slice(0, 12).map(e => e.id)
  const close = [...(named.id ? [named.id] : []), ...(named.kind === 'none' ? [] : named.candidates || [])]
  const pool = [...new Set([...close, ...found].map(canonicalExId))].filter(id => exists(S, id))
  if (!pool.length) return done({ id: null, options: (named.candidates || []).filter(id => exists(S, id)).slice(0, 4) })
  const trained = new Set((S?.workouts || []).flatMap(w => (w?.entries || []).map(e => e?.id)))
  const everyday = found.slice(0, 5).map(canonicalExId).filter(id => exists(S, id))
    .reduce((best, id) => (best == null || everydayScore(exOf(S, id)) > everydayScore(exOf(S, best)) ? id : best), null)
  // A curated alias or the exact name beats the search; a near match ("bench" is "bench dip" with
  // one word missing) does not, the search's everyday hit reads a gym name better.
  const sure = named.kind === 'alias' || named.kind === 'exact' ? named.id : null
  const id = pool.find(p => trained.has(p)) || sure || everyday || named.id || pool[0]
  return done({ id, options: pool.filter(p => p !== id).slice(0, 4) })
}

const round1 = v => Math.round(v * 10) / 10
const round2 = v => Math.round(v * 100) / 100

/**
 * The read lines as rows for the sheet and as the input of buildLoggedWorkout, against profile
 * `S`. `picks` maps a typed name (nameKey) to the exercise chosen for it in the sheet, over the
 * match: kept by name, so it follows its line while lines above it come and go.
 *
 * Each row: { name, line, id, options, sets, note, unread, problem }. `problem` says why a line
 * cannot be saved: 'name' (no name before the numbers), 'match' (no exercise found), 'unread' (a
 * number or sign it could not place), 'sets' (no sets), 'reps' (a set without its reps), 'time'
 * (cardio without its minutes), 'cardio' (cardio given reps or a weight), 'mixed' (timed and
 * counted sets, or a distance, on a lift) or 'limit' (more than a set or a workout holds).
 * `ready` once there is a row and none has a problem.
 */
export function typedWorkoutInput(S, lines, { picks = {} } = {}) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const speedUnit = speedUnitOf(S)
  const distUnit = speedUnit === 'mph' ? 'mi' : 'km'
  const toUnit = (w, u) => (!u || u === unit ? w : round1(u === 'lb' ? w * LB_TO_KG : w / LB_TO_KG))
  const toDist = (d, u) => { const km = u === 'mi' ? d * KMH_PER_MPH : d; return round2(distUnit === 'mi' ? km / KMH_PER_MPH : km) }
  const rows = lines.map((l, i) => {
    const key = nameKey(l.name)
    const picked = key && Object.hasOwn(picks, key) && exists(S, picks[key]) ? picks[key] : null
    const hit = picked ? { id: picked, options: [] } : matchTypedName(S, l.name)
    const row = { name: l.name, line: l.line, id: hit.id, options: hit.options, sets: null, note: (l.words || []).join(' ').slice(0, 280), unread: l.unread || [], problem: null }
    const fail = problem => ({ ...row, problem })
    if (i >= LOG_LIMITS.maxExercises || l.sets.length > LOG_LIMITS.maxSets) return fail('limit')
    if (!l.name) return fail('name')
    if (!hit.id) return fail('match')
    if (row.unread.length) return fail('unread')
    if (!l.sets.length) return fail('sets')
    const ex = exOf(S, hit.id)
    if (isCardio(ex)) {
      if (l.sets.some(s => s.reps !== undefined || s.w != null)) return fail('cardio')
      if (l.sets.some(s => s.min == null && s.sec == null)) return fail('time')
      const sets = l.sets.map(s => ({
        minutes: Math.max(1, Math.round(s.min != null ? s.min : s.sec / 60)),
        ...(s.dist != null ? { distance: toDist(s.dist, s.du) } : {}),
        ...(s.rpe != null ? { rpe: s.rpe } : {}),
      }))
      if (sets.some(s => s.minutes > LOG_LIMITS.maxCardioMin)) return fail('limit')
      return { ...row, sets, mode: 'cardio' }
    }
    if (l.sets.some(s => s.dist != null)) return fail('mixed')
    // A hold (a plank) counts seconds: "Plank 3x60" is three minutes of plank, not 60 reps.
    const hold = isHold(ex) && l.sets.every(s => s.min == null && s.sec == null && s.reps != null)
    const timed = l.sets.map(s => hold || s.min != null || s.sec != null)
    if (timed.some(Boolean) && !timed.every(Boolean)) return fail('mixed')
    if (!timed[0] && l.sets.some(s => s.reps == null)) return fail('reps')
    const sets = l.sets.map(s => {
      const out = timed[0] ? { seconds: hold ? s.reps : s.sec != null ? s.sec : s.min * 60 } : { reps: s.reps }
      if (s.w != null) out.weight = toUnit(s.w, s.u)
      if (s.rir != null && !timed[0]) out.rir = s.rir
      else if (s.rpe != null && !timed[0]) out.rpe = s.rpe
      if (s.bw) out.bw = true
      return out
    })
    const bad = sets.some(s => (s.reps != null && (s.reps < 1 || s.reps > LOG_LIMITS.maxReps))
      || (s.seconds != null && (s.seconds < 1 || s.seconds > LOG_LIMITS.maxSec))
      || (s.weight != null && (unit === 'lb' ? s.weight * LB_TO_KG : s.weight) > LOG_LIMITS.maxKg))
    if (bad) return fail('limit')
    return { ...row, sets, mode: timed[0] ? 'time' : 'reps' }
  })
  const ready = rows.length > 0 && rows.every(r => !r.problem)
  const exercises = rows.filter(r => !r.problem).map(r => ({
    exercise: r.id,
    // `bw` is the sheet's to show; the saved set is a weight of 0, as a body-weight set always is.
    sets: r.sets.map(({ bw, ...s }) => s),
    ...(r.note ? { note: r.note } : {}),
  }))
  return { rows, ready, input: { unit, speedUnit, exercises } }
}
