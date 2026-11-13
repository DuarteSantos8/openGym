// Tap muscles, get a session (1.4.5, gm-builder). Pure: the muscles you picked on the body map
// (lib/muscle-filter.js terms), how long you have, and the profile decide; the same inputs and the
// same `seed` always give the same session, and Shuffle is just another seed.
//
// WHAT IT READS
//   equipment  the active gym or equipment profile, the bench (flat/adjustable/none), "I own no
//              dumbbells", the gym's machines and your own kit tags, all through lib/equipment.js
//              exAvailable, the same filter the library uses
//   recovery   lib/recovery.js fatigueOf: a picked muscle still above FATIGUE_RECOVERING_BELOW is
//              left out and said so; if every picked muscle is tired, they stay and a line says so
//   history    exercises you logged come first (how often, and not the very same as two days
//              ago), your favourites before them, then the everyday staples (lib/exercises.js)
//   sets/reps  a compound lift 3 × 8 with 2 minutes rest, isolation work 3 × 12 with 75 s, a hold
//              3 × 30 s; the count of exercises grows until the estimate fills the minutes asked
//
// WHAT IT GIVES BACK
//   { picks: [{ id, cfg, muscles, why: [[key, ...args]], compound }], minutes, tired, allTired,
//     profileName, muscles }
// `why` entries are i18n keys with their arguments, so the sheet says "You did it 6 times", "One
// of your favourites", "Fits Home gym" in the reader's language (components/SessionBuilder.jsx).
// `cfg` is a routine entry ({ id, sets, reps | sec, weight, mode, restSec }), so the session can
// be started at once or saved as a routine.
import { allExercises, everydayScore, isClassicEx, isCardio, isHold, isBodyweightEq, isLoadedEq, isCustomEx } from './exercises.js'
import { musclesOf, MUSCLE_NAME } from './muscles.js'
import { shownMuscles } from './muscle-filter.js'
import { activeProfile, exAvailable } from './equipment.js'
import { fatigueOf, LB_TO_KG } from './recovery.js'
import { FATIGUE_RECOVERING_BELOW } from './recovery-view.js'
import { favIds } from './favourites.js'
import { defaultConfig, lastBW } from './history.js'
import { activityStimuli } from './activities.js'

export const DURATIONS = [20, 40, 60]
export const MAX_PICKS = 9
const DAY = 86400000

// Not working sets: stretches, mobility, drills and the catalogue's "form check" clips.
const NOT_A_LIFT = /stretch|mobility|mobilization|\bpose\b|toe touch|\broll(er)?\b|circles|warm-?up|form check|massage|release|isometric squeeze|breathing/i
const OK_CAT = new Set(['strength', 'calisthenics', 'isometric'])
// A hold is only offered for the core, where a plank is a fine pick; elsewhere it is filler.
const CORE = new Set(['abs', 'obliques'])

// A tiny seeded generator (xorshift), so a shuffle is reproducible.
function rng (seed) {
  let x = (Number(seed) >>> 0) || 0x9e3779b9
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

// Name words that are not the movement, so "barbell bench press" and "dumbbell bench press" read
// as one movement and a session never gets both.
const KIT = /\b(barbell|dumbbells?|cable|lever(age)?|machine|smith|band|kettlebell|ez|body ?weight|weighted|sled|assisted|seated|standing|lying|close[- ]grip|wide[- ]grip|v\.? ?\d|\(.*?\))\b/gi
const movementOf = e => String(e?.n || '').toLowerCase().replace(KIT, ' ').replace(/\s+/g, ' ').trim()

/** How often each exercise was logged, and the last day it was. */
function historyOf (S) {
  const count = {}, last = {}
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    for (const e of w?.entries || []) {
      if (!e?.id || !(e.sets || []).some(s => s?.done)) continue
      count[e.id] = (count[e.id] || 0) + 1
      if (!last[e.id] || w.d > last[e.id]) last[e.id] = w.d
    }
  }
  return { count, last }
}

// Muscles a group stands for but that do not get a slot of their own when only the group was
// tapped ("Legs" is squats, hinges and calves, not a hip-flexor drill). Tapped by name, they do.
const MINOR = new Set(['hip-flexors', 'tibialis', 'adductors', 'serratus', 'forearm'])
// The big multi-joint movements, by name: they go first, take longer rests and fewer reps.
const COMPOUND = /press|row\b|rows\b|squat|deadlift|lunge|pull-?ups?|chin-?ups?|\bdips?\b|thrust|clean|snatch|push-?ups?|pulldown|step-?up|good morning|swing/i
// Variants the catalogue keeps for completeness: a second take ("v. 2"), one on a ball, a single
// arm of a lift that has a two-arm version. Fine when you logged them, a step back otherwise.
const ODD = /\bv\. ?\d|\bpov\b|side lying|exercise ball|stability ball|swiss ball|bosu|\bone arm\b|\bsingle arm\b|palm up|palm down|iron cross|on knees|\(male\)|kneeling/i
const NEEDS_BALL = /exercise ball|stability ball|swiss ball|bosu/i
// At most this many exercises with the same main muscle; past it, sets go up instead. A big
// muscle gets three, a small one two, and a muscle tapped on its own four.
const BIG = new Set(['chest', 'lats', 'upper-back', 'quadriceps', 'gluteal', 'hamstring'])
export const capOf = (m, alone) => (alone ? 4 : BIG.has(m) ? 3 : 2)

