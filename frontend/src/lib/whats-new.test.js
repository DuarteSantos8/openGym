// What's new after an update (lib/whats-new.js): once per version per device, never on a fresh
// install, and the "a newer version is out" nudge at most once a day and once per version.
import { describe, expect, it } from 'vitest'
import { takeWhatsNew, takeUpdateNudge, notesFor, NOTES } from './whats-new.js'

const mem = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }
}
const withData = { workouts: [{ id: 'w1', d: '2026-11-20', entries: [] }], routines: [] }
const fresh = { workouts: [], routines: [] }

describe('What\'s new', () => {
  it('1.4.6 has five rows, each with an icon and words', () => {
    const rows = notesFor('1.4.6')
    expect(rows).toHaveLength(5)
    for (const r of rows) { expect(r.icon).toBeTruthy(); expect(r.text.length).toBeGreaterThan(10) }
    expect(notesFor('v1.4.6+build.81')).toHaveLength(5)
  })

  it('an upgrade from before this existed (workouts, nothing seen) shows it once', () => {
    const st = mem()
    expect(takeWhatsNew(withData, '1.4.6', st)).toBe(true)
    expect(takeWhatsNew(withData, '1.4.6', st)).toBe(false)
  })

  it('a fresh install notes the version and shows nothing, not even on the next start', () => {
    const st = mem()
    expect(takeWhatsNew(fresh, '1.4.6', st)).toBe(false)
    expect(st.m.get('gym_seen_version')).toBe('1.4.6')
    expect(takeWhatsNew(withData, '1.4.6', st)).toBe(false)
  })

  it('an older version seen shows it, whatever the profile holds', () => {
    expect(takeWhatsNew(fresh, '1.4.6', mem({ gym_seen_version: '1.4.5' }))).toBe(true)
  })

  it('a version without notes is noted silently; going back a version shows nothing', () => {
    const st = mem({ gym_seen_version: '1.4.6' })
    expect(NOTES['1.4.7']).toBeUndefined()
    expect(takeWhatsNew(withData, '1.4.7', st)).toBe(false)
    expect(st.m.get('gym_seen_version')).toBe('1.4.7')
    expect(takeWhatsNew(withData, '1.4.6', st)).toBe(false)
  })

  it('storage that throws never breaks the start', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => takeWhatsNew(withData, '1.4.6', bad)).not.toThrow()
  })
})

describe('the update nudge', () => {
  const DAY = 24 * 3600 * 1000
  it('says a newer version is out once, and never again for that version', () => {
    const st = mem()
    expect(takeUpdateNudge('1.4.7', '1.4.6', 0, st)).toBe(true)
    expect(takeUpdateNudge('1.4.7', '1.4.6', 3 * DAY, st)).toBe(false)
  })
  it('a still newer one waits until a day has passed', () => {
    const st = mem()
    takeUpdateNudge('1.4.7', '1.4.6', 0, st)
    expect(takeUpdateNudge('1.4.8', '1.4.6', DAY / 2, st)).toBe(false)
    expect(takeUpdateNudge('1.4.8', '1.4.6', DAY + 1, st)).toBe(true)
  })
  it('not newer: nothing', () => {
    expect(takeUpdateNudge('1.4.6', '1.4.6', 0, mem())).toBe(false)
    expect(takeUpdateNudge('1.4.5', '1.4.6', 0, mem())).toBe(false)
  })
})

describe('Settings → About', () => {
  it('shows this version\'s notes, or the last version that had some', async () => {
    const { latestNoted } = await import('./whats-new.js')
    expect(latestNoted('1.4.6')).toBe('1.4.6')
    expect(latestNoted('1.4.7')).toBe('1.4.6')
    expect(latestNoted('test')).toBe('1.4.6')
  })
})
