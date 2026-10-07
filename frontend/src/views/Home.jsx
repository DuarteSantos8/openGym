import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW, setsDoneActive, setUnitsTotal } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, weekStartOf, weekDayOffset, DAYS, DAYN, exCount } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, startShortFlow, starterPlanSheet, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import AttentionRow from '../components/AttentionRow.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { BEN_PROFILE } from '../lib/ben-profile.js'
import { routineCoaching, bodyweightTrend, strengthRetention, exerciseAttention, alternativesFor, sessionVariants } from '../lib/ben-coach.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
// Single-person build: no name in the header, no generic fitness content. The page
// answers, top to bottom: what to do today (one action), where the week stands
// (3 sessions is the target, a 4th is optional), which workout to start, how body
// weight is trending, and whether strength is holding.
const WEEK_TARGET = BEN_PROFILE.frequency || 3

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const todayIso = todayISO()
  const todayRoutines = effectiveRoutines(S, todayIso)
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayExCount = todayRoutines.reduce((n, r) => n + (r.ex || []).length, 0)
  const todayOvr = S.dayPlan[todayIso] !== undefined
  const editingSaved = !!S.active?.editingWorkoutId
  const next = !S.active && !todayRoutines.length ? nextTrainingDay(S, todayIso) : null
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const doneToday = S.workouts.filter(w => w.d === todayIso).at(-1) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayIso ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d, ws) === weekKey(todayIso, ws)).length
  const extra = Math.max(0, wThisWeek - WEEK_TARGET)
  const weekDone = Math.min(wThisWeek, WEEK_TARGET)
  const benBW = bodyweightTrend({ ...S, weekStart: ws })
  const benStrength = strengthRetention(S)
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  // The trend sentence follows the same fitted story as Stats: the weekly rate when it is
  // meaningful, otherwise the plain last-week difference with no direction word — pairing
  // that number with the slope's word could read "+0.4 down" when the two disagree.
  const bwRate1 = benBW.rate == null ? null : Math.round(benBW.rate * 10) / 10 + 0
  const bwTrendLine = benBW.delta == null ? t('Log another week to see the trend.') : benBW.meaningful
    ? t('Weekly average {0} over {1} weeks.', (bwRate1 > 0 ? '+' : '') + fmtNum(bwRate1) + ' ' + S.unit + '/wk', benBW.weeksUsed)
    : t('Weekly average {0} vs previous logged week.', (benBW.delta > 0 ? '+' : '') + fmtNum(benBW.delta) + ' ' + S.unit)

  // Progression guidance follows the session that matters: today's plan, else the next
  // planned session, so a rest day still shows what is coming rather than nothing.
  const guideRoutine = routine || next?.routine || null
  const benCoaching = guideRoutine ? routineCoaching(S, guideRoutine, 3) : []
  // Cross-exercise signals for that same session: stalling runs, skipped movements and
  // equipment mismatches, each with the evidence behind it.
  const attention = guideRoutine ? exerciseAttention(S, guideRoutine) : []
  // Shorter/longer options only make sense for a single-routine day; a combined day is
  // already the long version.
  const variants = todayRoutines.length === 1 && routine ? sessionVariants(routine, S) : { short: null, full: null, longer: null }

  // The concrete numbers behind a guidance label, if the engine prescribed any.
  const nextSummary = n => {
    if (!n) return ''
    if (n.sec != null) return `${n.sec}s`
    const parts = []
    if (n.weight != null && n.weight > 0) parts.push(`${fmtNum(n.weight)} ${S.unit}`)
    if (n.reps != null) parts.push(`×${n.reps}`)
    if (n.sets != null) parts.push(t('{0} sets', n.sets))
    return parts.join(' ')
  }

  // This week's planned sessions, in weekday order, with the status of the shown week.
  // Days are tappable to reschedule, the same as the strip above.
  const weekSessions = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const routines = effectiveRoutineIds(S, iso).map(id => S.routines.find(r => r.id === id)).filter(Boolean)
    if (!routines.length) continue
    weekSessions.push({ iso, weekday: d.getDay(), date: d.getDate(), routines, done: doneDays.has(iso), isToday: iso === todayIso })
  }

  // Active-session progress for the hero row.
  const activeDone = S.active ? setsDoneActive(S.active) : 0
  const activeTotal = S.active ? setUnitsTotal(S.active.entries) : 0

  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, todayIso)); else nav('/workout') }
  const idSet = new Set(effectiveRoutineIds(S, todayIso))
  const otherRoutines = S.routines.filter(r => !idSet.has(r.id))

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Today')}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    {/* One clear next action. Tapping the row and the primary button do the same thing. */}
    <div className="card">
      <div className="today-row" {...tappable(onToday)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? (editingSaved ? 'pencil' : 'timer') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{S.active ? t('In progress') : doneToday ? t('Done for today') : routine ? t("Today's session") : t('Rest day')}</div>
            <div className="ttl">{S.active ? S.active.name
              : doneToday ? (doneToday.name || t('Workout done'))
              : routine ? todayName : t('Recovery')}</div>
            {S.active && activeTotal > 0 && !editingSaved && <div className="ss">{t('{0} of {1} sets', activeDone, activeTotal)}</div>}
            {!S.active && !doneToday && routine && <div className="ss">{exCount(todayExCount)}{todayOvr ? ' · ' + t('rescheduled') : ''}</div>}
            {!S.active && !doneToday && !routine && next && <div className="ss">{t('Next: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
            {!S.active && !doneToday && !routine && !next && <div className="ss">{t('No sessions planned')}</div>}
            {!S.active && doneToday && <div className="ss">{wThisWeek >= WEEK_TARGET ? t('{0} of {1} this week — anything more is extra', wThisWeek, WEEK_TARGET) : t('{0} of {1} this week', wThisWeek, WEEK_TARGET)}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{editingSaved ? t('Edit') : t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="chevronRight" className="chev" />}
      </div>
      <div className="hero-act">
        {S.active
          ? <Button variant="primary" icon={editingSaved ? 'pencil' : 'play'} onClick={() => nav('/workout')}>{editingSaved ? t('Open editor') : t('Resume workout')}</Button>
          : doneToday
            ? <Button icon="plus" onClick={() => nav('/workout')}>{t('Log another workout')}</Button>
            : routine
              ? <Button variant="primary" icon="play" onClick={() => startFlow(effectiveRoutineIds(S, todayIso))}>{t('Start {0}', todayName)}</Button>
              : <Button icon="dumbbell" onClick={() => nav('/workout')}>{t('Browse workouts')}</Button>}
        {/* One button per destination: the "All workouts" door only sits beside the primary
            when the primary starts today's plan — everywhere else it would duplicate it. */}
        {!S.active && !doneToday && routine && <Button variant="ghost" className="dim" onClick={() => nav('/workout')}>{t('All workouts')}</Button>}
      </div>
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made starter plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {/* Weekly structure: 3 sessions is the target, a 4th is optional extra. */}
    {!!S.routines.length && <div className="card">
      <div className="row between" style={{ marginBottom: 4 }}>
        <div><div className="lbl2">{wkLabel}</div><h2 style={{ margin: '2px 0 0', fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{t('Training week')}</h2></div>
        <b>{t('{0} of {1}', Math.min(wThisWeek, WEEK_TARGET), WEEK_TARGET)}{extra > 0 ? t(' +{0} extra', extra) : ''}</b>
      </div>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: WEEK_TARGET }, (_, i) => <i key={i} className={i < weekDone ? 'fill' : ''} />)}
      </div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{t('{0} sessions keep the week on track. A 4th is optional.', WEEK_TARGET)}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      {weekSessions.length > 0 ? <div style={{ marginTop: 8 }}>
        {weekSessions.map(s => <div key={s.iso} className="sess" {...tappable(() => dayOverrideSheet(s.iso))}>
          <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14, background: s.done ? 'var(--surface-3)' : s.isToday ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={s.done ? 'checkCircle' : glyphOf(s.routines[0].emoji)} style={s.done ? { color: 'var(--green)' } : undefined} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt" style={{ fontSize: 14 }}>{t(DAYN[s.weekday])} · {s.routines.map(r => r.name).join(' + ')}</div>
            <div className="ss">{s.done ? t('Done') : s.isToday ? t('Today') : t('{0} exercises', s.routines.reduce((n, r) => n + (r.ex || []).length, 0))}</div>
          </div>
          {s.isToday && !s.done && !S.active && <span className="tag acc">{t('Start')}</span>}
        </div>)}
      </div> : <div className="muted small" style={{ marginTop: 8 }}>{t('No sessions planned this week.')}</div>}
      <div className="row between" style={{ marginTop: 8 }}>
        <div className="muted small">{t('{0} week streak', streakWeeks(S))} · {t('{0} workouts total', S.workouts.length)}</div>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => calendarSheet()}>{t('Calendar')}</Button>
      </div>
    </div>}

    {/* Workout selection: today's plan is above; everything else lives here. */}
    {!!S.routines.length && !S.active && <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{todayRoutines.length ? t('Other workouts') : t('Start a workout')}</h2>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/plan')}>{t('Edit plan')}</Button>
      </div>
      {(todayRoutines.length ? otherRoutines : S.routines).map(r => <div key={r.id} className="sess" {...tappable(() => startFlow([r.id]))}>
        <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
        <span className="tag acc">{t('Start')}</span>
      </div>)}
      {todayRoutines.length > 0 && otherRoutines.length === 0 && <div className="muted small">{t('This is the only routine in the plan.')}</div>}
      {/* Session lengths for a single-routine day: a short subset built from the same routine
          (same prescription, same history), or a longer session combining two routines. */}
      {todayRoutines.length === 1 && variants.short && (
        <div className="sess" {...tappable(() => startShortFlow(routine.id, variants.short.exerciseIds))}>
          <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name="timer" /></span>
          <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{t('Short version')}</div><div className="ss">{t('{0} exercises · {1} sets', variants.short.exerciseIds.length, variants.short.sets)}{variants.short.minutes != null ? t(' · about {0} min', variants.short.minutes) : ''}</div></div>
          <span className="tag acc">{t('Start')}</span>
        </div>)}
      {todayRoutines.length === 1 && variants.longer && variants.longer.routineIds.length === 2 && (
        <div className="sess" {...tappable(() => startFlow(variants.longer.routineIds))}>
          <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name="plus" /></span>
          <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{t('Longer session')}</div><div className="ss">{todayName} + {variants.longer.name}</div></div>
          <span className="tag acc">{t('Start')}</span>
        </div>)}
      <div className="sess" {...tappable(() => startFlow([]))}>
        <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name="shuffle" /></span>
        <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{t('Freestyle')}</div><div className="ss">{t('Pick exercises as you go')}</div></div>
        <span className="tag">{t('Start')}</span>
      </div>
      {!todayRoutines.length && <div className="muted small" style={{ marginTop: 6 }}>{t('Rest day — training now counts as an optional extra session.')}</div>}
    </div>}

    {/* Bodyweight trend. The toggle in Settings hides this card only. */}
    {S.showWeightCard !== false && <div className="card">
      <div className="row between bw-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>{bwTrendLine}</div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <div className="muted small">{S.weighIn === false
        ? t('No entries yet — log your weight to start the curve.')
        : t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>}

    {/* Strength / progression: retention across windows + guidance for the relevant session. */}
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{t('Strength')}</h2>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/stats')}>{t('Details')}</Button>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="tag">
          {benStrength.status === 'baseline' ? t('Building baseline') : benStrength.status === 'holding' ? t('Holding') : benStrength.status === 'mixed' ? t('Mixed') : t('Needs attention')}
        </span>
        {benStrength.compared > 0 && <span className="tag">{t('{0} exercises compared', benStrength.compared)}</span>}
      </div>
      {benCoaching.length > 0 ? <div>
        <div className="small dim" style={{ marginBottom: 5 }}>{guideRoutine && guideRoutine !== routine ? t('Guidance for next session: {0}', guideRoutine.name) : t('Guidance for today')}</div>
        {benCoaching.map(x => <div key={x.id} className="mrow">
          <span className="nm" style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
          <span className="v" style={{ color: x.recommendation.status === 'progress' ? 'var(--green)' : x.recommendation.status === 'regress' ? 'var(--orange)' : 'var(--label-2)' }}>{t(x.recommendation.label)}{nextSummary(x.recommendation.next) ? ` → ${nextSummary(x.recommendation.next)}` : ''}</span>
        </div>)}
      </div> : <div className="small muted">{t('Complete a planned workout to unlock exercise-specific guidance.')}</div>}
      {attention.length > 0 && <div style={{ marginTop: 10 }}>
        <div className="small dim" style={{ marginBottom: 5 }}>{t('Needs attention')}</div>
        {attention.map((a, i) => <AttentionRow key={a.id + ':' + a.kind + ':' + i} a={a}
          altNames={alternativesFor(S, a.id, { count: 2 }).map(x => x.name)} />)}
        {guideRoutine && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav(`/plan/r/${guideRoutine.id}`)}>{t('Adjust in plan')}</Button>
        </div>}
      </div>}
    </div>
  </div>
}
