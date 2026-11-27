import { describe, it, expect } from 'vitest'
import {
  readRecovery, recoverySessionsOf, recoveryOn, recoveryDays, withRecovery, recoveryLine, recoveryTotals,
  recoveryCountsStreak, recoveryFromHealth, matchingRecoverySessions, recoveryPace, appNameForOrigin,
  isRecoveryMetricOn, withRecoveryMetric, recoverySpeedText, recoveryElevText, recoveryCadenceVal, formatLapSec,
} from './recovery-sessions.js'
import { streakInfo } from './streak.js'

describe('recovery sessions', () => {
  it('reads a session back and refuses a broken one', () => {
    expect(readRecovery({ d: '2026-11-01', kind: 'sauna', min: '20.4', note: ' hot ' })).toEqual({ d: '2026-11-01', kind: 'sauna', min: 20, note: 'hot' })
    expect(readRecovery({ d: '2026-11-01', kind: 'lava', min: 5 }).kind).toBe('other')
    expect(readRecovery({ d: '2026-11-01', kind: 'sauna', min: 0 })).toBeNull()
    expect(readRecovery({ d: 'nope', min: 5 })).toBeNull()
    expect(readRecovery({ _ts: 3 })).toBeNull()
    expect(readRecovery({ d: '2026-11-01', min: 5000 }).min).toBe(600)
  })
  it('lists newest first and finds a day', () => {
    let m = withRecovery({}, 'a', { d: '2026-11-01', kind: 'sauna', min: 15 }, 1)
    m = withRecovery(m, 'b', { d: '2026-11-03', kind: 'cold', min: 3 }, 2)
    m = withRecovery(m, 'c', { d: '2026-11-01', kind: 'massage', min: 45 }, 3)
    const S = { recoverySessions: m }
    expect(recoverySessionsOf(S).map(r => r.id)).toEqual(['b', 'c', 'a'])
    expect(recoveryOn(S, '2026-11-01').map(r => r.kind)).toEqual(['massage', 'sauna'])
    expect([...recoveryDays(S)].sort()).toEqual(['2026-11-01', '2026-11-03'])
    expect(recoveryTotals(S, '2026-11-01', '2026-11-02')).toEqual({ sauna: 15, massage: 45 })
  })
  it('a removal is a stamped empty entry, so it syncs', () => {
    const m = withRecovery({ a: { d: '2026-11-01', kind: 'sauna', min: 15, _ts: 1 } }, 'a', null, 9)
    expect(m.a).toEqual({ _ts: 9 })
    expect(recoverySessionsOf({ recoverySessions: m })).toEqual([])
  })
  it('reads as a line', () => {
    expect(recoveryLine({ kind: 'cold', min: 3 }, (s, n) => s.replace('{0}', n))).toBe('Ice bath · 3 min')
  })
})

describe('recovery and the week streak', () => {
  // Weeks of 2026-10-12, 10-19 (sauna only), 10-26.
  const S = {
    weekStart: 1, streakRule: { rule: 'off' },
    workouts: [{ d: '2026-10-13' }, { d: '2026-10-27' }],
    recoverySessions: { s: { d: '2026-10-21', kind: 'sauna', min: 20, _ts: 1 }, x: { _ts: 2 } },
  }
  it('does not count unless the profile opted in', () => {
    expect(recoveryCountsStreak(S)).toBe(false)
    expect(streakInfo(S, '2026-10-28').current).toBe(1)
  })
  it('counts the sauna week once opted in', () => {
    const on = { ...S, recoveryStreak: true }
    expect(recoveryCountsStreak(on)).toBe(true)
    expect(streakInfo(on, '2026-10-28').current).toBe(3)
  })
})

