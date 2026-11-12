// Cardio plans: a named list of segments, each some minutes at a speed and, on a treadmill, a grade.
//
//   S.cardioPlans = { [id]: CardioPlan }        one entry per plan, merged per key (sync-merge.js)
//   CardioPlan    = { id, name, at, segments: Segment[] }
//   Segment       = { min, speed, incline? }      min whole minutes, speed in km/h, incline in percent
//
// A cardio set already is one segment ({ min, speed, incline }, lib/incline.js), so a plan is
// just those rows saved under a name: choosing it writes its segments as the exercise's sets, and
// the set timer (views/Workout.jsx) walks through them one after the other. Nothing here knows
// about the screen; everything that decides what a plan holds, or what a pasted text means, lives
// here so it can be tested.
import { clampIncline, hasIncline } from './incline.js'
import { KMH_PER_MPH } from './speed.js'
import { uid } from './format.js'

export const PLAN_MAX_SEGMENTS = 40
export const PLANS_MAX = 50
export const SEGMENT_MIN_MAX = 300
export const SPEED_MAX = 40
export const NAME_MAX = 60

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** A segment as it is stored: whole minutes (1 to 300), km/h on a tenth, the grade on a half percent. */
export function normalizeSegment(seg) {
  if (!isMap(seg)) return null
  const min = Math.round(Number(seg.min))
  const speed = Math.round(Number(seg.speed) * 10) / 10
  if (!(min >= 1) || !(speed > 0)) return null
  const out = { min: Math.min(SEGMENT_MIN_MAX, min), speed: Math.min(SPEED_MAX, speed) }
  const incline = clampIncline(seg.incline)
  if (incline > 0) out.incline = incline
  return out
}

/** A plan as it is stored, or null when there is nothing in it worth keeping. */
export function normalizePlan(p) {
  if (!isMap(p) || typeof p.id !== 'string' || !p.id) return null
  const segments = (Array.isArray(p.segments) ? p.segments : []).map(normalizeSegment).filter(Boolean).slice(0, PLAN_MAX_SEGMENTS)
  if (!segments.length) return null
  const name = String(p.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  if (!name) return null
  return { id: p.id, name, at: Number(p.at) || 0, segments }
}

/** Every plan, newest first. */
export function plansOf(S) {
  if (!isMap(S?.cardioPlans)) return []
  return Object.values(S.cardioPlans).map(normalizePlan).filter(Boolean).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
}

export const planById = (S, id) => (isMap(S?.cardioPlans) ? normalizePlan(S.cardioPlans[id]) : null)

/** A new plan, not stored yet. */
export function newPlan(name, segments, now = Date.now()) {
  return normalizePlan({ id: uid(), name, at: now, segments })
}

/** Writes `p` into the draft state (store.update), cleaned. Returns it, or null when it holds nothing. */
export function savePlan(s, p) {
  const clean = normalizePlan(p)
  if (!clean) return null
  const all = isMap(s.cardioPlans) ? s.cardioPlans : {}
  // The oldest go when the cap is reached, never the one being saved.
  const keep = Object.values(all).filter(x => x?.id !== clean.id).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, PLANS_MAX - 1)
  s.cardioPlans = Object.fromEntries([...keep, clean].map(x => [x.id, x]))
  return clean
}

export function removePlan(s, id) {
  if (!isMap(s.cardioPlans) || !(id in s.cardioPlans)) return false
  const { [id]: _gone, ...rest } = s.cardioPlans
  s.cardioPlans = rest
  return true
}

/** Minutes the whole plan takes. */
export const planMinutes = p => (p?.segments || []).reduce((n, g) => n + (Number(g.min) || 0), 0)

/**
 * The rows a plan becomes in a workout. The grade only goes on where the exercise has one
 * (`withIncline`, lib/incline.js inclineFits), so a bike never gets a number it cannot show.
 */
export function planToSets(p, { withIncline = true } = {}) {
  return (p?.segments || []).map(g => ({
    min: g.min, speed: g.speed, ...(withIncline && hasIncline(g) ? { incline: Number(g.incline) } : {}), done: false,
  }))
}

