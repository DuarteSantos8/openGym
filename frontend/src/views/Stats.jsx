import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { lastBW, streakWeeks, setLabel, modeOf, effortOf, metricModeForEntry, metricRowsForEntry, bestWeightForEntry, volumeByPhase, setsByPhase, workoutVolume } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, weekKey } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { loadOfWorkouts, rankOf, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { fatigueOf, strengthOf, STRENGTH_FLOOR } from '../lib/recovery.js'
import { strengthExerciseRowsForMuscle } from '../lib/strength-exercises.js'
import { fatigueStateOf } from '../lib/recovery-view.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import {
  hasEffort, displayScale, scaleName, toScale, avgRir, effortSummary, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR
} from '../lib/effort.js'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'
import { historyUnitCompatible } from '../lib/workout-model.js'

// Which muscles the training in a window actually hit — and, the point of the card,
// which ones it keeps missing. Shading is relative within the window (lib/muscles.js).
function latestMuscleTraining(workouts) {
  const latest = {}
  for (const workout of workouts || []) {
    const timestamp = Number(workout?.start || new Date(workout?.d).getTime())
    if (!Number.isFinite(timestamp)) continue
    for (const entry of workout.entries || []) {
      if (!(entry.sets || []).some(set => set?.done === true)) continue
      for (const slug of Object.keys(musclesOf(EXIDX[entry.id]))) {
        if (latest[slug] == null || timestamp > latest[slug]) latest[slug] = timestamp
      }
    }
  }
  return latest
}

export const FATIGUE_LEVELS = [
  { at: 0, level: 0 },
  { at: 0.15, level: 1 },
  { at: 0.25, level: 2 },
  { at: 0.4, level: 3 },
  { at: 0.55, level: 4, exclusive: true },
]

export const STRENGTH_LEVELS = [
  { at: STRENGTH_FLOOR, level: 0 },
  { at: 0.625, level: 1 },
  { at: 0.75, level: 2 },
  { at: 0.875, level: 3 },
  { at: 1, level: 4 },
]

function useNow() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(tick => tick + 1), 60000)
    return () => clearInterval(iv)
  }, [])
  return Date.now()
}

/**
 * Return the whole weeks since a completed muscle-training timestamp.
 *
 * @param {number} now Current render-time timestamp in milliseconds.
 * @param {number} lastTrained Timestamp of the latest completed training event.
 * @returns {number} Non-negative whole weeks, including zero for ages under seven days.
 */
export function weeksSinceTraining(now, lastTrained) {
  return Math.max(0, Math.floor((now - lastTrained) / 86400000 / 7))
}

function FatigueLegend() {
  return <div className="hm-legend hm-fatigue" aria-label={t('Fatigue')}>
    <span>{t('Fatigued')}</span><div className="hm-c l4" />
    <span>{t('Recovering')}</span><div className="hm-c l2" />
    <span>{t('Ready')}</span><div className="hm-c l0" />
  </div>
}

function StrengthLegend() {
  return <div className="hm-legend hm-strength" aria-label={t('Strength')}>
    <span>1 <span className="dim">{t('full')}</span></span><div className="hm-c l4" /><div className="hm-c l3" /><div className="hm-c l2" />
    <div className="hm-c l1" /><div className="hm-c l0" /><span>{fmtNum(STRENGTH_FLOOR)} <span className="dim">{t('floor')}</span></span>
  </div>
}

function fatigueLabel(value) {
  const state = fatigueStateOf(value)
  return t(state === 'ready' ? 'Ready' : state === 'recovering' ? 'Recovering' : 'Fatigued')
}

