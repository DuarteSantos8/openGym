// Material You on the Android app: the accent and the backgrounds follow the phone's wallpaper.
//
// From Android 12 the system makes tonal palettes out of the wallpaper and lends them to apps
// (DynamicColorPlugin.java). Three are used here: accent1 for the accent, neutral1 for the page
// and neutral2, a touch more coloured, for the cards and controls on it. Each arrives as 13
// '#rrggbb' tones, system_*_0 (white) to system_*_1000 (black).
//
// It is a choice of this phone, not of the profile: the wallpaper belongs to the phone, and the
// same profile on an iPhone, a desktop or a second Android has its own (or none). So it is kept
// in this device's storage, never in S, and the synced accent stays as it was underneath: switch
// this off, or open the profile anywhere else, and the chosen accent is there.
//
// Only the accent and the five surface tokens change. Text, separators and the status colours keep
// the theme's own values, which are translucent greys and read the same on a tinted background.
// The accent goes through lib/accent.js like a colour of the user's own, so it gets the same
// contrast checks, pressed shade and text colour.
import { accentValue, cleanHex, customAccentVars, mix } from './accent.js'
import { MOBILE, onAppActive } from './mobile.js'

// The steps the system names its tones by, in the order the plugin sends them, and the tone
// (lightness, 100 = white) each one stands for in Material's palettes.
export const STEPS = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
export const toneOfStep = step => (step === 0 ? 100 : step === 10 ? 99 : step === 50 ? 95 : 100 - step / 10)
const TONES = STEPS.map(toneOfStep)
const PALETTES = ['accent1', 'neutral1', 'neutral2']

/** The plugin's answer made safe: three arrays of 13 hex colours, or null for anything else. */
export function cleanPalette(p) {
  if (!p || typeof p !== 'object' || p.available !== true) return null
  const out = {}
  for (const k of PALETTES) {
    const arr = Array.isArray(p[k]) && p[k].length === STEPS.length ? p[k].map(cleanHex) : null
    if (!arr || arr.includes(null)) return null
    out[k] = arr
  }
  return out
}

/** The colour at `tone` (0-100) in one palette, mixed between the two system tones around it. */
export function toneIn(arr, tone) {
  const t = Math.min(100, Math.max(0, tone))
  for (let i = 0; i < TONES.length - 1; i++) {
    const hi = TONES[i], lo = TONES[i + 1]
    if (t <= hi && t >= lo) return hi === lo ? arr[i] : mix(arr[i + 1], arr[i], (t - lo) / (hi - lo))
  }
  return arr[arr.length - 1]
}

// Which palette and tone each token takes, per theme. The tones sit close to the lightness of the
// greys they stand in for (index.css), so the hierarchy between page, card and control stays the
// same and only the colour moves: dark stays nearly black, light keeps white cards on a tinted page.
// The accent is the tone Material itself uses there, 80 on dark and 40 on light.
export const LOOK = {
  dark: {
    '--bg': ['neutral1', 4], '--bg-el': ['neutral1', 7],
    '--surface': ['neutral2', 12], '--surface-2': ['neutral2', 18], '--surface-3': ['neutral2', 24],
    '--surface-raised': ['neutral2', 18],
    accent: ['accent1', 80],
  },
  light: {
    '--bg': ['neutral2', 95], '--bg-el': ['neutral1', 97],
    '--surface': ['neutral1', 99], '--surface-2': ['neutral2', 92], '--surface-3': ['neutral2', 89],
    '--surface-raised': ['neutral1', 99],
    accent: ['accent1', 40],
  },
}
export const SURFACE_VARS = ['--bg', '--bg-el', '--surface', '--surface-2', '--surface-3', '--surface-raised']

/**
 * What the wallpaper's palettes come to in `theme`: the accent as '#rrggbb' and the surface
 * tokens. null without a usable palette.
 */
export function dynamicLook(palette, theme) {
  const p = cleanPalette(palette && { available: true, ...palette })
  if (!p) return null
  const look = LOOK[theme] || LOOK.dark
  const at = ([name, tone]) => toneIn(p[name], tone)
  const surfaces = Object.fromEntries(SURFACE_VARS.map(k => [k, at(look[k])]))
  return { accent: at(look.accent), surfaces }
}

/** The accent's CSS custom properties for the wallpaper colour (lib/accent.js customAccentVars). */
export const dynamicAccentVars = (palette, theme) => {
  const look = dynamicLook(palette, theme)
  return look ? customAccentVars(look.accent, theme) : null
}

/** Puts the surface tokens on the page root, or takes them off again (`surfaces` null). */
export function applySurfaces(el, surfaces) {
  for (const k of SURFACE_VARS) {
    if (surfaces?.[k]) el.style.setProperty(k, surfaces[k])
    else el.style.removeProperty(k)
  }
}

// --- this device's choice ---------------------------------------------------------------------
const KEY = 'og_dynamic_color'
export function dynamicChosen() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
function storeChosen(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* for this run */ }
}

// --- the palette, read from the phone ---------------------------------------------------------
// A tiny store: what the phone last said (null off Android 12+, in a browser, or in an APK from
// before the plugin), whether this device chose it, and who wants to hear about a change.
let palette = null
let chosen = dynamicChosen()
const subs = new Set()
const emit = () => { snap = { palette, chosen }; for (const f of subs) f() }
let snap = { palette, chosen }

export const dynamicSnapshot = () => snap
export function subscribeDynamic(fn) { subs.add(fn); return () => subs.delete(fn) }

/** The palette to draw with right now: only when the phone has one and this device chose it. */
export const activePalette = () => (chosen ? palette : null)

export function setDynamicChosen(on) {
  chosen = !!on
  storeChosen(chosen)
  emit()
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Asks the phone again; `read` is the plugin call (injected so tests need no Capacitor). */
export async function refreshPalette(read) {
  let next = null
  try { next = cleanPalette(await read()) } catch { next = null }
  if (same(next, palette)) return palette
  palette = next
  emit()
  return palette
}

/**
 * The accent the native side should draw (the rest countdown's notification): the wallpaper's,
 * in its dark-theme tone, while this device follows it, else the profile's (lib/accent.js).
 */
export function deviceAccentValue(S) {
  const look = dynamicLook(activePalette(), 'dark')
  return look ? look.accent : accentValue(S)
}

// Registered once, and kept inside an object (a Capacitor plugin proxy answers `then`, see
// lib/system-bars.js). Android only: iOS has no Material You, a browser no plugin.
let pluginP = null
const colorPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'android') return null
  const plugin = registerPlugin('DynamicColor')
  return { palette: () => plugin.palette() }
})().catch(() => null))

/** What the phone says now, or null (no plugin, an APK from before it, Android before 12). */
export async function readPalette() {
  const p = await colorPlugin()
  return p ? p.palette() : null
}

let booted = false
/** Reads the palette at start and again each time the app comes back (a new wallpaper). */
export function initDynamicColor() {
  if (booted || !MOBILE) return
  booted = true
  refreshPalette(readPalette)
  onAppActive(() => refreshPalette(readPalette))
}

/** For tests: back to a fresh start. */
export function resetDynamicForTests() { palette = null; chosen = dynamicChosen(); subs.clear(); snap = { palette, chosen } }
