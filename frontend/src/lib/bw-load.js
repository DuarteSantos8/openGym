// Body weight in the volume of bodyweight lifts (#794), Settings → Units → "Count body weight
// in bodyweight lifts", off by default. A pull-up session otherwise reads 0 kg however many
// were done. Only volume follows the switch (lib/history.js sessionVolume): records, e1RM and
// progression keep reading the logged load, so a weigh-in never turns into a fake record and
// an old pull-up stays comparable with today's.
import { exerciseOf, isAssisted } from './exercises.js'
import { bodyweightAt } from './bodyweight.js'

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

/**
 * The body weight a session was done at: the one checked in for it (`w.bw`), else read off the
 * weigh-in log at its start (between two weigh-ins, the line between them; else the nearest one,
 * before or after, so a weigh-in synced late still lands on it). 0 with none.
 */
export function bodyweightFor(w, S) {
  const own = Number(w?.bw)
  if (own > 0) return own
  const log = Array.isArray(S?.bodyweight) ? S.bodyweight : []
  // When it started; a session with no start time sits at noon of its day, as workoutAt has it
  // (lib/history.js, which imports this file). Between two weigh-ins, the line between them; else
  // the nearest, however far (lib/bodyweight.js bodyweightAt): a pull-up always moves something.
  const at = Number.isFinite(w?.start) ? w.start : new Date(w?.d + 'T12:00:00').getTime()
  if (!Number.isFinite(at)) {
    const pts = log.filter(b => b?.d && Number(b.w) > 0)
    return pts.length ? Number(pts.reduce((a, b) => (String(b.d) >= String(a.d) ? b : a)).w) : 0
  }
  return bodyweightAt(log, at, Infinity) || 0
}
