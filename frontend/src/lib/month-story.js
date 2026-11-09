// "Your month in openGym" (v1.4.5, gm-insights): the year's story engine (lib/wrapped.js,
// lib/wrapped-cards.js, components/Wrapped.jsx) for one calendar month, shorter. The month in
// numbers, its records, how consistent it was, the exercise of the month on the muscle map, what
// was new, and one line to go out on. Every card is a picture to share, drawn by the same layout.
//
// A month is the user's own calendar month: a workout belongs to the month of its local day
// (workoutDay), as in the year. The records are the ones each workout saved when it was finished
// (lib/finish-workout.js sessionPrs, kept in `w.prs`); a workout that came in without them (an
// import) is asked sessionPrs against the history before it, so it is judged by the same rule.
// Reads the profile, stores nothing, sends nothing.
import { workoutDay, workoutDuration, sessionVolume, doneUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { isAssisted } from './exercises.js'
import { MUSCLES, MUSCLE_NAME, loadOfWorkouts, levelsOf } from './muscles.js'
import { sessionPrs } from './finish-workout.js'
import { comparisonFor } from './wrapped.js'
import { volumeParts, hoursOf, comparisonLine, exName } from './wrapped-cards.js'
import { weekKey, weekStartOf, fmtDur, fmtNum, MONTHS_LONG } from './format.js'
import { shownWeight, exUnitOf } from './ex-unit.js'
import { LB_KG } from './units.js'
import { t, tn, tnf, dateLocale } from './i18n-core.js'
import { activityTotals } from './activities.js'
import { nutritionSummary } from './sister-nutrition.js'

const YM = /^\d{4}-\d{2}$/
const MIN_SESSION_MS = 60000

const byTime = (a, b) => (workoutDay(a) < workoutDay(b) ? -1 : workoutDay(a) > workoutDay(b) ? 1 : (Number(a.start) || 0) - (Number(b.start) || 0))
const all = S => (Array.isArray(S?.workouts) ? S.workouts : []).filter(w => w && workoutDay(w)).sort(byTime)
const workSets = e => (Array.isArray(e?.sets) ? e.sets : []).filter(s => !isWarmupRow(s) && doneUnits(s) > 0)
const topWeight = e => Math.max(0, ...workSets(e).map(s => Number(s.w) || 0))

/** 'YYYY-MM' of the month before. */
export function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Every month with a workout, newest first ('YYYY-MM'). */
export function storyMonths(S) {
  return [...new Set(all(S).map(w => workoutDay(w).slice(0, 7)))].sort().reverse()
}

/**
 * The month Stats offers: the month before `today` when it has workouts (it is complete), else
 * this month so far, else null.
 */
export function offeredMonth(S, today) {
  const ms = storyMonths(S)
  const cur = today.slice(0, 7)
  const prev = prevMonth(cur)
  return ms.includes(prev) ? prev : ms.includes(cur) ? cur : null
}

// The weeks (in the profile's week) that touch the month, as week keys.
function weeksOfMonth(ym, wkStart) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const keys = new Set()
  for (let d = 1; d <= last; d++) keys.add(weekKey(`${ym}-${String(d).padStart(2, '0')}`, wkStart))
  return [...keys]
}

/** The records a workout set: its saved `prs`, or sessionPrs against the history before it. */
function recordsOf(w, before, S) {
  if (Array.isArray(w.prs)) return w.prs.filter(id => typeof id === 'string')
  return sessionPrs({ ...S, workouts: before }, w.entries || []).prs
}

/**
 * Everything the month's cards say, or null without a workout in it. `today` decides whether the
 * month is still going (then its weeks are counted up to this week).
 */
