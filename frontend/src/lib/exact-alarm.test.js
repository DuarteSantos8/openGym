// lib/exact-alarm.js: the notification plugin opens Android's "Alarms & reminders" screen on a
// schedule() that wants an exact alarm without that permission; planned through here it never does.
import { describe, expect, it } from 'vitest'
import { withoutAlarmPrompt } from './exact-alarm.js'

const n = [{ id: 1, title: 'a', schedule: { at: new Date(0) } }, { id: 2, title: 'b', schedule: { at: new Date(0) } }]
const plugin = state => ({ checkExactNotificationSetting: async () => ({ exact_alarm: state }) })

describe('withoutAlarmPrompt', () => {
  it('asks for an inexact alarm while Android does not allow exact ones (no settings screen)', async () => {
    const out = await withoutAlarmPrompt(plugin('denied'), n)
    expect(out.map(x => x.isExactNotification)).toEqual([false, false])
    expect(out[0].schedule).toBe(n[0].schedule)
  })
  it('keeps exact alarms once the person allowed them', async () => {
    expect((await withoutAlarmPrompt(plugin('granted'), n)).map(x => x.isExactNotification)).toEqual([true, true])
  })
  it('is inexact where the check does not exist or fails (iOS, an older shell)', async () => {
    expect((await withoutAlarmPrompt({}, n))[0].isExactNotification).toBe(false)
    const broken = { checkExactNotificationSetting: async () => { throw new Error('not implemented') } }
    expect((await withoutAlarmPrompt(broken, n))[1].isExactNotification).toBe(false)
  })
  it('leaves the plugin its own ask when a person flipped a Settings switch', async () => {
    expect(await withoutAlarmPrompt(plugin('denied'), n, { prompt: true })).toBe(n)
  })
})
