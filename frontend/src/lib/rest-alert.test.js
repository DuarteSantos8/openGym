import { describe, expect, it } from 'vitest'
import { armRestAlert, buildRestAlert, disarmRestAlert, REST_ALERT_ID, REST_CHANNEL_ID, REST_QUIET_CHANNEL_ID } from './rest-alert.js'

describe('buildRestAlert', () => {
  const now = 1_700_000_000_000

  it('schedules a public notification', () => {
    const alert = buildRestAlert({ at: now + 90_000, title: 'Rest’s over. Next set!', sound: true, now })
    expect(alert).toMatchObject({
      id: REST_ALERT_ID,
      channelId: REST_CHANNEL_ID,
      title: 'Rest’s over. Next set!',
      at: now + 90_000,
      allowWhileIdle: true,
      countdownTitle: 'Rest',
      totalMs: 90_000,
      sound: true,
      localOnly: false,
      visibility: 'public',
      importance: 'high',
    })
  })

  it('paints the notification with the chosen accent, not the default green', () => {
    const alert = buildRestAlert({ at: now + 1000, accent: 'red', now })
    expect(alert.accent).toBe((0xff000000 | 0xff453a) >>> 0)
    expect(alert.ink).toBe((0xff000000 | 0xffffff) >>> 0)
  })

  it('still schedules when sound is off', () => {
    expect(buildRestAlert({ at: now + 1000, sound: false, now }).sound).toBe(false)
  })

  // Discord "Rest Timer Sound Notification too Quiet": the locked phone played the old beeps
  // whatever Settings → Sound said. The chime is the default; only `true` picks the classic beeps.
  it('carries Settings → Sound to the native tone, chime by default', () => {
    expect(buildRestAlert({ at: now + 1000, now }).classic).toBe(false)
    expect(buildRestAlert({ at: now + 1000, classic: true, now }).classic).toBe(true)
    expect(buildRestAlert({ at: now + 1000, classic: 'kind', now }).classic).toBe(false)
  })

  // #306: more sounds to pick from. `tone` names the one; `classic` stays for an older app shell.
  it('names the picked sound for the native side, with classic set for the classic beeps only', () => {
    expect(buildRestAlert({ at: now + 1000, now })).toMatchObject({ tone: 'chime', classic: false })
    expect(buildRestAlert({ at: now + 1000, tone: 'bell', now })).toMatchObject({ tone: 'bell', classic: false })
    expect(buildRestAlert({ at: now + 1000, tone: 'classic', now })).toMatchObject({ tone: 'classic', classic: true })
    expect(buildRestAlert({ at: now + 1000, classic: true, now })).toMatchObject({ tone: 'classic', classic: true })
    for (const junk of ['kazoo', 'constructor', 7]) expect(buildRestAlert({ at: now + 1000, tone: junk, now }).tone).toBe('chime')
  })

  // A channel keeps the vibration it was created with, so Vibrate off cannot switch 'rest-over'
  // off: that end goes out on a channel that never buzzes.
  it('buzzes on the rest channel by default, and uses the quiet one when Vibrate is off', () => {
    expect(buildRestAlert({ at: now + 1000, now })).toMatchObject({ vibrate: true, channelId: REST_CHANNEL_ID })
    expect(buildRestAlert({ at: now + 1000, vibrate: false, now })).toMatchObject({ vibrate: false, channelId: REST_QUIET_CHANNEL_ID })
    expect(REST_QUIET_CHANNEL_ID).not.toBe(REST_CHANNEL_ID)
  })

  it('refuses a deadline that has already passed', () => {
    expect(buildRestAlert({ at: now, now })).toBe(null)
    expect(buildRestAlert({ at: now - 1, now })).toBe(null)
  })
})

describe('rest alert outside the mobile build', () => {
  it('does not schedule an alarm, so the caller keeps the server push', async () => {
    await expect(armRestAlert(Date.now() + 90_000, { title: 'Rest over', sound: true })).resolves.toBe(false)
    disarmRestAlert()
  })
})