export function monthStats(S, ym, today = null) {
  if (!YM.test(String(ym))) return null
  const list = all(S)
  const ws = list.filter(w => workoutDay(w).slice(0, 7) === ym)
  if (!ws.length) return null
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const wkStart = weekStartOf(S)
  const start = ym + '-01'

  let ms = 0, timed = 0, volume = 0, sets = 0
  const days = new Set()
  const perEx = new Map()
  const records = new Map()   // id -> { w, d }
  const firstSeen = new Map() // id -> first day ever
  for (const w of list) for (const e of w.entries || []) if (e?.id && workSets(e).length && !firstSeen.has(e.id)) firstSeen.set(e.id, workoutDay(w))

  for (const w of ws) {
    days.add(workoutDay(w))
    volume += sessionVolume(w, S)
    const dur = workoutDuration(w)
    if (dur >= MIN_SESSION_MS) { ms += dur; timed++ }
    const before = list.slice(0, list.indexOf(w))
    for (const id of new Set(recordsOf(w, before, S))) {
      const top = Math.max(0, ...(w.entries || []).filter(e => e?.id === id).map(topWeight))
      if (!records.has(id) || top > records.get(id).w) records.set(id, { w: top, d: workoutDay(w) })
    }
    for (const e of w.entries || []) {
      if (!e || typeof e.id !== 'string') continue
      const n = workSets(e).reduce((m, s) => m + doneUnits(s), 0)
      if (!n) continue
      sets += n
      const cur = perEx.get(e.id) || { sets: 0, name: null }
      cur.sets += n
      cur.name = cur.name || (typeof e.ex?.n === 'string' ? e.ex.n : null)
      perEx.set(e.id, cur)
    }
  }

  let topEx = null
  for (const [id, v] of perEx) if (!topEx || v.sets > topEx.sets || (v.sets === topEx.sets && id < topEx.id)) topEx = { id, ...v }
  const load = loadOfWorkouts(ws)
  let topMuscle = null
  for (const m of MUSCLES) if ((load[m] || 0) > 0 && (!topMuscle || load[m] > load[topMuscle])) topMuscle = m

  // Records: the heaviest gain past the best before the month first, assisted lifts left out of the
  // list (less help is the record there, and "+10 kg" would read the wrong way round).
  const bestBefore = id => Math.max(0, ...list.filter(w => workoutDay(w) < start).flatMap(w => (w.entries || []).filter(e => e?.id === id).map(topWeight)))
  const recordList = [...records].filter(([id, r]) => !isAssisted(id) && r.w > 0)
    .map(([id, r]) => { const prev = bestBefore(id); return { id, w: r.w, d: r.d, gain: prev > 0 ? r.w - prev : null } })
    .sort((a, b) => (b.gain ?? -1) - (a.gain ?? -1) || b.w - a.w || (a.id < b.id ? -1 : 1))

  const monthWeeks = weeksOfMonth(ym, wkStart)
  const nowWeek = today && today.slice(0, 7) === ym ? weekKey(today, wkStart) : null
  const weeks = nowWeek ? monthWeeks.filter(k => k <= nowWeek) : monthWeeks
  const trained = new Set(ws.map(w => weekKey(workoutDay(w), wkStart)))

  const prevYm = prevMonth(ym)
  const pws = list.filter(w => workoutDay(w).slice(0, 7) === prevYm)
  return {
    ym, unit, workouts: ws.length, days: days.size,
    ms, timed, avgMs: timed ? ms / timed : 0,
    volume, volumeKg: unit === 'lb' ? volume * LB_KG : volume, sets,
    weeks: { trained: weeks.filter(k => trained.has(k)).length, of: weeks.length },
    prs: records.size, records: recordList,
    topExercise: topEx ? { id: topEx.id, sets: topEx.sets, name: topEx.name } : null,
    topMuscle: topMuscle ? { id: topMuscle } : null,
    load,
    newExercises: [...firstSeen].filter(([, d]) => d.slice(0, 7) === ym).map(([id]) => id),
    prev: pws.length ? { ym: prevYm, workouts: pws.length, volume: pws.reduce((v, w) => v + sessionVolume(w, S), 0) } : null,
    running: !!nowWeek,
  }
}

/* ---------- the words ---------- */

