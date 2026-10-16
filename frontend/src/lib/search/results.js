// The local sources of the global search and how their results are put together
// (fitness-eval ux-search.md §3, §5): pages, settings, exercises, routines, workouts, your foods
// (foods, saved meals and recipes) and diary days, each a group. Online (Open Food Facts) is
// asked for separately, being slow and budgeted (use-search-results.js).
//
// One result shape for every row:
//   { type, id, key, title, ranges, subtitle, subRanges, value, unit, media, score, exact,
//     wordPrefix, frecency, ...what its route needs }
// `media` is { kind: 'glyph', glyph } | { kind: 'thumb', ex } | { kind: 'date', iso }. `value` and
// `unit` are the trailing pair ("420" over "kcal"); `value` alone is a setting's current value.
import { dateLocale, t, tn } from '../i18n-core.js'
import { capWords, exCount, exerciseNameText, fmtDate, fmtDaysAgo, fmtDur, fmtNum, isoOf, todayISO } from '../format.js'
import { effectiveRoutineIds, setsDone, workoutDay, workoutDuration } from '../history.js'
import { isFav } from '../favourites.js'
import { searchExercises } from '../exercises.js'
import { foodKcal } from '../nutrition/diary.js'
import { mealKcal, servingsOf } from '../nutrition/meals.js'
import { matchRecord, queryWords, rangesIn } from './match.js'
import { inRange, parseDateQuery } from './date-words.js'
import { searchablePages, TAB_TITLE, TAB_GLYPH } from './pages.js'
import { settingsResults } from './settings-source.js'
import { openedScore } from './recents.js'

export const GROUPS = ['pages', 'settings', 'exercises', 'routines', 'workouts', 'foods', 'days', 'online']

// The order groups come in, by the tab the search was opened on. Online is always last.
export const GROUP_ORDER = {
  home: ['pages', 'exercises', 'foods', 'workouts', 'days', 'settings', 'routines', 'online'],
  train: ['exercises', 'routines', 'workouts', 'pages', 'settings', 'foods', 'days', 'online'],
  food: ['foods', 'days', 'pages', 'settings', 'exercises', 'routines', 'workouts', 'online'],
  progress: ['pages', 'exercises', 'workouts', 'days', 'settings', 'foods', 'routines', 'online'],
}

export const GROUP_LIMIT = 3

/** A group's title, and its noun for the summary line ("4 exercises"). */
export const groupTitle = g => ({
  pages: t('Pages'), settings: t('Settings'), exercises: t('Exercises'), routines: t('Routines'),
  workouts: t('Workouts'), foods: t('Your foods'), days: t('Days'), online: t('Open Food Facts'),
})[g]
export const groupCount = (g, n) => ({
  pages: tn('{0} page', '{0} pages', n), settings: tn('{0} setting', '{0} settings', n), exercises: tn('{0} exercise', '{0} exercises', n),
  routines: tn('{0} routine', '{0} routines', n), workouts: tn('{0} workout', '{0} workouts', n), foods: tn('{0} food', '{0} foods', n),
  days: tn('{0} day', '{0} days', n), online: t('{0} online', n),
})[g]

const keyOf = (type, id) => type + ':' + id
const byScore = (a, b) => b.score - a.score || b.frecency - a.frecency

/* ------------------------------------------------------------------ pages -------------------- */

/** Every record, unmatched: what a Recent entry or a suggestion is looked up in. */
export const UNMATCHED = { score: 0, ranges: [], exact: false, wordPrefix: false }

// `all`: no query, every page (to look one up).
export function pageResults(words, ctx, { all = false } = {}) {
  const out = []
  for (const p of searchablePages(ctx)) {
    const title = t(p.title)
    const m = all && !words.length ? UNMATCHED : matchRecord(words, { title, aliases: [p.kw, p.title], secondary: [t(TAB_TITLE[p.tab])] })
    if (!m) continue
    const off = typeof p.state === 'object' ? p.state.off : null
    const key = keyOf('page', p.path)
    out.push({
      type: 'page', id: p.path, key, title, ranges: m.ranges,
      subtitle: p.path === '/' + p.path.split('/')[1] ? t(TAB_TITLE[p.tab]) : [t(TAB_TITLE[p.tab]), title].join(' › '),
      media: { kind: 'glyph', glyph: p.glyph || TAB_GLYPH[p.tab] }, off,
      path: p.path, tab: p.tab,
      score: m.score, exact: m.exact, wordPrefix: m.wordPrefix, frecency: openedScore(key),
    })
  }
  return out.sort(byScore)
}

/* ------------------------------------------------------------------ exercises ---------------- */

