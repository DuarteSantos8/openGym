// The freeze rule you pick (lib/streak-rule.js, used by lib/streak.js streakInfo): each rule, the
// week it starts, and that a switch never rewrites what was already counted. Also how it rides
// along in a sync merge and in a backup.
import { describe, expect, it } from 'vitest'
import { streakInfo } from './streak.js'
import { isoOf } from './format.js'
import { streakRuleOf, ruleTimeline, ruleAt, setStreakRule, currentRule, HISTORY_MAX } from './streak-rule.js'
import { mergeStates, stampEdits } from './sync-merge.js'

const day = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const MON = '2026-06-01' // a Monday; week k starts at day(MON, 7k)
const wk = k => day(MON, 7 * k)
// Trained in the listed weeks (a Tuesday each), with Monday weeks.
const prof = (weeks, extra = {}) => ({ weekStart: 1, workouts: weeks.map(k => ({ d: day(wk(k), 1) })), ...extra })
const rule = (r, since = null, history = []) => ({ streakRule: { rule: r, since, history } })
const at = k => day(wk(k), 2) // a Wednesday of week k, "today"

// 8 trained weeks (two freezes earned under generous), then weeks 8 and 9 missed, 10 trained.
const twoGaps = [0, 1, 2, 3, 4, 5, 6, 7, 10]

describe('each rule', () => {
  it('generous (no pick): two missed weeks in a row are covered, as before 1.4.5', () => {
    const got = streakInfo(prof(twoGaps), at(10))
    expect(got.current).toBe(9)
    expect(got.frozen).toEqual([wk(8), wk(9)])
    expect(got.rule).toBe('generous'); expect(got.max).toBe(2)
  })

  it('gentle: one freeze at most, so two missed weeks in a row end the streak', () => {
    const got = streakInfo(prof(twoGaps, rule('gentle')), at(10))
    expect(got.current).toBe(1)
    expect(got.max).toBe(1)
    // One missed week is still covered.
    const one = streakInfo(prof([0, 1, 2, 3, 5], rule('gentle')), at(5))
    expect(one.current).toBe(5); expect(one.frozen).toEqual([wk(4)])
  })

  it('off: no freezes, any missed week starts over, and nothing to earn', () => {
    const got = streakInfo(prof([0, 1, 2, 3, 5], rule('off')), at(5))
    expect(got.current).toBe(1)
    expect(got.freezes).toBe(0); expect(got.max).toBe(0); expect(got.toNextFreeze).toBe(0)
    const log = new Map(); streakInfo(prof([0, 1, 2, 3, 5], rule('off')), at(5), log)
    expect(log.get(wk(4))).toMatchObject({ s: 'broke', rule: 'off' })
  })

  it('the current week stays open under every rule', () => {
    for (const r of ['off', 'gentle', 'generous']) {
      const got = streakInfo(prof([0, 1, 2], rule(r)), at(3))
      expect(got.current).toBe(3)
      expect(got.thisWeekDone).toBe(false)
    }
  })
})

describe('a switch counts from its week on, never back', () => {
  it('weeks before the switch keep the old rule: a frozen week stays frozen, the streak stays', () => {
    // Generous covered weeks 8 and 9; then off from week 11 on.
    const S = prof([...twoGaps, 11], rule('off', wk(11), [{ rule: 'generous', since: null }]))
    const got = streakInfo(S, at(11))
    expect(got.current).toBe(10)
    expect(got.frozen).toEqual([wk(8), wk(9)])
    expect(got.rule).toBe('off')
    // …and the next missed week, under off, ends it.
    expect(streakInfo(S, at(13)).current).toBe(0)
  })

  it('a rule that keeps fewer only trims the bank at the switch', () => {
    // 8 trained weeks: 2 freezes under generous. Gentle from week 8: the bank is 1.
    const S = prof([0, 1, 2, 3, 4, 5, 6, 7, 8], rule('gentle', wk(8), [{ rule: 'generous', since: null }]))
    const before = streakInfo({ ...S, streakRule: undefined }, at(8))
    const after = streakInfo(S, at(8))
    expect(before.freezes).toBe(2)
    expect(after.freezes).toBe(1)
    expect(after.current).toBe(before.current)
  })

  it('setStreakRule starts at this week, keeps the one before, and replaces a pick in the same week', () => {
    const S = prof([0, 1, 2, 3, 4, 5, 6, 7])
    expect(setStreakRule(S, 'gentle', at(8))).toBe(true)
    expect(S.streakRule).toEqual({ rule: 'gentle', since: wk(8), history: [{ rule: 'generous', since: null }] })
    expect(setStreakRule(S, 'gentle', at(8))).toBe(false)
    setStreakRule(S, 'off', day(wk(8), 4))
    expect(S.streakRule).toEqual({ rule: 'off', since: wk(8), history: [{ rule: 'generous', since: null }] })
    setStreakRule(S, 'generous', at(10))
    expect(S.streakRule.history).toEqual([{ rule: 'generous', since: null }, { rule: 'off', since: wk(8) }])
    expect(ruleAt(ruleTimeline(S), wk(9))).toBe('off')
    expect(ruleAt(ruleTimeline(S), wk(7))).toBe('generous')
    expect(currentRule(S)).toBe('generous')
  })

  it('a first pick (a new profile) judges every week, imported old sessions too', () => {
    const S = prof(twoGaps)
    setStreakRule(S, 'gentle', at(10), { always: true })
    expect(S.streakRule).toEqual({ rule: 'gentle', since: null, history: [] })
    expect(streakInfo(S, at(10)).current).toBe(1)
  })

  it('follows the profile\'s own weeks: a since on a Wednesday is that week', () => {
    const S = prof(twoGaps, rule('off', day(wk(11), 2), [{ rule: 'generous', since: null }]))
    expect(streakInfo(S, at(11)).current).toBe(9)
  })
})