const nf = (n, max = 0) => { try { return new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: max }).format(n) } catch (e) { return String(Math.round(n)) } }

/** "October" in the app's language. */
export const monthName = ym => t(MONTHS_LONG[Number(ym.slice(5, 7)) - 1])
/** "October 2026", for the story's header pill and the share card. */
export const monthLabel = ym => `${monthName(ym)} ${ym.slice(0, 4)}`

/** The line the month goes out on: the first rule that fits, always a kind one. */
export function funLine(st) {
  if (st.prs >= 5) return t('So many records, the plates are filing a complaint.')
  if (st.weeks.of >= 4 && st.weeks.trained === st.weeks.of) return t('Not a single week off. Your calendar is impressed.')
  if (st.prev && st.workouts > st.prev.workouts) return t('More than last month. Momentum looks good on you.')
  if (st.newExercises.length >= 3) return t('New moves, new muscles asking questions. Curiosity pays.')
  if (st.workouts >= 12) return t('Twelve or more sessions. The gym should start charging you rent.')
  return t('Showing up is the whole trick, and you did it.')
}

/**
 * Beyond the gym for the month (gm-hooks): the runs and matches (lib/activities.js) and, when this
 * device is linked to openNutrition and the story may show it, what you ate (`nutritionDays`, the
 * month's days from lib/sister-nutrition.js daysIn). { sport, food }, each null when there is none.
 */
/** The month's first and last day ('YYYY-MM-DD'), the last no later than `today` when given. */
export function monthRange(ym, today = null) {
  const [y, m] = ym.split('-').map(Number)
  const from = ym + '-01', last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  return { from, to: today && today >= from && today < last ? today : last }
}

export function monthExtras(S, ym, nutritionDays = null) {
  if (!YM.test(String(ym))) return { sport: null, food: null }
  const { from, to } = monthRange(ym)
  const sport = activityTotals(S, from, to)
  return { sport: sport.n ? sport : null, food: nutritionDays ? nutritionSummary(nutritionDays.filter(d => d.date >= from && d.date <= to), { from, to }) : null }
}

/**
 * The cards for one month, the same model as the year's (lib/wrapped-cards.js wrappedCards), so the
 * stories and the share pictures draw them unchanged. Cards with nothing to say are left out.
 * `extras` is monthExtras: a sport card and a nutrition card before the summary, when there is one.
 */
