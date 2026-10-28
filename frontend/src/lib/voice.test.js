// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertWeight, parseSpokenWeight, importPendingWeighIns, todayRoutineIds, loggedLine, weightInRange } from './voice.js'

// Weigh-ins Siri logged with the app closed (ios/App/App/VoiceIntents.swift VoicePending), and
// what Assistant hands over in a link: brought in once, in the profile's unit, on the right day.
const at = (iso, hh = 8, mm = 0) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime()
const pending = (over = {}) => ({ id: 'p1', w: 78.2, unit: 'kg', at: at('2026-10-28'), d: '2026-10-28', ...over })
const NOW = at('2026-10-28', 12)

describe('parseSpokenWeight', () => {
  it('reads numbers as assistants pass them', () => {
    expect(parseSpokenWeight('78.2')).toEqual({ w: 78.2, unit: null })
    expect(parseSpokenWeight('78,2')).toEqual({ w: 78.2, unit: null })
    expect(parseSpokenWeight(' 80 kg ')).toEqual({ w: 80, unit: 'kg' })
    expect(parseSpokenWeight('80 kilos')).toEqual({ w: 80, unit: 'kg' })
    expect(parseSpokenWeight('170 lbs')).toEqual({ w: 170, unit: 'lb' })
    expect(parseSpokenWeight('170 pounds')).toEqual({ w: 170, unit: 'lb' })
    expect(parseSpokenWeight(72)).toEqual({ w: 72, unit: null })
  })

  it('refuses what is not a weight', () => {
    for (const v of ['', 'abc', '-5', '0', '78.2 stone', '1e3', '78..2', null, undefined, NaN, Infinity, -3, {}]) {
      expect(parseSpokenWeight(v), String(v)).toBeNull()
    }
  })
})

describe('convertWeight', () => {
  it('converts both ways to a tenth', () => {
    expect(convertWeight(100, 'kg', 'lb')).toBe(220.5)
    expect(convertWeight(170, 'lb', 'kg')).toBe(77.1)
    expect(convertWeight(78.24, 'kg', 'kg')).toBe(78.2)
    expect(Number.isNaN(convertWeight('x', 'kg', 'kg'))).toBe(true)
  })

  it('knows a body weight from a mishearing', () => {
    expect(weightInRange(78, 'kg')).toBe(true)
    expect(weightInRange(2, 'kg')).toBe(false)
    expect(weightInRange(30, 'lb')).toBe(false)
    expect(weightInRange(1600, 'lb')).toBe(false)
  })
})

