// Home and Stats are yours to arrange (Discord 2026-11-15, #1119): every card can be shown, folded
// to one line, or hidden, and moved up or down among its neighbours. Home is one list; Stats
// keeps its four parts (Overview, Body, Lifts, Effort) and a card moves inside its own part, so
// the sticky index above the page keeps meaning what it says.
//
// What is stored, with the rest of the profile (it syncs like any other setting):
//   S.layout = { home: { order: [ids], hidden: [ids], folded: [ids] }, stats: { ... } }
// Nothing stored means the page as it always was. An id the list does not know (a card from a
// newer version, or one that was removed) is ignored, and a card that is not in `order` yet
// (new in this version) keeps its built-in place, so an update never drops a card off the page.
//
// The labels are existing strings, translated where they are shown (t(label)). `needs` is the
// module (Settings → Modules) a card belongs to: with it off the card is not offered at all.

import { recapPeriod } from './recap.js'

export const PAGES = {
  home: [
    { id: 'recap', label: 'Your week' },
    { id: 'recovery', label: 'Recovery tips', needs: 'health' },
    { id: 'deload', label: 'Deload week' },
    { id: 'challenges', label: 'Challenges' },
    { id: 'checkin', label: 'Check in', needs: 'checkin' },
    // Settings → Look & Home has had a switch for this card since v1.3: it stays the one truth.
    { id: 'bodyweight', label: 'Body weight', legacy: 'showWeightCard', needs: 'body' },
    { id: 'streak', label: 'Streak' },
  ],
  stats: [
    { id: 'totals', label: 'Totals', group: 'overview' },
    { id: 'streak', label: 'Streak', group: 'overview', needs: 'motivation' },
    { id: 'challenges', label: 'Challenges', group: 'overview', needs: 'motivation' },
    { id: 'dailyform', label: 'Daily form', group: 'overview', needs: 'health' },
    { id: 'cardio', label: 'Cardio', group: 'overview' },
    { id: 'activity', label: 'Activity', group: 'overview' },
    { id: 'recent', label: 'Recent workouts', group: 'overview' },
    { id: 'bodyweight', label: 'Body weight', group: 'body', needs: 'body' },
    { id: 'progress', label: 'Exercise progress', group: 'lifts' },
    { id: 'muscles', label: 'Sets per muscle', group: 'lifts' },
    { id: 'strength', label: 'Strength levels', group: 'lifts', needs: 'strength' },
    { id: 'effort', label: 'Effort', group: 'effort', needs: 'effort' },
    { id: 'time', label: 'Time per exercise', group: 'effort' },
  ],
}

export const GROUP_LABELS = { overview: 'Overview', body: 'Body', lifts: 'Lifts', effort: 'Effort' }

const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])

/** The stored layout of a page, cleaned: three lists of known ids, never undefined. */
export function layoutOf(S, page) {
  const known = new Set((PAGES[page] || []).map(c => c.id))
  const raw = (S && S.layout && S.layout[page]) || {}
  const only = v => [...new Set(list(v).filter(id => known.has(id)))]
  const hidden = only(raw.hidden)
  for (const c of PAGES[page] || []) if (c.legacy && S && S[c.legacy] === false && !hidden.includes(c.id)) hidden.push(c.id)
  return { order: only(raw.order), hidden, folded: only(raw.folded).filter(id => !hidden.includes(id)) }
}

/** 'shown', 'folded' or 'hidden'. */
export function cardState(S, page, id) {
  const l = layoutOf(S, page)
  return l.hidden.includes(id) ? 'hidden' : l.folded.includes(id) ? 'folded' : 'shown'
}

/**
 * Every card of the page in the order it is drawn. Cards the person moved come in their stored
 * order; a card that is not in the stored order sits after the built-in neighbour before it.
 */
export function orderedCards(S, page) {
  const cards = PAGES[page] || []
  const { order } = layoutOf(S, page)
  if (!order.length) return cards
  const byId = new Map(cards.map(c => [c.id, c]))
  const out = order.map(id => byId.get(id))
  cards.forEach((c, i) => {
    if (order.includes(c.id)) return
    // after the nearest built-in predecessor that is already placed, else at the front
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(cards[j])
      if (k >= 0) { at = k + 1; break }
    }
    out.splice(at, 0, c)
  })
  return out
}

/** The ids of `ids` (the cards a view can draw right now) in drawing order, hidden ones left out. */
export function arrange(S, page, ids) {
  const have = new Set(ids)
  const { hidden } = layoutOf(S, page)
  return orderedCards(S, page).map(c => c.id).filter(id => have.has(id) && !hidden.includes(id))
}

