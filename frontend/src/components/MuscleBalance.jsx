import { useEffect, useMemo, useState } from 'react'
import { EXIDX } from '../lib/exercises.js'
import { workoutDay, workoutAt } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, weekStartOf } from '../lib/format.js'
import { t, exerciseNameClass, getLang } from '../lib/i18n.js'
import { levelsOf, loadOfWeeklyPlan, loadOfWorkouts, muscleBalanceWindow, musclesOf, rankOf, MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { fatigueOf, strengthOf, STRENGTH_FLOOR } from '../lib/recovery.js'
import { FATIGUE_LEVELS, STRENGTH_LEVELS, fatigueStateOf, weeksSinceTraining } from '../lib/recovery-view.js'
import { bodyweightKgOf } from '../lib/structuralBalance.js'
import { strengthExerciseRowsForMuscle } from '../lib/strength-exercises.js'
import { isHardSet } from '../lib/effort.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { cx } from '../lib/ui-kit.js'
import { exerciseHistorySheet } from '../sheets.jsx'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import { InlineNote } from './blocks.jsx'
import { Inline } from './layout.jsx'
import { MuscleRow, PeriodNav, SectionHeader, StatCard } from './tab-kit.jsx'
import { Button, Row, Section, Segmented } from './ui.jsx'

// Which muscles the training in a window actually hit — and, the point of the map,
// which ones it keeps missing. Shading is relative within the window (lib/muscles.js).
function latestMuscleTraining(workouts) {
  const latest = {}
  for (const workout of workouts || []) {
    const timestamp = workoutAt(workout)
    if (!Number.isFinite(timestamp)) continue
    for (const entry of workout.entries || []) {
      if (!(entry.sets || []).some(set => set?.done === true && !isWarmupRow(set))) continue
      const exercise = EXIDX[entry.id] || entry.exercise || entry
      for (const slug of Object.keys(musclesOf(exercise))) {
        if (latest[slug] == null || timestamp > latest[slug]) latest[slug] = timestamp
      }
    }
  }
  return latest
}

function useNow() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(tick => tick + 1), 60000)
    return () => clearInterval(iv)
  }, [])
  return Date.now()
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

const round1 = n => Math.round((n || 0) * 10) / 10
const ROWS = 4

