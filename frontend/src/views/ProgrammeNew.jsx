import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, localTZ, uid, weekOrder, weekStartOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { POLICY_NAME } from '../lib/progression.js'
import {
  addProgrammeDefinitionInState, copyProgrammeWeekToTargets, createProgrammeDefinition,
  cycleWeekMode, PROGRAMME_COLOURS, programmeBuilderSources, programmeDefinitionOf,
  programmeEditorInputForCycle, programmeProgressionOptions, programmeWeeksFromSource,
  setProgrammeDaySessions, updateActiveProgrammeCycleInState,
} from '../lib/programmes.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Stepper, TextField } from '../components/ui.jsx'
import { glyphPicker } from '../sheets.jsx'
import { DEFAULT_GLYPH, glyphOf } from '../lib/glyphs.js'

const clone = value => JSON.parse(JSON.stringify(value))
const DRAFT_PREFIX = 'opengym:programme-draft:'
const ACTIVE_DRAFT = 'opengym:programme-draft-active'
const COLOUR_CSS = {
  lime: 'var(--green)', sky: 'var(--blue)', orange: 'var(--orange)', gold: 'var(--yellow)',
  violet: 'var(--purple)', pink: 'var(--pink)', teal: 'var(--teal)',
}
const COLOUR_NAME = {
  lime: 'Lime', sky: 'Sky', orange: 'Orange', gold: 'Gold', violet: 'Violet', pink: 'Pink', teal: 'Teal',
}

function validDraftToken(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{8,200}$/.test(value)
}

function clearProgrammeDraft(token) {
  if (validDraftToken(token)) sessionStorage.removeItem(DRAFT_PREFIX + token)
  if (!token || sessionStorage.getItem(ACTIVE_DRAFT) === token) sessionStorage.removeItem(ACTIVE_DRAFT)
}

export function readProgrammeDraft(token) {
  if (!validDraftToken(token)) return null
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + token) || 'null')
    if (value?.version !== 1 || value.returnPath !== '/programme/new' || !Array.isArray(value.draft?.weeks)) return null
    return value
  } catch {
    return null
  }
}

export function programmeRoutineReturnToken(locationState) {
  const token = locationState?.programmeReturn === true ? locationState.programmeDraftToken : null
  return readProgrammeDraft(token) ? token : null
}

function writeProgrammeDraft(draft, action, priorToken) {
  const token = validDraftToken(priorToken) ? priorToken : `programme:${uid()}:${uid()}`
  sessionStorage.setItem(DRAFT_PREFIX + token, JSON.stringify({ version: 1, returnPath: '/programme/new', draft: clone(draft), action: clone(action) }))
  sessionStorage.setItem(ACTIVE_DRAFT, token)
  return token
}

function freshSession(routine) {
  return {
    id: `programme-session-${uid()}`, sessionTemplateId: `programme-template-${uid()}`,
    routineId: routine.id, routineSnapshot: clone(routine),
  }
}

function syncRoutineSnapshots(weeks, routine) {
  return weeks.map(week => ({ ...clone(week), days: (week.days || []).map(day => ({
    ...clone(day), sessions: (day.sessions || []).map(session => String(session.routineId || session.routineSnapshot?.id) === String(routine.id)
      ? { ...clone(session), routineId: routine.id, routineSnapshot: clone(routine) }
      : clone(session)),
  })) }))
}

export function applyProgrammeRoutineReturn(payload, state) {
  const draft = clone(payload?.draft)
  if (!draft?.weeks || !payload?.action?.routineId) return draft
  const routine = (state.routines || []).find(item => String(item.id) === String(payload.action.routineId))
  if (!routine) return draft
  if (payload.action.kind === 'edit') draft.weeks = syncRoutineSnapshots(draft.weeks, routine)
  if (payload.action.kind === 'add') {
    const { weekOffset, weekday } = payload.action
    const day = draft.weeks?.[weekOffset]?.days?.find(item => Number(item.weekday) === Number(weekday))
    if (day) draft.weeks = setProgrammeDaySessions(draft.weeks, weekOffset, weekday, [...(day.sessions || []), freshSession(routine)])
  }
  return draft
}

