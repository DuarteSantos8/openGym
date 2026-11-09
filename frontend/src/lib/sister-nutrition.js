// openNutrition → openGym (v1.4.5, gm-hooks): what you ate, read-only, opt-in, on this device.
//
// The mirror of the pairing openNutrition already does the other way (it redeems an openGym pairing
// code at POST /api/pair/redeem and reads /api/data). Here openGym is the one that links:
//
//   1. In openNutrition: Settings → Connected apps → "Link openGym" shows a short code (or, on an
//      openNutrition from before that, "Create token" gives an `on_…` token with summary:read).
//   2. In openGym: Settings → Integrations → Sister apps → openNutrition, its address and the code.
//      A code is redeemed at POST <url>/api/v1/integration/pair/redeem for a summary:read token;
//      a pasted `on_…` token is used as it is, after one read proves it works.
//   3. openGym reads GET <url>/api/v1/integration/summary?from=&to= (schema opennutrition.summary.v1)
//      with that token, never writes anything, and keeps the answer here.
//
// The contract, and what openNutrition still has to add (the code, CORS for the web app, protein
// meals and the fasting window), is docs/dev/SISTER_APPS.md. Everything here works with the summary
// openNutrition serves today; the extras show once it sends them.
//
// Device-local on purpose, like the WebDAV backup (lib/webdav.js): the token is a secret, so it is
// kept in the phone's secure storage (lib/coach-secrets.js) and never in S, a backup or the sync. A second device
// links on its own. Off until linked; unlinking forgets the token and the numbers.
//
// Network only: openGym Offline (lib/build-caps.js) leaves the card out (OFFLINE_OFF_CARDS), and
// link() / refresh() / loadLink() do nothing there, so no screen ever shows or asks for it.
import { nativeFetch } from './capacitor-fetch.js'
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'
import { offlineBuild } from './build-caps.js'

export const NUTRITION_KEY = 'gym_sister_nutrition_v1'
// The token itself: the phone's secure storage (Keychain / Keystore), this browser's storage on the web.
export const TOKEN_KEY = 'gym_sister_nutrition_token'
export const SUMMARY_SCHEMA = 'opennutrition.summary.v1'
// How long a summary is fresh enough not to ask again, and how far back the cache keeps days.
export const FRESH_MS = 30 * 60e3
export const KEEP_DAYS = 400
// Protein meals are openNutrition's own count (days[].proteinMeals). Without it nothing is guessed:
// a day's total says nothing about how it was split.

const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const listeners = new Set()
/** Called with the new link (or null) after every change, for the card and the sheets. */
export function onNutritionChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(+v) ? Math.round(+v * 10) / 10 : null)

/** The address as typed, cleaned: https:// added when it has no scheme, no trailing slash. Null when it is not one. */
export function cleanUrl(raw) {
  let s = String(raw || '').trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return (u.origin + u.pathname).replace(/\/+$/, '')
  } catch { return null }
}

/** A guess for the address, from openGym's own: gym.example.com → nutrition.example.com. */
export function guessUrl(base) {
  try {
    const u = new URL(base)
    const parts = u.hostname.split('.')
    if (parts.length < 2 || /^\d+$/.test(parts.at(-1))) return ''
    return 'https://nutrition.' + (parts.length > 2 ? parts.slice(1) : parts).join('.')
  } catch { return '' }
}

/** One day of the summary, in openGym's words: { date, kcal, protein, carbs, fat, partial, target?, proteinMeals? }. */
export function cleanDay(d) {
  if (!isObj(d) || !ISO.test(String(d.date || ''))) return null
  // opennutrition.summary.v1 says energy/carbohydrate/targets; the trainer hook's older shape kcal/carbs/target.
  const tg = isObj(d.targets) ? { kcal: num(d.targets.energy ?? d.targets.kcal), protein: num(d.targets.protein) }
    : isObj(d.target) ? { kcal: num(d.target.kcal ?? d.target.energy), protein: num(d.target.protein) } : null
  const out = {
    date: d.date, kcal: num(d.energy ?? d.kcal), protein: num(d.protein), carbs: num(d.carbohydrate ?? d.carbs), fat: num(d.fat),
    partial: d.complete === false,
  }
  if (tg && (tg.kcal != null || tg.protein != null)) out.target = tg
  const pm = Math.round(Number(d.proteinMeals))
  if (Number.isFinite(pm) && pm >= 0 && pm <= 12) out.proteinMeals = pm
  return out
}

/**
 * The fasting part of the answer (additive in v1, docs/dev/SISTER_APPS.md), or null:
 * { goalHours, startedAt (ms) | null, endsAt (ms) | null, window: { opensAt, closesAt } | null }.
 * The eating window is openNutrition's own when it sends one, else the hours a fast leaves:
 * from the end of the last fast, 24 - goal hours long.
 */
