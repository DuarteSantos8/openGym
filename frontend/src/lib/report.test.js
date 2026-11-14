// The performance report's numbers (lib/report.js): every figure the PDF prints is counted here.
import { describe, it, expect } from 'vitest'
import { reportRange, reportData, totalsOf, bucketsOf, calendarOf, topLiftsOf, prsOf, inRange, workSetsOf } from './report.js'
import { reportPrintHTML, workoutPrintHTML, barChartSVG, lineChartSVG } from './report-print.js'

const at = (iso, h = 18) => new Date(iso + `T${String(h).padStart(2, '0')}:00:00`).getTime()
const workout = (d, entries, extra = {}) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 60 * 60000, name: 'Push', entries, ...extra })
const bench = (w, reps = [5, 5, 5], warm = true) => ({
  id: '0025',
  sets: [...(warm ? [{ w: w / 2, r: 8, done: true, warmup: true }] : []), ...reps.map(r => ({ w, r, done: true }))],
})

function state() {
  return {
    unit: 'kg', weekStart: 1, routines: [], week: {},
    workouts: [
      workout('2026-09-10', [bench(80)]),                                   // before both ranges
      workout('2026-09-30', [bench(90)]),                                   // the 4 weeks before (prev)
      workout('2026-10-06', [bench(95)], { prs: ['0025'] }),
      workout('2026-10-08', [bench(97.5, [5, 5, 4])]),
      workout('2026-10-09', [bench(100), { id: '0027', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] }], { prs: ['0025', '0025'], note: 'Good one' }),
      workout('2026-10-14', [{ id: '0464', mode: 'time', sets: [{ sec: 45, done: true }] }]),
    ],
    bodyweight: [{ d: '2026-10-01', w: 81 }, { d: '2026-10-07', w: 80.5 }, { d: '2026-10-14', w: 79.8 }],
  }
}
const TODAY = '2026-10-15'

describe('reportRange', () => {
  it('counts both ends: 7 days with today, 28 for four weeks', () => {
    expect(reportRange('7d', { today: TODAY })).toEqual({ from: '2026-10-09', to: TODAY, days: 7 })
    expect(reportRange('4w', { today: TODAY })).toEqual({ from: '2026-09-18', to: TODAY, days: 28 })
  })
  it('three months back to the day after the same date, short months clamped', () => {
    expect(reportRange('3m', { today: TODAY })).toMatchObject({ from: '2026-07-16', to: TODAY })
    expect(reportRange('3m', { today: '2026-05-31' })).toMatchObject({ from: '2026-03-01', to: '2026-05-31' })
  })
  it('custom: swapped ends put right, the future cut to today, junk falls back to four weeks', () => {
    expect(reportRange('custom', { from: '2026-10-10', to: '2026-10-01', today: TODAY })).toEqual({ from: '2026-10-01', to: '2026-10-10', days: 10 })
    expect(reportRange('custom', { from: '2026-10-10', to: '2027-01-01', today: TODAY })).toMatchObject({ to: TODAY })
    expect(reportRange('custom', { from: 'nope', to: '', today: TODAY })).toMatchObject({ from: '2026-09-18', to: TODAY })
  })
})

describe('totals', () => {
  it('counts work sets only (warm-ups and unticked sets out), volume, time and distinct new bests', () => {
    const S = state()
    const ws = inRange(S, reportRange('7d', { today: TODAY }))
    expect(ws.map(w => w.d)).toEqual(['2026-10-09', '2026-10-14'])
    const t = totalsOf(ws)
    expect(t.workouts).toBe(2)
    expect(t.sets).toBe(3 + 1 + 1)              // 3 bench + 1 row (the second not done) + 1 plank
    expect(t.volume).toBe(100 * 15 + 60 * 8)     // warm-up left out
    expect(t.ms).toBe(2 * 3600000)
    expect(t.prs).toBe(1)                         // the same lift twice in one workout is one best
    expect(workSetsOf(ws[0])).toBe(4)
  })
  it('body weight change from the first to the last weigh-in in the range', () => {
    const R = reportData(state(), { range: '4w', today: TODAY })
    expect(R.totals.bwStart).toBe(81)
    expect(R.totals.bwEnd).toBe(79.8)
    expect(R.totals.bwChange).toBe(-1.2)
    expect(R.bodyweight).toHaveLength(3)
  })
  it('compares with the stretch of the same length just before', () => {
    const R = reportData(state(), { range: '4w', today: TODAY })
    expect(R.workouts).toHaveLength(5)
    expect(R.prev.workouts).toBe(1)               // 10 Sep: 2026-08-21 .. 2026-09-17
    expect(R.prev.volume).toBe(80 * 15)
  })
})

