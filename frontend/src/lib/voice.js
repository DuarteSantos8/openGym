// Siri, the Shortcuts app and Google Assistant (v1.4.4). What the voice side hands the app, and
// what the app does with it:
//
//   iPhone (ios/App/App/VoiceIntents.swift): "Log my weight in openGym" runs without opening the
//     app. The intent leaves a pending weigh-in in the App Group ({ id, w, unit, at, d }), and the
//     page brings those in when it starts or comes back (importPendingWeighIns, startVoice).
//     "Start my workout" opens opengym://start?today=1. "What's my workout today?" and "How's my
//     streak?" answer from the widget snapshot (lib/widgets.js) and never open the app.
//   Android (res/xml/shortcuts.xml): long-press shortcuts and Assistant's App Actions open
//     opengym://start?today=1, opengym://stats and opengym://weigh-in?w=78.2, the last one the
//     weigh-in sheet with the number already in (lib/widget-links.js).
//
// A pending weigh-in comes in once: by its id, and a day whose weigh-in is as new or newer keeps
// it. Nothing here does more than the weigh-in sheet would.
import { MOBILE, nativePlatform } from './mobile.js'
import { effectiveRoutines } from './history.js'
import { isoOf, todayISO, fmtNum } from './format.js'
import { t } from './i18n.js'

export const LB_PER_KG = 2.2046226218
// What a spoken number may be. Below this it was a mishearing ("two"), above it the sheet's own cap.
export const VOICE_MIN = { kg: 20, lb: 44 }
export const VOICE_MAX = { kg: 700, lb: 1500 }
// The ids already brought in, so a pending one the phone failed to clear is not logged twice.
const SEEN_KEY = 'og_voice_seen'
const SEEN_MAX = 100
const DAY = 86400000

const unitOf = u => (u === 'lb' ? 'lb' : 'kg')
const round1 = n => Math.round(n * 10) / 10

/** `w` in `from` as `to`, to a tenth. */
export function convertWeight (w, from, to) {
  const n = Number(w)
  if (!Number.isFinite(n)) return NaN
  if (unitOf(from) === unitOf(to)) return round1(n)
  return round1(unitOf(from) === 'kg' ? n * LB_PER_KG : n / LB_PER_KG)
}

export const weightInRange = (w, unit) => Number.isFinite(w) && w >= VOICE_MIN[unitOf(unit)] && w <= VOICE_MAX[unitOf(unit)]

/**
 * A weight as an assistant passes it: "78.2", "78,2", "78.2 kg", "170 lbs", "80 kilos".
 * { w, unit } (unit null when it says none), or null.
 */
export function parseSpokenWeight (input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? { w: input, unit: null } : null
  if (typeof input !== 'string') return null
  const m = /^\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*([a-z]*)\.?\s*$/i.exec(input)
  if (!m) return null
  const w = Number(m[1].replace(',', '.'))
  if (!(w > 0)) return null
  const word = m[2].toLowerCase()
  let unit = null
  if (word) {
    if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilogramm|kilogramme|kilogrammes)$/.test(word)) unit = 'kg'
    else if (/^(lb|lbs|pound|pounds)$/.test(word)) unit = 'lb'
    else return null
  }
  return { w, unit }
}

/** The routines planned for `iso` that have exercises, as Home's today row starts them. */
export function todayRoutineIds (S, iso = todayISO()) {
  try {
    const st = { ...S, routines: S?.routines || [], week: S?.week || {}, dayPlan: S?.dayPlan || {} }
    return effectiveRoutines(st, iso).filter(r => r && (r.ex || []).length).map(r => r.id).filter(Boolean)
  } catch { return [] }
}