describe('recovery suggestions from the health store', () => {
  const at = (iso, h, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()
  const now = at('2026-11-21', 20, 0)
  const walk = (id, h, min, extra = {}) => ({
    id, sport: 'walk', start: at('2026-11-21', h), end: at('2026-11-21', h) + min * 60e3,
    title: 'Morning Walk', origin: 'com.garmin.android.apps.connectmobile', ...extra,
  })

  it('preserves optional health metadata and walk specs in readRecovery while staying backwards-compatible', () => {
    expect(readRecovery({
      d: '2026-11-21', kind: 'walk', min: 32, at: at('2026-11-21', 8), src: 'hc', srcId: 'hc-1',
      app: 'Garmin Connect', title: 'Morning Walk', km: 3.846, kcal: 214.6, steps: 4820,
      hr: { avg: 112.4, min: 88, max: 134 }, elev: 42.4, speed: { avg: 5.12, max: 6.44 },
      cadence: 114, floors: 6.2, laps: [{ sec: 920, km: 1.609 }, { sec: 950, km: 1.609 }],
    })).toEqual({
      d: '2026-11-21', kind: 'walk', min: 32, at: at('2026-11-21', 8), src: 'hc', srcId: 'hc-1',
      app: 'Garmin Connect', title: 'Morning Walk', km: 3.85, kcal: 215, steps: 4820,
      hr: { avg: 112, min: 88, max: 134 }, elev: 42, speed: { avg: 5.1, max: 6.4 },
      cadence: 114, floors: 6.2, laps: [{ sec: 920, km: 1.61 }, { sec: 950, km: 1.61 }],
    })
    expect(readRecovery({
      d: '2026-11-21', kind: 'walk', min: 32, at: -1, src: 'other', srcId: '   ',
      km: -5, kcal: 0, steps: 9999999, hr: { avg: 10, max: 300 }, elev: 0, speed: { avg: 0 }, cadence: 5, floors: 0, laps: [{ sec: 0 }],
    })).toEqual({ d: '2026-11-21', kind: 'walk', min: 32 })
  })

  it('maps health origin packages, formats speed/elev/cadence/laps, and toggles metric visibility (all on by default)', () => {
    expect(appNameForOrigin('com.garmin.android.apps.connectmobile', 'Connect')).toBe('Garmin Connect')
    expect(appNameForOrigin('com.garmin.connect.mobile', 'Connect')).toBe('Garmin Connect')
    expect(appNameForOrigin('com.strava')).toBe('Strava')
    expect(appNameForOrigin('com.apple.health.123', 'Apple Watch')).toBe('Apple Watch')
    expect(appNameForOrigin('com.example.tracker', 'TrailApp')).toBe('TrailApp')
    expect(recoveryPace(30, 3, 'kg')).toBe('10:00 /km')
    expect(recoveryPace(32, 3.218688, 'lb')).toBe('16:00 /mi')
    expect(recoveryPace(30, 0, 'kg')).toBeNull()
    expect(recoverySpeedText(4.82, 'kg')).toBe('4.8 km/h')
    expect(recoverySpeedText(4.828, 'lb')).toBe('3 mph')
    expect(recoveryElevText(42, 'kg')).toBe('42 m')
    expect(recoveryElevText(100, 'lb')).toBe('328 ft')
    expect(recoveryCadenceVal({ steps: 3600 }, 30)).toBe(120)
    expect(formatLapSec(925)).toBe('15:25')
    expect(isRecoveryMetricOn({}, 'elev')).toBe(true)
    const hidden = withRecoveryMetric({}, 'elev', false)
    expect(isRecoveryMetricOn({ recoveryMetrics: hidden }, 'elev')).toBe(false)
    expect(withRecoveryMetric(hidden, 'elev', true)).toEqual({})
  })

  it('matches walk and stretch sessions on the selected local date with specs and source app, newest first', () => {
    const records = [
      walk('w1', 8, 25, { title: 'Morning Walk', km: 2.5, kcal: 160, steps: 3200, hrAvg: 108, hrMax: 126 }),
      walk('w2', 17, 40, { title: 'Evening Walk', km: 4.1, steps: 5100 }),
      { id: 's1', sport: 'stretch', start: at('2026-11-21', 12), end: at('2026-11-21', 12) + 15 * 60e3, title: 'Mobility flow', origin: 'com.apple.health.watch', sourceName: 'Apple Watch', kcal: 42 },
      { id: 'r1', sport: 'run', start: at('2026-11-21', 9), end: at('2026-11-21', 9) + 30 * 60e3, origin: 'com.strava' },
      { id: 'old', sport: 'walk', start: at('2026-11-20', 8), end: at('2026-11-20', 8) + 30 * 60e3, origin: 'com.garmin.android.apps.connectmobile' },
    ]
    const walks = matchingRecoverySessions(records, {}, { d: '2026-11-21', kind: 'walk', src: 'hc', now })
    expect(walks.map(w => [w.id, w.min, w.title, w.src, w.app, w.km, w.steps, w.hr, w.kcal])).toEqual([
      ['w2', 40, 'Evening Walk', 'hc', 'Garmin Connect', 4.1, 5100, undefined, undefined],
      ['w1', 25, 'Morning Walk', 'hc', 'Garmin Connect', 2.5, 3200, { avg: 108, max: 126 }, 160],
    ])
    const stretches = matchingRecoverySessions(records, {}, { d: '2026-11-21', kind: 'stretch', src: 'ah', now })
    expect(stretches.map(s => [s.id, s.min, s.title, s.src, s.app, s.kcal])).toEqual([['s1', 15, 'Mobility flow', 'ah', 'Apple Watch', 42]])
    expect(matchingRecoverySessions(records, {}, { d: '2026-11-21', kind: 'sauna', src: 'hc', now })).toEqual([])
  })

  it('excludes own records, sessions under 5 minutes, future timestamps, and workout overlaps', () => {
    const S = { workouts: [{ id: 'g1', d: '2026-11-21', start: at('2026-11-21', 10), end: at('2026-11-21', 11) }] }
    expect(recoveryFromHealth(walk('own1', 8, 20, { origin: 'ch.duartesantos.opengym' }), S, { d: '2026-11-21', kind: 'walk', now })).toBeNull()
    expect(recoveryFromHealth(walk('own2', 8, 20, { clientId: 'opengym-w-1' }), S, { d: '2026-11-21', kind: 'walk', now })).toBeNull()
    expect(recoveryFromHealth(walk('short', 8, 4), S, { d: '2026-11-21', kind: 'walk', now })).toBeNull()
    expect(recoveryFromHealth(walk('future', 21, 20), S, { d: '2026-11-21', kind: 'walk', now })).toBeNull()
    expect(recoveryFromHealth(walk('overlap', 10, 20), S, { d: '2026-11-21', kind: 'walk', now })).toBeNull()
    expect(recoveryFromHealth(walk('ok', 12, 5), S, { d: '2026-11-21', kind: 'walk', now })).toMatchObject({ id: 'ok', min: 5 })
  })

  it('excludes sessions already logged as recovery by srcId or timestamp, but re-offers removed ones', () => {
    const logged = withRecovery({}, 'r1', { d: '2026-11-21', kind: 'walk', min: 25, at: at('2026-11-21', 8), src: 'hc', srcId: 'w1' }, 1)
    const loggedByTime = withRecovery(logged, 'r2', { d: '2026-11-21', kind: 'walk', min: 30, at: at('2026-11-21', 14) }, 2)
    const records = [walk('w1', 8, 25), walk('w2', 14, 30), walk('w3', 16, 20)]
    expect(matchingRecoverySessions(records, { recoverySessions: loggedByTime }, { d: '2026-11-21', kind: 'walk', src: 'hc', now }).map(r => r.id))
      .toEqual(['w3'])
    const removed = withRecovery(loggedByTime, 'r1', null, 3)
    expect(matchingRecoverySessions(records, { recoverySessions: removed }, { d: '2026-11-21', kind: 'walk', src: 'hc', now }).map(r => r.id))
      .toEqual(['w3', 'w1'])
  })

  it('deduplicates repeated records and clamps extreme durations', () => {
    const records = [
      walk('dup', 8, 25),
      walk('dup', 8, 25),
      walk('same-span', 8, 25),
      walk('long', 4, 700),
    ]
    const out = matchingRecoverySessions(records, {}, { d: '2026-11-21', kind: 'walk', src: 'hc', now })
    expect(out.map(r => [r.id, r.min])).toEqual([['dup', 25], ['long', 600]])
  })
})