describe('charts data', () => {
  it('a bucket for every day of a short range, every week of a longer one, the empty ones too', () => {
    const S = state()
    const r7 = reportRange('7d', { today: TODAY })
    const b7 = bucketsOf(inRange(S, r7), r7, 1)
    expect(b7.unit).toBe('day')
    expect(b7.buckets).toHaveLength(7)
    expect(b7.buckets.find(b => b.key === '2026-10-09').volume).toBe(1980)
    const r4 = reportRange('4w', { today: TODAY })
    const b4 = bucketsOf(inRange(S, r4), r4, 1)
    expect(b4.unit).toBe('week')
    expect(b4.buckets.map(b => b.key)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
    expect(b4.buckets.find(b => b.key === '2026-10-05').workouts).toBe(3)
    const r = reportRange('custom', { from: '2026-01-01', to: '2026-10-15', today: TODAY })
    expect(bucketsOf([], r, 1).unit).toBe('month')
  })
  it('the calendar has every day, shaded 0 for rest days', () => {
    const S = state()
    const r = reportRange('7d', { today: TODAY })
    const cal = calendarOf(inRange(S, r), r)
    expect(cal).toHaveLength(7)
    expect(cal.filter(d => d.n).map(d => d.d)).toEqual(['2026-10-09', '2026-10-14'])
    expect(cal.find(d => d.d === '2026-10-10').level).toBe(0)
    expect(cal.find(d => d.d === '2026-10-09').level).toBeGreaterThan(0)
  })
  it('top lifts: most sessions first, with the 1RM change across the range', () => {
    const S = state()
    const r = reportRange('4w', { today: TODAY })
    const [first, second] = topLiftsOf(S, inRange(S, r), r)
    expect(first.id).toBe('0025')
    expect(first.points.map(p => p.d)).toEqual(['2026-09-30', '2026-10-06', '2026-10-08', '2026-10-09'])
    expect(first.change).toBeGreaterThan(0)
    expect(second.id).toBe('0027')
    expect(second.change).toBeNull()               // one session: no change to report
  })
  it('new bests newest first, each with the set behind it', () => {
    const S = state()
    const prs = prsOf(S, inRange(S, reportRange('4w', { today: TODAY })))
    expect(prs.map(p => p.d)).toEqual(['2026-10-09', '2026-10-06'])
    expect(prs[0].best).toMatchObject({ w: 100, r: 5 })
  })
  it('streaks and muscles', () => {
    const R = reportData(state(), { range: '4w', today: TODAY })
    expect(R.streak.activeDays).toBe(5)
    expect(R.streak.longestDays).toBe(2)           // 8 and 9 Oct
    expect(R.streak.longestWeeks).toBe(3)          // weeks of 28 Sep, 5 Oct, 12 Oct
    expect(R.muscles.worked[0].slug).toBe('chest')
    expect(R.muscles.missed.length).toBeGreaterThan(0)
  })
})

describe('report and workout printouts', () => {
  it('an empty range still prints, and says so', () => {
    const html = reportPrintHTML({ unit: 'kg', workouts: [], bodyweight: [] }, { range: '7d', today: TODAY })
    expect(html).toContain('No workouts in this period.')
    expect(html).toContain('<title>Last 7 days</title>')
  })
  it('has every section for a range with training in it', () => {
    const html = reportPrintHTML(state(), { range: '4w', today: TODAY, owner: 'Ana' })
    for (const s of ['Volume per week', 'Consistency', 'Sets per muscle', 'Estimated 1RM, top lifts', 'Body weight', 'New bests', 'All workouts']) expect(html).toContain(s)
    expect(html.match(/<svg class="chart"/g).length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Good one')
    // No exercise media on paper, ever.
    expect(html).not.toMatch(/<img|\.webp|\.gif|\.mp4/)
  })
  it('summary cards show the change itself under the arrow, with a percentage when there was a before', () => {
    const html = reportPrintHTML(state(), { range: '4w', today: TODAY })
    // 5 workouts in the 4 weeks, 1 in the 4 weeks before.
    expect(html).toContain('<div class="delta up">▲ +4 · 400%</div>')
    expect(html).toContain('Arrows compare with the 28 days before.')
    // Same count both weeks: a flat line, no arrow.
    expect(reportPrintHTML(state(), { range: '7d', today: TODAY })).toContain('<div class="delta flat">± 0</div>')
  })
  it('nothing before the range: the change without a percentage; nothing at all: no arrows, no note', () => {
    const S = { ...state(), workouts: state().workouts.slice(-1), bodyweight: [] }
    const html = reportPrintHTML(S, { range: '7d', today: TODAY })
    expect(html).toContain('<div class="delta up">▲ +1</div>')
    const empty = reportPrintHTML({ unit: 'kg', workouts: [], bodyweight: [] }, { range: '7d', today: TODAY })
    expect(empty).not.toContain('class="delta')
    expect(empty).not.toContain('Arrows compare')
  })
  it('sets per muscle are whole numbers, with the rounding explained', () => {
    const html = reportPrintHTML(state(), { range: '4w', today: TODAY })
    const vals = [...html.matchAll(/<td class="v">([^<]*)<\/td>/g)].map(x => x[1])
    expect(vals.length).toBeGreaterThan(0)
    for (const v of vals) expect(v).toMatch(/^(<|&lt;)?\d+ sets?$/)
    expect(html).toContain('Rounded to whole sets.')
  })
  it('a workout: every exercise with every set, warm-ups marked', () => {
    const S = state()
    const html = workoutPrintHTML(S, S.workouts[4], { owner: 'Ana' })
    expect(html.match(/<div class="wx">/g)).toHaveLength(2)
    expect(html).toContain('<span class="k">Warm-up</span>')
    expect(html).toContain('100×5')
    expect(html).toContain('class="pr"')
    expect(html).not.toMatch(/<img|\.webp|\.gif|\.mp4/)
  })
  it('charts are plain SVG with round axis numbers', () => {
    const bars = barChartSVG([{ label: 'a', value: 1200 }, { label: 'b', value: 0 }, { label: 'c', value: 3100 }])
    expect(bars).toContain('class="bar hot"')
    expect(bars).toContain('>5,000<')
    const line = lineChartSVG([{ t: 0, y: 101 }, { t: 1, y: 117 }, { t: 2, y: 113 }])
    expect(line).toMatch(/>100<|>120</)
    expect(lineChartSVG([])).toBe('')
  })
})
