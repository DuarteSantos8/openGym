// What the overlay shows before anything is typed (fitness-eval ux-search.md §2): four shortcut
// chips per tab, Recent, and up to three "right now" suggestions worked out from local state. And
// the way back from a Recent entry or a "most opened" key to the row it names, which also tells a
// deleted target from one that is still there.
import { t } from '../i18n-core.js'
import { isoOf, startOfWeek, todayISO, weekStartOf } from '../format.js'
import { effectiveRoutines } from '../history.js'
import { EXIDX } from '../exercises.js'
import { defaultMeal } from '../nutrition/diary.js'
import { PAGE_INDEX } from './pages.js'
import { dayResults, exerciseRow, foodRow, mealRow, pageResults, routineRow, trainedIndex, workoutRow } from './results.js'
import { settingsResults } from './settings-source.js'
import { useRecents } from './recents.js'

const chip = (id, label, glyph, target) => ({ id, label, glyph, target })
const route = path => ({ kind: 'route', path })

const ROUTINES = chip('routines', 'Routines', 'clipboard', route('/train/routines'))
const SCHEDULE = chip('schedule', 'Schedule', 'calendarCheck', route('/train/schedule'))
const STRENGTH = chip('strength', 'Strength', 'chartLine', route('/progress/strength'))
const WORKOUT_SETTINGS = chip('workout-settings', 'Workout settings', 'gear', route('/me/workout'))
const HISTORY = chip('history', 'History', 'history', route('/train/history'))

/** The shortcut chips, fixed per tab: places two taps or more deep that the tab's root does not
 *  already show. With nutrition off its chips are training ones. */
export function shortcutsFor(tab, nutrition) {
  if (tab === 'train') return [ROUTINES, SCHEDULE, STRENGTH, WORKOUT_SETTINGS]
  if (tab === 'food') {
    return nutrition
      ? [chip('meals', 'Saved meals', 'utensils', route('/food/meals')), chip('recipes', 'Recipes', 'cookingPot', route('/food/recipes')),
        chip('trends', 'Trends', 'chart', route('/progress/trends')), chip('diary', 'Diary & meals', 'bookOpen', route('/me/diary'))]
      : [ROUTINES, SCHEDULE, STRENGTH, WORKOUT_SETTINGS]
  }
  if (tab === 'progress') {
    return [chip('weigh-ins', 'Weigh-ins', 'scale', { kind: 'sheet', sheet: 'weighIns' }), chip('measurements', 'Measurements', 'ruler', route('/progress/body/measurements')),
      chip('photos', 'Photos', 'image', route('/progress/body/photos')), HISTORY]
  }
  return [HISTORY, chip('exercises', 'Exercises', 'dumbbell', route('/train/exercises')),
    nutrition ? chip('foods', 'Foods', 'apple', route('/food/foods')) : ROUTINES, chip('body', 'Body', 'scale', route('/progress/body'))]
}

/**
 * The row a reference names now, or null when it is gone: { type, id } from Recent, or a
 * "most opened" key. `data` is the overlay's (use-search-data.js).
 */
export function resolveRef(type, id, data) {
  const { S } = data
  switch (type) {
    case 'page': {
      const p = PAGE_INDEX.find(x => x.path === id)
      return p ? pageResults([], data.pagesCtx, { all: true }).find(r => r.id === id) || null : null
    }
    case 'setting': return settingsResults([], S, data.settingsCtx, undefined, { all: true }).find(r => r.id === id) || null
    case 'exercise': {
      const ex = (S.customEx || []).find(e => e?.id === id) || EXIDX[id]
      return ex ? exerciseRow(ex, S, []) : null
    }
    case 'routine': { const r = (S.routines || []).find(x => x.id === id); return r ? routineRow(r, S, [], data.today) : null }
    case 'workout': { const w = (S.workouts || []).find(x => x.id === id); return w ? workoutRow(w) : null }
    case 'food': { const f = (data.foods || []).find(x => String(x.id) === String(id)); return f ? foodRow(f) : null }
    case 'meal':
    case 'recipe': {
      const m = [...(data.meals || []), ...(data.recipes || [])].find(x => String(x.id) === String(id))
      return m ? mealRow(m) : null
    }
    case 'day': {
      const d = (data.days || []).find(x => x.date === id)
      return d ? dayResults([], [d], data.mealNames || [], { from: d.date, to: d.date, rest: [] })[0] || null : null
    }
    default: return null
  }
}