// Per exercise, its last session and how often it was trained in the last 30 days: what a row
// shows ("80 kg × 5" over "3 d ago") and what orders ties. Worked out once per workout list.
let trainedCache = { workouts: null, map: new Map() }
export function trainedIndex(workouts = []) {
  if (trainedCache.workouts === workouts) return trainedCache.map
  const map = new Map()
  const month = isoOf(new Date(Date.now() - 30 * 86400000))
  for (const w of [...workouts].sort((a, b) => String(b.d).localeCompare(String(a.d)))) {
    const day = workoutDay(w)
    for (const e of w.entries || []) {
      if (!e?.id) continue
      const done = (e.sets || []).filter(s => s && s.done)
      if (!done.length) continue
      let rec = map.get(e.id)
      if (!rec) {
        const top = done.reduce((b, s) => ((Number(s.w) || 0) > (Number(b.w) || 0) ? s : b), done[0])
        rec = { last: day, top, n30: 0, n: 0 }
        map.set(e.id, rec)
      }
      rec.n++
      if (day && day >= month) rec.n30++
    }
  }
  trainedCache = { workouts, map }
  return map
}

const topLine = (top, unit) => {
  if (!top) return null
  if (Number(top.w) > 0 && Number(top.r) > 0) return t('{0} {1} × {2}', fmtNum(top.w), unit, top.r)
  if (Number(top.r) > 0) return tn('{0} rep', '{0} reps', Number(top.r))
  if (Number(top.sec) > 0) return t('{0} s', top.sec)
  return null
}

export function exerciseRow(ex, S, words, trained = trainedIndex(S.workouts)) {
  const title = exerciseNameText(ex)
  const rec = trained.get(ex.id)
  const key = keyOf('exercise', ex.id)
  return {
    type: 'exercise', id: ex.id, key, title, ranges: words.length ? rangesIn(title, words) : [],
    subtitle: [ex.tg && capWords(t(ex.tg)), ex.eq && capWords(t(ex.eq))].filter(Boolean).join(' · '),
    media: { kind: 'thumb', ex }, fav: isFav(S, ex.id), ex,
    value: rec ? topLine(rec.top, S.unit || 'kg') : null, unit: rec?.last ? fmtDaysAgo(rec.last) : null,
    frecency: (rec ? rec.n30 * 2 + Math.min(rec.n, 20) / 10 : 0) + openedScore(key) + (isFav(S, ex.id) ? 1 : 0),
  }
}

export function exerciseResults(words, query, S, list) {
  const trained = trainedIndex(S.workouts)
  const found = searchExercises(list, query)
  return found.map((ex, i) => {
    const row = exerciseRow(ex, S, words, trained)
    const m = matchRecord(words, { title: row.title })
    // The exercise search's own order stands; our score only says how it sits against other
    // groups (Best match) and lets frecency break the ties it leaves.
    return { ...row, score: m ? m.score : 0, exact: !!m?.exact, wordPrefix: !!m?.wordPrefix, rank: i }
  }).sort((a, b) => b.score - a.score || b.frecency - a.frecency || a.rank - b.rank)
}

/* ------------------------------------------------------------------ routines ----------------- */

function nextDayOf(S, id, today) {
  for (let i = 0; i < 7; i++) {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() + i)
    const iso = isoOf(d)
    if (effectiveRoutineIds(S, iso, today).includes(id)) return iso
  }
  return null
}

