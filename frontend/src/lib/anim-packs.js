// The animation packs on this device (store apps only): what is installed, what is downloading,
// and the person's choice of quality. The rules are lib/anim-quality.js; this is the state around
// them and the bridge to the native AnimationPacks plugin:
//
//   available()                              → { available, testflight, packs? }   iOS 26+ with Apple-hosted packs;
//                                              Android (Play build): `packs`, the ids this build has
//   status({ packId, probe })                → { state: 'ready'|'none', bytes?, base? }
//   info({ packId })                         → { downloadSize? } what the download costs, from Apple
//   diagnose({ packId, probe })              → what the native side knows, for the details row
//   download({ packId, wifiOnly, probe })    → resolves once installed; 'progress' events
//                                              { packId, fraction }; rejects with a code:
//                                              'needs-wifi', 'unavailable', 'cancelled', 'failed'
//   remove({ packId })
//   localPath({ packId, probe })             → { base } (older native sides: { path })
//
// A pack's files are read from `base` + '/<drawing>.webp'. On iOS that is opengym-pack://<packId>,
// which the app answers from Background Assets itself: a downloaded pack is not a folder a page
// could be pointed at (build 30: "downloaded, 0.1 MB", no new animations). `probe` is one drawing
// the pack holds, the native side's test that the pack can really be read.
// iOS: ios/App/App/AnimationPacksPlugin.swift. Android answers
// "unavailable" until Play Asset Delivery comes (and the sideloaded APK never has packs).
//
// The choice is this device's, not the profile's: kept in localStorage, never in S, so it never
// syncs. Packs are downloaded per device, and a phone and an iPad want different sizes; the
// profile, its workouts and its history are not touched by any of this.
import { MOBILE } from './mobile.js'
import { EXIDX } from './exercises.js'
import { PACK_QUALITIES, FIGURES, packId, packDrawingId, readChoice, wantedPack, packQualities, parsePackId, DEFAULT_CHOICE } from './anim-quality.js'

export const PREFS_KEY = 'gym_anim_v1'
export const ALL_PACKS = PACK_QUALITIES.flatMap(px => FIGURES.map(f => packId(px, f)))
const PROBE_EX = '0001'
const MB = 1024 * 1024
// What the packs uploaded so far take to download, until Apple's own figure (info) is in.
export const KNOWN_DOWNLOAD_BYTES = { 'anim-480-male': 749.5 * MB, 'anim-480-female': 742.0 * MB }
export const probeFor = id => packDrawingId(EXIDX[PROBE_EX], id.endsWith('-female') ? 'female' : 'male')

/* ---------------------------------------------------------------- the choice, per device */
export function readPrefs(storage = globalThis.localStorage) {
  let v = null
  try { v = JSON.parse(storage?.getItem(PREFS_KEY) || 'null') } catch { /* unreadable: the defaults */ }
  return { choice: readChoice(v?.choice ?? DEFAULT_CHOICE), wifiOnly: v?.wifiOnly !== false }
}
export function writePrefs(patch, storage = globalThis.localStorage) {
  const next = { ...readPrefs(storage), ...patch }
  next.choice = readChoice(next.choice)
  next.wifiOnly = next.wifiOnly !== false
  try { storage?.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* private mode: for this run only */ }
  state = { ...state, prefs: next }
  emit()
  return next
}

/** The screen's short side in CSS px: what Auto reads to tell a phone from a tablet. */
export const deviceInfo = () => {
  try { return { shortSide: Math.min(window.screen?.width || 0, window.screen?.height || 0) } } catch { return {} }
}

/* ---------------------------------------------------------------- state */
// packs: { [packId]: { state: 'none'|'ready'|'downloading'|'failed'|'needs-wifi', progress, bytes, base, downloadSize } }
// offered: the pack ids this build has (Android's Play build says), or null for all of them (iOS)
let state = { available: false, testflight: false, offered: null, checked: false, packs: {}, prefs: readPrefs() }
const listeners = new Set()
const emit = () => { for (const fn of listeners) fn() }
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const getState = () => state
const setPack = (id, patch) => { state = { ...state, packs: { ...state.packs, [id]: { ...(state.packs[id] || {}), ...patch } } }; emit() }

/** The installed packs as clipSources wants them: pack id → base its files are read from. */
export const installedBases = (s = state) =>
  Object.fromEntries(Object.entries(s.packs).filter(([, p]) => p.state === 'ready' && p.base).map(([id, p]) => [id, p.base]))

/* ---------------------------------------------------------------- the native side */
// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with
// a native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const packsPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  return { Packs: registerPlugin('AnimationPacks'), toUrl: p => Capacitor.convertFileSrc(p) }
})().catch(() => null))

async function readPack(p, id) {
  try {
    const st = await p.Packs.status({ packId: id, probe: probeFor(id) })
    if (st?.state !== 'ready') { setPack(id, { state: state.packs[id]?.state === 'downloading' ? 'downloading' : 'none', bytes: 0, base: null }); return }
    let base = typeof st.base === 'string' && st.base ? st.base : null
    if (!base) {
      const r = await p.Packs.localPath({ packId: id, probe: probeFor(id) })
      base = r?.base || (r?.path ? (r.path.startsWith('/') ? p.toUrl(r.path) : r.path) : null)
    }
    setPack(id, { state: 'ready', bytes: Number(st.bytes) || 0, base, progress: 1 })
  } catch { setPack(id, { state: 'none', base: null }) }
}

