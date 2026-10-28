// Body weight in the volume of bodyweight lifts (#794), Settings → Units → "Count body weight
// in bodyweight lifts", off by default. A pull-up session otherwise reads 0 kg however many
// were done. Only volume follows the switch (lib/history.js sessionVolume): records, e1RM and
// progression keep reading the logged load, so a weigh-in never turns into a fake record and
// an old pull-up stays comparable with today's.
import { exerciseOf, isAssisted } from './exercises.js'
import { weighInAt } from './bodyweight.js'

export const countsBodyweight = S => S?.volumeBodyweight === true

// How much of your body weight a rep moves, by movement pattern. The catalogue has no field for
// it, so this is a short table matched on the name, and anything it does not know counts
// nothing extra rather than a guess.
//  - Hanging and dipping (pull-up, chin-up, muscle-up, bar and ring dips): your whole body hangs
//    from or sits on your hands, so 100 %, the convention Hevy and Strong use too.
//  - Push-ups: the share on the hands measured by Ebben et al. 2011, "Kinetic analysis of several
//    variations of push-ups" (J Strength Cond Res 25(10)): 64 % standard, 49 % on the knees,
//    41 % hands raised (incline), 74 % feet raised (decline).
// Left out on purpose: bench, floor and reverse dips (feet carry an unknown share), wall,
// handstand and pike push-ups, scapular pulls, stretches, form checks, holds, and every band or partner "assisted" variant,
// where nobody knows how much the band took.
const SKIP = /stretch|form check|scapular|\bhold\b|\bassist(ed)?\b|\bbench\b|\bfloor\b|\bwall\b|reverse (push|dip)|handstand|\bpike\b/i
const PATTERNS = [
  [/\b(pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?)\b/i, 1],
  [/\bdips?\b/i, 1],
  [/push[- ]?ups?.*\bknees?\b|\bknees?\b.*push[- ]?ups?/i, 0.49],
  [/\bincline\b.*push[- ]?ups?/i, 0.41],
  [/\bdecline\b.*push[- ]?ups?/i, 0.74],
  [/push[- ]?ups?/i, 0.64],
]
// Equipment where the logged weight is on top of you (a belt, a vest) or there is none: your body
// is the load. A dumbbell, ball or band variant has a load (or a wobble) of its own.
const BODY_EQ = new Set(['body weight', 'weighted', 'suspension trainer', 'rope'])

/**
 * The share of body weight one rep of this exercise moves, and how the logged weight combines
 * with it: `assisted` (an assistance machine, #232) takes the logged weight off, every other
 * exercise adds it (a dip belt). `null` for exercises that get nothing added.
 */
export function bodyLoadOf(idOrEx) {
  const ex = exerciseOf(idOrEx)
  if (!ex || ex.bp === 'cardio') return null
  const name = String(ex.n || '')
  const assisted = isAssisted(ex)
  if (!assisted && (!BODY_EQ.has(ex.eq) || SKIP.test(name))) return null
  // An assistance machine's name says "assisted"; only its pattern is read.
  const plain = assisted ? name.replace(/\bassist(ed)?\b/gi, '') : name
  if (assisted && SKIP.test(plain)) return null
  const hit = PATTERNS.find(([re]) => re.test(plain))
  return hit ? { share: hit[1], assisted } : null
}

// The weigh-ins sorted on their time axis, cached per list so a lifetime total over years of
// sessions does one sort, not one per session.
const sortedCache = new WeakMap()
function sortedWeighIns(list) {
  const hit = sortedCache.get(list)
  if (hit && hit.n === list.length) return hit.pts
  const pts = list.filter(b => Number(b?.w) > 0 && b?.d).map(b => ({ t: weighInAt(b), w: Number(b.w) })).sort((a, b) => a.t - b.t)
  sortedCache.set(list, { n: list.length, pts })
  return pts
}

/**
 * The body weight a session was done at: the one checked in for it (`w.bw`), else the weigh-in
 * nearest its start, before or after (a weigh-in synced late still lands on it). 0 with none.
 */
export function bodyweightFor(w, S) {
  const own = Number(w?.bw)
  if (own > 0) return own
  const pts = Array.isArray(S?.bodyweight) ? sortedWeighIns(S.bodyweight) : []
  if (!pts.length) return 0
  // When it started; a session with no start time sits at noon of its day, as workoutAt has it
  // (lib/history.js, which imports this file).
  const at = Number.isFinite(w?.start) ? w.start : new Date(w?.d + 'T12:00:00').getTime()
  if (!Number.isFinite(at)) return pts[pts.length - 1].w
  let lo = 0, hi = pts.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t < at) lo = mid + 1; else hi = mid }
  const prev = pts[lo - 1]
  return prev && at - prev.t <= pts[lo].t - at ? prev.w : pts[lo].w
}