export function cleanFasting(f) {
  if (!isObj(f) || f.enabled === false) return null
  const goal = Number(f.goalHours)
  if (!(goal >= 8 && goal <= 72)) return null
  const ms = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) && t > 0 ? t : null }
  const startedAt = ms(f.startedAt)
  const lastEnd = isObj(f.last) ? ms(f.last.end) : null
  let window = null
  if (isObj(f.window) && ms(f.window.opensAt) && ms(f.window.closesAt)) window = { opensAt: ms(f.window.opensAt), closesAt: ms(f.window.closesAt) }
  else if (!startedAt && lastEnd && goal < 24) window = { opensAt: lastEnd, closesAt: lastEnd + (24 - goal) * 3600e3 }
  return { goalHours: goal, startedAt, endsAt: startedAt ? startedAt + goal * 3600e3 : null, window }
}

/** The whole answer read back: { days: [..], fasting } or null when it is not a summary. */
export function cleanSummary(body) {
  if (!isObj(body) || !Array.isArray(body.days)) return null
  if (body.schema && body.schema !== SUMMARY_SCHEMA) return null
  return { days: body.days.map(cleanDay).filter(Boolean).slice(0, 400), fasting: cleanFasting(body.fasting) }
}

/* ---------------------------------------------------------------- the link ---- */

/** This device's link, or null: { url, hint, linkedAt, show: { report, story, home }, days: { iso: day }, fasting, at, error }. */
export function loadLink() {
  if (offlineBuild()) return null
  try {
    const v = JSON.parse(store()?.getItem(NUTRITION_KEY) || 'null')
    if (!isObj(v) || !cleanUrl(v.url)) return null
    return { show: { report: true, story: true, home: true }, days: {}, fasting: null, at: 0, error: null, ...v, show: { report: true, story: true, home: true, ...(isObj(v.show) ? v.show : {}) }, days: isObj(v.days) ? v.days : {} }
  } catch { return null }
}

export function saveLink(v) {
  // Never the token: that one lives in secure storage only.
  const { token: _t, ...keep } = v || {}
  try { if (v) store()?.setItem(NUTRITION_KEY, JSON.stringify(keep)); else store()?.removeItem(NUTRITION_KEY) } catch { /* not kept */ }
  listeners.forEach(cb => { try { cb(v || null) } catch { /* a closed screen */ } })
  return v || null
}

/** Forget the link and everything it brought. openNutrition's token stays valid until revoked there. */
export async function unlink() {
  await secureRemove(TOKEN_KEY).catch(() => {})
  return saveLink(null)
}

/** The switch for one place it shows ('report' | 'story' | 'home'). */
export function setShown(where, on) {
  const l = loadLink()
  if (l) saveLink({ ...l, show: { ...l.show, [where]: !!on } })
}

/* ------------------------------------------------------------ talking to it ---- */

const DAY = 86400000
const isoAt = t => new Date(t).toISOString().slice(0, 10)

// The phone app asks from native code (no CORS there); the web app needs openNutrition to allow
// openGym's origin (docs/dev/SISTER_APPS.md, "CORS").
const doFetch = (url, init) => nativeFetch(url, init)

export class LinkError extends Error {
  constructor(code) { super(code); this.code = code }
}

async function call(url, init, fetchFn) {
  let r
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout?.(10000) }) } catch { throw new LinkError('unreachable') }
  if (r.status === 401 || r.status === 403) throw new LinkError('revoked')
  if (r.status === 404) throw new LinkError('missing')
  if (r.status === 429) throw new LinkError('busy')
  if (!r.ok) throw new LinkError('failed')
  try { return await r.json() } catch { throw new LinkError('notnutrition') }
}

