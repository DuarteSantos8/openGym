// A workout typed the way people write it in a notes app, one exercise per line:
//
//   Bench press 60x8, 60x8, 62.5x6
//   Squat 100kg 5x5
//   Dumbbell curl 12 kg: 12, 12, 10
//   Pull-ups 3x8
//   Plank 3x60s
//   Treadmill 20 min 3 km
//
// read into the description lib/log-workout.js turns into a saved workout, so a typed session gets
// the same exercise resolution, limits, PR badges and backfill rules as one logged by the MCP
// server's log_workout tool. Nothing here guesses silently: every line comes back with the
// exercise it was matched to, the sets it was read as and whatever could not be read, for the
// sheet to show before anything is saved.
//
// The numbers and units are read the same in every app language; the exercise name goes through
// the library search, which knows the translated names and the user's own aliases.
import { allExercises, searchExercises, isCardio, EXIDX } from './exercises.js'
import { speedUnitOf, KMH_PER_MPH } from './speed.js'
import { LOG_LIMITS } from './log-workout.js'
import { exerciseCandidates } from './import-csv.js'

const LB_TO_KG = 0.45359237
export const QUICK_LOG_MAX = 4000

// The words a number can carry, longest first so "sets" is not read as "s" + "ets".
const UNIT_WORDS = {
  kilograms: 'kg', kilogram: 'kg', kilos: 'kg', kilo: 'kg', kgs: 'kg', kg: 'kg',
  pounds: 'lb', pound: 'lb', lbs: 'lb', lb: 'lb',
  reps: 'r', rep: 'r',
  sets: 's', set: 's', rounds: 's', round: 's',
  seconds: 't', second: 't', secs: 't', sec: 't', s: 't',
  minutes: 'm', minute: 'm', mins: 'm', min: 'm',
  kilometers: 'km', kilometer: 'km', kilometres: 'km', kilometre: 'km', kms: 'km', km: 'km',
  miles: 'mi', mile: 'mi', mi: 'mi',
}
const UNIT_RE = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|')
// A number, then maybe its unit. Not followed by a letter, except the "x" of "60x8". A word, and
// last any other character, so nothing in the line goes by unseen ("60x8-10" is not 60x8 and 10).
const TOKEN = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})?(?![a-wyz])|(x)(?![a-wyz])|(@)|(\\p{L}+)|(\\S)`, 'gu')
// Punctuation that only sets numbers apart, as in "12 kg: 12, 12" or "(60x8)".
const QUIET = new Set([':', '(', ')', '.', '!', '?', '"', "'"])
// Words that join numbers without meaning anything themselves: "3 sets of 10", "8 and 6".
const FILLER = new Set(['of', 'by', 'and', 'then', 'in', 'with', 'for', 'each', 'total'])
const BODYWEIGHT = new Set(['bw', 'bodyweight'])

const num = s => Number(s)
const isInt = v => Number.isInteger(v)

/** One line's exercise name and the text after it, with a list marker ("- ", "1. ") taken off. */
export function splitLine(line) {
  const text = String(line || '').replace(/^\s*(?:[-*•·]+|\d+[.)])\s+/, '').trim()
  const at = text.search(/\d/)
  let label = (at < 0 ? text : text.slice(0, at)).replace(/[\s:,=–—-]+$/, '').trim()
  let rest = at < 0 ? '' : text.slice(at)
  // "Dips bw x 12": the body-weight word before the first number is a load, not part of the name.
  const bw = label.match(/\s+(bw|bodyweight)(\s*[x×*])?$/i)
  if (bw) { label = label.slice(0, bw.index).replace(/[\s:,=–—-]+$/, ''); rest = bw[0].trim() + ' ' + rest }
  return { label, rest }
}

// "22,5 kg", "22,5x8" and "@ 22,5" are decimals; "12,12,10" is three groups. A comma between
// digits is a decimal only when one or two digits follow and then a weight unit or the "x", or
// when the number comes straight after an "@".
const decimalCommas = s => s
  .replace(/(\d),(\d{1,2})(?=\s*(?:kg|kilo|lb|pound|x|\*|×))/g, '$1.$2')
  .replace(/(@\s*\d+),(\d{1,2})(?!\d)/g, '$1.$2')

function tokens(group) {
  const out = []
  const s = group.replace(/[×*]/g, 'x').replace(/(\d{1,2}):([0-5]\d)/g, (_, m, sec) => `${num(m) * 60 + num(sec)}s`)
  for (const m of s.matchAll(TOKEN)) {
    if (m[1] != null) {
      const kind = m[2] ? UNIT_WORDS[m[2]] : 'n'
      const tok = { v: num(m[1]), kind }
      if (kind === 'kg' || kind === 'lb') { tok.kind = 'w'; tok.u = kind }
      if (kind === 'km' || kind === 'mi') { tok.kind = 'd'; tok.u = kind }
      out.push(tok)
    } else if (m[3]) out.push({ kind: 'x' })
    else if (m[4]) out.push({ kind: '@' })
    else if (m[5] === 'at') out.push({ kind: '@' })
    else if (BODYWEIGHT.has(m[5])) out.push({ kind: 'w', v: 0, u: null })
    else if (m[5] != null) { if (!FILLER.has(m[5])) out.push({ kind: 'word', text: m[5] }) }
    else if (!QUIET.has(m[6])) out.push({ kind: 'sym', text: m[6] })
  }
  return out
}

const isWeight = t => t && (t.kind === 'w' || t.kind === 'n')
const isCount = t => t && (t.kind === 'n' || t.kind === 's' || t.kind === 'r') && isInt(t.v)
const weightOf = t => ({ weight: t.v, unit: t.u || null })
// One past the limit at most: enough for the line to say it is too many, never a silent cut.
const repeat = (n, set) => Array.from({ length: Math.min(n, LOG_LIMITS.maxSets + 1) }, () => ({ ...set }))
// The carried weight, marked as used by the set that takes it.
const carried = ctx => { ctx.carryUsed = true; return ctx.weight || {} }

// "AxB" with a weight already known for it: which number is the set count. Marked numbers say so
// themselves ("3 sets x 10", "10 reps x 3"); unmarked ones follow the usual sets-x-reps order
// ("5x5", "3x8") unless the first is too high for a set count and the second is not ("12x3").
function setsAndReps(a, b) {
  if (a.kind === 's' || b.kind === 'r') return [a.v, b.v]
  if (b.kind === 's' || a.kind === 'r') return [b.v, a.v]
  return a.v > 10 && b.v <= 10 ? [b.v, a.v] : [a.v, b.v]
}

// The sets a group's tokens stand for, read left to right; each rule says how many tokens it took.
// `ctx.weight` is the weight carried from earlier in the line ("12 kg: 12, 12, 10").
function readAt(t, i, ctx) {
  const [a, b, c, d, e] = [t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4]]
  // "60x8x3", "50kg x 12 x 3": weight x reps x sets
  if (isWeight(a) && b?.kind === 'x' && isCount(c) && d?.kind === 'x' && e) {
    // "3x8x60kg" the other way round: a set count first, and last a load (or one too heavy to be a count)
    if (a.kind === 'n' && isInt(a.v) && a.v <= 6 && isWeight(e) && (e.kind === 'w' || e.v > 20)) return { len: 5, sets: repeat(a.v, { ...weightOf(e), reps: c.v }) }
    if (isCount(e) && e.kind !== 'r') return { len: 5, sets: repeat(e.v, { ...weightOf(a), reps: c.v }) }
  }
  // "3x8 @ 60", "3 sets x 8 at 60kg", "3x8 60kg": sets x reps, then the weight
  if (isCount(a) && b?.kind === 'x' && isCount(c) && (d?.kind === '@' ? isWeight(e) : d?.kind === 'w')) {
    const w = d.kind === '@' ? e : d
    const [n, reps] = setsAndReps(a, c)
    return { len: d.kind === '@' ? 5 : 4, sets: repeat(n, { ...weightOf(w), reps, at: true }) }
  }
  // "5x5 100": a bare sets x reps, then a plain number that ends the group is its weight
  if (a?.kind === 'n' && isInt(a.v) && a.v <= 6 && b?.kind === 'x' && c?.kind === 'n' && isInt(c.v) && d?.kind === 'n' && !t[i + 4]) {
    return { len: 4, sets: repeat(a.v, { weight: d.v, unit: null, reps: c.v, at: true }) }
  }
  // "100 5x5", "100kg 3x8", "bw 3x10": the weight, then sets x reps
  if (isWeight(a) && isCount(b) && c?.kind === 'x' && isCount(d) && t[i + 4]?.kind !== 'x') {
    const [n, reps] = setsAndReps(b, d)
    return { len: 4, sets: repeat(n, { ...weightOf(a), reps }) }
  }
  // "3x60s", "60s x 3", "2 x 1:30": timed sets
  if (isCount(a) && b?.kind === 'x' && c?.kind === 't') return { len: 3, sets: repeat(a.v, { seconds: c.v }) }
  if (a?.kind === 't' && b?.kind === 'x' && isCount(c)) return { len: 3, sets: repeat(c.v, { seconds: a.v }) }
  if (isCount(a) && b?.kind === 'x' && c?.kind === 'm') return { len: 3, sets: repeat(a.v, { minutes: c.v }) }
  if (a && b?.kind === 'x' && c) {
    // "60kg x 8", "bw x 12": a weight and its reps; "60kg x 3 sets": the reps are missing
    if (a.kind === 'w' && isCount(c)) {
      return c.kind === 's' ? { len: 3, sets: repeat(c.v, { ...weightOf(a), reps: null }) } : { len: 3, sets: [{ ...weightOf(a), reps: c.v }] }
    }
    // "3 sets x 10", "10 reps x 3", or bare "3x10" with a weight carried from earlier in the line
    if (isCount(a) && isCount(c) && (a.kind !== 'n' || c.kind !== 'n' || ctx.weight)) {
      const [n, reps] = setsAndReps(a, c)
      return { len: 3, sets: repeat(n, { ...carried(ctx), reps }) }
    }
    // Bare "AxB": "3x12" and "5x5" are sets x reps (a body-weight exercise), "60x8" and "12.5x10"
    // are a weight x reps. A set count is a whole number of six or less.
    if (a.kind === 'n' && isCount(c) && c.kind === 'n') {
      return isInt(a.v) && a.v <= 6
        ? { len: 3, sets: repeat(a.v, { reps: c.v }) }
        : { len: 3, sets: [{ weight: a.v, unit: null, reps: c.v }] }
    }
  }
  // "8 @ 60": one set at a weight
  if (isCount(a) && b?.kind === '@' && isWeight(c)) return { len: 3, sets: [{ ...weightOf(c), reps: a.v, at: true }] }
  // "@ 60" on its own: the weight of the line's sets that have none
  if (a?.kind === '@' && isWeight(b)) return { len: 2, sets: [], fill: weightOf(b) }
  // "3 sets of 10"
  if (a?.kind === 's' && isInt(a.v) && b && (b.kind === 'n' || b.kind === 'r') && isInt(b.v)) {
    return { len: 2, sets: repeat(a.v, { ...carried(ctx), reps: b.v }) }
  }
  // "20 min 3 km", "3 km 20 min": a stretch of cardio
  if (a?.kind === 'm' && b?.kind === 'd') return { len: 2, sets: [{ minutes: a.v, distance: b.v, distanceUnit: b.u }] }
  if (a?.kind === 'd' && b?.kind === 'm') return { len: 2, sets: [{ minutes: b.v, distance: a.v, distanceUnit: a.u }] }
  if (a?.kind === 'm') return { len: 1, sets: [{ minutes: a.v }] }
  if (a?.kind === 't') return { len: 1, sets: [{ seconds: a.v }] }
  // "60kg" on its own: the weight for the reps that follow
  if (a?.kind === 'w') return { len: 1, sets: [], carry: weightOf(a) }
  // "3 sets": that many, reps still to say
  if (a?.kind === 's' && isInt(a.v)) return { len: 1, sets: repeat(a.v, { ...carried(ctx), reps: null }) }
  // "12", "12 reps": one set, at the carried weight if there is one
  if ((a?.kind === 'n' || a?.kind === 'r') && isInt(a.v)) return { len: 1, sets: [{ ...carried(ctx), reps: a.v }] }
  return null
}

// A weight given on its own that no reps took ("bench 60kg x 8, 80kg") is a set whose reps are
// missing, so the sheet asks for them instead of the weight vanishing.
function settleCarry(ctx, sets) {
  if (ctx.weight && !ctx.carryUsed) sets.push({ ...ctx.weight, reps: null })
  ctx.carryUsed = true
}

// Words left over are a note on the exercise ("squat 3x5 felt heavy"); a number or sign left over
// ("60x8-10") is unread, and the line cannot be saved until it reads.
function readGroup(group, ctx) {
  const t = tokens(group)
  const sets = [], words = [], unread = []
  // Two plain numbers and nothing else, "15 12", are a weight and its reps, unless a weight is
  // already carried: then "12 10" are two sets of reps at it.
  if (!ctx.weight && t.length === 2 && t[0].kind === 'n' && t[1].kind === 'n' && isInt(t[1].v)) {
    return { sets: [{ weight: t[0].v, unit: null, reps: t[1].v }], words, unread }
  }
  for (let i = 0; i < t.length;) {
    const hit = readAt(t, i, ctx)
    if (!hit) {
      const tok = t[i]
      if (tok.kind === 'word') words.push(tok.text)
      else unread.push(tok.kind === 'sym' ? tok.text : tok.kind === 'x' ? 'x' : tok.kind === '@' ? '@' : String(tok.v))
      i++
      continue
    }
    if (hit.carry) { settleCarry(ctx, sets); ctx.weight = hit.carry; ctx.carryUsed = false }
    if (hit.fill) ctx.fill = hit.fill
    sets.push(...hit.sets)
    i += hit.len
  }
  return { sets, words, unread }
}

/**
 * The lines of `text` as { label, sets, words, unread }. A set is
 * { weight?, unit?, reps? } for lifting, { seconds? | minutes?, weight? } for a timed one,
 * { minutes, distance?, distanceUnit? } for cardio; `unit` is 'kg', 'lb' or null (the profile's).
 * Lines split on new lines and ";", groups of sets on "," and "/".
 */
export function parseQuickLog(text) {
  const lines = String(text || '').slice(0, QUICK_LOG_MAX).split(/[\n;]+/).map(s => s.trim()).filter(Boolean)
  // One line past the limit at most, so the sheet can say there are too many.
  return lines.slice(0, LOG_LIMITS.maxExercises + 1).map(line => {
    const { label, rest } = splitLine(line)
    const ctx = { weight: null, carryUsed: false, fill: null }
    const sets = [], words = [], unread = []
    for (const group of decimalCommas(rest.toLowerCase()).split(/[,/|]+/)) {
      const r = readGroup(group, ctx)
      sets.push(...r.sets)
      words.push(...r.words)
      unread.push(...r.unread)
    }
    settleCarry(ctx, sets)
    // "8, 8, 6 @ 60": a weight given with "@" also covers the sets before it that have none.
    let at = ctx.fill
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i].at) at = { weight: sets[i].weight, unit: sets[i].unit }
      else if (sets[i].weight == null && at && sets[i].reps != null) Object.assign(sets[i], at)
      delete sets[i].at
    }
    return { line, label, sets: sets.slice(0, LOG_LIMITS.maxSets + 1), words, unread }
  })
}

const nameKey = s => String(s || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** The key a choice made in the sheet is kept under: the typed name, case and punctuation aside. */
export const pickKey = nameKey

/**
 * The exercise a typed name stands for, in this order:
 *  1. one of the user's own names for it, exactly: an alias, a custom exercise;
 *  2. of the exercises the name could be, one the user has trained before, so "bench" is the
 *     bench press they always log;
 *  3. the catalogue's own answer for a gym name ("dips" is the triceps dip, "shoulder press" the
 *     barbell one), the one an import and the MCP's log_workout give (import-csv exerciseCandidates);
 *  4. the library search's best hit, which knows typos, shorthand and the translated names.
 * `options` are the next likeliest, for a quick change in the sheet.
 */
export function matchExercise(S, label) {
  const key = nameKey(label)
  if (!key) return { id: null, options: [] }
  for (const [id, names] of Object.entries(S?.exAliases || {})) {
    if (Array.isArray(names) && names.some(n => nameKey(n) === key) && (EXIDX[id] || (S.customEx || []).some(c => c?.id === id))) return { id, options: [] }
  }
  const own = (S?.customEx || []).filter(c => c?.id && nameKey(c.n) === key)
  if (own.length === 1) return { id: own[0].id, options: [] }
  const named = exerciseCandidates(label)
  const found = searchExercises(allExercises(S), label).slice(0, 12).map(e => e.id)
  const known = [...new Set([...(named.id ? [named.id] : []), ...named.candidates, ...found])].filter(id => EXIDX[id] || (S?.customEx || []).some(c => c?.id === id))
  if (!known.length) return { id: null, options: [] }
  const trained = new Set((S?.workouts || []).flatMap(w => (w?.entries || []).map(e => e?.id)))
  const curated = named.kind === 'alias' || named.kind === 'exact'
    ? named.id || (named.candidates.includes(found[0]) ? found[0] : named.candidates[0])
    : null
  const pick = known.find(id => trained.has(id)) || curated || found[0]
  // Entries that only share a word with the name are offered, never picked.
  if (!pick) return { id: null, options: known.slice(0, 4) }
  return { id: pick, options: known.filter(id => id !== pick).slice(0, 4) }
}

const round1 = v => Math.round(v * 10) / 10
const cardioOf = (S, id) => isCardio(id) || (S?.customEx || []).some(c => c?.id === id && c.bp === 'cardio')

/**
 * The parsed lines as the input of buildLoggedWorkout, against profile `S`. `picks` holds the
 * exercise the user chose for a typed name (by pickKey), over the matched one: keyed by the name,
 * not the line, so it stays with its line while lines above it are added or removed. Words the
 * line had besides its sets become the exercise's note. Each row says what its line became
 * and, when it cannot be saved, why: 'match' (no exercise found), 'sets' (no sets read), 'reps'
 * (a set without its reps), 'cardio' (a cardio exercise given reps or weight instead of minutes),
 * 'mixed' (timed sets and rep sets on one exercise), 'unread' (a number or sign it could not
 * place) or 'limit' (more sets or exercises than a workout holds). `ready` once every row can be saved.
 */
export function quickLogInput(S, lines, { date, name, picks = {} } = {}) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const speedUnit = speedUnitOf(S)
  const distUnit = speedUnit === 'mph' ? 'mi' : 'km'
  const toUnit = (w, u) => (u && u !== unit ? round1(u === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) : w)
  const rows = lines.map((l, i) => {
    const picked = Object.hasOwn(picks, nameKey(l.label)) ? picks[nameKey(l.label)] : null
    const hit = picked ? { id: picked, options: [] } : matchExercise(S, l.label)
    const note = (l.words || []).join(' ').slice(0, 280)
    const row = { label: l.label, line: l.line, unread: l.unread, note, id: hit.id, options: hit.options, sets: null, problem: null }
    if (i >= LOG_LIMITS.maxExercises || l.sets.length > LOG_LIMITS.maxSets) return { ...row, problem: 'limit' }
    if (!hit.id) return { ...row, problem: 'match' }
    if (l.unread.length) return { ...row, problem: 'unread' }
    if (!l.sets.length) return { ...row, problem: 'sets' }
    if (cardioOf(S, hit.id)) {
      if (l.sets.some(s => s.reps != null || s.weight != null || (s.minutes == null && s.seconds == null))) return { ...row, problem: 'cardio' }
      row.sets = l.sets.map(s => {
        const out = { minutes: s.minutes != null ? Math.max(1, Math.round(s.minutes)) : Math.max(1, Math.round(s.seconds / 60)) }
        if (s.distance != null) {
          const km = s.distanceUnit === 'mi' ? s.distance * KMH_PER_MPH : s.distance
          out.distance = Math.round((distUnit === 'mi' ? km / KMH_PER_MPH : km) * 100) / 100
        }
        return out
      })
      return row
    }
    const timed = l.sets.map(s => s.seconds != null || s.minutes != null)
    if (timed.some(Boolean) && !timed.every(Boolean)) return { ...row, problem: 'mixed' }
    if (l.sets.some(s => s.distance != null)) return { ...row, problem: 'mixed' }
    if (!timed[0] && l.sets.some(s => !isInt(s.reps) || s.reps < 1)) return { ...row, problem: 'reps' }
    row.sets = l.sets.map(s => {
      const out = timed[0] ? { seconds: s.seconds != null ? s.seconds : s.minutes * 60 } : { reps: s.reps }
      if (s.weight != null) out.weight = toUnit(s.weight, s.unit)
      return out
    })
    return row
  })
  const ready = rows.length > 0 && rows.every(r => !r.problem)
  const input = {
    date, unit, speedUnit,
    ...(name ? { name } : {}),
    exercises: rows.filter(r => !r.problem).map(r => ({ exercise: r.id, sets: r.sets, ...(r.note ? { note: r.note } : {}) })),
  }
  return { rows, ready, input }
}
