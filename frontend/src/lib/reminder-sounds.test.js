// A sound for each kind of reminder (lib/reminder-sounds.js).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ platform: 'android', calls: [] }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: () => new Proxy({}, {
    get: (_, prop) => prop === 'then' ? undefined : async arg => {
      h.calls.push([prop, arg])
      if (prop === 'channel') return { channelId: 'reminder-' + arg.kind + '-0000abcd' }
      if (prop === 'pick') return { uri: 'content://media/internal/audio/media/7', title: 'Tri-tone' }
      return {}
    },
  }),
}))

const HASH = 'a'.repeat(64)
const S0 = { sounds: [{ id: 's1', name: 'Gong', m: { kind: 'audio', hash: HASH, mime: 'audio/wav', size: 4000, width: 1, height: 1, dur: 1.5, at: 1 } }] }

let m
beforeEach(async () => {
  vi.resetModules()
  h.platform = 'android'; h.calls = []
  m = await import('./reminder-sounds.js')
})

describe('reminder sounds', () => {
  it('keeps only choices that still mean something', () => {
    const s = structuredClone(S0)
    expect(m.reminderSoundOf(s, 'workout')).toBe(null)
    m.setReminderSound(s, 'workout', { tone: 'bell' })
    m.setReminderSound(s, 'checkin', { tone: 'u:s1' })
    m.setReminderSound(s, 'gym', { tone: 'sys', uri: 'content://media/1', name: 'Ping' })
    m.setReminderSound(s, 'rest', { tone: 'bell' })
    expect(Object.keys(s.reminderSounds)).toEqual(['workout', 'checkin', 'gym'])
    expect(m.reminderSoundOf(s, 'gym')).toEqual({ tone: 'sys', uri: 'content://media/1', name: 'Ping' })
    expect(m.reminderSoundOf({ reminderSounds: { workout: { tone: 'u:gone' } } }, 'workout')).toBe(null)
    expect(m.reminderSoundOf({ reminderSounds: { workout: { tone: 'sys', uri: 'javascript:1' } } }, 'workout')).toBe(null)
    expect(m.reminderSoundOf({ reminderSounds: { workout: { tone: 'kazoo' } } }, 'workout')).toBe(null)
    m.setReminderSound(s, 'workout', null); m.setReminderSound(s, 'checkin', null); m.setReminderSound(s, 'gym', null)
    expect(s.reminderSounds).toBeUndefined()
  })

  it('names the native side the file hash of one\'s own sound', () => {
    const s = { ...structuredClone(S0), reminderSounds: { checkin: { tone: 'u:s1' }, workout: { tone: 'none' } } }
    expect(m.channelSpec(s, 'checkin')).toMatchObject({ kind: 'checkin', tone: 'u:' + HASH })
    expect(m.channelSpec(s, 'workout')).toMatchObject({ kind: 'workout', tone: 'none', name: 'Workout reminders' })
    expect(m.channelSpec(s, 'gym')).toBe(null)
  })

  it('makes a channel once per choice and resets a kind that went back to default', async () => {
    const s = { reminderSounds: { workout: { tone: 'chime' } } }
    expect(await m.reminderChannel(s, 'workout')).toBe('reminder-workout-0000abcd')
    expect(await m.reminderChannel(s, 'workout')).toBe('reminder-workout-0000abcd')
    expect(h.calls.filter(c => c[0] === 'channel')).toHaveLength(1)
    expect(await m.reminderChannel({}, 'workout')).toBe(null)
    expect(await m.reminderChannel({}, 'workout')).toBe(null)
    expect(h.calls.filter(c => c[0] === 'reset')).toEqual([['reset', { kind: 'workout' }]])
    expect(await m.pickPhoneSound()).toEqual({ uri: 'content://media/internal/audio/media/7', name: 'Tri-tone' })
  })

  it('does nothing on the iPhone', async () => {
    h.platform = 'ios'
    vi.resetModules()
    m = await import('./reminder-sounds.js')
    expect(await m.reminderSoundsBuilt()).toBe(false)
    expect(await m.reminderChannel({ reminderSounds: { workout: { tone: 'bell' } } }, 'workout')).toBe(null)
    expect(h.calls).toEqual([])
  })

  it('a deleted sound of one\'s own takes its reminders back to default', async () => {
    const { removeSound } = await import('./user-sounds.js')
    const s = { ...structuredClone(S0), reminderSounds: { checkin: { tone: 'u:s1' }, workout: { tone: 'bell' } } }
    removeSound(s, 's1')
    expect(s.reminderSounds).toEqual({ workout: { tone: 'bell' } })
  })
})