export function monthCards(st, S, extras = null) {
  if (!st) return []
  const name = monthName(st.ym)
  const cards = []
  cards.push({ id: 'intro', kicker: t('Your month in openGym'), big: name, bigKind: 'text',
    title: st.running ? t('The month so far, the short version.') : t('One month, the short version.'), lines: [t('Tap to start')] })

  const lines = []
  if (st.prev) {
    const prev = monthName(st.prev.ym)
    const d = st.workouts - st.prev.workouts
    lines.push(d > 0 ? t('{0} more than {1}. Look at you.', nf(d), prev)
      : d < 0 ? t('{0} fewer than {1}. Some months are like that.', nf(-d), prev)
        : t('Same as {0}. Steady wins.', prev))
  } else lines.push(t('Your first month on the books here. Welcome in.'))
  cards.push({ id: 'workouts', kicker: t('Showing up'), big: nf(st.workouts), num: st.workouts, bigKind: 'number', title: t('Workouts this month'), lines })

  if (st.ms > 0) {
    const h = hoursOf(st.ms)
    cards.push({ id: 'time', kicker: t('Time well spent'), big: nf(h, h < 10 ? 1 : 0), num: h, bigKind: 'number', title: t('Hours of training'),
      lines: [t('Your average session: {0}', fmtDur(st.avgMs))] })
  }

  if (st.volume > 0) {
    const v = volumeParts(st.volume, st.unit)
    cards.push({ id: 'volume', kicker: t('Heavy lifting'), big: v.value, unit: v.unit, bigKind: 'number', title: t('Lifted in total'), lines: [comparisonLine(comparisonFor(st.volumeKg))].filter(Boolean) })
  }

  if (st.weeks.of > 0) {
    const { trained, of } = st.weeks
    cards.push({ id: 'streak', kicker: t('Consistency'), big: `${nf(trained)}/${nf(of)}`, bigKind: 'number', title: t('Weeks with a workout'),
      lines: [tn('{0} day in the gym.', '{0} days in the gym.', st.days),
        trained === of ? t('Every single week. That is a habit, not a phase.') : t('Every week you showed up counted.')] })
  }

  if (st.prs > 0) {
    const shown = st.records.slice(0, 3).map(r => `${exName(r.id)}, ${fmtNum(shownWeight(S, r.id, r.w))} ${exUnitOf(S, r.id)}`)
    cards.push({ id: 'records', kicker: t('Records'), big: nf(st.prs), num: st.prs, bigKind: 'number', title: t('New personal records'), lines: shown })
  }

  if (st.topExercise) {
    const { id, sets, name: n } = st.topExercise
    cards.push({ id: 'top', kicker: t('Exercise of the month'), big: exName(id, n), bigKind: 'text', title: tnf('{0} set this month', '{0} sets this month', sets, nf(sets)),
      lines: st.topMuscle ? [t('Most trained muscle: {0}', t(MUSCLE_NAME[st.topMuscle.id] || st.topMuscle.id))] : [],
      map: st.topMuscle ? levelsOf(st.load) : null })
  }

  if (st.newExercises.length) {
    const n = st.newExercises.length
    cards.push({ id: 'new', kicker: t('Something new'), big: nf(n), num: n, bigKind: 'number', title: tn('Exercise you tried for the first time', 'Exercises you tried for the first time', n),
      lines: st.newExercises.slice(0, 3).map(id => exName(id)) })
  }

  // Beyond the gym (gm-hooks): runs and matches, then what openNutrition says you ate.
  const sport = extras?.sport
  if (sport) {
    const h = sport.min / 60
    const km = sport.km > 0 ? (st.unit === 'lb' ? t('{0} mi', nf(sport.km / 1.609344, 1)) : t('{0} km', nf(sport.km, 1))) : null
    cards.push({ id: 'sport', kicker: t('Beyond the gym'), big: nf(sport.n), num: sport.n, bigKind: 'number',
      title: t('Runs, rides and matches'),
      lines: [[t('{0} hours of it', nf(h, h < 10 ? 1 : 0)), km].filter(Boolean).join(' · '), t('Your legs remember every one.')] })
  }
  const food = extras?.food
  if (food && food.protein != null) {
    cards.push({ id: 'food', kicker: t('Fuel'), big: nf(food.protein), unit: 'g', num: food.protein, bigKind: 'number', title: t('Protein a day, on average'),
      lines: [food.kcal != null ? t('{0} kcal a day', nf(food.kcal)) : null,
        food.proteinMeals != null ? t('{0} protein meals a day', nf(food.proteinMeals, 1)) : null,
        tn('{0} day logged in openNutrition', '{0} days logged in openNutrition', food.days)].filter(Boolean) })
  }

  const v = volumeParts(st.volume, st.unit)
  const tiles = [
    { label: t('Workouts'), value: nf(st.workouts) },
    ...(st.ms > 0 ? [{ label: t('Hours'), value: nf(hoursOf(st.ms), hoursOf(st.ms) < 10 ? 1 : 0) }] : []),
    ...(st.volume > 0 ? [{ label: t('Lifted in total'), value: v.value + ' ' + v.unit }] : []),
    ...(st.prs > 0 ? [{ label: t('Records'), value: nf(st.prs) }] : []),
    ...(st.topExercise ? [{ label: t('Exercise of the month'), value: exName(st.topExercise.id, st.topExercise.name), wide: true }] : []),
  ]
  cards.push({ id: 'summary', kicker: t('Your {0} in openGym', name), big: '', bigKind: 'none', title: funLine(st), lines: [], tiles })
  return cards
}