// Apple's download size for a pack, when it says (it needs the network once).
async function readInfo(p, id) {
  try {
    const r = await p.Packs.info({ packId: id })
    const n = Number(r?.downloadSize)
    if (n > 0) setPack(id, { downloadSize: n })
  } catch { /* the built-in figure, or none */ }
}

/** What downloading a pack takes, in bytes: Apple's figure, else the known one, else null. */
// (The known figures are Apple's packs: a build that names its own packs gets its sizes from its store.)
export const downloadBytes = (id, s = state) => s.packs[id]?.downloadSize || (s.offered ? null : KNOWN_DOWNLOAD_BYTES[id]) || null

/** The qualities this build has a pack of for a figure: all the sharper ones, or those it names. */
export const offeredQualities = (figure, s = state) =>
  packQualities().filter(px => !s.offered || s.offered.includes(packId(px, figure)))

/**
 * The pack a choice wants for a figure on this build: the wanted quality's when the build has
 * it, else the sharpest smaller one it has, else none (the built-in files).
 */
export function targetPack(choice, figure, device = deviceInfo(), s = state) {
  const id = wantedPack(choice, figure, device)
  if (!id || !s.offered || s.offered.includes(id)) return id
  const want = parsePackId(id)?.px || 0
  const px = offeredQualities(figure, s).filter(q => q <= want).pop()
  return px ? packId(px, figure) : null
}

/** Asks the native side what it has. Once at start, and after every download or removal. */
export async function refresh() {
  const p = await packsPlugin()
  if (!p) { state = { ...state, checked: true, available: false }; emit(); return state }
  let available = false, testflight = false, offered = null
  try {
    const r = await p.Packs.available()
    available = !!r?.available; testflight = !!r?.testflight
    if (Array.isArray(r?.packs)) offered = r.packs.filter(id => ALL_PACKS.includes(id))
  } catch { available = false }
  state = { ...state, checked: true, available, testflight, offered }
  emit()
  if (available) {
    const ids = offered || ALL_PACKS
    await Promise.all(ids.map(id => readPack(p, id)))
    ids.forEach(id => { readInfo(p, id) })
  }
  return state
}

let progressHooked = false
const downloads = new Map()
/** Downloads a pack; resolves to 'ready' or the code it stopped with. One at a time per pack. */
export function download(id) {
  if (downloads.has(id)) return downloads.get(id)
  const run = (async () => {
    const p = await packsPlugin()
    if (!p || !state.available) return 'unavailable'
    if (!progressHooked) {
      progressHooked = true
      // Returned into the catch: addListener rejects when the plugin is not behind the bridge.
      Promise.resolve(p.Packs.addListener('progress', e => {
        if (e?.packId && state.packs[e.packId]?.state === 'downloading') setPack(e.packId, { progress: Math.max(0, Math.min(1, Number(e.fraction) || 0)) })
      })).catch(() => {})
    }
    setPack(id, { state: 'downloading', progress: 0 })
    try {
      await p.Packs.download({ packId: id, wifiOnly: state.prefs.wifiOnly, probe: probeFor(id) })
      await readPack(p, id)
      return state.packs[id]?.state === 'ready' ? 'ready' : 'failed'
    } catch (e) {
      const code = ['needs-wifi', 'unavailable', 'cancelled'].includes(e?.code) ? e.code : 'failed'
      setPack(id, { state: code === 'needs-wifi' ? 'needs-wifi' : code === 'cancelled' ? 'none' : 'failed' })
      return code
    }
  })().finally(() => downloads.delete(id))
  downloads.set(id, run)
  return run
}

export async function remove(id) {
  const p = await packsPlugin()
  if (!p) return false
  try { await p.Packs.remove({ packId: id }) } catch { /* read back below either way */ }
  await readPack(p, id)
  return state.packs[id]?.state !== 'ready'
}

/**
 * Starts the download the current choice and figure want, when the pack is not there yet and
 * not on its way. Called when the choice or the figure changes and at start. Never touches the
 * profile: the figure is only read.
 */
export function ensureWanted(figure, device = deviceInfo()) {
  if (!state.available) return null
  const id = targetPack(state.prefs.choice, figure, device)
  if (!id) return null
  const st = state.packs[id]?.state
  if (st === 'ready' || st === 'downloading') return null
  return download(id)
}

/**
 * For the details row (TestFlight builds): what the native side says about one pack, and whether
 * its probe drawing really loads as an image from where the page reads it.
 */
export async function diagnose(id, loadImage = defaultLoadImage) {
  const p = await packsPlugin()
  const out = { packId: id, state: state.packs[id]?.state || 'none', base: state.packs[id]?.base || null }
  if (!p) return { ...out, native: null, image: 'no plugin' }
  try { out.native = await p.Packs.diagnose({ packId: id, probe: probeFor(id) }) } catch (e) { out.native = { error: String(e?.message || e) } }
  const base = out.base || out.native?.base
  out.image = base ? await loadImage(base.replace(/\/$/, '') + '/' + probeFor(id) + '.webp') : 'no base'
  return out
}

function defaultLoadImage(src) {
  return new Promise(resolve => {
    try {
      const img = new Image()
      const t = setTimeout(() => resolve('timeout'), 8000)
      img.onload = () => { clearTimeout(t); resolve(`ok ${img.naturalWidth}×${img.naturalHeight}`) }
      img.onerror = () => { clearTimeout(t); resolve('error') }
      img.src = src
    } catch (e) { resolve('error ' + String(e?.message || e)) }
  })
}

export function _resetAnimPacks(next = {}) {
  pluginP = null; progressHooked = false; downloads.clear()
  state = { available: false, testflight: false, offered: null, checked: false, packs: {}, prefs: readPrefs(), ...next }
}
