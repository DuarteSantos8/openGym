// How many Open Food Facts searches this person can still spend (fitness-eval ux-search.md §5,
// api-diary-index.md §8). The hub lets 30 a minute through /api/proxy, shared with barcode
// lookups, from a token bucket (fitness-hub src/rate-limit.ts): 30 tokens, refilled continuously,
// one every two seconds, and a 429 past that. The global search must not burn them on every
// keystroke: it searches by itself only while the budget has room for 20 a minute, and keeps 10
// for the searches a person asks for with a tap.
//
// The hub's own count wins when it sends one (RateLimit-Remaining, right across tabs and devices):
// an automatic search while more than 10 remain, a tap while any does. Between two answers the
// count is credited back at the bucket's refill rate. Without the header (an older hub, the first
// call) a local count of the last minute stands in.
//
// A 429 pauses every search for its Retry-After, which is the wait for a single token (about two
// seconds), not for the bucket to fill. The bucket is empty after it: the RateLimit-Remaining: 0
// the refusal carries stands, with nothing credited, until a later answer says where the bucket
// is. Until then only a search the person asked for may go (the one token the pause waited for),
// so that typing right after a burst cannot spend the ten kept for taps. The countdown is shown
// while the pause lasts.
import { create } from 'zustand'
import { useStore } from '../../store/useStore.js'

export const AUTO_PER_MIN = 20
export const TAP_RESERVE = 10
export const CAP_PER_MIN = AUTO_PER_MIN + TAP_RESERVE
const MINUTE = 60_000
const REFILL_MS = MINUTE / CAP_PER_MIN
const PAUSE_DEFAULT_S = 15
const PAUSE_MAX_S = 60

/** `pausedUntil` (epoch ms, 0 when not paused) for the countdown line. */
export const useOffBudget = create(() => ({ pausedUntil: 0 }))

let spent = []          // { at, kind } of the last minute
// What the hub last said: `remaining` tokens at `at`. `known` is false after a 429, whose zero is
// all that is known until a later answer reports the count again.
let server = null

const within = now => spent.filter(s => now - s.at < MINUTE)
// The tokens the bucket holds by now: the count at the last answer, refilled since.
const credit = now => Math.min(CAP_PER_MIN, server.remaining + Math.max(0, now - server.at) / REFILL_MS)
const tokensFor = kind => (kind === 'tap' ? 1 : TAP_RESERVE + 1)

/** Whether a search of this kind may go at `now`: 'auto' (typed, not asked for) or 'tap'. */
export function canSearch(kind, now = Date.now()) {
  if (now < useOffBudget.getState().pausedUntil) return false
  if (server) {
    if (!server.known) return kind === 'tap'
    return Math.floor(credit(now) + 1e-9) >= tokensFor(kind)
  }
  const last = within(now)
  if (kind === 'tap') return last.length < CAP_PER_MIN
  return last.filter(s => s.kind === 'auto').length < AUTO_PER_MIN && last.length < CAP_PER_MIN
}

/** Milliseconds until a search of this kind may go, 0 when it may now, Infinity when waiting does
 *  not say so: after a 429 only the answer to a search the person asked for does. */
export function waitFor(kind, now = Date.now()) {
  const times = [now, useOffBudget.getState().pausedUntil, ...spent.map(s => s.at + MINUTE)]
  if (server?.known) times.push(Math.ceil(server.at + (tokensFor(kind) - server.remaining) * REFILL_MS))
  for (const at of times.filter(t => t >= now).sort((a, b) => a - b)) if (canSearch(kind, at)) return at - now
  return Infinity
}

/** A search is going out. */
export function noteSearch(kind, now = Date.now()) {
  spent = within(now)
  spent.push({ at: now, kind })
  if (server?.known) server = { ...server, remaining: Math.max(0, credit(now) - 1), at: now }
}

/** What an answer says about the budget: its RateLimit-Remaining, and a 429's Retry-After. */
export function noteAnswer(res, now = Date.now()) {
  const remaining = parseInt(res?.headers?.get?.('RateLimit-Remaining'), 10)
  if (res?.status !== 429) {
    // Nothing goes out during a pause, so an answer that lands in one was asked before the 429
    // and says nothing of the bucket as it is now.
    if (Number.isFinite(remaining) && now >= useOffBudget.getState().pausedUntil) server = { remaining, at: now, known: true }
    return
  }
  const after = parseInt(res.headers?.get?.('Retry-After'), 10)
  const s = Math.min(PAUSE_MAX_S, Number.isFinite(after) && after > 0 ? after : PAUSE_DEFAULT_S)
  useOffBudget.setState({ pausedUntil: now + s * 1000 })
  if (Number.isFinite(remaining)) {
    // The bucket is empty and the pause waited for one token of it, not for it to fill: that zero
    // stands until a later answer reports the count again.
    server = { remaining: 0, at: now, known: false }
  } else {
    // A refusal that says nothing of the bucket (an older hub): its window is over at its
    // Retry-After, so the local count starts again after it.
    spent = []
    server = null
  }
}

/** Seconds left on a pause, 0 when there is none. */
export const pausedFor = (now = Date.now()) => Math.max(0, Math.ceil((useOffBudget.getState().pausedUntil - now) / 1000))

/** Forgets everything (tests, sign-out). */
export function resetOffBudget() {
  spent = []
  server = null
  useOffBudget.setState({ pausedUntil: 0 })
}

// Signing out, or another account signing in: the searches counted and a pause are the last
// person's, not the next one's.
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    if (prev.user && String(prev.user.id ?? '') !== String(s.user?.id ?? '')) resetOffBudget()
  })
}