describe('a stored rule, cleaned', () => {
  it('ignores what is not a rule, and counts it as generous', () => {
    for (const bad of [undefined, null, 'gentle', { rule: 'strict' }, { rule: 1 }, []]) {
      expect(streakRuleOf({ streakRule: bad })).toBe(null)
      expect(currentRule({ streakRule: bad })).toBe('generous')
    }
    expect(streakRuleOf({ streakRule: { rule: 'off', since: 'soon' } })).toEqual({ rule: 'off', since: null, history: [] })
  })

  it('keeps only earlier history, in order, once per start, capped', () => {
    const history = [{ rule: 'off', since: wk(5) }, { rule: 'nope', since: wk(1) }, { rule: 'gentle', since: wk(2) }, { rule: 'generous', since: wk(9) }, { rule: 'generous', since: wk(2) }]
    expect(streakRuleOf({ streakRule: { rule: 'gentle', since: wk(8), history } }).history)
      .toEqual([{ rule: 'generous', since: wk(2) }, { rule: 'off', since: wk(5) }])
    const long = Array.from({ length: 40 }, (_, i) => ({ rule: 'off', since: wk(i) }))
    expect(streakRuleOf({ streakRule: { rule: 'gentle', since: wk(50), history: long } }).history).toHaveLength(HISTORY_MAX)
  })
})

describe('sync and backup', () => {
  it('a merge keeps the rule changed last, whole', () => {
    const base = { _ts: 1, workouts: [], weekStart: 1 }
    const a = stampEdits(base, { ...base, _ts: 2, streakRule: { rule: 'off', since: wk(8), history: [{ rule: 'generous', since: null }] } }, 1000)
    const b = stampEdits(base, { ...base, _ts: 3, streakRule: { rule: 'gentle', since: wk(9), history: [{ rule: 'generous', since: null }] } }, 2000)
    expect(mergeStates(a, b).streakRule).toEqual(b.streakRule)
    expect(mergeStates(b, a).streakRule).toEqual(b.streakRule)
    // A copy from an older app that never had the field does not wipe it.
    const old = { ...base, _ts: 5 }
    expect(mergeStates(a, old).streakRule).toEqual(a.streakRule)
  })

  it('survives a backup round trip, and a broken one counts as generous', () => {
    const S = prof(twoGaps); setStreakRule(S, 'gentle', at(10))
    const back = JSON.parse(JSON.stringify(S))
    expect(back.streakRule).toEqual(S.streakRule)
    expect(streakInfo(back, at(10)).current).toBe(streakInfo(S, at(10)).current)
    expect(streakInfo({ ...back, streakRule: { rule: 'x' } }, at(10)).current).toBe(9)
  })
})

describe('one number everywhere', () => {
  it('the watch, the widgets, the recap and the report read the streak from lib/streak.js only', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const src = resolve(process.cwd(), 'src')
    for (const f of ['lib/watch-sync.js', 'lib/widgets.js', 'lib/recap.js']) expect(readFileSync(join(src, f), 'utf8')).toMatch(/import \{[^}]*streak(Info|Weeks)[^}]*\} from '\.\/streak\.js'/)
    // Nobody else keeps a freeze count of their own: the one walk is api/coach/core/streak.js, which
    // lib/streak.js and the trainer list on the server both run.
    const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (!['node_modules', 'locales', 'fixtures'].includes(n)) walk(p, out) } else if (/\.(js|jsx|mjs)$/.test(n) && !/\.test\./.test(n)) out.push(p) } return out }
    const files = [...walk(src), ...walk(resolve(process.cwd(), '../api')), ...walk(resolve(process.cwd(), '../mcp/src'))]
    const own = files.filter(f => !/(lib|coach[\\/]core)[\\/]streak(-rule)?\.js$/.test(f) && /freezes\s*(\+\+|--|[-+]=)/.test(readFileSync(f, 'utf8')))
    expect(own).toEqual([])
  })
})
