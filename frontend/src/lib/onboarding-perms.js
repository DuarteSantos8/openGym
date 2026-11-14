// The phone app's first-start permission steps: right after "Use on this device" or a finished
// pairing, one short screen per thing the OS has to be asked about, each with one Continue that
// leads to the OS dialog (views/PermissionSteps.jsx renders them). The OS dialog alone says
// nothing about why; asked cold, mid-rest, people tap "Don't allow" and the rest timer never reaches the lock screen.
//
// A step is { id, state(), request() }. state() answers 'prompt' when there is something to
// ask, anything else ('granted', 'denied', 'unsupported') skips the step: never a screen for a
// permission already given, nor for one the OS will not show a dialog for any more. Each step is
// shown once per device, whatever the answer in the OS dialog.
//
// iPhone only, Apple Health: Continue asks iOS for it (saving workouts and weigh-ins, reading the
// heart rate and the body weight) and switches the app's Apple Health setting on, the same switch
// as Settings → Apple Health (lib/health-sync.js), which the Apple Watch app goes by too. Turning it all
// off in the iOS sheet is the no; Settings can switch it off too. Android keeps Health Connect in Settings as it is.
import { MOBILE } from './mobile.js'
import { askNotifPermissionOnce } from './rest-alert.js'
import { healthStatus, loadHealth, enableHealth } from './health-sync.js'

export const SEEN_KEY = 'gym_onboard_perms_seen'

const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || [] } catch { return [] } }
export function markStepSeen(id) {
  const seen = readSeen()
  if (seen.includes(id)) return
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id])) } catch { /* shown again next first start, which is rare */ }
}

async function notificationState() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const p = await LocalNotifications.checkPermissions()
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'
  } catch { return 'unsupported' }
}

// 'prompt' while the iPhone app has Apple Health to offer and it is still off.
async function appleHealthState() {
  const st = await healthStatus()
  if (st.platform !== 'ios' || st.status !== 'available') return 'unsupported'
  return (await loadHealth()).on ? 'granted' : 'prompt'
}
async function appleHealthRequest() {
  const { useStore } = await import('../store/useStore.js')
  return enableHealth(useStore.getState().S)
}

export const STEPS = [
  // The same request the first rest makes (rest-alert.js): it asks through LocalNotifications,
  // which is POST_NOTIFICATIONS on Android 13+ and the usual alert on iOS, and records the
  // answer so the first rest does not ask a second time.
  { id: 'notifications', state: notificationState, request: () => askNotifPermissionOnce() },
  { id: 'appleHealth', state: appleHealthState, request: appleHealthRequest },
]

/** The steps this device still has to see, in order. Empty off the phone app. */
export async function pendingSteps(steps = STEPS, mobile = MOBILE) {
  if (!mobile) return []
  const seen = readSeen()
  const out = []
  for (const s of steps) {
    if (seen.includes(s.id)) continue
    if ((await s.state().catch(() => 'unsupported')) === 'prompt') out.push(s)
  }
  return out
}
