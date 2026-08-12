import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { streakWeeks, lastBW } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, beginWorkout, goalSheet, dayOverrideSheet, dayViewSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { programmeColourForItem, programmeItems, programmeItemsForDate, programmeNameForItem } from '../lib/programmes-ui.js'

function routineIdsForDate(state, iso) {
  const hasOverride = Object.prototype.hasOwnProperty.call(state.dayPlan || {}, iso)
  const raw = hasOverride
    ? state.dayPlan[iso]
    : state.week?.[new Date(iso + 'T12:00:00').getDay()]
  if (raw == null || raw === '' || raw === 'rest') return []
  const ids = Array.isArray(raw) ? raw : [raw]
  const available = new Set((state.routines || []).map(routine => String(routine.id)))
  return [...new Set(ids.filter(id => available.has(String(id))))]
}

function routinesForDate(state, iso) {
  const routines = new Map((state.routines || []).map(routine => [String(routine.id), routine]))
  return routineIdsForDate(state, iso).map(id => routines.get(String(id))).filter(Boolean)
}

function completedClassicRoutineIds(state, iso) {
  const done = new Set()
  ;(state.workouts || []).forEach(workout => {
    if (workout?.d !== iso || !workout.routineId) return
    const programmeMarked = workout.programmeSession === true || workout.sessionType === 'programme'
      || workout.kind === 'programme' || workout.instanceId || workout.programmeInstance?.instanceId
    if (!programmeMarked) done.add(String(workout.routineId))
  })
  return done
}

