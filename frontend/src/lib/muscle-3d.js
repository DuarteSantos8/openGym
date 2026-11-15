// The 3D body's data (EP12). The levels are the same ones the 2D muscle map and Stats' Muscle
// balance draw (lib/muscles.js: muscleBalanceWindow → loadOfWorkouts → levelsOf), so the two
// views can never disagree. The model (public/anatomy/muscles.glb, see ATTRIBUTION.md there)
// has one mesh per muscle id in MUSCLES, plus a neutral `body` for everything else.
import { levelsOf, loadOfWorkouts, muscleBalanceWindow } from './muscles.js'
import { todayISO, MONDAY } from './format.js'

export const MODEL_URL = 'anatomy/muscles.glb'
export const NEUTRAL = 'body'
export const WINDOWS = Object.freeze([{ days: 7, label: 'This week' }, { days: 30, label: 'Last 30 days' }])
export const LEVEL_WORD = Object.freeze(['Not trained', 'Light', 'Moderate', 'Solid', 'Most trained'])

/** Per-muscle levels 0–4 for `workouts` in the window, as the 2D map computes them. */
export function muscleLevels3d(workouts, { win = 7, now = Date.now(), today = todayISO(), ws = MONDAY } = {}) {
  return levelsOf(loadOfWorkouts(muscleBalanceWindow(workouts || [], win, now, today, ws)))
}

/** The node names in a GLB file's JSON chunk, read without three.js. */
export function glbMeshNames(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (u8.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('Not a GLB file')
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + dv.getUint32(12, true))))
  return (json.nodes || []).map(n => n.name).filter(Boolean)
}

/** [r, g, b] in 0–1 from a computed CSS colour (`rgb()`, `rgba()` or `color(srgb …)`), else null. */
export function parseCssColor(s) {
  const str = String(s || '').trim()
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(str)
  if (m) return [m[1], m[2], m[3]].map(v => Number(v) / 255)
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(str)
  if (m) return [m[1], m[2], m[3]].map(Number)
  return null
}

const FALLBACK = [[0.32, 0.33, 0.36], [0.42, 0.52, 0.22], [0.52, 0.68, 0.18], [0.62, 0.82, 0.14], [0.66, 0.9, 0.12]]
/** The five shades of the activity heatmap / 2D map (.hm-c.l0…l4) in the current theme. */
export function levelColors(doc = globalThis.document) {
  if (!doc?.body || typeof getComputedStyle !== 'function') return FALLBACK
  const probe = doc.createElement('span')
  probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'
  doc.body.append(probe)
  const out = FALLBACK.map((fb, i) => { probe.className = 'hm-c l' + i; return parseCssColor(getComputedStyle(probe).backgroundColor) || fb })
  probe.remove()
  return out
}
