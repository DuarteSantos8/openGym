// What the Strength page draws for one exercise: the exercises with a history (best first), the
// one shown, its points per chart metric (top set, per set, estimated 1RM, effort, Max reps) cut
// to the range, its bests, and the last five sessions. The bests and the sessions stay all-time;
// only the chart follows the range (issue #511).
import { useMemo } from 'react'
import { EXIDX, betterWeight, isAssisted } from './exercises.js'
import {
  modeOf, entriesForExercise, metricEntriesForExercise, metricModeForEntry, bestWeightForEntry, completedRepsOf,
} from './history.js'
import { fmtNum } from './format.js'
import { speedUnitOf, speedLabel, toSpeed } from './speed.js'
import { t, exerciseNameFor } from './i18n.js'
import { displayScale, scaleName, toScale, avgRir } from './effort.js'
import { e1rmSeries, best1RM, formulaOf } from './onerm.js'
import { currentDbLoad, workoutAs } from './dumbbells.js'
import { maxRepsSeries } from './pyramid.js'
import { perSetSessions, perSetLines, dropOffSet } from './per-set.js'
import { rangeStart } from './progress-range.js'

// Set 1 to 5 on the per-set chart — system colours, so each line keeps its hue in dark mode. The
// legend's keys are the same five (.set-key-N, tab-kit.css).
const SET_COLORS = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)', 'var(--pink)']

const listOf = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
const firstAvailable = (...values) => {
  for (const value of values) {
    const list = listOf(value)
    if (list.length) return list
  }
  return []
}