// One pending weigh-in as the phone wrote it, checked; null for one that cannot be used.
function cleanPending (p, now) {
  if (!p || typeof p !== 'object') return null
  const id = typeof p.id === 'string' ? p.id.trim().slice(0, 64) : ''
  if (!id) return null
  const parsed = parseSpokenWeight(typeof p.w === 'string' ? p.w : Number(p.w))
  if (!parsed) return null
  const at = Number(p.at)
  // A clock from the future (a day ahead and more) is not a moment anyone stood on a scale.
  if (!Number.isFinite(at) || at <= 0 || at > now + DAY) return null
  const unit = p.unit === 'lb' || p.unit === 'kg' ? p.unit : parsed.unit
  if (!unit) return null
  // The day where the phone was when it was logged: a weigh-in at 23:30 stays on that evening's
  // day, wherever the phone is by the time the app opens.
  let d = typeof p.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.d) ? p.d : isoOf(new Date(at))
  // West of where it was logged it can be "tomorrow" there still: today here, as the sheet allows.
  const today = isoOf(new Date(now))
  if (d > today) d = today
  return { id, w: parsed.w, unit, at, d }
}

/**
 * Brings pending weigh-ins into the state `s` (mutated; inside the store's update). `seen` holds
 * the ids brought in before. Returns { logged: [{ id, d, w, unit }], ids }: `ids` is every id that
 * was looked at, used or not, so the phone can forget them all.
 */
export function importPendingWeighIns (s, items, { now = Date.now(), seen = [] } = {}) {
  const unit = unitOf(s.unit)
  if (!Array.isArray(s.bodyweight)) s.bodyweight = []
  const done = new Set(seen)
  const ids = [], logged = []
  const list = []
  for (const raw of Array.isArray(items) ? items : []) {
    if (raw && typeof raw.id === 'string' && raw.id) ids.push(raw.id)
    const p = cleanPending(raw, now)
    if (p) list.push(p)
  }
  list.sort((a, b) => a.at - b.at)
  for (const p of list) {
    if (done.has(p.id)) continue
    done.add(p.id)
    const w = convertWeight(p.w, p.unit, unit)
    if (!weightInRange(w, unit)) continue
    const ex = s.bodyweight.find(b => b.d === p.d)
    // That day's weigh-in is as new or newer: it stays (and this one, seen again, changes nothing).
    if (ex && Number(ex.t) >= p.at) continue
    if (ex) { ex.w = w; ex.t = p.at; delete ex.src } else s.bodyweight.push({ d: p.d, w, t: p.at })
    logged.push({ id: p.id, d: p.d, w, unit })
  }
  if (logged.length) s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return { logged, ids: [...new Set(ids)] }
}

export const loggedLine = ({ w, unit }) => `${fmtNum(w)} ${unit}`

function readSeen () {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
function writeSeen (ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), ...ids])].slice(-SEEN_MAX))) } catch { /* private mode: the day check still holds */ }
}

/* ---------- the native side (iPhone) ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const voicePlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  if (await nativePlatform() !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { VoiceBridge: registerPlugin('VoiceBridge') }
})().catch(() => null))

const waitReady = useStore => new Promise(resolve => {
  if (useStore.getState().ready) return resolve()
  const off = useStore.subscribe(s => { if (s.ready) { off(); resolve() } })
})

/**
 * Brings in what Siri logged, once now and every time the app comes back. `toast(msg)` says so
 * ("78.2 kg logged by Siri"). Resolves with the stop function.
 */
export async function startVoice ({ useStore, toast }) {
  const p = await voicePlugin()
  if (!p) return () => {}
  let busy = false, gone = false
  const run = async () => {
    if (busy || gone) return
    busy = true
    try {
      await waitReady(useStore)
      const res = await p.VoiceBridge.pending()
      const items = Array.isArray(res?.items) ? res.items : []
      if (!items.length) return
      let out = { logged: [], ids: [] }
      useStore.getState().update(s => { out = importPendingWeighIns(s, items, { seen: readSeen() }) })
      writeSeen(out.ids)
      await p.VoiceBridge.clear({ ids: out.ids })
      const last = out.logged[out.logged.length - 1]
      if (last && toast) toast(t('{0} logged by Siri', loggedLine(last)))
    } catch { /* the next time the app comes back */ } finally { busy = false }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  document.addEventListener('visibilitychange', onVisible)
  run()
  return () => { gone = true; document.removeEventListener('visibilitychange', onVisible) }
}

// Test seams.
export function _setVoicePluginForTest (plugin) { pluginP = Promise.resolve(plugin ? { VoiceBridge: plugin } : null) }
export function _resetVoice () { pluginP = null }
