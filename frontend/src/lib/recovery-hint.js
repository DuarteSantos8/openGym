// The recovery hint on Home: the friendly reverse of the missed-workout nudge (lib/nudge.js).
// Where the nudge says "you skipped", this says what has rested and what has not, read off the
// same fatigue model the Stats muscle map shows (lib/recovery.js fatigueOf). One hint at a time,
// never more than one line of advice, and never a "don't train":
//
//   - a session running, or today's already logged: nothing (you are on it, or done).
//   - a planned rest day: only ever calm. When the legs or the upper body are still recovering,
//     it says the rest comes at a good time; otherwise nothing.
//   - a planned day whose routines lean on a region still marked fatigued (3 or more sets for its
//     main muscles): go a bit lighter, or swap the session (the day's override sheet).
//   - a planned day that brings back a main muscle group left alone 7+ days: a nod that today's
//     plan covers it.
//   - no plan for today and none to follow (freestyle): the region still recovering, and the
//     other one as the idea for today; else the main group left alone longest, once it is 7+ days.
//
// "Fatigued" is the map's own band (above 0.5, lib/recovery-view.js fatigueStateOf); the
// "recovering" band below it is normal training and says nothing. Only people who train get a
// hint: three workouts in the last 30 days, so a new profile is not told its back is neglected.
// The card can be put away for the day (S.recoveryHintDay) and switched off (S.recoveryHint).
import { loadOfWorkouts, loadOfRoutine } from './muscles.js'
import { workoutAt, effectiveRoutines } from './history.js'
import { t } from './i18n.js'
import { DAYN, fmtDate, todayISO } from './format.js'

const DAY = 86400000
export const HINT_NEGLECT_DAYS = 7
// A group counts as "your" training once it had work in this window; older is a choice.
export const HINT_HABIT_DAYS = 60
export const HINT_MIN_RECENT_WORKOUTS = 3
// Planned sets on a region's main muscles that make a session lean on it.
export const HINT_HEAVY_SETS = 3
const FATIGUED = 0.5

// The two regions the hint talks about, by their main muscles.
export const REGIONS = {
  legs: ['quadriceps', 'hamstring', 'gluteal'],
  upper: ['chest', 'upper-back', 'deltoids'],
}
// The groups a "left alone" hint names, most important first on a tie.
export const GROUPS = {
  legs: ['quadriceps', 'hamstring', 'gluteal'],
  back: ['upper-back'],
  chest: ['chest'],
  shoulders: ['deltoids'],
}

const iso = ms => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY)

/** When each muscle last had a real set of work (one effective set or more): slug → ms. */
export function lastWorked(workouts) {
  const out = {}
  for (const w of workouts || []) {
    const at = workoutAt(w)
    if (!Number.isFinite(at)) continue
    const load = loadOfWorkouts([w])
    for (const [slug, v] of Object.entries(load)) if (v >= 1 && !(out[slug] >= at)) out[slug] = at
  }
  return out
}

const regionFatigued = (fatigue, r) => REGIONS[r].some(m => (Number(fatigue?.[m]) || 0) > FATIGUED)
const regionSets = (load, r) => REGIONS[r].reduce((s, m) => s + (Number(load?.[m]) || 0), 0)

/**
 * The hint for today, or null. `fatigue` is fatigueOf's map for `now`; `today` the local day.
 * Returns { kind, region?, group?, day?, days?, routine? } where `kind` is one of
 *   'rest'     a planned rest day while `region` recovers (`day`: when it was worked last)
 *   'lighter'  today's plan leans on `region`, which is still recovering (`day`, `routine`)
 *   'split'    freestyle: `region` recovering, the other one is the idea (`day`)
 *   'covered'  today's plan brings back `group`, left alone `days` days
 *   'neglect'  freestyle: `group` left alone `days` days
 */
