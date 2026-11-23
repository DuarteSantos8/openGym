// LIFTIQ-FORK: feature gating for the LiftIQ sensor integration (new file).
// The integration is on in the standalone flavour (VITE_STANDALONE=1), when the URL carries
// ?liftiqSim=1 (simulated sensor, see sim-transport.js) or when localStorage 'liftiq.enabled' is '1'.
// Upstream builds and the other flavours show nothing of it.
import { STANDALONE } from '../lib/demo.js'

export const ENABLED_KEY = 'liftiq.enabled'
export const SIM_KEY = 'liftiq.sim'

const storage = which => { try { return window[which] } catch { return null } }

function readParam(name) {
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

// ?liftiqSim=1 turns the simulator on for this tab session (kept in sessionStorage so in-app
// navigation and reloads without the query keep it); ?liftiqSim=0 turns it off again.
export function simRequested() {
  const flag = readParam('liftiqSim')
  const ss = storage('sessionStorage')
  try {
    if (flag === '1') ss?.setItem(SIM_KEY, '1')
    else if (flag === '0') ss?.removeItem(SIM_KEY)
    return ss?.getItem(SIM_KEY) === '1' || flag === '1'
  } catch { return flag === '1' }
}

// ?liftiqSpeed=4 plays the simulated set back 4 times faster (1..8).
export function simSpeed() {
  const n = Number(readParam('liftiqSpeed'))
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.round(n)) : 1
}

export function liftiqEnabled() {
  if (STANDALONE || simRequested()) return true
  try { return storage('localStorage')?.getItem(ENABLED_KEY) === '1' } catch { return false }
}

// Why Web Bluetooth is missing, as a key the UI turns into words. Never throws.
export function bluetoothSupport() {
  try {
    if (simRequested()) return { ok: true, reason: null }
    if (typeof navigator === 'undefined') return { ok: false, reason: 'browser' }
    if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, reason: 'insecure' }
    if ('bluetooth' in navigator) return { ok: true, reason: null }
    const ua = navigator.userAgent || ''
    if (/iPhone|iPad|iPod/i.test(ua)) return { ok: false, reason: 'ios' }
    return { ok: false, reason: 'browser' }
  } catch { return { ok: false, reason: 'browser' } }
}

// Plain English on purpose (see LIFTIQ-FORK.md, deliberate deviations).
export const SUPPORT_TEXT = {
  ios: 'This browser cannot talk to Bluetooth sensors (iPhone Safari has no Web Bluetooth). Use Chrome on Android, or Chrome or Edge on a computer.',
  insecure: 'Bluetooth needs a secure page (https or localhost). Open the app from its https address.',
  browser: 'This browser has no Web Bluetooth. Use Chrome on Android, or Chrome or Edge on a computer.',
}
