import { describe, expect, it } from 'vitest'
import { armRestAlert, buildRestAlert, disarmRestAlert, REST_ALERT_ID, REST_CHANNEL_ID } from './rest-alert.js'

describe('buildRestAlert', () => {
  const now = 1_700_000_000_000

  it('schedules a public notification', () => {
    const alert = buildRestAlert({ at: now + 90_000, title: 'Rest over — next set!', sound: true, now })
    expect(alert).toMatchObject({
      id: REST_ALERT_ID,
      channelId: REST_CHANNEL_ID,
      title: 'Rest over — next set!',
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