const isProgrammeDone = item => ['completed', 'complete', 'done', 'finished'].includes(String(item?.status || '').toLowerCase())

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)
  const todayISOValue = todayISO()
  const [selectedISO, setSelectedISO] = useState(todayISOValue)

  const now = Date.now()
  const today = new Date(now)
  const selectedPlans = routinesForDate(S, selectedISO)
  const programmeQueue = programmeItems(S, { now })
  const selectedProgramme = programmeItemsForDate(S, selectedISO, { now })
  const selectedFreestyle = (S.workouts || []).filter(workout => workout.d === selectedISO && !workout.routineId)
  const doneClassic = completedClassicRoutineIds(S, selectedISO)
  const isPast = selectedISO < todayISOValue
  const selectedLabel = selectedISO === todayISOValue
    ? t('Today')
    : new Date(selectedISO + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' })
  const hasDayOverride = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, selectedISO)

  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const unitWorkouts = S.workouts || []
  const doneDays = new Set(unitWorkouts.map(workout => workout.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const iso = isoOf(date)
    const planned = routineIdsForDate(S, iso)
    const override = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, iso)
    const done = doneDays.has(iso)
    const programme = programmeQueue.find(item => item.projectedDate === iso && item.source === 'programme')
    const dot = done ? ' done' : override && planned.length ? ' ovr' : planned.length ? ' plan' : ''
    const programmeColour = programmeColourForItem(S, programme)
    strip.push(
      <div key={iso} className={'wday' + (iso === todayISOValue ? ' today' : '') + (iso === selectedISO ? ' sel' : '')}
        onClick={() => setSelectedISO(iso)}
        onContextMenu={event => { event.preventDefault(); dayOverrideSheet(iso) }}>
        <div className="lbl">{t(DAYS[date.getDay()])}</div>
        <div className="num">{date.getDate()}</div>
        <div className={'dot' + dot} style={programmeColour ? { background: programmeColour } : undefined} />
      </div>,
    )
  }
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0
    ? t('This week')
    : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`
  const shiftWeek = deltaWeeks => {
    setWeekOffset(offset => offset + deltaWeeks)
    setSelectedISO(current => {
      const date = new Date(current + 'T12:00:00')
      date.setDate(date.getDate() + deltaWeeks * 7)
      return isoOf(date)
    })
  }

  const wThisWeek = unitWorkouts.filter(workout => weekKey(workout.d) === weekKey(todayISOValue)).length
  const plannedPerWeek = Object.keys(S.week).filter(key => S.week[key]).length
  const bwPoints = S.bodyweight.slice(-30).map(entry => ({ t: entry.t || new Date(entry.d).getTime(), y: entry.w, d: entry.d }))

  const startFreestyle = () => bwSheet({ required: true, locked: false, onDone: weight => beginWorkout(null, weight) })
  const openDay = () => {
    if (S.active) nav('/workout')
    else if (isPast) dayViewSheet(selectedISO)
    else dayOverrideSheet(selectedISO)
  }
  const noSessions = !selectedPlans.length && !selectedProgramme.length && !selectedFreestyle.length

  const actionForRoutine = (routine, done, programmeItem = null) => isPast
    ? <span className="row" style={{ gap: 8 }} onClick={event => event.stopPropagation()}>
        {done && <Icon name="check" className="accent" />}
        <Button variant="ghost" className="dim" size="sm" onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
        <Button variant="primary" size="sm" onClick={() => startFlow(routine?.id || programmeItem?.routineId, programmeItem)}>{t('Repeat')}</Button>
      </span>
    : <span className="row" style={{ gap: 8 }} onClick={event => event.stopPropagation()}>
        <Button variant="ghost" className="dim" size="sm" aria-label={t('Edit day')} onClick={() => dayOverrideSheet(selectedISO)}><Icon name="pencil" /></Button>
        <Button variant="primary" size="sm" onClick={() => startFlow(routine?.id || programmeItem?.routineId, programmeItem)}>{t('Start')}</Button>
      </span>

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => shiftWeek(-1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => shiftWeek(1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>

      {S.active ? <div className="today-row" onClick={() => nav('/workout')}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name="timer" /></span>
          <div style={{ minWidth: 0 }}><div className="lbl2">{t('Today')}</div><div className="ttl">{t('{0} — in progress', S.active.name)}</div></div>
        </div>
        <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
      </div> : <>
        {noSessions && <div className="today-row" onClick={openDay}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span>
            <div style={{ minWidth: 0 }}><div className="lbl2">{selectedLabel}</div><div className="ttl">{t('Rest day')}</div></div>
          </div>
          {isPast
            ? <span className="row" style={{ gap: 8 }} onClick={event => event.stopPropagation()}>
                <Button variant="ghost" className="dim" size="sm" onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
                <Button variant="primary" size="sm" onClick={startFreestyle}>{t('Repeat')}</Button>
              </span>
            : <span className="row" style={{ gap: 8 }} onClick={event => event.stopPropagation()}>
                <Button variant="ghost" className="dim" size="sm" aria-label={t('Edit day')} onClick={() => dayOverrideSheet(selectedISO)}><Icon name="pencil" /></Button>
                <Button variant="primary" size="sm" onClick={startFreestyle}>{t('Start')}</Button>
              </span>}
        </div>}

        {selectedPlans.map((routine, index) => <div key={'routine:' + routine.id} className="today-row" style={index || noSessions ? { borderTop: '1px solid var(--line)' } : undefined} onClick={() => isPast ? dayViewSheet(selectedISO) : startFlow(routine.id)}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: 'var(--acc)' }}><Icon name={glyphOf(routine.emoji)} /></span>
            <div style={{ minWidth: 0 }}><div className="lbl2">{selectedLabel}</div><div className="ttl">{routine.name}{hasDayOverride ? ' · ' + t('rescheduled') : ''}</div></div>
          </div>
          {actionForRoutine(routine, doneClassic.has(String(routine.id)))}
        </div>)}

        {selectedProgramme.map((item, index) => {
          const liveRoutine = (S.routines || []).find(routine => String(routine.id) === String(item.routineId))
          // Programme snapshots are the prescription the cycle was created with. Prefer one
          // that can actually be started; falling back to the live routine keeps older cycles
          // (which stored only an id) working without silently replacing a valid snapshot.
          const routine = Array.isArray(item.routineSnapshot?.ex)
            ? item.routineSnapshot
            : liveRoutine || item.routineSnapshot || { id: item.routineId, name: t('Routine'), emoji: null }
          return <div key={item.instanceId} className="today-row" style={selectedPlans.length || index ? { borderTop: '1px solid var(--line)' } : undefined} onClick={() => isPast ? dayViewSheet(selectedISO) : startFlow(item.routineId, item)}>
            <div className="row" style={{ gap: 9, minWidth: 0 }}>
              <span className="lrow-i" style={{ background: programmeColourForItem(S, item) || 'var(--surface-3)' }}><Icon name={glyphOf(routine.emoji)} /></span>
              <div style={{ minWidth: 0 }}><div className="lbl2">{programmeNameForItem(S, item)}</div><div className="ttl">{routine.name}</div></div>
            </div>
            {actionForRoutine(routine, isProgrammeDone(item), item)}
          </div>
        })}

        {selectedFreestyle.map((workout, index) => <div key={workout.id} className="today-row" style={selectedPlans.length || selectedProgramme.length || index ? { borderTop: '1px solid var(--line)' } : undefined} onClick={() => dayViewSheet(selectedISO)}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: 'var(--surface-2)' }}><Icon name="sparkles" /></span>
            <div style={{ minWidth: 0 }}><div className="lbl2">{t('Freestyle')}</div><div className="ttl">{workout.name || t('Session')}</div></div>
          </div>
          <span className="row" style={{ gap: 8 }} onClick={event => event.stopPropagation()}>
            <Icon name="check" className="accent" />
            <Button variant="ghost" className="dim" size="sm" onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
            <Button variant="primary" size="sm" onClick={startFreestyle}>{t('Repeat')}</Button>
          </span>
        </div>)}
      </>}
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}><span className="lrow-i"><Icon name="sparkles" /></span><div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div></div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {!!delta && <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}><Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(delta))}</span>}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}><Icon name="target" style={{ fontSize: 13 }} /><span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span></div>}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}><Icon name="flame" style={{ color: 'var(--orange)' }} />{t('{0} week streak', streakWeeks(S))}</div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(unitWorkouts.length === 1 ? '{0} workout total' : '{0} workouts total', unitWorkouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
