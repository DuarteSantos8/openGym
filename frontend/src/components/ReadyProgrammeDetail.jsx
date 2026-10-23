import {POLICY_NAME} from '../lib/progression.js'
import { useState } from 'react'
import { DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { supersetUnits } from '../lib/history.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

function programmeDayLabel(weekday) {
  const value = Number(weekday)
  const day = value === 7 ? 0 : value
  return t(DAYS[Number.isInteger(day) && day >= 0 && day < DAYS.length ? day : 0])
}

export function renderSupersetGroups(rows, rowKey, nameOf, targetOf, notesOf, sgOf, restOf, onExercise) {
  const groups = supersetUnits(rows).map(indices => {
    const members = indices.map(index => rows[index])
    return {
      sg: members.length > 1 ? sgOf(members[0]) : null,
      rows: members,
      indices
    }
  })
  const occurrenceOf = (row, index) => rows
    .slice(0, index + 1)
    .filter(candidate => String(candidate?.id) === String(row?.id)).length - 1
  const activate = (event, row, index) => {
    if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
    if (event?.type === 'keydown') event.preventDefault()
    onExercise?.(row, index, occurrenceOf(row, index))
  }
  let ssIndex = 0
  return groups.map((group) => {
    if (!group.sg) {
      const row = group.rows[0]
      const index = group.indices[0]
      return (
        <div className="prog-exercise-row" key={rowKey(row)} data-testid="programme-exercise-timeline" role={onExercise ? "button" : undefined} tabIndex={onExercise ? 0 : undefined}
          onClick={event => activate(event, row, index)} onKeyDown={event => activate(event, row, index)} style={{ cursor: onExercise ? 'pointer' : undefined }}>
          <span className="prog-exercise-name">{nameOf(row)}</span>
          <span className="prog-exercise-meta"><span className="prog-exercise-target">{targetOf(row)}</span></span>
          {notesOf(row) && <span className="prog-exercise-note dim">{notesOf(row)}</span>}
        </div>
      )
    }
    ssIndex += 1
    const isGiant = group.rows.length > 2
    return (
      <div className="prog-ssg" key={rowKey(group.rows[0])} data-testid="programme-superset-group">
        <div className="prog-ssg-head">
          <span className="tag acc">{isGiant ? t('Giant set') : t('Superset')} {ssIndex}</span>
        </div>
        <div className="prog-ssg-bracket">
          {group.rows.map((row, i) => {
            const index = group.indices[i]
            const rest = restOf(row)
            const notes = notesOf(row)
            return (
              <div className="prog-exercise-row prog-ssg-row" key={rowKey(row)} role={onExercise ? "button" : undefined} tabIndex={onExercise ? 0 : undefined}
                onClick={event => activate(event, row, index)} onKeyDown={event => activate(event, row, index)} style={{ cursor: onExercise ? 'pointer' : undefined }}>
                <span className="prog-ssg-label">{'A' + (i + 1)}</span>
                <span className="prog-exercise-name">{nameOf(row)}</span>
                <span className="prog-ssg-target">{targetOf(row)}</span>
                {rest != null && <span className="prog-ssg-rest">{t('rest {0} s', rest)}</span>}
                {notes && <span className="prog-ssg-note dim" style={{ flexBasis: '100%', paddingLeft: 30, fontSize: 10.5, lineHeight: 1.4 }}>{notes}</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  })
}

export default function ReadyProgrammeDetail({ definition, onStart, onClose, onEdit, onDuplicate, onShare, effortKind = 'none', customEx = [], onExercise, initialWeek = 1, onWeekChange }) {
  const [selectedWeek, setSelectedWeek] = useState(() => initialWeek)
  const [openSession, setOpenSession] = useState(null)
  const weeks = Array.isArray(definition?.weeks) ? definition.weeks : []
  const sessions = weeks.reduce((count, week) => count + (week?.days || []).reduce((n, day) => n + (day?.sessions || []).length, 0), 0)
  const selected = weeks[selectedWeek - 1] || weeks[0] || null
  const exerciseTarget = cfg => {
    const bits = []
    if (cfg.sets != null) bits.push(cfg.sets + ' × ' + (cfg.reps != null ? cfg.reps : cfg.sec != null ? cfg.sec + 's' : '?'))
    // The target effort scale follows the user's main-menu setting: RIR as stored, or
    // the RPE reading (RPE = 10 - RIR) when the user thinks in RPE.
    if (cfg.rir != null) bits.push(effortKind === 'rpe' ? 'RPE ' + Math.max(0, 10 - cfg.rir) : 'RIR ' + cfg.rir)
    return bits.join(' ')
  }
  return <section className="card programme-detail" data-testid="ready-programme-detail" aria-label={t('Programme preview')}>
    <div className="prog-detail-head row">
      <div><h3 style={{ margin: 0 }}>{definition?.name || t('Programme')}</h3><div className="small dim">{t('{0} weeks', weeks.length || 1)}{sessions ? ' · ' + t('{0} planned sessions', sessions) : ''}{definition?.progression ? ' · ' + t('Progression: {0}', t(POLICY_NAME[definition.progression] || definition.progression)) : ''}</div></div>
      <button className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    <div className="prog-pills" role="tablist" aria-label={t('Programme weeks')}>
      {weeks.map((week, index) => {
        const weekIndex = Number(week?.weekIndex ?? index + 1)
        const mode = week?.mode || 'normal'
        return <button key={weekIndex} type="button" role="tab"
          aria-selected={weekIndex === selectedWeek}
          aria-label={t('Week {0} of {1}', weekIndex, weeks.length)}
          data-testid={`ready-week-pill-${weekIndex}`}
          className={`prog-pill${weekIndex === selectedWeek ? ' is-selected' : ''}${mode === 'deload' ? ' is-deload' : ''}${mode === 'rest' ? ' is-rest' : ''}`}
          onClick={() => { setSelectedWeek(weekIndex); onWeekChange?.(weekIndex) }}
        >{weekIndex}</button>
      })}
    </div>
    {selected && <>
      <div className={`prog-week-label${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>{t('Week')} {selectedWeek} · {t('sessions')}{selected.mode === 'deload' ? ' · ' + t('deload') : selected.mode === 'rest' ? ' · ' + t('rest week') : ''}</div>
      {(() => {
        const dayRows = (selected.days || []).filter(day => (day.sessions || []).length)
        if (!dayRows.length) return <div className={`small dim prog-empty-week${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>{selected.mode === 'deload' ? t('Deload week') : t('Rest week')}</div>
        return <div className="prog-day-list" data-testid="ready-day-list">
          {dayRows.map(day => <div key={day.weekday} className={`prog-day-row${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>
            <div className="prog-day-head">
              <span className="tag acc prog-session-day">{programmeDayLabel(day.weekday)}</span>
            </div>
            <div className="prog-day-sessions">
              {(day.sessions || []).map((session, sessionIndex) => {
                const routine = session.routineSnapshot || session.routine || {}
                const ex = Array.isArray(routine.ex) ? routine.ex : []
                const sessionKey = session.id || session.sessionTemplateId || `${day.weekday}:${sessionIndex}`
                const isOpen = openSession === sessionKey
                return <div key={sessionKey} className={'prog-session' + (isOpen ? ' is-open' : '')}>
                  <button type="button" className="prog-session-toggle" style={{ minHeight: 0, padding: '10px 12px' }} aria-expanded={isOpen}
                    onClick={() => setOpenSession(current => current === sessionKey ? null : sessionKey)}>
                    <span className="grow"><strong className="prog-session-title">{routine.name || session.routineId || t('Session')}</strong><span className="prog-session-meta">{ex.length ? t('{0} exercises · {1} sets', ex.length, ex.reduce((n, cfg) => n + (cfg.sets || 0), 0)) : ''}</span></span>
                    <Icon name="chevronRight" className={`prog-chevron${isOpen ? ' is-open' : ''}`} />
                  </button>
                  {isOpen && ex.length ? <div className="prog-exercises is-open">
                    {renderSupersetGroups(
                      ex,
                      cfg => cfg.id + ':' + (cfg.sg || 'plain') + ':' + ex.indexOf(cfg),
                      cfg => exerciseDisplayName(cfg, customEx),
                      cfg => exerciseTarget(cfg),
                      cfg => cfg.notes,
                      cfg => cfg.sg || null,
                      cfg => cfg.workRestSec != null ? Number(cfg.workRestSec) : null,
                      onExercise && ((cfg, index, occurrence) => onExercise?.(session.routineId || session.routineSnapshot?.id || routine.id, cfg.id, index, occurrence))
                    )}
                  </div> : null}
                </div>
              })}
            </div>
          </div>)}
        </div>
      })()}
    </>}
    <div className="prog-detail-actions row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, padding: '12px 12px 4px' }}>
      <Button size="sm" variant="tinted" icon="pencil" onClick={() => onEdit?.(definition)}>{t('Edit')}</Button>
      {onDuplicate && <Button size="sm" variant="tinted" onClick={() => onDuplicate(definition)}>{t('Duplicate')}</Button>}
      {onShare && <Button size="sm" variant="tinted" icon="share" onClick={() => onShare(definition)}>{t('Share')}</Button>}
      <Button size="sm" variant="primary" icon="play" onClick={() => onStart?.(definition)}>{t('Start programme')}</Button>
    </div>
  </section>
}

function exerciseDisplayName(cfg, customEx = []) {
  if (cfg?.name || cfg?.n) return cfg.name || cfg.n
  const custom = customEx.find(item => String(item.id) === String(cfg?.id))
  if (custom?.n) return custom.n
  return EXIDX[cfg?.id]?.n || cfg?.id
}