/** The segments of an exercise's rows, to save as a plan. Rows with no minutes or no speed are left out. */
export function setsToSegments(sets) {
  return (Array.isArray(sets) ? sets : []).map(s => normalizeSegment({ min: s?.min, speed: s?.speed, incline: s?.incline })).filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// Pasted text. Plans come written down in a few shapes, and typing seven segments by hand on a
// phone is what this is here to spare:
//
//   ➡️ Minutos 0–3                    a range of minutes starts a segment (3 minutes),
//   Inclinação: 4                     and the lines under it say its grade
//   Velocidade: 5,0 km/h              and its speed
//
//   3 min @ 5 km/h · 4% incline       or one line each, as the set list prints them
//
// Labels are matched in English, Portuguese, Spanish, French, German and Italian by their stems;
// numbers take a comma or a point. A speed with "mph" is converted; one without a unit is in
// `speedUnit`, the profile's. Anything that is not a number we understand is left out rather than
// guessed at, and counted, so the screen can say how much was read.
const NUM = '(\\d+(?:[.,]\\d+)?)'
const num = s => Number(String(s).replace(',', '.'))
const RANGE = new RegExp(`(?:min\\p{L}*|мин\\p{L}*)?\\s*[:\\-]?\\s*${NUM}\\s*(?:[–—−-]|a|à|to|bis|au)\\s*${NUM}`, 'iu')
const MINWORD = /min|мин|\bm\b/i
const INCLINE = new RegExp(`(?:inclin\\p{L}*|pente|pendenza|steigung|neigung|nachylenie|lutning|emelked\\p{L}*|eğim|наклон|grade|slope|incline)\\s*[:=\\-]?\\s*${NUM}`, 'iu')
const SPEED = new RegExp(`(?:veloc\\p{L}*|speed|vitesse|geschw\\p{L}*|tempo|hastighet|sebess\\p{L}*|pr[eę]dko\\p{L}*|hız|скорость|vel)\\.?\\s*[:=\\-]?\\s*${NUM}\\s*(km\\s*\\/?\\s*h|kmh|mph)?`, 'iu')
const COMPACT = new RegExp(`${NUM}\\s*min\\p{L}*\\.?\\s*(?:@|·|x|×|a|at|-|,)?\\s*${NUM}\\s*(km\\s*\\/?\\s*h|kmh|mph)`, 'iu')
const PCT = new RegExp(`${NUM}\\s*%`, 'u')

export function parsePlanText(text, { speedUnit = 'kmh' } = {}) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/[➡️▶►•*_#>]|​/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const segments = []
  let skipped = 0
  let cur = null
  const toKmh = (v, unit) => {
    const u = String(unit || '').toLowerCase().replace(/\s|\//g, '')
    const mph = u ? u === 'mph' : speedUnit === 'mph'
    return mph ? v * KMH_PER_MPH : v
  }
  const flush = () => {
    if (!cur) return
    const g = normalizeSegment(cur)
    if (g) segments.push(g)
    else skipped++
    cur = null
  }
  for (const line of lines) {
    const compact = COMPACT.exec(line)
    if (compact) {
      flush()
      const pct = PCT.exec(line.slice(compact.index + compact[0].length)) || INCLINE.exec(line)
      cur = { min: num(compact[1]), speed: toKmh(num(compact[2]), compact[3]), incline: pct ? num(pct[1]) : undefined }
      flush()
      continue
    }
    const range = MINWORD.test(line) ? RANGE.exec(line) : null
    if (range && !INCLINE.test(line) && !SPEED.test(line)) {
      flush()
      const a = num(range[1]), b = num(range[2])
      cur = { min: b > a ? b - a : NaN }
      continue
    }
    if (!cur) continue
    const inc = INCLINE.exec(line)
    if (inc) cur.incline = num(inc[1])
    const spd = SPEED.exec(line)
    if (spd) cur.speed = toKmh(num(spd[1]), spd[2])
  }
  flush()
  return { segments: segments.slice(0, PLAN_MAX_SEGMENTS), skipped, tooMany: segments.length > PLAN_MAX_SEGMENTS }
}