function MuscleBalance({ S }) {
  const [view, setView] = useState('balance')
  const [win, setWin] = useState(7)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const now = useNow()
  const workouts = S.workouts
  // The user's own last registered bodyweight drives bodyweight-exercise tonnage.
  const bodyweightKg = useMemo(() => {
    const entries = S.bodyweight || []
    if (!entries.length) return null
    const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
    if (!last || !(last.w > 0)) return null
    return S.unit === 'lb' ? last.w * 0.45359237 : last.w
  }, [S.bodyweight, S.unit])
  const fatigue = useMemo(() => fatigueOf(workouts, now, { bodyweightKg }), [workouts, now, bodyweightKg])
  const strength = useMemo(() => strengthOf(workouts, now), [workouts, now])
  const muscleExercises = useMemo(() => (sel ? strengthExerciseRowsForMuscle(S, now, sel) : []), [S, now, sel])
  const lastTrained = useMemo(() => latestMuscleTraining(workouts), [workouts])
  const strengthHint = slug => {
    if (lastTrained[slug] == null) return t('not trained')
    const weeks = weeksSinceTraining(now, lastTrained[slug])
    return t('Weeks since training: {0}', weeks)
  }
  const toggleSel = m => setSel(s => (s === m ? null : m))
  const inWin = S.workouts.filter(w =>
    historyUnitCompatible(w, S.unit) && (win === 0 ? true
      : win === 7 ? weekKey(w.d) === weekKey(todayISO())
        : (w.start || new Date(w.d).getTime()) > now - win * 86400000))
  // Counting only the sets taken near failure turns the map from "where did the volume go"
  // into "where did the stimulus go" — a muscle can lead on sets and still never be trained
  // hard. Offered only when the window holds ratings at all, since with none the hard map
  // would just be empty and read as "you trained nothing".
  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null)
  const { worked, missed } = rankOf(load)
  const top = worked.slice(0, 4)
  const max = worked.length ? load[worked[0]] : 0
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <Segmented className="seg-range" value={view} onChange={setView}
      options={[{ value: 'balance', label: t('Muscle balance') }, { value: 'fatigue', label: t('Fatigue') }, { value: 'strength', label: t('Strength') }]} />
    {view === 'balance' ? <>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Muscle balance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {on ? t('by hard sets') : t('by sets worked')}</span></h2>
        {rated && <Button size="sm" icon="flame" style={on ? { color: 'var(--yellow)' } : undefined}
          onClick={() => { setHard(h => !h); setSel(null) }}>{on ? t('Hard') : t('All')}</Button>}
      </div>
      <Segmented className="seg-range" value={win} onChange={v => { setWin(v); setSel(null) }}
        options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
      {inWin.length ? <>
        <BodyMap className="tappable" load={load} body={S.body} selected={sel}
          onMuscle={m => setSel(s => (s === m ? null : m))} />
        <BodyMapLegend />
        {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
          <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
          <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : on ? t('no hard sets') : t('not trained')}</span>
        </div>}
        {!sel && top.map(m => <div key={m} className="mrow">
          <span className="nm">{t(MUSCLE_NAME[m])}</span>
          <span className="bar"><i style={{ width: Math.round(load[m] / max * 100) + '%', background: on ? 'var(--yellow)' : undefined }} /></span>
          <span className="v">{t('{0} sets', sets(m))}</span>
        </div>)}
        {missed.length > 0 && <>
          <h4 className="sec" style={{ marginTop: 12 }}>{on ? t('No hard sets in this period') : t('Not trained in this period')}</h4>
          <div className="mchips">{missed.map(m => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
        </>}
        {!missed.length && worked.length > 0 &&
          <div className="muted small" style={{ marginTop: 10 }}>{on
            ? t('Every muscle group got at least one hard set in this period.')
            : t('Every muscle group got some work in this period.')}</div>}
      </> : <div className="muted small">{t('No workouts in this period yet.')}</div>}
    </> : view === 'fatigue' ? <>
      <h2>{t('Fatigue')}</h2>
      <BodyMap className="tappable hm-fatigue" load={fatigue} thresholds={FATIGUE_LEVELS} body={S.body} selected={sel} onMuscle={toggleSel} />
      <FatigueLegend />
      <div className="muted small" style={{ marginTop: 10 }}>{t('Fatigue shows how recently each muscle was trained. High means rest.')}</div>
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{fatigueLabel(fatigue[sel])}</span>
      </div>}
    </> : <>
      <h2>{t('Strength')}</h2>
      <BodyMap className="tappable hm-strength" load={strength} thresholds={STRENGTH_LEVELS} body={S.body} selected={sel} onMuscle={toggleSel} />
      <StrengthLegend />
      <div className="muted small" style={{ marginTop: 10 }}>{t('Strength shows retained muscle strength. Train again to reset it.')}</div>
      {sel ? <>
        <h4 className="sec" style={{ marginTop: 14 }}>{t('Exercises')} · {t(MUSCLE_NAME[sel])}</h4>
        {muscleExercises.length ? muscleExercises.map(row => (
          <div key={row.id} className="mrow" style={{ minHeight: 48, alignItems: 'stretch' }}>
            <span className="nm" style={{ whiteSpace: 'normal', lineHeight: 1.35, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name}
                {row.primary === sel
                  ? <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>{t('primary')}</span>
                  : <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>{t('secondary')}</span>}
              </span>
              <span className="small dim" style={{ display: 'block', fontWeight: 400 }}>{t('Est. 1RM')}: {fmtNum(row.est)} {S.unit} · {fmtDate(row.estDate, true)}</span>
            </span>
            <span className="bar" style={{ alignSelf: 'center' }}><i style={{ width: Math.round(row.decay * 100) + '%' }} /></span>
            <span className="v" style={{ alignSelf: 'center' }}>{fmtNum(row.current)} {S.unit}<span className="dim"> · {Math.round(row.decay * 100)}%</span></span>
          </div>
        )) : <div className="muted small">{t('No exercises with an estimated 1RM yet.')}</div>}
      </> : <div className="muted small" style={{ marginTop: 10 }}>{t('Tap a muscle to see its exercises.')}</div>}
    </>}
  </div>
}