// Whether a list this result's source reads has loaded: a Recent entry is only dropped as deleted
// once its source has answered.
export const sourceReady = (type, data) => (['food'].includes(type) ? data.foodsReady : ['meal', 'recipe'].includes(type) ? data.mealsReady : type === 'day' ? data.daysReady : true)

const reason = (r, why) => r && { ...r, reason: why }
const daysAgo = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return isoOf(d) }

function mostOpened(data, skip) {
  const opened = useRecents.getState().opened
  const keys = Object.keys(opened).sort((a, b) => opened[b].n - opened[a].n || opened[b].at - opened[a].at)
  for (const key of keys) {
    if (skip.has(key)) continue
    const at = key.indexOf(':')
    const r = resolveRef(key.slice(0, at), key.slice(at + 1), data)
    if (r) return reason(r, t('Opened often'))
  }
  return null
}

const lastWorkout = S => {
  const w = [...(S.workouts || [])].sort((a, b) => String(b.d).localeCompare(String(a.d)) || (b.start || 0) - (a.start || 0))[0]
  return w ? reason(workoutRow(w), t('Last workout')) : null
}

/** Up to three rows for right now, each with a `reason` that leads its subtitle. */
export function suggestionsFor(tab, data, now = new Date()) {
  const { S } = data
  const today = data.today || todayISO()
  const out = []
  const add = r => { if (r && out.length < 3 && !out.some(x => x.key === r.key)) out.push(r) }
  const slot = defaultMeal(data.ntSettings, now)
  const mealName = (data.mealNames || [])[slot] || ''
  if (tab === 'train') {
    const r = effectiveRoutines(S, today).find(x => (x.ex || []).length)
    if (r) add(reason(routineRow(r, S, [], today), t('Today’s routine')))
    add(lastWorkout(S))
    let top = null
    for (const [id, rec] of trainedIndex(S.workouts)) if (rec.n30 && (!top || rec.n30 > top.n30)) top = { id, n30: rec.n30 }
    const ex = top && ((S.customEx || []).find(e => e?.id === top.id) || EXIDX[top.id])
    if (ex) add(reason(exerciseRow(ex, S, []), t('Most trained this month')))
  } else if (tab === 'food') {
    if (data.nutrition) {
      const since = daysAgo(today, 30)
      const counts = new Map()
      for (const d of data.days || []) {
        if (d.date < since) continue
        for (const i of d.items) if (i.meal === slot && i.food_id != null) counts.set(i.food_id, (counts.get(i.food_id) || 0) + 1)
      }
      const usual = [...counts].sort((a, b) => b[1] - a[1])[0]
      const food = usual && (data.foods || []).find(f => f.id === usual[0])
      if (food) add(reason(foodRow(food), t('Usual at {0}', mealName)))
      const meal = [...(data.meals || [])].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))[0]
      if (meal?.usage_count) add(reason(mealRow(meal), t('Your top saved meal')))
    }
  } else if (tab === 'progress') {
    const since = daysAgo(today, 14)
    const pr = [...(S.workouts || [])].filter(w => String(w.d) >= since && (w.prs || []).length).sort((a, b) => String(b.d).localeCompare(String(a.d)))[0]
    const ex = pr && ((S.customEx || []).find(e => e?.id === pr.prs[0]) || EXIDX[pr.prs[0]])
    if (ex) add(reason(exerciseRow(ex, S, []), t('New record')))
    const week = isoOf(startOfWeek(today, weekStartOf(S)))
    const weighed = (S.bodyweight || []).some(b => String(b.d) >= week)
    if (!weighed) add(reason(pageResults([], data.pagesCtx, { all: true }).find(r => r.id === '/progress/body'), t('No weigh-in this week')))
  } else {
    if (data.nutrition) {
      const y = (data.days || []).find(d => d.date === daysAgo(today, 1))
      const item = y?.items.find(i => i.meal === slot)
      if (item) add({ ...dayResults([], [y], data.mealNames || [], { from: y.date, to: y.date, rest: [] })[0], title: item.name, ranges: [], uuid: item.uuid, reason: t('Yesterday at {0}', mealName) })
    }
    add(lastWorkout(S))
  }
  add(mostOpened(data, new Set(out.map(r => r.key))))
  return out
}