/** Read the summary for [from, to] with a token. Rejects with a LinkError. */
export async function readSummary(url, token, from, to, fetchFn = doFetch) {
  const body = await call(`${url}/api/v1/integration/summary?from=${from}&to=${to}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, fetchFn)
  const s = cleanSummary(body)
  if (!s) throw new LinkError('notnutrition')
  return s
}

/**
 * Link this device: `secret` is the code openNutrition showed, or an `on_…` token. The code is
 * redeemed for a token; either way one read of the last two weeks proves it before anything is
 * kept. Resolves with the new link; rejects with a LinkError ('url', 'code', 'unreachable',
 * 'revoked', 'missing', 'notnutrition', 'busy', 'failed').
 */
export async function link(rawUrl, secret, { fetchFn = doFetch, now = Date.now() } = {}) {
  if (offlineBuild()) throw new LinkError('unreachable')
  const url = cleanUrl(rawUrl)
  if (!url) throw new LinkError('url')
  const s = String(secret || '').trim()
  if (!s) throw new LinkError('code')
  let token = s
  if (!/^on_[A-Za-z0-9_-]{16,}$/.test(s)) {
    const code = s.replace(/[\s-]/g, '').toUpperCase()
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new LinkError('code')
    let res
    try {
      res = await call(`${url}/api/v1/integration/pair/redeem`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, app: 'opengym', scopes: ['summary:read'] }),
      }, fetchFn)
    } catch (e) { throw e.code === 'revoked' ? new LinkError('code') : e }
    if (!isObj(res) || typeof res.token !== 'string' || !res.token) throw new LinkError('notnutrition')
    token = res.token
  }
  const sum = await readSummary(url, token, isoAt(now - 13 * DAY), isoAt(now), fetchFn)
  await secureSet(TOKEN_KEY, token)
  const l = { url, hint: token.slice(-4), linkedAt: now, show: { report: true, story: true, home: true }, days: {}, fasting: null, at: 0, error: null }
  return saveLink({ ...withSummary(l, sum, now), from: isoAt(now - 13 * DAY), to: isoAt(now) })
}

/** The link with a fresh answer folded in: days replaced, the oldest dropped past KEEP_DAYS. */
export function withSummary(l, sum, now = Date.now()) {
  const days = { ...(l.days || {}) }
  for (const d of sum.days) days[d.date] = d
  const cut = isoAt(now - KEEP_DAYS * DAY)
  for (const k of Object.keys(days)) if (k < cut) delete days[k]
  return { ...l, days, fasting: sum.fasting, at: now, error: null }
}

let running = null
/**
 * Bring the cache up to date for [from, to] (default: the last 14 days), at most every FRESH_MS
 * unless `force`. Never throws: a failure is kept on the link as `error` and the old numbers stay.
 */
export function refresh({ from, to, force = false, now = Date.now(), fetchFn = doFetch } = {}) {
  const l = loadLink()
  if (!l) return Promise.resolve(null)
  const f = from || isoAt(now - 13 * DAY), t2 = to || isoAt(now)
  const covered = l.at > now - FRESH_MS && l.from <= f && l.to >= t2
  if (covered && !force) return Promise.resolve(l)
  if (running) return running
  running = secureGet(TOKEN_KEY)
    .then(token => { if (!token) throw new LinkError('revoked'); return readSummary(l.url, token, f, t2, fetchFn) })
    .then(sum => {
      const cur = loadLink()
      if (!cur || cur.linkedAt !== l.linkedAt) return cur
      return saveLink({ ...withSummary(cur, sum, now), from: f, to: t2 })
    })
    .catch(e => {
      const cur = loadLink()
      return cur ? saveLink({ ...cur, error: e?.code || 'failed', errorAt: now }) : null
    })
    .finally(() => { running = null })
  return running
}

/* ----------------------------------------------------------------- reading ---- */

/** The days of the cache in [from, to], oldest first. */
export function daysIn(l, from, to) {
  if (!l) return []
  return Object.values(l.days || {}).filter(d => d.date >= from && d.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1))
}

const avg = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
const avg1 = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null)

/**
 * A stretch of days in a few numbers, for the report and the month story, or null without a
 * logged day: { days, of, kcal, protein, proteinMeals, kcalTarget, proteinTarget, proteinHit, partial }.
 * Averages are over the logged days only (a day not logged is not a day of zero). `proteinHit`
 * counts the days that reached that day's protein target, when it had one.
 */
export function nutritionSummary(days, { from, to } = {}) {
  const list = (days || []).filter(d => d && (d.kcal != null || d.protein != null))
  if (!list.length) return null
  const of = from && to ? Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / DAY) + 1 : null
  const pm = list.filter(d => d.proteinMeals != null).map(d => d.proteinMeals)
  const withPTarget = list.filter(d => d.target?.protein > 0 && d.protein != null)
  return {
    days: list.length, of,
    kcal: avg(list.filter(d => d.kcal != null).map(d => d.kcal)),
    protein: avg(list.filter(d => d.protein != null).map(d => d.protein)),
    proteinMeals: avg1(pm),
    kcalTarget: avg(list.filter(d => d.target?.kcal > 0).map(d => d.target.kcal)),
    proteinTarget: avg(withPTarget.map(d => d.target.protein)),
    proteinHit: withPTarget.length ? withPTarget.filter(d => d.protein >= d.target.protein * 0.95).length : null,
    proteinDays: withPTarget.length,
    partial: list.some(d => d.partial),
  }
}

/**
 * What the Home card says about fasting right now, or null: { kind: 'fasting', until } while a
 * fast runs, { kind: 'window', until } while the eating window is open, { kind: 'opens', at }
 * before it opens later today. Only from an answer younger than six hours.
 */
export function fastingNow(l, now = Date.now()) {
  const f = l?.fasting
  if (!f || !(l.at > now - 6 * 3600e3)) return null
  if (f.startedAt && f.endsAt) return f.endsAt > now ? { kind: 'fasting', until: f.endsAt } : { kind: 'done', since: f.endsAt }
  const w = f.window
  if (!w) return null
  if (w.opensAt <= now && now < w.closesAt) return { kind: 'window', until: w.closesAt }
  if (now < w.opensAt && w.opensAt - now < 12 * 3600e3) return { kind: 'opens', at: w.opensAt }
  return null
}
