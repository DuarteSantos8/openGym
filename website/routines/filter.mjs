// What the routines list shows for a search, a set of filters and a sort. Pure functions, used by
// list.js in the browser and by scripts/routines/filter.test.mjs. A routine here is the compact
// record the list page carries in #rt-data (scripts/routines/render.mjs listPage).

export const GROUPS = ['goal', 'days', 'len', 'kit', 'level', 'focus', 'split', 'lang']
export const SORTS = ['new', 'popular', 'name', 'short']

/** Lowercase, accents off, so "Bankdrücken" is found by "bankdrucken" and the other way round. */
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = s => fold(s).match(/[\p{L}\p{N}]+/gu) || []

export function emptyState() {
  return { q: '', goal: [], days: [], len: '', kit: [], level: [], focus: [], split: [], lang: [], sort: 'new' }
}

export function stateFromQuery(search) {
  const p = new URLSearchParams(search)
  const s = emptyState()
  s.q = (p.get('q') || '').slice(0, 100)
  for (const g of GROUPS) {
    if (g === 'len') { s.len = ['30', '45', '60', '61'].includes(p.get('len')) ? p.get('len') : ''; continue }
    s[g] = (p.get(g) || '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 12)
  }
  if (SORTS.includes(p.get('sort'))) s.sort = p.get('sort')
  return s
}

export function queryFromState(s) {
  const p = new URLSearchParams()
  if (s.q.trim()) p.set('q', s.q.trim())
  for (const g of GROUPS) {
    if (g === 'len') { if (s.len) p.set('len', s.len); continue }
    if (s[g].length) p.set(g, s[g].join(','))
  }
  if (s.sort !== 'new') p.set('sort', s.sort)
  const q = p.toString().replace(/%2C/g, ',')
  return q ? '?' + q : ''
}

export const activeCount = s => GROUPS.reduce((n, g) => n + (g === 'len' ? (s.len ? 1 : 0) : s[g].length), 0)

/** The text a routine is searched in: its words, its days, and its exercises in every language. */
export function haystack(r, names = {}) {
  return fold([r.t, r.d, r.a, ...(r.tags || []), ...(r.sn || []), ...(r.ex || []).map(id => names[id] || '')].join(' \n '))
}

function passGroup(r, g, s) {
  switch (g) {
    case 'goal': return !s.goal.length || s.goal.includes(r.g)
    case 'days': return !s.days.length || s.days.includes(String(r.n))
    case 'len': return !s.len || (s.len === '61' ? r.m > 60 : r.m <= Number(s.len))
    // What you have: a routine fits when it needs nothing beyond it ("Nothing, just me" alone
    // leaves the body-weight ones).
    case 'kit': return !s.kit.length || r.k.every(k => s.kit.includes(k))
    case 'level': return !s.level.length || s.level.includes(r.l)
    case 'focus': return !s.focus.length || r.f.some(f => s.focus.includes(f))
    case 'split': return !s.split.length || s.split.includes(r.sp)
    case 'lang': return !s.lang.length || s.lang.includes(r.lang)
  }
  return true
}

export function matches(r, s, hay) {
  for (const g of GROUPS) if (!passGroup(r, g, s)) return false
  const q = words(s.q)
  if (q.length) {
    const h = hay ?? haystack(r)
    if (!q.every(w => h.includes(w))) return false
  }
  return true
}

/**
 * For every option, how many routines there would be with it picked and everything else as it is.
 * { goal: { strength: 3, … }, … }. `hays` holds each routine's haystack (by slug), or nothing.
 */
export function facetCounts(list, s, options, hays = {}) {
  const out = {}
  for (const g of GROUPS) {
    out[g] = {}
    for (const v of options[g] || []) {
      const t = { ...s }
      if (g === 'len') t.len = v
      else if (g === 'kit') t.kit = [...new Set([...s.kit, v])]
      else t[g] = [v]
      out[g][v] = list.reduce((n, r) => n + (matches(r, t, hays[r.s]) ? 1 : 0), 0)
    }
  }
  return out
}

export function sortRoutines(list, sort, popular = {}) {
  const by = {
    new: (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0),
    popular: (a, b) => (popular[b.id] || 0) - (popular[a.id] || 0) || (a.at < b.at ? 1 : -1),
    name: (a, b) => a.t.localeCompare(b.t, 'en', { sensitivity: 'base' }),
    short: (a, b) => a.m - b.m || a.t.localeCompare(b.t, 'en')
  }[sort] || (() => 0)
  return list.map((r, i) => [r, i]).sort((x, y) => by(x[0], y[0]) || x[1] - y[1]).map(x => x[0])
}