export function recoveryHint(S, { now = Date.now(), today = iso(now), fatigue = {} } = {}) {
  if (!S || S.recoveryHint === false || S.recoveryHintDay === today || S.active) return null
  const workouts = Array.isArray(S.workouts) ? S.workouts : []
  if (workouts.some(w => w?.d === today)) return null
  const recent = workouts.filter(w => { const at = workoutAt(w); return at > now - 30 * DAY && at <= now })
  if (recent.length < HINT_MIN_RECENT_WORKOUTS) return null
  const last = lastWorked(workouts)
  const lastDay = slugs => {
    const at = Math.max(...slugs.map(m => last[m] || 0))
    return at > 0 ? iso(at) : null
  }
  const recovering = Object.keys(REGIONS).filter(r => regionFatigued(fatigue, r))
  // A group left alone: worked within the habit window, not for 7+ days. The longest gap first.
  const neglected = Object.entries(GROUPS).map(([group, slugs]) => {
    const at = Math.max(...slugs.map(m => last[m] || 0))
    return { group, at, days: at > 0 ? daysBetween(iso(at), today) : null }
  }).filter(g => g.at > now - HINT_HABIT_DAYS * DAY && g.days >= HINT_NEGLECT_DAYS)
    .sort((a, b) => b.days - a.days)

  const routines = effectiveRoutines(S, today).filter(r => (r?.ex || []).length)
  const hasPlan = Object.values(S.week || {}).some(v => [].concat(v || []).length) || !!(S.queue?.ids || []).length
  const restDay = !routines.length && (hasPlan || S.dayPlan?.[today] === 'rest')

  if (restDay) {
    const region = recovering[0]
    return region ? { kind: 'rest', region, day: lastDay(REGIONS[region]) } : null
  }
  if (routines.length) {
    const load = loadOfRoutine({ ex: routines.flatMap(r => r.ex || []) })
    const heavy = recovering.filter(r => regionSets(load, r) >= HINT_HEAVY_SETS)
      .sort((a, b) => regionSets(load, b) - regionSets(load, a))
    if (heavy.length) return { kind: 'lighter', region: heavy[0], day: lastDay(REGIONS[heavy[0]]), routine: routines.map(r => r.name).join(' + ') }
    const covered = neglected.find(g => GROUPS[g.group].some(m => (Number(load[m]) || 0) >= 1))
    return covered ? { kind: 'covered', group: covered.group, days: covered.days } : null
  }
  // Freestyle: nothing planned for today and no plan to follow.
  if (recovering.length === 1) return { kind: 'split', region: recovering[0], day: lastDay(REGIONS[recovering[0]]) }
  if (recovering.length) return null
  return neglected.length ? { kind: 'neglect', group: neglected[0].group, days: neglected[0].days } : null
}

// ---- Words ---------------------------------------------------------------------------------

// "from Tuesday": the day a region was worked last, as a weekday within the week, else a date.
export function hintDay(day, today = todayISO()) {
  if (!day) return ''
  const n = Math.round((new Date(today + 'T12:00:00') - new Date(day + 'T12:00:00')) / 86400000)
  if (n === 1) return t('yesterday')
  if (n > 1 && n < 7) return t(DAYN[new Date(day + 'T12:00:00').getDay()])
  return fmtDate(day)
}

const regionLine = (region, day) => (region === 'legs'
  ? t('Your legs are still recovering from {0}.', day)
  : t('Your upper body is still recovering from {0}.', day))

const groupLine = (group, days) => (group === 'legs' ? t('Your legs haven’t had any work in {0} days.', days)
  : group === 'back' ? t('Your back hasn’t had any work in {0} days.', days)
  : group === 'chest' ? t('Your chest hasn’t had any work in {0} days.', days)
  : t('Your shoulders haven’t had any work in {0} days.', days))

/** The words of a hint: [main line, follow-up]. */
export function hintText(h, today = todayISO()) {
  if (!h) return null
  const day = hintDay(h.day, today)
  if (h.kind === 'rest') return [t('Rest day, good timing.'), regionLine(h.region, day)]
  if (h.kind === 'lighter') return [regionLine(h.region, day), t('Go a bit lighter today, or swap the session.')]
  if (h.kind === 'split') return [regionLine(h.region, day), h.region === 'legs' ? t('Upper body today?') : t('Legs today?')]
  if (h.kind === 'covered') return [groupLine(h.group, h.days), t('Today’s plan takes care of that.')]
  if (h.kind === 'neglect') return [groupLine(h.group, h.days), t('A few sets today would be nice.')]
  return null
}