/** The muscles the session is for: the filter's, minus the tired ones (unless that is all of them). */
export function targetMuscles (terms, fatigue = {}) {
  const named = new Set((terms || []).filter(x => typeof x === 'string' && !x.startsWith('group:')))
  const muscles = shownMuscles(terms).filter(m => named.has(m) || !MINOR.has(m))
  const tired = muscles.filter(m => (fatigue[m] || 0) >= FATIGUE_RECOVERING_BELOW)
  const fresh = muscles.filter(m => !tired.includes(m))
  return { muscles, tired, fresh: fresh.length ? fresh : muscles, allTired: muscles.length > 0 && !fresh.length }
}

/** The routine entry a pick starts with: compound, isolation or a hold. */
export function pickConfig (S, e, compound) {
  if (isHold(e)) return { ...defaultConfig(e.id, 'time'), id: e.id, sets: 3, sec: 30, restSec: 60 }
  const base = { ...defaultConfig(e.id, 'reps'), id: e.id }
  const loaded = isLoadedEq(e)
  const reps = compound && loaded ? 8 : isBodyweightEq(e) ? 10 : 12
  return { ...base, sets: 3, reps, restSec: compound && loaded ? 120 : 75 }
}

/** The minutes a list of routine entries takes, roughly: work, rest and a minute and a half to set up each. */
export function estimateMinutes (cfgs) {
  let sec = 0
  for (const c of cfgs) {
    const sets = Math.max(1, c.sets || 1)
    const work = c.mode === 'time' ? (c.sec || 30) : Math.max(35, (c.reps || 10) * 4)
    sec += sets * work + (sets - 1) * (c.restSec || 90) + 90
  }
  return Math.round(sec / 60)
}

/**
 * The session for `terms` in about `minutes`. `seed` shuffles among close calls; `now` and
 * `today` keep it pure for tests. `exclude` holds ids to leave out (a pick swapped away).
 */