export function routineRow(r, S, words = [], today = todayISO()) {
  const next = nextDayOf(S, r.id, today)
  const when = !next ? null : next === today ? t('Today') : t('next {0}', new Date(next + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short' }))
  const key = keyOf('routine', r.id)
  return {
    type: 'routine', id: r.id, key, title: r.name || t('Routine'), ranges: words.length ? rangesIn(r.name || '', words) : [],
    subtitle: [exCount((r.ex || []).length), when].filter(Boolean).join(' · '),
    media: { kind: 'glyph', glyph: 'clipboard' }, frecency: openedScore(key),
  }
}

export function routineResults(words, S, names, today) {
  const out = []
  for (const r of S.routines || []) {
    const exNames = (r.ex || []).map(e => names(e.id)).filter(Boolean)
    const m = matchRecord(words, { title: r.name || '', secondary: exNames })
    if (!m) continue
    out.push({ ...routineRow(r, S, words, today), score: m.score, exact: m.exact, wordPrefix: m.wordPrefix })
  }
  return out.sort(byScore)
}

/* ------------------------------------------------------------------ workouts ----------------- */

export function workoutRow(w, extra = {}) {
  const dur = workoutDuration(w)
  const key = keyOf('workout', w.id)
  return {
    type: 'workout', id: w.id, key, title: w.name || t('Freestyle'), ranges: [],
    subtitle: [dur >= 60000 ? fmtDur(dur) : null, tn('{0} set', '{0} sets', setsDone(w))].filter(Boolean).join(' · '),
    media: { kind: 'date', iso: workoutDay(w) || w.d }, workout: w, frecency: 0, ...extra,
  }
}

export function workoutResults(words, S, names, date) {
  const out = []
  const rest = date ? date.rest : words
  for (const w of S.workouts || []) {
    const day = workoutDay(w) || w.d
    if (date && !inRange(day, date)) continue
    const recency = day ? Date.parse(day + 'T12:00:00') / 864e8 : 0
    if (!rest.length) { out.push(workoutRow(w, { score: 30, frecency: recency })); continue }
    const title = w.name || t('Freestyle')
    const m = matchRecord(rest, { title })
    if (m) { out.push(workoutRow(w, { ranges: m.ranges, score: m.score, exact: m.exact, wordPrefix: m.wordPrefix, frecency: recency })); continue }
    // Matched on an exercise it holds: "Includes Bench press", the exercise in bold.
    for (const e of w.entries || []) {
      const name = names(e.id)
      const em = name && matchRecord(rest, { title: name })
      if (!em) continue
      const lead = t('Includes {0}', '\u0000')
      const [before] = lead.split('\u0000')
      const subtitle = lead.replace('\u0000', name)
      const subRanges = em.ranges.map(([a, b]) => [a + before.length, b + before.length])
      out.push(workoutRow(w, { subtitle, subRanges, score: em.score / 2, frecency: recency }))
      break
    }
  }
  return out.sort(byScore)
}

/* ------------------------------------------------------------------ your foods --------------- */

export function foodRow(f, words = []) {
  const key = keyOf('food', f.id)
  return {
    type: 'food', id: f.id, key, title: f.name, ranges: words.length ? rangesIn(f.name, words) : [],
    subtitle: [f.brand, `${fmtNum(Number(f.portion) || 100)} ${f.unit || 'g'}`].filter(Boolean).join(' · '),
    media: f.imgUrl ? { kind: 'photo', src: f.imgUrl } : { kind: 'glyph', glyph: 'apple' },
    value: foodKcal(f), unit: 'kcal', food: f, frecency: (f.usage_count || 0) + openedScore(key),
  }
}

export function mealRow(m, words = []) {
  const type = m.is_recipe ? 'recipe' : 'meal'
  const key = keyOf(type, m.id)
  return {
    type, id: m.id, key, title: m.name, ranges: words.length ? rangesIn(m.name, words) : [],
    subtitle: m.is_recipe ? t('Recipe · {0}', tn('{0} serving', '{0} servings', servingsOf(m))) : t('Saved meal · {0}', tn('{0} item', '{0} items', (m.items || []).length)),
    media: { kind: 'glyph', glyph: m.is_recipe ? 'cookingPot' : 'utensils' },
    value: mealKcal(m), unit: 'kcal', meal: m, frecency: (m.usage_count || 0) + openedScore(key),
  }
}

export function foodResults(words, { foods = [], meals = [], recipes = [] }) {
  const out = []
  for (const f of foods) {
    const m = matchRecord(words, { title: f.name || '', secondary: [f.brand] })
    if (m) out.push({ ...foodRow(f, words), score: m.score, exact: m.exact, wordPrefix: m.wordPrefix })
  }
  for (const meal of [...meals, ...recipes]) {
    const m = matchRecord(words, { title: meal.name || '', secondary: (meal.items || []).map(i => i.name) })
    if (m) out.push({ ...mealRow(meal, words), score: m.score, exact: m.exact, wordPrefix: m.wordPrefix })
  }
  return out.sort(byScore)
}

/* ------------------------------------------------------------------ days --------------------- */

// A day the index holds only part of (diary-index.js `truncated`) is still found by what it
// holds, and says it is partial.
export function dayResults(words, days, mealNames, date) {
  const out = []
  const rest = date ? date.rest : words
  for (const d of days) {
    if (date && !inRange(d.date, date)) continue
    const recency = Date.parse(d.date + 'T12:00:00') / 864e8
    const partial = d.truncated === true
    const base = { type: 'day', id: d.date, key: keyOf('day', d.date), media: { kind: 'date', iso: d.date }, value: d.kcal, unit: 'kcal', date: d.date, frecency: recency, partial }
    const mark = partial ? t('partly indexed') : null
    if (!rest.length) {
      if (!d.items.length && !partial) continue
      out.push({ ...base, title: fmtDate(d.date, true), ranges: [], subtitle: [tn('{0} item', '{0} items', d.items.length), mark].filter(Boolean).join(' · '), uuid: null, score: 30 })
      continue
    }
    let best = null
    let more = 0
    for (const item of d.items) {
      const m = matchRecord(rest, { title: item.name, secondary: [item.brand, ...(item.parts || [])] })
      if (!m) continue
      if (!best || m.score > best.m.score) { if (best) more++; best = { item, m } } else more++
    }
    if (!best) continue
    const meal = mealNames[best.item.meal] ?? mealNames[0] ?? ''
    const when = d.date === todayISO() ? t('Today') : fmtDate(d.date, true)
    out.push({
      ...base, title: best.item.name, ranges: best.m.ranges, uuid: best.item.uuid,
      subtitle: [meal, when, more ? t('+{0} more', more) : null, mark].filter(Boolean).join(' · '),
      score: best.m.score, exact: false, wordPrefix: false,
    })
  }
  return out.sort(byScore)
}

/* ------------------------------------------------------------------ together ----------------- */

/**
 * Every local group for a query. `data`: { S, exercises, nameOf, foods, meals, recipes, days,
 * mealNames, pagesCtx, settingsCtx, nutrition, today }. Returns { groups, best, order, total } where
 * `best` (at most one, ux §3) is the result that clearly wins, taken out of its group.
 */
export function searchLocal(query, data, tab = 'home') {
  const words = queryWords(query)
  const order = GROUP_ORDER[tab] || GROUP_ORDER.home
  const empty = Object.fromEntries(GROUPS.map(g => [g, []]))
  if (!words.length) return { groups: empty, best: null, order, total: 0, words }
  const date = parseDateQuery(query, { today: data.today, weekStart: data.weekStart })
  const groups = {
    ...empty,
    pages: pageResults(words, data.pagesCtx),
    settings: settingsResults(words, data.S, data.settingsCtx),
    exercises: exerciseResults(words, query, data.S, data.exercises),
    routines: routineResults(words, data.S, data.nameOf, data.today),
    workouts: workoutResults(words, data.S, data.nameOf, date),
    foods: data.nutrition ? foodResults(words, data) : [],
    days: data.nutrition ? dayResults(words, data.days || [], data.mealNames || [], date) : [],
  }
  const best = bestMatch(groups, order)
  if (best) groups[best.group] = groups[best.group].filter(r => r.key !== best.result.key)
  const total = GROUPS.reduce((n, g) => n + groups[g].length, 0) + (best ? 1 : 0)
  return { groups, best, order, total, words, date }
}

// The one result that clearly wins: the only one whose title is the query, else the only one
// whose title starts with it on a word boundary. Two equal claims, and nobody wins.
export function bestMatch(groups, order) {
  const all = order.filter(g => g !== 'online').flatMap(g => (groups[g] || []).map(result => ({ group: g, result })))
  const exact = all.filter(x => x.result.exact)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const prefix = all.filter(x => x.result.wordPrefix)
  return prefix.length === 1 ? prefix[0] : null
}

/** A scoped group with nothing typed: all of it (the scope token's count, "Exercises 5,612"). */
export function listAll(group, data) {
  const { S } = data
  switch (group) {
    case 'pages': return pageResults([], data.pagesCtx, { all: true })
    case 'settings': return settingsResults([], S, data.settingsCtx, t, { all: true })
    case 'exercises': { const trained = trainedIndex(S.workouts); return data.exercises.map(ex => exerciseRow(ex, S, [], trained)) }
    case 'routines': return (S.routines || []).map(r => routineRow(r, S, [], data.today))
    case 'workouts': return [...(S.workouts || [])].sort((a, b) => String(b.d).localeCompare(String(a.d))).map(w => workoutRow(w))
    case 'foods': return data.nutrition ? [...(data.foods || []).map(f => foodRow(f)), ...[...(data.meals || []), ...(data.recipes || [])].map(m => mealRow(m))] : []
    case 'days': return data.nutrition ? dayResults([], data.days || [], data.mealNames || [], { from: '0000-00-00', to: '9999-99-99', rest: [] }) : []
    default: return []
  }
}

/** The summary line's entries, in group order, largest count marked. */
export function summaryOf(groups, order, extra = {}) {
  const entries = order.map(g => ({ group: g, count: (groups[g] || []).length + (extra[g] || 0) })).filter(e => e.count > 0)
  const max = Math.max(0, ...entries.map(e => e.count))
  return entries.map(e => ({ ...e, emphasized: e.count === max }))
}
