// The one December notification on the phones (Your year in openGym, lib/wrapped.js): a local
// notification the app plans for itself, Dec 1 at 18:00 on the phone's clock, the next time it is
// opened before then. No server is involved, so it works the same with or without one. The app
// never asks for permission for it: with notifications off there is the Home card and nothing else.
// A planned one is remembered in the profile (S.wrapped.phone = the year), which also tells a
// server not to send its web push on top (api/wrapped.js), and taken back when the switch in
// Settings → Notifications goes off.
import { MOBILE } from './mobile.js'
import { notificationPlan, wrappedOf, wrappedNow, NOTIFY_ID } from './wrapped.js'
import { t } from './i18n-core.js'
import { WRAPPED_PUSH } from './wrapped-copy.js'

/** The notification itself, for `year`, at `at`. */
export function wrappedNotification(year, at) {
  return {
    id: NOTIFY_ID,
    title: t(WRAPPED_PUSH.title, String(year)),
    body: t(WRAPPED_PUSH.body),
    schedule: { at, allowWhileIdle: true },
    extra: { wrapped: year },
  }
}

/**
 * Plans, re-plans or takes back the notification, as notificationPlan says. `update` is the
 * store's, to remember the year; returns what was done ('schedule' | 'cancel' | 'none').
 */
export async function syncWrappedNotification(S, update, now = wrappedNow()) {
  if (!MOBILE) return 'none'
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const granted = (await LocalNotifications.checkPermissions()).display === 'granted'
    const plan = notificationPlan(S, now, { granted })
    if (plan.action === 'cancel') {
      await LocalNotifications.cancel({ notifications: [{ id: NOTIFY_ID }] }).catch(() => {})
      if (wrappedOf(S).phone != null) update?.(s => { s.wrapped = { ...wrappedOf(s), phone: null } })
      return 'cancel'
    }
    if (plan.action !== 'schedule') return 'none'
    await LocalNotifications.schedule({ notifications: [wrappedNotification(plan.year, plan.at)] })
    if (wrappedOf(S).phone !== plan.year) update?.(s => { s.wrapped = { ...wrappedOf(s), phone: plan.year } })
    return 'schedule'
  } catch (e) { return 'none' }
}

/** Calls cb(year) when the December notification is tapped. Returns a function that stops listening. */
export function onWrappedNotificationOpen(cb) {
  if (!MOBILE) return () => {}
  let handle = null
  let gone = false
  import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
    Promise.resolve(LocalNotifications.addListener('localNotificationActionPerformed', e => {
      const n = e?.notification
      if (e?.actionId === 'dismiss' || n?.id !== NOTIFY_ID) return
      const year = Number(n?.extra?.wrapped)
      cb(Number.isInteger(year) ? year : null)
    })).then(h => { if (gone) h?.remove?.(); else handle = h })
  ).catch(() => {})
  return () => { gone = true; try { handle?.remove?.() } catch (e) { /* gone already */ } }
}