/** True when every card of this part of the page is hidden: the part and its index entry go too. */
export function groupHidden(S, page, group) {
  const { hidden } = layoutOf(S, page)
  const mine = (PAGES[page] || []).filter(c => c.group === group)
  return mine.length > 0 && mine.every(c => hidden.includes(c.id))
}

/** True when the person changed anything on this page. */
export function isCustom(S, page) {
  const l = layoutOf(S, page)
  return l.order.length > 0 || l.hidden.length > 0 || l.folded.length > 0
}

// The writers below change the draft `s` in place (useStore's update(s => …)).
function slot(s, page) {
  const l = layoutOf(s, page)
  s.layout = { ...(s.layout && typeof s.layout === 'object' ? s.layout : {}), [page]: l }
  return l
}

// Some Home cards also have their own × that puts them away for a while: the challenges until next
// month (S.challengesHidden = 'YYYY-MM'), the recovery tip for today (S.recoveryHintDay), the week
// or month recap until the next one (S.recapSeen, the recap's key; Discord 2026-11-24). Such a
// card drew nothing, so the sheet left it out and nothing brought it back (Discord 2026-11-20).
// The sheet now lists it as hidden, says until when, and Show clears the ×.
const pad2 = n => String(n).padStart(2, '0')
const monthOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
const dayOf = d => `${monthOf(d)}-${pad2(d.getDate())}`
const DISMISS = {
  home: {
    recap: { on: (S, now) => !!S.recapSeen && S.recapSeen === recapPeriod(S, dayOf(now))?.key, clear: s => { s.recapSeen = null }, note: 'Hidden until the next recap.' },
    challenges: { on: (S, now) => S.challengesHidden === monthOf(now), clear: s => { s.challengesHidden = null }, note: 'Hidden until next month.' },
    recovery: { on: (S, now) => S.recoveryHintDay === dayOf(now), clear: s => { s.recoveryHintDay = null }, note: 'Hidden for today. Back tomorrow.' },
  },
}

/** The note (an English string, t() it) for a card put away with its own ×, or null. */
export function dismissedNote(S, page, id, now = new Date()) {
  const d = DISMISS[page]?.[id]
  return d && S && d.on(S, now) ? d.note : null
}

/** Brings back every card of the page that its own × put away. Mutates the draft `s`. */
export function clearDismissed(s, page, id) {
  for (const [k, d] of Object.entries(DISMISS[page] || {})) if (id == null || id === k) d.clear(s)
}

export function setCardState(s, page, id, state) {
  if (state !== 'hidden') clearDismissed(s, page, id)
  const l = slot(s, page)
  l.hidden = l.hidden.filter(x => x !== id)
  l.folded = l.folded.filter(x => x !== id)
  const legacy = (PAGES[page] || []).find(c => c.id === id)?.legacy
  if (legacy) s[legacy] = state !== 'hidden'
  else if (state === 'hidden') l.hidden.push(id)
  if (state === 'folded') l.folded.push(id)
}

/**
 * Moves a card one place up (-1) or down (+1) among the cards of its own group. Returns whether
 * it moved; at the edge of its group it stays.
 */
export function moveCard(s, page, id, dir) {
  const all = orderedCards(s, page)
  const me = all.find(c => c.id === id)
  if (!me) return false
  const peers = all.filter(c => c.group === me.group)
  const i = peers.indexOf(me), other = peers[i + dir]
  if (!other) return false
  const ids = all.map(c => c.id)
  const a = ids.indexOf(id), b = ids.indexOf(other.id)
  ids[a] = other.id; ids[b] = id
  slot(s, page).order = ids
  return true
}

/**
 * Puts a card where `targetId` is, among the whole page's order: after it when it came from
 * above, before it when it came from below (one drag in the Customize sheet). Cards between them
 * that the sheet does not list keep their places relative to each other.
 */
export function placeCard(s, page, id, targetId) {
  const ids = orderedCards(s, page).map(c => c.id)
  const a = ids.indexOf(id), b = ids.indexOf(targetId)
  if (a < 0 || b < 0 || a === b) return false
  ids.splice(a, 1)
  ids.splice(b, 0, id)
  slot(s, page).order = ids
  return true
}

export function resetLayout(s, page) {
  if (!s.layout || typeof s.layout !== 'object') return
  const { [page]: _gone, ...rest } = s.layout
  s.layout = rest
  for (const c of PAGES[page] || []) if (c.legacy) s[c.legacy] = true
  clearDismissed(s, page)
}