describe('importPendingWeighIns', () => {
  it('logs a pending weigh-in like the sheet does, and says which ids it looked at', () => {
    const s = { unit: 'kg', bodyweight: [{ d: '2026-10-20', w: 79, t: at('2026-10-20') }] }
    const res = importPendingWeighIns(s, [pending()], { now: NOW })
    expect(res.ids).toEqual(['p1'])
    expect(res.logged).toEqual([{ id: 'p1', d: '2026-10-28', w: 78.2, unit: 'kg' }])
    expect(s.bodyweight).toEqual([{ d: '2026-10-20', w: 79, t: at('2026-10-20') }, { d: '2026-10-28', w: 78.2, t: at('2026-10-28') }])
    expect(loggedLine(res.logged[0])).toBe('78.2 kg')
  })

  it('brings each one in once: the same id twice, a second run, an id seen before', () => {
    const s = { unit: 'kg', bodyweight: [] }
    importPendingWeighIns(s, [pending(), pending()], { now: NOW })
    expect(s.bodyweight).toHaveLength(1)
    const again = importPendingWeighIns(s, [pending()], { now: NOW })
    expect(again.logged).toEqual([])
    expect(again.ids).toEqual(['p1'])
    expect(s.bodyweight).toHaveLength(1)
    // Deleted in the app after it came in: an id the phone failed to clear does not bring it back.
    s.bodyweight = []
    expect(importPendingWeighIns(s, [pending()], { now: NOW, seen: ['p1'] }).logged).toEqual([])
    expect(s.bodyweight).toEqual([])
  })

  it('leaves a newer weigh-in of that day alone, and replaces an older one', () => {
    const newer = { unit: 'kg', bodyweight: [{ d: '2026-10-28', w: 80, t: at('2026-10-28', 9) }] }
    importPendingWeighIns(newer, [pending()], { now: NOW })
    expect(newer.bodyweight).toEqual([{ d: '2026-10-28', w: 80, t: at('2026-10-28', 9) }])
    const older = { unit: 'kg', bodyweight: [{ d: '2026-10-28', w: 80, t: at('2026-10-28', 7), src: 'health' }] }
    importPendingWeighIns(older, [pending()], { now: NOW })
    expect(older.bodyweight).toEqual([{ d: '2026-10-28', w: 78.2, t: at('2026-10-28') }])
  })

  it('takes several in time order, the last of a day winning', () => {
    const s = { unit: 'kg', bodyweight: [] }
    const res = importPendingWeighIns(s, [
      pending({ id: 'b', w: 78.0, at: at('2026-10-28', 9) }),
      pending({ id: 'a', w: 78.6, at: at('2026-10-28', 7) }),
      pending({ id: 'c', w: 79.1, at: at('2026-10-27', 7), d: '2026-10-27' }),
    ], { now: NOW })
    expect(res.logged.map(l => l.id)).toEqual(['c', 'a', 'b'])
    expect(s.bodyweight).toEqual([{ d: '2026-10-27', w: 79.1, t: at('2026-10-27', 7) }, { d: '2026-10-28', w: 78, t: at('2026-10-28', 9) }])
  })

  it('converts to the profile’s unit', () => {
    const lb = { unit: 'lb', bodyweight: [] }
    importPendingWeighIns(lb, [pending({ w: 80, unit: 'kg' })], { now: NOW })
    expect(lb.bodyweight[0].w).toBe(176.4)
    const kg = { unit: 'kg', bodyweight: [] }
    importPendingWeighIns(kg, [pending({ w: 176.4, unit: 'lb' })], { now: NOW })
    expect(kg.bodyweight[0].w).toBe(80)
  })

  it('drops bad ones but still lets the phone forget them', () => {
    const s = { unit: 'kg' }
    const res = importPendingWeighIns(s, [
      pending({ id: 'neg', w: -3 }), pending({ id: 'tiny', w: 2 }), pending({ id: 'huge', w: 900 }),
      pending({ id: 'nan', w: 'eighty' }), pending({ id: 'nounit', unit: undefined }),
      pending({ id: 'future', at: NOW + 3 * 86400000 }), pending({ id: 'noat', at: undefined }),
      { w: 80, unit: 'kg', at: NOW }, null, 'junk',
    ], { now: NOW })
    expect(s.bodyweight).toEqual([])
    expect(res.logged).toEqual([])
    expect(res.ids).toEqual(['neg', 'tiny', 'huge', 'nan', 'nounit', 'future', 'noat'])
  })

  it('accepts a number sent as text, and a unit inside it (none at all is no weigh-in)', () => {
    const s = { unit: 'kg', bodyweight: [] }
    importPendingWeighIns(s, [pending({ w: '78,4' }), pending({ id: 'p2', w: '170 lb', unit: undefined, at: at('2026-10-27'), d: '2026-10-27' })], { now: NOW })
    expect(s.bodyweight.map(b => b.w)).toEqual([77.1, 78.4])
    expect(importPendingWeighIns(s, [pending({ id: 'p3', w: '80', unit: undefined, at: NOW })], { now: NOW }).logged).toEqual([])
  })

  describe('time zones', () => {
    const tz = process.env.TZ
    afterEach(() => { process.env.TZ = tz })

    it('keeps the day the phone was on when Siri logged it', () => {
      // Logged at 23:30 in Zurich on the 27th, opened in New York: still the 27th.
      process.env.TZ = 'America/New_York'
      const s = { unit: 'kg', bodyweight: [] }
      const loggedAt = Date.UTC(2026, 9, 27, 22, 30)
      importPendingWeighIns(s, [pending({ at: loggedAt, d: '2026-10-27' })], { now: Date.UTC(2026, 9, 28, 12) })
      expect(s.bodyweight[0].d).toBe('2026-10-27')
    })

    it('works the day out in local time when the phone did not say', () => {
      process.env.TZ = 'Asia/Tokyo'
      const s = { unit: 'kg', bodyweight: [] }
      importPendingWeighIns(s, [pending({ at: Date.UTC(2026, 9, 27, 20), d: undefined })], { now: Date.UTC(2026, 9, 28, 3) })
      expect(s.bodyweight[0].d).toBe('2026-10-28')
    })

    it('never puts one on a day that has not come yet here', () => {
      // Logged just after midnight in Zurich (the 29th there), opened in New York the evening before.
      process.env.TZ = 'America/New_York'
      const s = { unit: 'kg', bodyweight: [] }
      importPendingWeighIns(s, [pending({ at: Date.UTC(2026, 9, 28, 23, 10), d: '2026-10-29' })], { now: Date.UTC(2026, 9, 28, 23, 40) })
      expect(s.bodyweight[0].d).toBe('2026-10-28')
    })
  })
})

describe('todayRoutineIds', () => {
  it('is today’s plan, without the empty routines', () => {
    const iso = '2026-10-28'
    const wd = new Date(iso + 'T12:00:00').getDay()
    const S = { routines: [{ id: 'r1', ex: [{ id: 'squat' }] }, { id: 'r2', ex: [] }, { id: 'r3', ex: [{ id: 'row' }] }], week: { [wd]: ['r1', 'r2'] }, dayPlan: {} }
    expect(todayRoutineIds(S, iso)).toEqual(['r1'])
    expect(todayRoutineIds({ ...S, dayPlan: { [iso]: 'rest' } }, iso)).toEqual([])
    expect(todayRoutineIds({ ...S, dayPlan: { [iso]: 'r3' } }, iso)).toEqual(['r3'])
    expect(todayRoutineIds(null, iso)).toEqual([])
  })
})

describe('startVoice', () => {
  afterEach(async () => { (await import('./voice.js'))._resetVoice(); vi.restoreAllMocks() })

  it('brings in what is pending once the store is ready, clears it and says so', async () => {
    const m = await import('./voice.js')
    const plugin = { pending: vi.fn(async () => ({ items: [pending({ at: Date.now() - 60000, d: undefined })] })), clear: vi.fn(async () => {}) }
    m._setVoicePluginForTest(plugin)
    let state = { ready: false, S: { unit: 'kg', bodyweight: [] } }
    const subs = new Set()
    const useStore = {
      getState: () => ({ ...state, update: fn => { const S = structuredClone(state.S); fn(S); state = { ...state, S } } }),
      subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
    }
    const toast = vi.fn()
    const stop = await m.startVoice({ useStore, toast })
    expect(plugin.pending).not.toHaveBeenCalled()
    state = { ...state, ready: true }
    for (const fn of [...subs]) fn(state)
    await vi.waitFor(() => expect(plugin.clear).toHaveBeenCalledWith({ ids: ['p1'] }))
    expect(state.S.bodyweight).toHaveLength(1)
    expect(toast).toHaveBeenCalledWith('78.2 kg logged by Siri')
    stop()
  })
})
