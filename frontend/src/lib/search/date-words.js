// Date words in a search (fitness-eval ux-search.md §3): "yesterday", "tuesday", "13 oct",
// "oct 13", "october", "last week", "this week". The English words always work; the app's own
// language works through Intl's weekday and month names and the app's own "Today", "Yesterday",
// "This week" and "Last week". A date always means the past: "tuesday" is the latest Tuesday up
// to today, "13 oct" the latest 13 October.
//
// parseDateQuery answers the range the words name and the query's other words, so "chicken
// tuesday" finds the chicken logged on Tuesday and "tuesday" alone lists that day.
import { dateLocale, t } from '../i18n-core.js'
import { isoOf, MONDAY, startOfWeek, todayISO } from '../format.js'
import { fold } from './match.js'

const EN_DAYS = [['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tue', 'tues'], ['wednesday', 'wed'], ['thursday', 'thu', 'thur', 'thurs'], ['friday', 'fri'], ['saturday', 'sat']]
const EN_MONTHS = [['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may'], ['june', 'jun'], ['july', 'jul'], ['august', 'aug'], ['september', 'sep', 'sept'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec']]

const noon = iso => new Date(iso + 'T12:00:00')
const addDays = (iso, n) => { const d = noon(iso); d.setDate(d.getDate() + n); return isoOf(d) }

const names = (opts, n, make) => {
  try {
    const f = new Intl.DateTimeFormat(dateLocale(), opts)
    return Array.from({ length: n }, (_, i) => fold(f.format(make(i))).replace(/\.$/, ''))
  } catch { return [] }
}

// Every word for each weekday (0 = Sunday) and each month, English and the app's language.
let cache = { locale: null }
function vocab() {
  const locale = dateLocale()
  if (cache.locale === locale) return cache
  const days = EN_DAYS.map(list => new Set(list))
  // 2024-01-07 was a Sunday.
  for (const opts of [{ weekday: 'long' }, { weekday: 'short' }]) {
    names(opts, 7, i => new Date(2024, 0, 7 + i, 12)).forEach((w, i) => w && days[i].add(w))
  }
  const months = EN_MONTHS.map(list => new Set(list))
  for (const opts of [{ month: 'long' }, { month: 'short' }]) {
    names(opts, 12, i => new Date(2024, i, 15, 12)).forEach((w, i) => w && months[i].add(w))
  }
  const phrase = s => fold(s).split(/\s+/).filter(Boolean)
  const today = new Set(['today', fold(t('Today'))])
  const yesterday = new Set(['yesterday', fold(t('Yesterday'))])
  cache = { locale, days, months, today, yesterday, thisWeek: [['this', 'week'], phrase(t('This week'))], lastWeek: [['last', 'week'], phrase(t('Last week'))] }
  return cache
}

const dayOf = (v, w) => v.days.findIndex(set => set.has(w))
const monthOf = (v, w) => v.months.findIndex(set => set.has(w))
const dayNum = w => (/^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31 ? +w : null)

// The latest `month`/`day` on or before today: this year's, else last year's.
function latestDate(month, day, today) {
  for (const y of [+today.slice(0, 4), +today.slice(0, 4) - 1]) {
    const d = new Date(y, month, day, 12)
    if (d.getMonth() !== month) continue
    const iso = isoOf(d)
    if (iso <= today) return iso
  }
  return null
}

function latestMonth(month, today) {
  let y = +today.slice(0, 4)
  if (month > +today.slice(5, 7) - 1) y -= 1
  const from = isoOf(new Date(y, month, 1, 12))
  const last = isoOf(new Date(y, month + 1, 0, 12))
  return { from, to: last < today ? last : today }
}

const samePhrase = (words, i, phrase) => phrase.length > 0 && phrase.every((p, k) => words[i + k] === p)

/**
 * The date range a query names, or null. `{ from, to, rest, at }`: ISO days inclusive, the
 * query's other words (folded), and what the words matched as ('day' | 'week' | 'month').
 */
export function parseDateQuery(query, { today = todayISO(), weekStart = MONDAY } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const v = vocab()
  const done = (i, n, r) => ({ ...r, rest: [...words.slice(0, i), ...words.slice(i + n)] })
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    for (const phrase of v.lastWeek) {
      if (samePhrase(words, i, phrase)) {
        const start = isoOf(startOfWeek(today, weekStart))
        return done(i, phrase.length, { from: addDays(start, -7), to: addDays(start, -1), at: 'week' })
      }
    }
    for (const phrase of v.thisWeek) {
      if (samePhrase(words, i, phrase)) return done(i, phrase.length, { from: isoOf(startOfWeek(today, weekStart)), to: today, at: 'week' })
    }
    if (v.today.has(w)) return done(i, 1, { from: today, to: today, at: 'day' })
    if (v.yesterday.has(w)) { const y = addDays(today, -1); return done(i, 1, { from: y, to: y, at: 'day' }) }
    const month = monthOf(v, w)
    if (month >= 0) {
      const before = i > 0 ? dayNum(words[i - 1]) : null
      const after = dayNum(words[i + 1] || '')
      if (before != null) { const iso = latestDate(month, before, today); if (iso) return done(i - 1, 2, { from: iso, to: iso, at: 'day' }) }
      if (after != null) { const iso = latestDate(month, after, today); if (iso) return done(i, 2, { from: iso, to: iso, at: 'day' }) }
      return done(i, 1, { ...latestMonth(month, today), at: 'month' })
    }
    const wd = dayOf(v, w)
    if (wd >= 0) {
      const back = (noon(today).getDay() - wd + 7) % 7
      const iso = addDays(today, -back)
      return done(i, 1, { from: iso, to: iso, at: 'day' })
    }
  }
  return null
}

export const inRange = (iso, r) => !!r && iso >= r.from && iso <= r.to