function consumeProgrammeDraft(locationState, state) {
  const locationToken = locationState?.programmeDraftToken
  const token = validDraftToken(locationToken) ? locationToken : sessionStorage.getItem(ACTIVE_DRAFT)
  const payload = readProgrammeDraft(token)
  if (!payload) {
    if (token) clearProgrammeDraft(token)
    return null
  }
  const draft = applyProgrammeRoutineReturn(payload, state)
  sessionStorage.setItem(DRAFT_PREFIX + token, JSON.stringify({ ...payload, draft: clone(draft), action: null }))
  sessionStorage.setItem(ACTIVE_DRAFT, token)
  return { token, draft }
}

function dayOf(week, weekday) {
  return (week?.days || []).find(day => Number(day.weekday) === Number(weekday)) || { weekday, sessions: [] }
}

export default function ProgrammeNew() {
  const location = useLocation()
  const nav = useNavigate()
  const S = useStore(state => state.S)
  const update = useStore(state => state.update)
  const restored = useMemo(() => consumeProgrammeDraft(location.state, S), [])
  const cycleId = restored?.draft?.cycleId || (location.state?.mode === 'edit-cycle' ? location.state.cycleId : null)
  const cycle = cycleId ? S.programmes?.cycles?.find(item => item.id === cycleId) : null
  const definitionId = restored?.draft?.definitionId || (location.state?.mode === 'edit' ? location.state.programmeId : null)
  const persisted = useMemo(() => cycle ? programmeEditorInputForCycle(cycle) : programmeDefinitionOf(S, definitionId), [cycle, definitionId, S])
  const duplicate = location.state?.mode === 'duplicate' ? programmeDefinitionOf(S, location.state.programmeId) : null
  const initial = restored?.draft || persisted || (duplicate ? { ...duplicate, sourceKey: 'programme:' + duplicate.id, name: t('{0} copy', duplicate.name), weeks: programmeWeeksFromSource(S, 'programme:' + duplicate.id, duplicate.weeks.length) } : null)
  const initialLength = initial?.weeks?.length || 8
  const [emoji, setEmoji] = useState(initial?.emoji || DEFAULT_GLYPH)
  const [name, setName] = useState(initial?.name || '')
  const [progression, setProgression] = useState(initial?.progression || 'linear')
  const [colour, setColour] = useState(initial?.colour ?? null)
  const [sourceKey, setSourceKey] = useState(initial?.sourceKey || 'current')
  const [weeks, setWeeks] = useState(() => initial?.weeks?.length ? clone(initial.weeks) : programmeWeeksFromSource(S, 'current', initialLength))
  const [selectedWeek, setSelectedWeek] = useState(Math.min(initial?.selectedWeek || 0, initialLength - 1))
  const [selectedDay, setSelectedDay] = useState(initial?.selectedDay ?? weekOrder(weekStartOf(S))[0])
  const [copyTargets, setCopyTargets] = useState([])
  const weekdays = weekOrder(weekStartOf(S))
  const sources = programmeBuilderSources(S)
  const progressionOptions = programmeProgressionOptions(weeks, S)
  const progressionCompatible = progressionOptions.includes(progression)
  const currentWeek = weeks[selectedWeek]
  const currentDay = dayOf(currentWeek, selectedDay)
  const originWeek = restored?.draft?.originWeek || restored?.draft?.returnWeek || location.state?.programmeDetailReturn?.week || location.state?.programmeWeek
  const returnPath = cycleId ? '/home?' + new URLSearchParams({ cycle: cycleId, ...(Number.isInteger(originWeek) && originWeek > 0 ? { week: originWeek } : {}) }) : '/plan'

  if (!S.programmeMode) return <Navigate to="/plan" replace />

  const draftValue = () => ({
    cycleId, definitionId, name, emoji, progression, colour, sourceKey, weeks,
    selectedWeek, selectedDay, originWeek,
  })
  const leave = () => { clearProgrammeDraft(restored?.token); nav(returnPath) }
  const resizeWeeks = value => {
    const length = Math.max(1, Math.min(52, Math.round(Number(value) || 1)))
    setWeeks(previous => length <= previous.length
      ? previous.slice(0, length).map((week, index) => ({ ...week, weekIndex: index + 1 }))
      : [...previous, ...programmeWeeksFromSource(S, sourceKey, length).slice(previous.length)])
    setSelectedWeek(index => Math.min(index, length - 1))
    setCopyTargets(targets => targets.filter(index => index < length))
  }
  const changeSource = value => {
    setSourceKey(value)
    const source = sources.find(item => item.value === value)
    const length = source?.definition?.weeks?.length || weeks.length
    const seeded = programmeWeeksFromSource(S, value, length)
    setWeeks(seeded); setSelectedWeek(0); setSelectedDay(weekdays[0]); setCopyTargets([])
    if (source?.definition) {
      setName(source.definition.name || '')
      setEmoji(source.definition.emoji || DEFAULT_GLYPH)
      setProgression(source.definition.progression || 'linear')
      setColour(PROGRAMME_COLOURS.includes(source.definition.colour) ? source.definition.colour : null)
    }
  }
  const updateDay = sessions => setWeeks(previous => setProgrammeDaySessions(previous, selectedWeek, selectedDay, sessions))
  const addSession = routine => { if (routine) updateDay([...(currentDay.sessions || []), freshSession(routine)]) }
  const replaceSession = (index, routine) => {
    if (!routine) return
    updateDay(currentDay.sessions.map((session, position) => position === index
      ? { ...clone(session), routineId: routine.id, routineSnapshot: clone(routine) }
      : session))
  }
  const moveSession = (index, amount) => {
    const target = index + amount
    if (target < 0 || target >= currentDay.sessions.length) return
    const sessions = [...currentDay.sessions]
    ;[sessions[index], sessions[target]] = [sessions[target], sessions[index]]
    updateDay(sessions)
  }
  const editRoutine = routineId => {
    if (!routineId || !S.routines.some(routine => String(routine.id) === String(routineId))) return
    const token = writeProgrammeDraft(draftValue(), { kind: 'edit', routineId }, restored?.token)
    nav(`/plan/r/${routineId}`, { state: { programmeReturn: true, programmeDraftToken: token } })
  }
  const addRoutine = () => {
    const routine = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(state => { state.routines.push(routine) })
    const token = writeProgrammeDraft(draftValue(), { kind: 'add', routineId: routine.id, weekOffset: selectedWeek, weekday: selectedDay }, restored?.token)
    nav(`/plan/r/${routine.id}`, { state: { programmeReturn: true, programmeDraftToken: token } })
  }
  const save = () => {
    try {
      update(state => {
        const input = { id: persisted?.id, name, emoji, progression, colour, weeks }
        if (cycleId) updateActiveProgrammeCycleInState(state, cycleId, input, { timeZone: localTZ() })
        else addProgrammeDefinitionInState(state, createProgrammeDefinition(input, state, { id: persisted?.id }))
      })
      clearProgrammeDraft(restored?.token); nav(returnPath)
    } catch (error) {
      useUI.getState().toast(error instanceof Error ? error.message : 'Programme update blocked')
    }
  }
  const sessionCount = weeks.reduce((sum, week) => sum + (week.mode === 'rest' ? 0 : (week.days || []).reduce((count, day) => count + (day.sessions || []).length, 0)), 0)
  const hasSession = sessionCount > 0
  const modeColour = mode => mode === 'rest' ? 'var(--red)' : mode === 'deload' ? 'var(--orange)' : 'var(--label-2)'
  const modeLabel = mode => mode === 'deload' ? t('Deload') : mode === 'rest' ? t('Rest') : t('Normal')
  const selectColourByKeyboard = (event, value) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setColour(value)
  }

  return <div className="narrow programme-builder">
    <div className="hdr">
      <div><h1>{persisted ? t('Edit programme') : t('New programme')}</h1><div className="sub">{t('Build a reusable training cycle')}</div></div>
      <button className="iconbtn" onClick={leave} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    <div className="card" style={{ marginBottom: 12 }}>
      <label className="small dim" htmlFor="programme-name">{t('Programme name')}</label>
      <div className="row programme-identity">
      <TextField id="programme-name" className="grow" placeholder={t('Programme name')} value={name} onChange={event => setName(event.target.value)} />
      <button type="button" className="iconbtn" aria-label={t('Pick an icon')} style={{ color: COLOUR_CSS[colour] || 'var(--acc)' }} onClick={() => glyphPicker(emoji, setEmoji)}><Icon name={glyphOf(emoji)} /></button>
      </div>
      <div style={{ height: 12 }} />
      <label className="small dim" htmlFor="programme-progression">{t('Progression')}</label>
      <select id="programme-progression" className="field" value={progression} onChange={event => setProgression(event.target.value)}>
        {progressionOptions.map(policy => <option key={policy} value={policy}>{t(POLICY_NAME[policy])}</option>)}
        {!progressionCompatible && <option value={progression} disabled>{t(POLICY_NAME[progression] || progression)}</option>}
      </select>
      <div style={{ height: 12 }} />
      <Stepper label={t('Number of weeks')} value={weeks.length} step={1} decimal={false} onChange={resizeWeeks} />
      <details className="programme-appearance"><summary><Icon name="chevronRight" className="programme-disclosure" /><span>{t('Programme colour')}</span><span className="programme-colour-preview" style={{ background: COLOUR_CSS[colour] || 'var(--surface-3)' }} /><span className="small">{colour ? t(COLOUR_NAME[colour]) : t('No colour')}</span></summary>
      <div className="row" role="group" aria-label={t('Programme colour')} style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button type="button" data-testid="programme-colour-none" aria-pressed={colour == null} aria-label={t('No colour')}
          onClick={() => setColour(null)} onKeyDown={event => selectColourByKeyboard(event, null)}
          style={{ width: 32, height: 32, borderRadius: '50%', border: colour == null ? '3px solid var(--label)' : '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--label-2)' }}><Icon name="xmark" /></button>
        {PROGRAMME_COLOURS.map(key => <button key={key} type="button" data-testid={`programme-colour-${key}`}
          aria-pressed={colour === key} aria-label={`${t('Programme colour')}: ${t(COLOUR_NAME[key])}`} onClick={() => setColour(key)}
          onKeyDown={event => selectColourByKeyboard(event, key)}
          style={{ width: 32, height: 32, borderRadius: '50%', border: colour === key ? '3px solid var(--label)' : '1px solid var(--line)', background: COLOUR_CSS[key] }} />)}
      </div>
      </details>
    </div>

    {!persisted && <div className="card" style={{ marginBottom: 12 }}>
      <label className="small dim" htmlFor="programme-source">{t('Start with')}</label>
      <select id="programme-source" className="field" value={sourceKey} onChange={event => changeSource(event.target.value)}>
        {sources.map(source => <option key={source.value} value={source.value}>{source.kind === 'programme' ? `${t('Clone')}: ${source.label}` : t(source.label)}</option>)}
      </select>
      <div className="small dim" style={{ marginTop: 8 }}>{sourceKey === 'current'
        ? t('Copies this week’s routines into each programme week. You can edit the templates later.')
        : sourceKey === 'blank' ? t('Creates empty weeks. Add sessions when you are ready.')
          : t('Creates an independent copy of the selected programme.')}</div>
    </div>}

    <h4 className="sec">{t('Week templates')}</h4>
    <div className="small muted" data-testid="programme-count" style={{ marginBottom: 10 }}>{t(weeks.length === 1 ? '{0} week' : '{0} weeks', weeks.length)} · {t(sessionCount === 1 ? '{0} session' : '{0} sessions', sessionCount)}</div>
    <div role="tablist" aria-label={t('Week templates')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(78px,1fr))', gap: 7, marginBottom: 12 }}>
      {weeks.map((week, index) => <button key={week.weekIndex || index} type="button" role="tab" aria-selected={selectedWeek === index}
        className="card" style={{ padding: 9, textAlign: 'left', border: selectedWeek === index ? '2px solid var(--acc)' : '1px solid var(--line)' }}
        onClick={() => { setSelectedWeek(index); setCopyTargets([]) }}>
        <strong>{t('Week')} {index + 1}</strong><span className="small dim" style={{ display: 'block', color: modeColour(week.mode) }}>{modeLabel(week.mode)}</span>
        <span className="small">{(week.days || []).reduce((sum, day) => sum + (day.sessions || []).length, 0)} {t('sessions')}</span>
      </button>)}
    </div>
    {currentWeek && <>
      <div className="row between" style={{ marginBottom: 8 }}><span className="small dim">{t('Week {0} mode', selectedWeek + 1)}</span>
        <Segmented value={currentWeek.mode || 'normal'} onChange={mode => setWeeks(previous => previous.map((week, index) => index === selectedWeek ? cycleWeekMode(week, mode) : week))}
          options={['normal', 'deload', 'rest'].map(mode => ({ value: mode, label: <span style={{ color: modeColour(mode) }}>{modeLabel(mode)}</span> }))} /></div>
      <div className="small dim" style={{ marginBottom: 10 }}>{currentWeek.mode === 'rest'
        ? t('Rest weeks keep their sessions but do not schedule workouts.')
        : currentWeek.mode === 'deload' ? t('Deload weeks keep configured loads and pause automatic progression.') : ''}</div>
      <details className="programme-copy" style={{ marginBottom: 12 }}>
        <summary className="small muted" style={{ padding: '12px 0', cursor: 'pointer' }}>{t('Copy this week')}</summary>
        <div className="card" style={{ marginBottom: 0 }}>
        <div className="small dim" style={{ margin: '5px 0 8px' }}>{t('Copy this week to any selected destination weeks.')}</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{weeks.map((week, index) => index === selectedWeek ? null
          : <button key={week.weekIndex || index} type="button" className={'tag' + (copyTargets.includes(index) ? ' acc' : '')}
            style={{ color: copyTargets.includes(index) ? 'var(--green)' : modeColour(week.mode) }} aria-pressed={copyTargets.includes(index)} onClick={() => setCopyTargets(targets => targets.includes(index) ? targets.filter(item => item !== index) : [...targets, index])}>{t('Week')} {index + 1}</button>)}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button size="sm" variant="tinted" disabled={!copyTargets.length}
          onClick={() => { setWeeks(previous => copyProgrammeWeekToTargets(previous, selectedWeek, copyTargets)); setCopyTargets([]) }}>{t('Copy')}</Button></div>
        </div>
      </details>
      <h4 className="sec">{t('Day sessions')}</h4>
      <div className="list">{weekdays.map(weekday => {
        const day = dayOf(currentWeek, weekday); const open = selectedDay === weekday
        return <div key={weekday} className="item" style={{ display: 'block' }}>
          <button type="button" className="row" data-programme-weekday={weekday} aria-expanded={open} style={{ width: '100%', border: 0, padding: 0, background: 'none', color: 'inherit', textAlign: 'left' }} onClick={() => setSelectedDay(weekday)}>
            <span className="grow"><strong>{t(DAYN[weekday])}</strong><span className="small dim" style={{ display: 'block', color: day.sessions.length ? undefined : 'var(--red)' }}>{day.sessions.length ? t(day.sessions.length === 1 ? '{0} session' : '{0} sessions', day.sessions.length) : t('Rest day')}</span></span>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} />
          </button>
          {open && <div style={{ marginTop: 8 }}>
            {day.sessions.map((session, index) => <div key={session.id} className="programme-session-editor">
              <select className="field grow" style={{ minWidth: 0, fontSize: 14 }} aria-label={t('Select routine')} value={session.routineId || session.routineSnapshot?.id || ''}
                onChange={event => replaceSession(index, S.routines.find(routine => routine.id === event.target.value))}>
                {(S.routines || []).map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
              </select>
              <button type="button" className="iconbtn" aria-label={t('Move up')} disabled={index === 0} onClick={() => moveSession(index, -1)}><Icon name="chevronUp" /></button>
              <button type="button" className="iconbtn" aria-label={t('Move down')} disabled={index === day.sessions.length - 1} onClick={() => moveSession(index, 1)}><Icon name="chevronDown" /></button>
              <button type="button" className="iconbtn" aria-label={t('Edit routine')} title={t('Edit routine')} onClick={() => editRoutine(session.routineId || session.routineSnapshot?.id)}><Icon name="pencil" /></button>
              <button type="button" className="iconbtn" aria-label={t('Remove session')} onClick={() => updateDay(day.sessions.filter((_, position) => position !== index))}><Icon name="xmark" /></button>
            </div>)}
            <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
              {!!S.routines.length && <select className="field grow" style={{ flexBasis: '100%', minWidth: 0 }} defaultValue="" aria-label={t('Add session')} onChange={event => { addSession(S.routines.find(routine => routine.id === event.target.value)); event.target.value = '' }}>
                <option value="">{t('Add session')}</option>{S.routines.map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
              </select>}
              <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
              {!!day.sessions.length && <Button size="sm" variant="ghost" onClick={() => updateDay([])}>{t('Set rest day')}</Button>}
            </div>
          </div>}
        </div>
      })}</div>
    </>}
    <Button variant="primary" icon="check" disabled={!name.trim() || !hasSession || !progressionCompatible} onClick={save}>{t('Save programme')}</Button>
  </div>
}