export function buildSession (S, { terms = [], minutes = 40, seed = 1, now = Date.now(), today = null, exclude = [] } = {}) {
  const bw = Array.isArray(S?.bodyweight) ? lastBW(S) : null
  const bodyweightKg = bw && bw.w > 0 ? (S.unit === 'lb' ? bw.w * LB_TO_KG : bw.w) : undefined
  let fatigue = {}
  try { fatigue = fatigueOf(S?.workouts || [], now, { bodyweightKg, unit: S?.unit, activities: activityStimuli(S, now) }) || {} } catch { fatigue = {} }
  const { muscles, tired, fresh, allTired } = targetMuscles(terms, fatigue)
  const profile = activeProfile(S)
  const out = { picks: [], minutes: 0, muscles, tired: allTired ? [] : tired, allTired, profileName: profile?.name || null }
  if (!fresh.length) return out
  const day = today || new Date(now).toISOString().slice(0, 10)
  const recentCut = new Date(Date.parse(day + 'T12:00:00Z') - 2 * DAY).toISOString().slice(0, 10)
  const { count, last } = historyOf(S)
  const favs = new Set(favIds(S))
  const skip = new Set(exclude)
  const tiredSet = new Set(allTired ? [] : tired)
  const eq = profile ? (profile.equipment || []) : []
  const hasBall = eq.includes('stability ball') || eq.includes('bosu ball')
  const rand = rng(seed)

  // Every exercise that can be done here and is a real working set for at least one target muscle.
  const pool = []
  for (const e of allExercises(S)) {
    if (!e || skip.has(e.id) || isCardio(e) || !exAvailable(S, e)) continue
    const custom = isCustomEx(e)
    const n = count[e.id] || 0
    const name = e.n || ''
    if (!custom && (!OK_CAT.has(e.cat) || NOT_A_LIFT.test(name) || /female/i.test(name))) continue
    if (!custom && !n && !hasBall && NEEDS_BALL.test(name)) continue
    // Dips need bars, which no profile can tick yet (the pull-up bar's tower usually has them):
    // without one, only the bench, chair and floor kinds. Your own logged dips always stay.
    if (!custom && !n && profile && !eq.includes('pull-up bar') && /\bdips?\b/i.test(name) && !/bench|chair|floor/i.test(name)) continue
    const w = musclesOf(e)
    const main = fresh.filter(m => w[m] >= 1)
    if (!main.length) continue
    if (isHold(e) && !main.some(m => CORE.has(m))) continue
    // A tired main muscle is out (unless every picked muscle is tired); a tired helper costs a bit.
    if (Object.keys(w).some(m => w[m] >= 1 && tiredSet.has(m))) continue
    const helpers = Object.keys(w).filter(m => w[m] > 0 && w[m] < 1 && tiredSet.has(m)).length
    const recent = !!last[e.id] && last[e.id] >= recentCut
    const familiar = everydayScore(e) + (isClassicEx(e) ? 3 : -4) - (ODD.test(name) ? 6 : 0)
    // What you already do leads: anything logged beats an unfamiliar staple, more often more so.
    const score = (favs.has(e.id) ? 14 : 0) + (n ? 18 + Math.min(6, n) * 3 : 0) + familiar * (n ? 0.8 : 1.6)
      + (custom ? 4 : 0) + (main.length - 1) * 2 - helpers * 3 - (recent ? 5 : 0) + rand() * 4
    pool.push({ e, w, main, score, n, compound: COMPOUND.test(name) || main.length >= 2 })
  }
  pool.sort((a, b) => b.score - a.score || (a.e.id < b.e.id ? -1 : 1))

  // Round-robin over the muscles: each turn the muscle with the fewest picks so far takes its best
  // candidate whose movement is not in the session yet. A muscle at its cap (capOf) is done; when
  // every one is done and time is left, sets go up instead (4, then 5 on the big lifts).
  const taken = new Set(), moves = new Set(), hits = Object.fromEntries(fresh.map(m => [m, 0]))
  const cap = m => capOf(m, fresh.length === 1)
  const picks = []
  const time = (extra = []) => estimateMinutes([...picks.map(p => p.cfg), ...extra])
  for (let guard = 0; guard < 40 && picks.length < MAX_PICKS; guard++) {
    if (picks.length && time() >= minutes - 3) break
    const open = fresh.filter(m => hits[m] < cap(m))
    if (!open.length) break
    const m = [...open].sort((a, b) => hits[a] - hits[b] || fresh.indexOf(a) - fresh.indexOf(b))[0]
    const c = pool.find(p => !taken.has(p.e.id) && !moves.has(movementOf(p.e)) && p.main.includes(m))
    if (!c) { hits[m] = cap(m); continue }
    const cfg = pickConfig(S, c.e, c.compound)
    // Past the time asked for by more than a few minutes: that one stays out.
    if (picks.length >= 2 && time([cfg]) > minutes + 5) break
    taken.add(c.e.id); moves.add(movementOf(c.e))
    for (const mm of c.main) hits[mm] = (hits[mm] || 0) + 1
    const why = []
    if (favs.has(c.e.id)) why.push(['One of your favourites'])
    if (c.n) why.push(c.n === 1 ? ['You did it once'] : ['You did it {0} times', c.n])
    else if (everydayScore(c.e) >= 8) why.push(['A classic for {0}', MUSCLE_NAME[c.main[0]] || c.main[0]])
    picks.push({ id: c.e.id, cfg, muscles: c.main, compound: c.compound, why })
  }
  // Time left over with every muscle covered: a set more, the big lifts first.
  for (let round = 0; round < 2 && picks.length; round++) {
    for (const p of [...picks].sort((a, b) => b.compound - a.compound)) {
      if (time() >= minutes - 3) break
      if (p.cfg.sets >= (p.compound ? 5 : 4)) continue
      const more = { ...p.cfg, sets: p.cfg.sets + 1 }
      if (estimateMinutes(picks.map(x => (x === p ? more : x.cfg))) > minutes + 3) continue
      p.cfg = more
    }
  }
  // Big lifts first, then the rest in the order they were picked.
  picks.sort((a, b) => (b.compound - a.compound))
  out.picks = picks
  out.minutes = time()
  return out
}

/** One pick swapped for the next best that is not in the session (`seed` varies the choice). */
export function swapPick (S, session, index, opts = {}) {
  const was = session.picks[index]
  if (!was) return session
  const keep = session.picks.filter((_, i) => i !== index).map(p => p.id)
  // The same muscles the swapped pick was there for, so the session keeps its shape.
  const alt = buildSession(S, { ...opts, terms: was.muscles, exclude: [...(opts.exclude || []), ...keep, was.id], minutes: 1 })
  const p0 = alt.picks[0]
  if (!p0) return session
  // It takes over the sets the session gave the one it replaces.
  const p = { ...p0, cfg: { ...p0.cfg, sets: was.cfg.sets } }
  const picks = session.picks.map((x, i) => (i === index ? p : x))
  return { ...session, picks, minutes: estimateMinutes(picks.map(x => x.cfg)) }
}

/** A routine made of the session: the picks' entries, a name from the muscles. */
export function sessionRoutine (session, { id, name, emoji = 'figureStrength' }) {
  return { id, name, emoji, ex: session.picks.map(p => ({ ...p.cfg })) }
}
