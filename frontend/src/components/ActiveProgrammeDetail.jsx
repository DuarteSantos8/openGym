import { useState } from 'react'
import { DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { programmeTimelineForCycle } from '../lib/programme-timeline.js'
import { renderSupersetGroups } from './ReadyProgrammeDetail.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
const settledProgrammeStatuses = new Set(['completed', 'skipped'])
const routineForItem = item => item.routineSnapshot || {}
function programmeDayLabel(weekday) {
  const value = Number(weekday)
  const day = value === 7 ? 0 : value
  return t(DAYS[Number.isInteger(day) && day >= 0 && day < DAYS.length ? day : 0])
}

function programmeItemMeta(item) {
  const routine = routineForItem(item)
  const configuredExercises = Array.isArray(routine.ex) ? routine.ex : []
  const exerciseCount = Array.isArray(item?.exercises) ? item.exercises.length : configuredExercises.length
  const setCount = configuredExercises.reduce((sum, exercise) => sum + Math.max(0, Number(exercise?.sets) || 0), 0)
  const exerciseKey = exerciseCount === 1 ? '{0} exercise' : '{0} exercises'
  return `${t(exerciseKey, exerciseCount)} · ${t('{0} sets', setCount)}`
}

function programmeStatus(item, isNext) {
  if (isNext) return { className: 'is-next', label: t('Next') }
  if (item?.status === 'skipped') return { className: 'is-planned', label: t('Missed') }
  if (settledProgrammeStatuses.has(item?.status)) return { className: 'is-done', label: t('Done') }
  return { className: 'is-planned', label: t('Planned') }
}

export default function ActiveProgrammeDetail({ state, cycle, now, onClose, onComplete, onEdit, onExercise, initialWeek, onWeekChange, onStartSession, projection }) {
  const timeline = programmeTimelineForCycle(state, cycle, { now })
  const summary = { name: cycle.name, currentWeek: timeline.currentWeek, totalWeeks: timeline.totalWeeks }
  const groups = timeline.weeks
  const currentGroup = groups.find(group => group.index === timeline.currentWeek) || groups[0] || null
  // Keep week labels aligned with projected dates, including shifted rest weeks.
  const mondayOfWeek = weekIndex => {
    const anchor = timeline.cycle?.week1StartDate
    if (!anchor) return null
    const allItems = groups.flatMap(group => group.items)
    const reference = allItems.find(item => item.weekIndex >= weekIndex) || allItems.at(-1)
    const day = new Date(anchor + 'T12:00:00')
    day.setDate(day.getDate() + (Number(weekIndex) - 1) * 7)
    if (reference) {
      const original = new Date(anchor + 'T12:00:00Z')
      const offset = (Number(reference.weekday) - Number(cycle.programmeRevision != null ? 1 : cycle.weekStart ?? 1) + 7) % 7
      original.setUTCDate(original.getUTCDate() + (reference.weekIndex - 1) * 7 + offset)
      const shift = Math.round((Date.parse(reference.projectedDate + 'T12:00:00Z') - original.getTime()) / 86400000)
      day.setDate(day.getDate() + shift)
    }
    return String(day.getDate()).padStart(2, '0') + '/' + String(day.getMonth() + 1).padStart(2, '0')
  }
  const ddmmOf = iso => (iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) : '')
  const [selectedWeek, setSelectedWeek] = useState(() => groups.some(group => group.index === initialWeek) ? initialWeek : currentGroup?.index || summary.currentWeek)
  const [nextOpen, setNextOpen] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState(() => new Set())
  const selectedGroup = groups.find(group => group.index === selectedWeek) || currentGroup
  const queued = projection?.items || []
  const startItem = queued.find(item => !settledProgrammeStatuses.has(item.status))
  const activeInstanceId = state.active?.programmeInstance?.instanceId || state.active?.programmeInstanceId
  const nextItem = groups.flatMap(group => group.items).find(item => !settledProgrammeStatuses.has(item.status)) || null
  const selectWeek = weekIndex => {
    setSelectedWeek(weekIndex)
    onWeekChange?.(weekIndex)
    setNextOpen(true)
    setExpandedSessions(new Set())
  }
  const toggleSession = instanceId => {
    setExpandedSessions(previous => {
      const next = new Set(previous)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })
  }
  const renderExerciseRows = item => renderSupersetGroups(
    item?.exercises || [],
    exercise => exercise.key,
    exercise => exercise.name,
    exercise => `${exercise.last} → ${exercise.next}`,
    exercise => exercise.notes,
    exercise => exercise.sg,
    exercise => exercise.rest,
    onExercise && ((exercise, index, occurrence) => onExercise?.(item?.routineId || item?.routineSnapshot?.id, exercise.id, index, occurrence))
  )
  return <section className="card programme-detail" data-testid="active-programme-detail" aria-label={t('Programme timeline')}>
    <div className="prog-detail-head row">
      <div><h3 style={{ margin: 0 }}>{summary.name}</h3><div className="small dim">{t('Programme timeline')} · {t('Week {0} of {1}', summary.currentWeek, summary.totalWeeks)}</div></div>
      <button className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    <div className="prog-pills" role="tablist" aria-label={t('Programme weeks')}>
      {groups.map(group => <button
        key={group.index}
        type="button"
        role="tab"
        aria-selected={group.index === selectedGroup?.index}
        aria-label={t('Week {0} of {1}', group.index, summary.totalWeeks)}
        data-testid={`programme-week-pill-${group.index}`}
        className={`prog-pill${group.index === timeline.currentWeek ? ' is-current' : ''}${group.index === selectedGroup?.index ? ' is-selected' : ''}${group.mode === 'deload' ? ' is-deload' : ''}${group.mode === 'rest' ? ' is-rest' : ''}`}
        onClick={() => selectWeek(group.index)}
      >{group.index}{mondayOfWeek(group.index) && <span className="prog-pill-date">{mondayOfWeek(group.index)}</span>}</button>)}
    </div>
    {startItem && onStartSession && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
      <Button size="sm" variant="tinted" icon="play" onClick={() => onStartSession(startItem)}>{t(activeInstanceId === startItem.instanceId ? 'Resume' : 'Start')}</Button>
    </div>}
    {nextItem && <article className="prog-next" data-testid="programme-next-up">
      <button type="button" className="prog-next-toggle" data-testid="programme-next-toggle" aria-expanded={nextOpen} onClick={() => setNextOpen(open => !open)}>
        <span className="prog-next-day"><span className="tag acc">{t('Next').toUpperCase()}</span><span>{ddmmOf(nextItem.projectedDate)}</span></span>
        <span className="grow"><strong className="prog-session-title">{nextItem.routineName || nextItem.routineSnapshot?.name || nextItem.routineId || t('Session')}</strong><span className="prog-session-meta">{programmeItemMeta(nextItem)}</span></span>
        <Icon name="chevronRight" className={`prog-chevron${nextOpen ? ' is-open' : ''}`} />
      </button>
      <div className={`prog-exercises${nextOpen ? ' is-open' : ''}`}>
        {renderExerciseRows(nextItem)}
      </div>
    </article>}
    {selectedGroup && <>
      <div className={`prog-week-label${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`} data-testid="programme-week-label">{t('Week')} {selectedGroup.index} · {t('sessions')}{selectedGroup.mode === 'deload' ? ' · ' + t('deload') : selectedGroup.mode === 'rest' ? ' · ' + t('rest week') : ''}</div>
      {selectedGroup.items.length ? <div className="prog-day-list" data-testid="programme-day-list">
        {[...new Set(selectedGroup.items.map(item => item.projectedDate))].sort().map(projectedDate => {
          const weekday = new Date(projectedDate + 'T12:00:00').getDay()
          const dayItems = selectedGroup.items.filter(item => item.projectedDate === projectedDate)
          if (!dayItems.length) return null
          return <div key={projectedDate} className={`prog-day-row${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`} data-testid="programme-day-row">
            <div className="prog-day-head">
              <span className="tag acc prog-session-day">{programmeDayLabel(weekday)}</span>
              <span className="prog-day-date dim">{ddmmOf(dayItems[0].projectedDate)}</span>
            </div>
            <div className="prog-day-sessions">
        {dayItems.map(item => {
          const open = expandedSessions.has(item.instanceId)
          const isNext = nextItem?.instanceId === item.instanceId
          const status = programmeStatus(item, isNext)
          return <article className={`prog-session${open ? ' is-open' : ''}`} key={item.instanceId}>
            <button type="button" className="prog-session-toggle" data-testid="programme-session-row" aria-expanded={open} onClick={() => toggleSession(item.instanceId)}>
              <span className="tag acc prog-session-day">{programmeDayLabel(weekday)}</span>
              <span className="grow"><strong className="prog-session-title">{item.routineName || item.routineSnapshot?.name || item.routineId || t('Session')}</strong><span className="prog-session-meta">{programmeItemMeta(item)}</span></span>
              <span className={`prog-status ${status.className}`}>{status.label}</span>
              <Icon name="chevronRight" className={`prog-chevron${open ? ' is-open' : ''}`} />
            </button>
            <div className={`prog-exercises${open ? ' is-open' : ''}`}>
              {renderExerciseRows(item)}
            </div>
          </article>
        })}
            </div>
          </div>
        })}
      </div> : <div className={`small dim prog-empty-week${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`}>{selectedGroup.mode === 'deload' ? t('Deload week') : t('Rest week')}</div>}
    </>}
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
      {onEdit && <Button size="sm" variant="tinted" icon="edit" onClick={() => onEdit?.(cycle)}>{t('Edit programme')}</Button>}
      <Button size="sm" variant="ghost" icon="flag" onClick={() => onComplete?.(cycle)}>{t('Complete early')}</Button>
    </div>
  </section>
}
