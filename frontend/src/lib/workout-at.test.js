import { describe, it, expect } from 'vitest'
import { workoutAt } from './history.js'
import { muscleBalanceWindow } from './muscles.js'

// Several copies of "when did this workout happen" had drifted apart, and the two ways they were
// wrong are the two things worth pinning: the UTC-midnight parse, and `||` swallowing a start
// of 0. Everything else in the app dates a day at local noon so that no timezone or DST shift
// can move it, and this is the one function that decides it now.
describe('workoutAt', () => {
  it('prefers the recorded start', () => {
    expect(workoutAt({ start: 1_700_000_000_000, d: '2026-09-22' })).toBe(1_700_000_000_000)
  })

  it('keeps a start of 0 instead of falling through to the day', () => {
    // Several of the copies wrote `w.start || ...`, so the first instant of 1970 read as
    // "no start recorded" and silently became noon on the workout's calendar day.
    expect(workoutAt({ start: 0, d: '2026-09-22' })).toBe(0)
  })

  it('dates a start-less workout at noon on its own calendar day', () => {
    const at = new Date(workoutAt({ d: '2026-09-22' }))
    expect([at.getFullYear(), at.getMonth() + 1, at.getDate()]).toEqual([2026, 9, 22])
    expect(at.getHours()).toBe(12)
  })

  it('does not land on the day before, the way a bare Date(iso) does west of UTC', () => {
    const iso = '2026-09-22'
    const utcMidnight = new Date(iso).getTime()
    const ours = workoutAt({ d: iso })
    expect(new Date(ours).getDate()).toBe(22)
    // Only west of UTC does the old parse actually cross the boundary, so assert the bug
    // itself only where it bites. The noon rule above holds in every zone either way.
    if (new Date(iso + 'T12:00:00').getTimezoneOffset() > 0) {
      expect(new Date(utcMidnight).getDate()).toBe(21)
      expect(ours).toBeGreaterThan(utcMidnight)
    }
  })

  it('answers NaN when the workout carries neither a start nor a usable day', () => {
    for (const w of [{}, null, undefined, { d: '' }, { d: 'yesterday' }, { d: '2026-9-2' }, { start: 'x' }]) {
      expect(Number.isNaN(workoutAt(w))).toBe(true)
    }
  })
})

describe('muscleBalanceWindow dates its cutoff the same way', () => {
  it('keeps a workout logged today inside a 30-day window', () => {
    // The UTC-midnight parse put a start-less workout up to 12 h earlier than it happened, so
    // a workout right on the edge of the window fell out of it depending on the reader's zone.
    const now = new Date('2026-09-22T12:00:00').getTime()
    const kept = muscleBalanceWindow([{ d: '2026-09-22' }], 30, now)
    expect(kept).toHaveLength(1)
  })

  it('still drops one that predates the window', () => {
    const now = new Date('2026-09-22T12:00:00').getTime()
    expect(muscleBalanceWindow([{ d: '2026-07-01' }], 30, now)).toHaveLength(0)
  })
})

/* Several call sites had their own copy of the rule: Stats.jsx twice, recovery.js, effort.js,
   coach-demo.js, coach-insights.js, muscles.js, strength-exercises.js and the MCP server's
   muscle_balance. A grep is the only guard that would have caught that, so here it is. */
describe('nothing re-implements the rule', () => {
  it('no source file dates a workout by hand', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(import.meta.dirname, '..')
    const mcp = path.resolve(root, '../../mcp/src')   // imports these helpers too
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === 'locales' ? [] : walk(p)
      return /\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [p] : []
    })
    // `w.start || new Date(w.d)` and its spellings. history.js itself is where the rule lives.
    const handRolled = /\bstart\s*(\|\||\?\?)\s*(Number\()?new Date\s*\(/
    const offenders = [...walk(root), ...walk(mcp)]
      .filter(p => !p.endsWith(path.join('lib', 'history.js')))
      .filter(p => handRolled.test(fs.readFileSync(p, 'utf8')))
      .map(p => path.relative(root, p))
    expect(offenders).toEqual([])
  })
})

/* What the sites were getting wrong in practice. `new Date('2026-09-22')` is UTC midnight,
   which is 20:00 the previous day in New York, so a date-only workout logged today was already
   four hours old to every window filter and could fall out of one early. */
describe('a date-only workout against a window edge', () => {
  it('stays inside a window that a UTC-midnight parse would push it out of', () => {
    const iso = '2026-09-22'
    // A window that opened at 06:00 local on the workout's own day.
    const opened = new Date('2026-09-22T06:00:00').getTime()
    expect(workoutAt({ d: iso })).toBeGreaterThan(opened)
    expect(new Date(iso).getTime()).toBeLessThan(opened)   // what the hand-rolled copies computed
  })
})