export function useExerciseProgress(S, { exId, exRange, exMetric }) {
  const exFrom = useMemo(() => rangeStart(exRange), [exRange])
  const inExRange = p => p.t >= exFrom
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const workouts = S.workouts

  // Dumbbell weights are read in each exercise's current meaning (lib/dumbbells.js), so the
  // chart and its best compare like with like across a switch between per bell and total.
  const meantIn = {}
  const metricDataOf = (workout, id) => {
    const entries = metricEntriesForExercise(workoutAs(workout, id, meantIn[id] ??= currentDbLoad(S, id)), id)
    const mode = entries.at(-1)?.mode || null
    const sameMode = entries.filter(item => item.mode === mode)
    const best = mode === 'reps' ? sameMode.reduce((value, item) => {
      const candidate = bestWeightForEntry(item.entry)
      if (!(candidate > 0)) return value
      return value > 0 ? betterWeight(id, value, candidate) : candidate
    }, 0) : 0
    return { mode, entries: sameMode, rows: sameMode.flatMap(item => item.rows), best }
  }
  const entryOf = id => workouts.flatMap(w => w.entries).find(e => e.id === id)
  const nameOf = id => {
    if (EXIDX[id]) return exerciseNameFor(EXIDX[id])
    const entry = entryOf(id)
    return entry?.muscleSnapshot?.n || entry?.n || id
  }
  // What the picker's search matches an exercise on: the catalogue's own entry, or what a
  // deleted custom exercise's logged entry still carries.
  const matcherOf = id => {
    if (EXIDX[id]) return EXIDX[id]
    const entry = entryOf(id)
    const snapshot = entry?.muscleSnapshot || {}
    const primaries = firstAvailable(snapshot.primaries, entry?.primaries)
    const secondaries = firstAvailable(
      snapshot.sm, snapshot.secondaries, snapshot.muscleGroups,
      entry?.sm, entry?.secondaries, entry?.muscleGroups,
    )
    return {
      n: snapshot.n || entry?.n || id,
      bp: snapshot.bp || entry?.bp || '',
      tg: primaries[0] || snapshot.tg || entry?.tg || '',
      sm: secondaries,
      eq: snapshot.eq || entry?.eq || '',
      desc: snapshot.desc || entry?.desc || '',
    }
  }
  // Cardio is charted and ranked in the profile's speed unit; the sets keep km/h (lib/speed.js).
  const speedUnit = speedUnitOf(S)
  const currentOf = id => {
    for (let i = workouts.length - 1; i >= 0; i--) {
      const data = metricDataOf(workouts[i], id)
      if (!data.mode) continue
      const mode = data.mode
      const rows = data.rows
      const mx = mode === 'reps'
        ? data.best
        : Math.max(0, ...rows.map(s => mode === 'cardio' ? toSpeed(s.speed || 0, speedUnit) : mode === 'time' ? (s.sec || 0) : (s.w || 0)))
      if (mx > 0) return { mx, unit: mode === 'cardio' ? speedLabel(speedUnit) : mode === 'time' ? 's' : S.unit }
      // Unloaded reps work still has a current figure — its rep count. Without this the whole
      // picker label went blank and the exercise sorted to the bottom as if it had no history.
      if (mode === 'reps') {
        const reps = Math.max(0, ...rows.map(completedRepsOf))
        if (reps > 0) return { mx: reps, unit: t('reps') }
      }
    }
    return { mx: 0, unit: S.unit }
  }
  const exHist = [...new Set(workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id] || nameOf(id) !== id)
  const exCurrent = Object.fromEntries(exHist.map(id => [id, currentOf(id)]))
  exHist.sort((a, b) => exCurrent[b].mx - exCurrent[a].mx || nameOf(a).localeCompare(nameOf(b)))
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // A completed reps work row is authoritative for strength metrics, even when the parent
  // target also contains timed/cardio work. Entries without reps rows use their selected mode.
  const curMode = curEx ? (() => {
    for (let i = workouts.length - 1; i >= 0; i--) {
      const data = metricDataOf(workouts[i], curEx)
      if (data.mode) return data.mode
      const entries = entriesForExercise(workouts[i], curEx)
      for (let j = entries.length - 1; j >= 0; j--) {
        const mode = metricModeForEntry(entries[j])
        if (mode) return mode
      }
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  // A pull-up or a push-up carries no weight, so its "best weight" is 0 — and dropping every
  // zero point left the card reading "No data yet" for exercises with a full history behind
  // them (issue #5). When nothing in an exercise's history was ever loaded, the progress IS
  // the rep count, so plot that. Add a weighted set later and it switches back to weight on
  // its own, which is also the honest reading: that is when load became the thing improving.
  const repsOnly = curEx && curMode === 'reps' && !workouts.some(w =>
    entriesForExercise(w, curEx).some(en => bestWeightForEntry(en) > 0))
  const metric = s => curCardio ? toSpeed(s.speed || 0, speedUnit) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? speedLabel(speedUnit) : curTimed ? 's' : repsOnly ? t('reps') : S.unit
  const exPts = []
  let exBest = 0
  if (curEx) {
    workouts.forEach(w => {
      const data = metricDataOf(w, curEx)
      if (data.mode === curMode) {
        const doneSets = data.rows
        const representative = data.entries.at(-1)?.entry
        const mx = curMode === 'reps'
          ? (repsOnly ? Math.max(0, ...doneSets.map(completedRepsOf)) : data.best)
          : Math.max(0, ...doneSets.map(metric))
        if (mx > 0) {
          exPts.push({ t: w.start, y: mx, d: w.d, sets: doneSets, target: representative?.target, w })
          // Weighted work on an assistance machine reads the other way: the smallest load is the
          // best (issue #232). Reps, duration and speed are always "more is better".
          const better = curMode === 'reps' && !repsOnly ? betterWeight(curEx, exBest || mx, mx) : Math.max(exBest, mx)
          exBest = exBest > 0 ? better : mx
        }
      }
    })
  }
  const sessions = exPts.slice(-5).reverse()
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  // Both memoised on the same inputs, and it has to start at e1rmSeries: LineChart clears its
  // hover whenever `points` changes identity, so a chart array rebuilt on every render made the
  // tooltip vanish under your finger the moment anything else on this screen re-rendered.
  // Memoising only the .map() would not have helped — its dependency was itself rebuilt each time.
  const e1Pts = useMemo(
    () => (curEx && curMode === 'reps' ? e1rmSeries(S, curEx) : []),
    [S, curEx, curMode],
  )
  const e1ChartPts = useMemo(() => e1Pts.filter(p => p.t >= exFrom).map(p => ({ t: p.t, y: p.y, d: p.d })), [e1Pts, exFrom])
  const e1Best = curEx && curMode === 'reps' ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(p => p && inExRange(p))
  // Pyramid sets' Max sets: the most reps in one, per workout — the point of a Max set is seeing
  // that number climb, which the top-set weight line does not show.
  const maxPts = useMemo(
    () => (curEx && curMode === 'reps' ? maxRepsSeries(workouts, curEx).map(p => ({ t: p.t, y: p.y, d: p.d, note: p.w > 0 ? fmtNum(p.w) + ' ' + S.unit : undefined })) : []),
    [workouts, curEx, curMode, S.unit],
  )
  const showMax = maxPts.length > 0
  const maxBest = showMax ? Math.max(...maxPts.map(p => p.y)) : 0
  const maxChartPts = useMemo(() => maxPts.filter(p => p.t >= exFrom), [maxPts, exFrom])
  // Per set (issue #145): one line per set number, to see which set you drop off on — often not
  // the last. Offered once two sessions are logged and one of them has two sets or more.
  // Memoised like e1Pts: LineChart drops its hover whenever `points` changes identity.
  // Loaded work is drawn as each set's estimated 1RM, so straight sets at one weight still part
  // where reps were lost. Reps instead for unloaded work, an assistance machine (where a 1RM
  // reads backwards), or a history of sets all past the estimate's rep cap.
  const oneRmFormula = formulaOf(S)
  const perSet = useMemo(() => {
    if (!curEx || curMode !== 'reps') return null
    const usable = list => list.length >= 2 && list.some(s => s.sets.length >= 2)
    let metric = repsOnly || isAssisted(curEx) ? 'reps' : 'e1rm'
    let sessions = perSetSessions(workouts, curEx, { metric, formula: oneRmFormula })
    if (metric === 'e1rm' && !usable(sessions)) sessions = perSetSessions(workouts, curEx, { metric: metric = 'reps' })
    if (!usable(sessions)) return null
    const { lines, hidden } = perSetLines(sessions)
    const shown = new Set(lines.map(l => l.n))
    return {
      series: lines.map(l => ({ n: l.n, points: l.points, color: SET_COLORS[l.n - 1] })),
      anchors: sessions.map(s => ({
        t: s.t, d: s.d, y: Math.max(...s.sets.map(x => x.y)),
        note: s.sets.filter(x => shown.has(x.n)).map(x => x.n + ': ' + (repsOnly ? x.r : fmtNum(x.w) + '×' + x.r)).join(' · '),
      })),
      ns: lines.map(l => l.n),
      hidden,
      metric,
      drop: dropOffSet(sessions),
    }
  }, [workouts, curEx, curMode, repsOnly, oneRmFormula])
  // The same sessions cut to the range; a set number with nothing left in it drops out of the legend.
  const perSetChart = useMemo(() => {
    if (!perSet) return null
    const series = perSet.series.map(s => ({ ...s, points: s.points.filter(p => p.t >= exFrom) })).filter(s => s.points.length)
    return { anchors: perSet.anchors.filter(p => p.t >= exFrom), series, ns: series.map(s => s.n) }
  }, [perSet, exFrom])
  const onSets = !!perSet && exMetric === 'sets'
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const onMax = showMax && exMetric === 'max'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  })).filter(inExRange)
  const chartPts = onSets ? perSetChart.anchors : onMax ? maxChartPts : onEff ? effPts : onE1 ? e1ChartPts : topPts
  // A line needs two workouts. A range that holds fewer says so, instead of a lone dot or an empty box.
  const rangeTooShort = exRange !== 0 && chartPts.length < 2
  // Short labels (ux-redesign-tabs §4.3): five of them share a 320px row.
  const options = [{ value: 'top', label: t('Top') }]
  // The full words stay the buttons' names; the label is the tighter wording that fits.
  if (perSet) options.push({ value: 'sets', label: t('Per set (short)'), ariaLabel: t('Per set') })
  if (showE1) options.push({ value: 'e1rm', label: t('1RM') })
  if (showEff) options.push({ value: 'effort', label: t('Effort (short)'), ariaLabel: t('Effort') })
  if (showMax) options.push({ value: 'max', label: t('Max') })
  const shown = onMax ? 'max' : onEff ? 'effort' : onE1 ? 'e1rm' : onSets ? 'sets' : 'top'

  return {
    exHist, exCurrent, curEx, nameOf, matcherOf, curCardio, curTimed, repsOnly, speedUnit, exUnit, exBest, kind, hd,
    sessions, chartPts, rangeTooShort, options, shown, onSets, onE1, onEff, onMax, showEff,
    perSet, perSetChart, maxChartPts, maxBest, effPts, e1Best,
  }
}