// Training load › Muscles (ui-redesign-components §1 MuscleMap): three maps of the same body.
// Balance is where the sets went over a week (stepped with PeriodNav; the current one against the
// plan) or a window, by every set or only the hard ones; Fatigue how recently each muscle was
// worked; Strength how much of it is retained. Each map has its Front/Back captions and legend, a
// StatCard for the muscle picked on it, and rows keyed to its shades.
export default function MuscleBalance({ S }) {
  const [view, setView] = useState('balance')
  const [win, setWin] = useState(7)
  const [weekOffset, setWeekOffset] = useState(0)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const now = useNow()
  const lang = getLang()
  const workouts = S.workouts
  const bodyweightKg = useMemo(() => bodyweightKgOf(S), [S.bodyweight, S.unit])
  const fatigue = useMemo(() => fatigueOf(workouts, now, { bodyweightKg, unit: S.unit }), [workouts, now, bodyweightKg, S.unit])
  const strength = useMemo(() => strengthOf(workouts, now, { bodyweightKg, unit: S.unit }), [workouts, now, bodyweightKg, S.unit])
  const muscleExercises = useMemo(() => (sel ? strengthExerciseRowsForMuscle(S, now, sel) : []), [S, now, sel, lang])
  const lastTrained = useMemo(() => latestMuscleTraining(workouts), [workouts])
  const strengthHint = slug => {
    if (lastTrained[slug] == null) return t('not trained')
    return t('Weeks since training: {0}', weeksSinceTraining(now, lastTrained[slug]))
  }
  const toggleSel = m => setSel(s => (s === m ? null : m))
  const name = m => t(MUSCLE_NAME[m])
  const ws = weekStartOf(S)
  const currentWeek = weekKey(todayISO(), ws)
  const selectedWeekDate = new Date(currentWeek + 'T12:00:00')
  selectedWeekDate.setDate(selectedWeekDate.getDate() + weekOffset * 7)
  const selectedWeek = isoOf(selectedWeekDate)
  const weekly = win === 7
  const inWin = weekly
    ? S.workouts.filter(workout => workoutDay(workout) && weekKey(workoutDay(workout), ws) === selectedWeek)
    : muscleBalanceWindow(S.workouts, win, now, todayISO(), ws)
  // Counting only the sets taken near failure turns the map from "where did the volume go"
  // into "where did the stimulus go" — a muscle can lead on sets and still never be trained
  // hard. Offered only when the window holds ratings at all, since with none the hard map
  // would just be empty and read as "you trained nothing".
  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = !weekly && hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null)
  const levels = levelsOf(load)
  // This week is read against the plan; a week before it only says what was done.
  const vsPlan = weekly && weekOffset === 0
  const planned = vsPlan ? loadOfWeeklyPlan(S) : {}
  const { worked, missed } = rankOf(load)
  const listed = vsPlan
    ? MUSCLES
      .filter(muscle => (planned[muscle] || 0) > 0 || (load[muscle] || 0) > 0)
      .sort((a, b) => (load[b] || 0) - (load[a] || 0) || (planned[b] || 0) - (planned[a] || 0) || MUSCLES.indexOf(a) - MUSCLES.indexOf(b))
    : worked
  // Four rows, all of them on Show more for a week; a window shows its four busiest.
  const shown = weekly && expanded ? listed : listed.slice(0, ROWS)
  const canExpand = weekly && listed.length > ROWS
  const done = m => round1(load[m])
  const target = m => round1(planned[m])
  const pct = m => (target(m) > 0 ? Math.round(done(m) / target(m) * 100) : null)
  const setsText = n => t('{0} sets', fmtNum(n))
  // A muscle the plan does not program has nothing to be read against: its sets alone, not "3/0".
  const comparison = m => (target(m) > 0
    ? {
      value: fmtNum(done(m)) + '/' + fmtNum(target(m)) + (pct(m) == null ? '' : ' · ' + pct(m) + '%'),
      valueLabel: t('Completed') + ' ' + setsText(done(m)) + ' · ' + t('Planned') + ' ' + setsText(target(m)),
    }
    : { value: setsText(done(m)) })
  const empty = vsPlan ? !listed.length : !inWin.length

  const changeWeek = step => { setWeekOffset(offset => Math.min(0, offset + step)); setSel(null); setExpanded(false) }
  const changeWin = v => { setWin(v); setSel(null); setExpanded(false) }

  const balance = <>
    <Segmented className="seg-range" ariaLabel={t('Period')} value={win} onChange={changeWin}
      options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {weekly
      ? <PeriodNav title={t('Week of {0}', fmtDate(selectedWeek))} sub={vsPlan ? t('This week') : null}
        prevLabel={t('Previous week')} nextLabel={t('Next week')} nextDisabled={weekOffset === 0}
        onPrev={() => changeWeek(-1)} onNext={() => changeWeek(1)} />
      : rated && <Inline justify="end" className="mb-4">
        <Button size="sm" icon="gauge" className={on ? 'ink-warn' : undefined} aria-pressed={on}
          onClick={() => { setHard(h => !h); setSel(null) }}>{on ? t('Hard') : t('All')}</Button>
      </Inline>}
    <div data-weekly-volume-comparison={weekly || undefined} data-week={weekly ? selectedWeek : undefined}>
      <BodyMap className="tappable" captions load={load} body={S.body} selected={sel} onMuscle={toggleSel} />
      <BodyMapLegend />
      {sel
        ? <StatCard label={name(sel)}
          meta={vsPlan && target(sel) > 0 ? t('Planned') + ' ' + setsText(target(sel)) : on ? t('by hard sets') : t('by sets worked')}
          value={fmtNum(done(sel))} unit={vsPlan && target(sel) > 0 ? t('/ {0} sets', fmtNum(target(sel))) : t('sets')}
          caption={vsPlan ? (pct(sel) == null ? t('Not in your plan this week') : t('{0}% of plan', pct(sel))) : done(sel) ? null : on ? t('no hard sets') : t('not trained')} />
        : !empty && <InlineNote icon="info">{t('Tap a muscle to see its numbers.')}</InlineNote>}
      {empty ? <InlineNote>{t('No workouts in this period yet.')}</InlineNote> : <>
        <SectionHeader title={t('Muscles')} />
        <Section className="mus-list">
          {shown.map(m => <MuscleRow key={m} data-muscle-volume={m} level={levels[m] || 0} title={name(m)}
            {...(vsPlan ? comparison(m) : { value: setsText(done(m)) })}
            pressed={sel === m} onClick={() => toggleSel(m)} />)}
        </Section>
        {canExpand && <Button className="weekly-volume-toggle mt-4" trailingIcon="chevronDown" aria-expanded={expanded}
          onClick={() => setExpanded(x => !x)}>{t(expanded ? 'Show less' : 'Show more')}</Button>}
        {missed.length > 0
          ? <Section className="mt-6"><Row title={on ? t('No hard sets in this period') : t('Not trained in this period')}
            subtitle={missed.map(name).join(', ')} /></Section>
          : worked.length > 0 && <InlineNote icon="check">{on
            ? t('Every muscle group got at least one hard set in this period.')
            : t('Every muscle group got some work in this period.')}</InlineNote>}
      </>}
    </div>
  </>

  const fatigueView = <>
    <BodyMap className="tappable hm-fatigue" captions load={fatigue} thresholds={FATIGUE_LEVELS} body={S.body} selected={sel} onMuscle={toggleSel} />
    <FatigueLegend />
    {sel && <StatCard label={name(sel)} meta={t('Fatigue')} value={fatigueLabel(fatigue[sel])} />}
    <InlineNote icon="info">{t('Fatigue shows how recently each muscle was trained. High means rest.')}</InlineNote>
  </>

  const { worked: strengthOrder } = rankOf(strength)
  const detrained = strengthOrder.filter(slug => strength[slug] < 1)
  const strengthLevels = levelsOf(strength, STRENGTH_LEVELS)
  const volWin = S.workouts.filter(w => workoutAt(w) > now - 90 * 86400000)
  const vol90 = loadOfWorkouts(volWin, null)
  const strengthView = <>
    <BodyMap className="tappable hm-strength" captions load={strength} thresholds={STRENGTH_LEVELS} body={S.body} selected={sel} onMuscle={toggleSel} />
    <StrengthLegend />
    {sel && <StatCard label={name(sel)} meta={t('Strength')} value={Math.round((strength[sel] ?? STRENGTH_FLOOR) * 100) + '%'} caption={strengthHint(sel)} />}
    <InlineNote icon="info">{t('Strength shows retained muscle strength. Train again to reset it.')}</InlineNote>
    {sel ? <>
      <SectionHeader title={t('Exercises') + ' · ' + name(sel)} />
      {/* A row quotes the exercise's estimated 1RM, so a tap opens the exercise history sheet —
          the curve behind that number plus the last sessions set by set. */}
      {muscleExercises.length ? <Section>
        {muscleExercises.map(row => <Row key={row.id} accessory="chevron" onClick={() => exerciseHistorySheet(row.id)}
          title={<><span className={EXIDX[row.id] ? exerciseNameClass(EXIDX[row.id]) : undefined}>{row.name}</span>
            <span className="dim small"> · {row.primary === sel ? t('primary') : t('secondary')}</span></>}
          subtitle={t('Est. 1RM') + ': ' + fmtNum(row.est) + ' ' + S.unit + ' · ' + fmtDate(row.estDate, true)}
          value={fmtNum(row.current) + ' ' + S.unit + ' · ' + Math.round(row.decay * 100) + '%'} />)}
      </Section> : <InlineNote>{t('No exercises with an estimated 1RM yet.')}</InlineNote>}
    </> : <InlineNote>{t('Tap a muscle to see its exercises.')}</InlineNote>}
    {/* Detrained muscles: the shade is retained strength, the value says how long ago the
        muscle was last trained. Sets in the last 90 days ride along only when there are any — a
        muscle is on this list precisely because it has not been trained lately, so that number
        alone read as "0 sets" all the way down and told nobody anything. */}
    {detrained.length > 0 && <>
      <SectionHeader title={t('Losing strength')} />
      <Section className="mus-list">
        {detrained.map(slug => {
          const sets90 = round1(vol90[slug])
          return <MuscleRow key={slug} level={strengthLevels[slug] || 0} title={name(slug)}
            subtitle={sets90 ? strengthHint(slug) : null} value={sets90 ? setsText(sets90) : strengthHint(slug)}
            pressed={sel === slug} onClick={() => toggleSel(slug)} />
        })}
      </Section>
    </>}
  </>

  // The fatigue and strength ramps recolour the rows' dots as well as the map.
  return <div className={cx(view === 'fatigue' && 'hm-fatigue', view === 'strength' && 'hm-strength')}>
    <Segmented className="seg-range" ariaLabel={t('Map')} value={view} onChange={setView}
      options={[{ value: 'balance', label: t('Muscle balance') }, { value: 'fatigue', label: t('Fatigue') }, { value: 'strength', label: t('Strength') }]} />
    {view === 'balance' ? balance : view === 'fatigue' ? fatigueView : strengthView}
  </div>
}
