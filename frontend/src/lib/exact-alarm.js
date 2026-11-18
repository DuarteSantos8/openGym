// Android's "Alarms & reminders" permission and the notification plugin.
//
// @capacitor/local-notifications 8.3 opens Android's "Alarms & reminders" settings screen on every
// schedule() of a notification that wants an exact alarm (its default) while that permission is
// off, and off is what Android 14 gives a newly installed app. The "Still training?" notification
// is planned again with every set, so the lifter was thrown out of the workout into the system
// settings at the start and after each tick. Planned through here, a notification is exact when
// the phone allows it and quietly inexact (a few minutes late at worst) when not: never a screen.
// `prompt` keeps the plugin's own ask for the one place a person asked for it (a Settings switch).

/** The notifications, `isExactNotification` set on them (the same objects), so schedule() never opens a settings screen. */
export async function withoutAlarmPrompt(L, notifications, { prompt = false } = {}) {
  if (prompt) return notifications
  let exact = false
  try { exact = (await L.checkExactNotificationSetting?.())?.exact_alarm === 'granted' } catch { /* iOS, the web: not a thing there */ }
  for (const n of notifications) n.isExactNotification = exact
  return notifications
}
