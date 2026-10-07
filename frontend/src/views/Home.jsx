import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [workoutLength, setWorkoutLength] = useState(() => S.workoutLength || 35)

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
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws))
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

  const wThisWeek = S.workouts.filter(w => weekKey(w.d, ws) === weekKey(todayIso, ws)).length
  const extra = Math.max(0, wThisWeek - WEEK_TARGET)
  const weekDone = Math.min(wThisWeek, WEEK_TARGET)
  const benBW = bodyweightTrend({ ...S, weekStart: ws })
  const benStrength = strengthRetention(S)
  const training = trainingSystem(S)
  // The trend sentence follows the same fitted story as Stats: the weekly rate when it is
  // meaningful, otherwise the plain last-week difference with no direction word — pairing
  // that number with the slope's word could read "+0.4 down" when the two disagree.
  const bwRate1 = benBW.rate == null ? null : Math.round(benBW.rate * 10) / 10 + 0
  const bwTrendLine = benBW.delta == null ? t('Log another week to see the trend.') : benBW.meaningful
    ? t('Weekly average {0} over {1} weeks.', (bwRate1 > 0 ? '+' : '') + fmtNum(bwRate1) + ' ' + S.unit + '/wk', benBW.weeksUsed)
    : t('Weekly average {0} vs previous logged week.', (benBW.delta > 0 ? '+' : '') + fmtNum(benBW.delta) + ' ' + S.unit)

  // The single next-action message: the top flag for the session that matters (today's
  // plan, else the next one). Full detail, alternatives and the fix live in Stats.
  const guideRoutine = routine || next?.routine || null
  const attention = guideRoutine ? exerciseAttention(S, guideRoutine) : []
  const topAttention = attention[0] || null

  // Active-session progress for the hero row.
  const activeDone = S.active ? setsDoneActive(S.active) : 0
  const activeTotal = S.active ? setUnitsTotal(S.active.entries) : 0

  const durationExerciseCount = minutes => !routine ? 0 : minutes <= 15 ? Math.min(3, routine.ex.length) : minutes <= 25 ? Math.min(4, routine.ex.length) : routine.ex.length
  const startToday = () => {
    const routineIds = effectiveRoutineIds(S, todayIso)
    const count = durationExerciseCount(workoutLength)
    if (!routine || routineIds.length !== 1 || count >= routine.ex.length) startFlow(routineIds)
    else startShortFlow(routine.id, routine.ex.slice(0, count).map(e => e.id))
  }
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startToday(); else nav('/workout') }

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
      {routine && !S.active && !doneToday && <div style={{ marginTop: 18 }}>
        <div className="row between" style={{ marginBottom: 6 }}><div className="lbl2">{t('How much time do you have?')}</div><b>{workoutLength} min</b></div>
        <Slider value={workoutLength} min={15} max={45} step={10} onChange={v => { setWorkoutLength(v); update(s => { s.workoutLength = v }) }} aria-label={t('Workout length')} />
        <div className="row between small muted" style={{ marginTop: 2 }}><span>15 min</span><span>25 min</span><span>35 min</span><span>45 min</span></div>
        <div className="small muted" style={{ marginTop: 8 }}>{t('{0} exercises · approximate length', durationExerciseCount(workoutLength))}</div>
      </div>}
      <div className="hero-act">
        {S.active
          ? <Button variant="primary" icon={editingSaved ? 'pencil' : 'play'} onClick={() => nav('/workout')}>{editingSaved ? t('Open editor') : t('Resume workout')}</Button>
          : doneToday
            ? <Button icon="plus" onClick={() => nav('/workout')}>{t('Log another workout')}</Button>
            : routine
              ? <Button variant="primary" icon="play" onClick={startToday}>{t('Start {0}', todayName)}</Button>
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

    {/* How the week is going: count, segments, strip. The schedule itself lives in Plan. */}
    {!!S.routines.length && training.optionalEligible && <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <div className="lbl2">{t('Optional')}</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{training.optional.name}</h2>
        </div>
        <span className="tag">{t('Low volume')}</span>
      </div>
      <div className="small muted" style={{ marginBottom: 10 }}>{t('The three main sessions are done. Use this only if you feel recovered and want a little extra work.')}</div>
      <Button onClick={() => startFlow([training.optional.id])}>{t('Start optional session')}</Button>
    </div>}

    {!!S.routines.length && <div className="card">
      <div className="row between" style={{ marginBottom: 4 }}>
        <div><div className="lbl2">{t('This week')}</div><h2 style={{ margin: '2px 0 0', fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{t('Training week')}</h2></div>
        <b>{t('{0} of {1}', Math.min(wThisWeek, WEEK_TARGET), WEEK_TARGET)}{extra > 0 ? t(' +{0} extra', extra) : ''}</b>
      </div>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: WEEK_TARGET }, (_, i) => <i key={i} className={i < weekDone ? 'fill' : ''} />)}
      </div>
      <div className="small muted" style={{ fontWeight: 500, marginBottom: 8 }}>{t('{0} sessions keep the week on track. A 4th is optional.', WEEK_TARGET)}</div>
      <div className="week">{strip}</div>
    </div>}

    {/* Compact weight trend. Chart and full history live in Stats. */}
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
      </> : <div className="muted small">{S.weighIn === false
        ? t('No entries yet — log your weight to start the curve.')
        : t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>}

    {/* Compact strength status plus the one thing needing attention, if any.
        Guidance, alternatives and the fix live in Stats. */}
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--label)', fontWeight: 600 }}>{t('Strength')}</h2>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/stats')}>{t('Details')}</Button>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: topAttention ? 8 : 0, flexWrap: 'wrap' }}>
        <span className="tag">
          {benStrength.status === 'baseline' ? t('Building baseline') : benStrength.status === 'holding' ? t('Holding') : benStrength.status === 'mixed' ? t('Mixed') : t('Needs attention')}
        </span>
        {benStrength.compared > 0 && <span className="tag">{t('{0} exercises compared', benStrength.compared)}</span>}
      </div>
      {topAttention && <div {...tappable(() => nav('/stats'))}>
        <div className="small dim" style={{ marginBottom: 5 }}>{t('Needs attention')}</div>
        <AttentionRow a={topAttention} altNames={alternativesFor(S, topAttention.id, { count: 1 }).map(x => x.name)} />
      </div>}
    </div>
  </div>
}