function WorkoutReview({ S }) {
  const totals = { warmup: 0, work: 0 }
  const sets = { warmup: 0, work: 0 }
  const modes = { reps: 0, time: 0, cardio: 0 }
  S.workouts.forEach(w => {
    if (!historyUnitCompatible(w, S.unit)) return
    const v = volumeByPhase(w, S.unit)
    const c = setsByPhase(w, S.unit)
    totals.warmup += v.warmup; totals.work += v.work
    sets.warmup += c.warmup; sets.work += c.work
    w.entries.forEach(e => {
      const mode = metricModeForEntry(e)
      if (mode) modes[mode]++
    })
  })
  const total = totals.warmup + totals.work
  return <div className="card">
    <h2>{t('Training review')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('all logged workouts')}</span></h2>
    <div className="tiles" style={{ textAlign: 'left', marginBottom: 10 }}>
      <div className="tile"><div className="l">{t('Total volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(total, S.unit)}</div></div>
      <div className="tile"><div className="l">{t('Work volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(totals.work, S.unit)}</div></div>
      <div className="tile"><div className="l">{t('Warm-up volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(totals.warmup, S.unit)}</div></div>
      <div className="tile"><div className="l">{t('Completed sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{sets.warmup + sets.work}</div></div>
    </div>
    <div className="small dim">{t('Warm-up volume is included in total volume but does not drive progression or estimated 1RM.')}</div>
    <div className="mchips" style={{ marginTop: 10 }}>
      {modes.reps > 0 && <span className="mchip">{t('Repetition entries')}: {modes.reps}</span>}
      {modes.time > 0 && <span className="mchip">{t('Timed entries')}: {modes.time}</span>}
      {modes.cardio > 0 && <span className="mchip">{t('Cardio entries')}: {modes.cardio}</span>}
    </div>
  </div>
}

// How hard the training was — the half of the picture a volume chart cannot show. Everything
// is computed in RIR (lib/effort.js) and converted to whichever scale this profile reads.
// Every number carries how much of the training it speaks for: rating is optional and off by
// default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const sum = effortSummary(S, win)
  const weeks = effortWeeks(S, win)
  const hist = effortHistogram(S, win)
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <div className="card">
    <h2>{t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('how close to failure')}</span></h2>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{sum.avg == null ? '—' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--yellow)' }}>{sum.hardPct == null ? '—' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small" style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t('Effort per set is switched off — turn it on in Settings to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} /></div>
      </>}
      <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--yellow)' : 'var(--label-3)' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '—'}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Most working sets belong close to failure without living there — half at the floor and half at the top average out to a healthy-looking middle.')}
      </div>
    </>}
  </div>
}

// Stats = the analytics hub: all charts, progress and history live here.
export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const [exId, setExId] = useState(null)
  const [exMetric, setExMetric] = useState('top')
  const now = Date.now()
  const kind = displayScale(S)
  const hd = scaleName(kind)

  const bwPts = S.bodyweight.filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const bw30 = S.bodyweight.filter(b => (b.t || new Date(b.d).getTime()) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const unitWorkouts = S.workouts.filter(w => historyUnitCompatible(w, S.unit))
  const unitState = { ...S, workouts: unitWorkouts }
  const monthW = unitWorkouts.filter(w => String(w.d || '').slice(0, 7) === todayISO().slice(0, 7)).length

  const nameOf = id => EXIDX[id]?.n || unitWorkouts.flatMap(w => w.entries).find(e => e.id === id)?.n || id
  const currentOf = id => {
    for (let i = unitWorkouts.length - 1; i >= 0; i--) {
      const en = unitWorkouts[i].entries.find(e => e.id === id)
      if (!en) continue
      const mode = metricModeForEntry(en) || modeOf({ id })
      const rows = metricRowsForEntry(en, mode)
      const mx = mode === 'reps' ? bestWeightForEntry(en) : Math.max(0, ...rows.map(s => mode === 'cardio' ? (s.speed || 0) : mode === 'time' ? (s.sec || 0) : (s.w || 0)))
      if (mx > 0) return { mx, unit: mode === 'cardio' ? 'km/h' : mode === 'time' ? 's' : S.unit }
    }
    return { mx: 0, unit: S.unit }
  }
  const exHist = [...new Set(unitWorkouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id] || nameOf(id) !== id)
  const exCurrent = Object.fromEntries(exHist.map(id => [id, currentOf(id)]))
  exHist.sort((a, b) => exCurrent[b].mx - exCurrent[a].mx || nameOf(a).localeCompare(nameOf(b)))
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // A completed reps work row is authoritative for strength metrics, even when the parent
  // target also contains timed/cardio work. Entries without reps rows use their selected mode.
  const curMode = curEx ? (() => {
    for (let i = unitWorkouts.length - 1; i >= 0; i--) {
      const en = unitWorkouts[i].entries.find(e => e.id === curEx)
      if (en) {
        const mode = metricModeForEntry(en)
        if (mode) return mode
      }
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  const metric = s => curCardio ? (s.speed || 0) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : S.unit
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    unitWorkouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) {
        const loggedMode = metricModeForEntry(en)
        if (loggedMode !== curMode) return
        const doneSets = metricRowsForEntry(en, curMode)
        const mx = curMode === 'reps' ? bestWeightForEntry(en) : Math.max(0, ...doneSets.map(metric))
        if (mx > 0) {
          exPts.push({ t: w.start, y: mx, d: w.d, sets: doneSets, target: en.target })
          if (mx > exBest) exBest = mx
        }
      }
    })
    exList = exPts.slice(-5).reverse()
  }
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  const e1Pts = curEx && curMode === 'reps' ? e1rmSeries(unitState, curEx) : []
  const e1Best = curEx && curMode === 'reps' ? best1RM(unitState, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(Boolean)
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  }))
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })

  return <>
    <div className="hdr"><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>

    <div className="tiles">
      <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{unitWorkouts.length}</div></div>
      <div className="tile"><div className="l"><Icon name="calendar" />{t('This month')}</div><div className="v">{monthW}</div></div>
      <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{streakWeeks(unitState)}</div></div>
      <div className="tile"><div className="l"><Icon name="scale" />{t('Weight 30d')}</div><div className="v" style={{ fontSize: 22, color: bwDelta30 === null ? 'inherit' : bwDeltaColor(bwDelta30, (lastBW(S) || {}).w || 0) }}>{bwDelta30 === null ? '—' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}</div></div>
      <div className="tile"><div className="l"><Icon name="chartLine" />{t('Total volume')}</div><div className="v" style={{ fontSize: 20 }}>{fmtVol(unitWorkouts.reduce((n, w) => n + workoutVolume(w, S.unit), 0), S.unit)}</div></div>
    </div>

    <div className="card">
      <h2>{t('Activity — last 12 months')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('by time trained')}</span></h2>
      <Heatmap S={unitState} onDay={iso => { const ws = unitWorkouts.filter(w => w.d === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso) }} />
    </div>

    {unitWorkouts.length > 0 && <MuscleBalance S={unitState} />}
    {hasEffort(unitState) && <EffortCard S={unitState} />}
    {unitWorkouts.length > 0 && <WorkoutReview S={unitState} />}

    <div className="cols">
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
          </div>
        </div>
        <Segmented className="seg-range" value={range} onChange={setRange}
          options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
        <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
      </div>

      <div className="card">
        <h2>{t('Exercise progress')}</h2>
        {exHist.length ? <>
          <div className="sect-b" style={{ marginBottom: 10 }}>
            <SelectRow title={t('Exercise')} sheetTitle={t('Exercise progress')} value={curEx} onChange={setExId}
              options={exHist.map(id => ({ value: id, label: nameOf(id) + (exCurrent[id].mx ? ' ' + '—' + ' ' + fmtNum(exCurrent[id].mx) + ' ' + exCurrent[id].unit : '') }))} />
          </div>
          {exOpts.length > 1 && <Segmented className="seg-range" value={onEff ? 'effort' : onE1 ? 'e1rm' : 'top'} onChange={setExMetric} options={exOpts} />}
          <div className="chart">
            {onEff
              ? <LineChart points={effPts} h={150} unit={hd} color="var(--yellow)" invert={kind === 'rir'} />
              : <LineChart points={onE1 ? e1Pts.map(p => ({ t: p.t, y: p.y, d: p.d })) : topPts} h={150} unit={exUnit} color="var(--blue)" />}
          </div>
          <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
            <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(curEx, s, p.target)).join('  ')}</span></div>)}</div>
          <div className="small dim" style={{ marginTop: 8 }}>
            {onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : t('Best set weight per workout')}
            {onEff ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b></>}
          </div>
          {onE1 && <div className="small dim" style={{ marginTop: 4 }}>
            {t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + S.unit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
          </div>}
          {!onEff && !onE1 && showEff && <div className="small dim" style={{ marginTop: 4 }}>
            {t('A fuller dot means less left in the tank — the same weight at a lower {0} is progress the line alone does not show.', hd)}
          </div>}
        </> : <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>}
      </div>
    </div>

    {unitWorkouts.length > 0 && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Recent workouts')}</h4>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {unitWorkouts.length}</Button>
      </div>
      <div className="list">{[...unitWorkouts].reverse().slice(0, 6).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </>}
  </>
}
