// What the routines list shows for a search, a set of filters and a sort. Pure functions, used by
// list.js in the browser and by scripts/routines/routines.test.mjs. A routine here is the compact
// record the list page carries in #rt-data (scripts/routines/render.mjs listPage).
//
// The rules, in one place:
//  - Within a group the picks are OR (Strength or Muscle), across groups AND (and 3 days a week).
//  - Equipment means "uses it": Barbell lists routines with a barbell in them. "No equipment"
//    lists the ones that need nothing. With `kitonly` on, the picks become "what I have": a routine
//    fits when it needs nothing beyond them (body-weight routines always fit).
//  - `home` is "no barbell, cable or machine": what fits a flat with a few bits of kit.
//  - Muscle focus is what a routine leans on (lib.mjs focusOf); "balanced" is the ones that don't lean.

export const GROUPS = ['goal', 'days', 'len', 'kit', 'level', 'focus', 'split', 'lang']
export const SORTS = ['new', 'popular', 'name', 'short']
export const LENS = ['30', '45', '60', '61']
/** What a home without a barbell, cable stack or machines still has room for. */
export const GYM_ONLY = ['barbell', 'cable', 'machine']

/** Lowercase, accents off, so "Bankdrücken" is found by "bankdrucken" and the other way round. */
export const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export const words = s => fold(s).match(/[\p{L}\p{N}]+/gu) || []

export function emptyState() {
  return { q: '', goal: [], days: [], len: '', kit: [], kitonly: false, home: false, level: [], focus: [], split: [], lang: [], sort: 'new' }
}

export function stateFromQuery(search) {
  const p = new URLSearchParams(search)
  const s = emptyState()
  s.q = (p.get('q') || '').slice(0, 100)
  for (const g of GROUPS) {
    if (g === 'len') { s.len = LENS.includes(p.get('len')) ? p.get('len') : ''; continue }
    s[g] = [...new Set((p.get(g) || '').split(',').map(v => v.trim()).filter(Boolean))].slice(0, 12)
  }
  s.kitonly = p.get('have') === 'only' && s.kit.length > 0
  s.home = p.get('home') === '1'
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
  if (s.kitonly && s.kit.length) p.set('have', 'only')
  if (s.home) p.set('home', '1')
  if (s.sort !== 'new') p.set('sort', s.sort)
  const q = p.toString().replace(/%2C/g, ',')
  return q ? '?' + q : ''
}

/** How many filters are on (the search and the sort are not filters). */
export const activeCount = s => GROUPS.reduce((n, g) => n + (g === 'len' ? (s.len ? 1 : 0) : s[g].length), 0) + (s.home ? 1 : 0)

/** The text a routine is searched in: its words, its days, and its exercises in every language. */
export function haystack(r, names = {}) {
  return fold([r.t, r.d, r.a, ...(r.tags || []), ...(r.sn || []), ...(r.ex || []).map(id => names[id] || '')].join(' \n '))
}

function passGroup(r, g, s) {
  switch (g) {
    case 'goal': return !s.goal.length || s.goal.includes(r.g)
    case 'days': return !s.days.length || s.days.includes(String(r.n))
    case 'len': return !s.len || (s.len === '61' ? r.m > 60 : r.m <= Number(s.len))
    case 'kit':
      if (!s.kit.length) return true
      if (s.kitonly) return r.k.every(k => s.kit.includes(k))
      return s.kit.some(v => (v === 'bodyweight' ? r.k.length === 0 : r.k.includes(v)))
    case 'level': return !s.level.length || s.level.includes(r.l)
    case 'focus': return !s.focus.length || s.focus.some(f => (f === 'balanced' ? !r.f.length : r.f.includes(f)))
    case 'split': return !s.split.length || s.split.includes(r.sp)
    case 'lang': return !s.lang.length || s.lang.includes(r.lang)
  }
  return true
}

export function matches(r, s, hay) {
  for (const g of GROUPS) if (!passGroup(r, g, s)) return false
  if (s.home && r.k.some(k => GYM_ONLY.includes(k))) return false
  const q = words(s.q)
  if (q.length) {
    const h = hay ?? haystack(r)
    if (!q.every(w => h.includes(w))) return false
  }
  return true
}

/**
 * For every option, how many routines there are with that option picked in its group and every
 * other group as it is: the number the list would show for that option on its own. With "only
 * what I have" on, an equipment option counts as added to the kit already picked.
 * { goal: { strength: 3, … }, … }. `hays` holds each routine's haystack (by slug), or nothing.
 */
export function facetCounts(list, s, options, hays = {}) {
  const out = {}
  for (const g of GROUPS) {
    out[g] = {}
    for (const v of options[g] || []) {
      const t = { ...s }
      if (g === 'len') t.len = v
      else if (g === 'kit' && s.kitonly) t.kit = [...new Set([...s.kit, v])]
      else t[g] = [v]
      out[g][v] = list.reduce((n, r) => n + (matches(r, t, hays[r.s]) ? 1 : 0), 0)
    }
  }
  return out
}

/** Quick picks: one tap for the questions people ask first. Each is just a filter state. */
export const QUICK = {
  nokit: { on: s => s.kit.length === 1 && s.kit[0] === 'bodyweight' && !s.kitonly, set: (s, on) => ({ ...s, kit: on ? ['bodyweight'] : [], kitonly: false }) },
  home: { on: s => s.home, set: (s, on) => ({ ...s, home: on }) },
  beginner: { on: s => s.level.length === 1 && s.level[0] === 'beginner', set: (s, on) => ({ ...s, level: on ? ['beginner'] : [] }) },
  short: { on: s => s.len === '30', set: (s, on) => ({ ...s, len: on ? '30' : '' }) }
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

/**
 * Where the search words sit in a piece of shown text, accents and case ignored, as
 * [[start, end], …] in the original string (merged, in order). For the <mark> highlights.
 */
export function highlightRanges(text, q) {
  const ws = words(q)
  if (!ws.length || !text) return []
  // Fold one character at a time, remembering where each folded character came from.
  let folded = ''
  const from = []
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i])
    for (let k = 0; k < f.length; k++) { folded += f[k]; from.push(i) }
  }
  const hits = []
  for (const w of ws) {
    let at = folded.indexOf(w)
    while (at >= 0) {
      hits.push([from[at], from[at + w.length - 1] + 1])
      at = folded.indexOf(w, at + w.length)
    }
  }
  hits.sort((a, b) => a[0] - b[0])
  const out = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1])
    else out.push([...h])
  }
  return out
}
