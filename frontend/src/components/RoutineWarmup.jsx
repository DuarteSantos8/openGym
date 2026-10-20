import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { warmupProposal } from '../lib/warmup-suggestions.js'
import { WARMUP_IDS, MAX_WARMUP_STEPS, WARMUP_TIME_LIMITS, WARMUP_REP_LIMITS, normalizeWarmup, defaultWarmupStep } from '../../../api/training/guided-warmup.js'
import { exerciseDetailSheet, exercisePicker } from '../sheets.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button, Row, Section, Segmented, Stepper, Switch } from './ui.jsx'

const warmupOf = routine => normalizeWarmup(routine?.warmup) || { enabled: false, steps: [] }
const matches = (step, snapshot) => step && JSON.stringify(step) === snapshot
const routineSnapshot = routine => JSON.stringify({ ex: routine?.ex, warmup: routine?.warmup })
const targetText = step => (step.mode === 'time' ? t('{0} s', step.sec) : t('{0} reps', step.reps)) + (step.perSide ? ' · ' + t('Per side') : '')

function MovementThumb({ ex }) {
  const label = `${t('Details')}: ${exerciseNameFor(ex)}`
  return <button type="button" className="wthumb" aria-label={label} title={label} onClick={() => exerciseDetailSheet(ex)}>
    <Thumb ex={ex} />
    <span className="wthumb-x" aria-hidden="true"><Icon name="expand" /></span>
  </button>
}

function SuggestionPreview({ steps, muscleNames, replacing, close, onSave }) {
  const [draft, setDraft] = useState(() => structuredClone(steps))
  const editMovement = index => {
    useUI.getState().openSheet(close => <div>
      <MovementSettings step={draft[index]} close={close}
        onSave={step => setDraft(current => current.map((value, at) => at === index ? step : value))}
        onRemove={() => setDraft(current => current.filter((_, at) => at !== index))} />
      <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
    </div>)
  }
  const move = (index, direction) => setDraft(current => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    const [step] = next.splice(index, 1)
    next.splice(target, 0, step)
    return next
  })
  return <div>
    <h3 style={{ margin: '0 0 12px' }}>{t('Suggested warm-up')}</h3>
    <p className="small dim">{t('Based on this routine’s muscles: {0}. Edit the movements before adding them.', muscleNames)}</p>
    <ol className="list" style={{ listStyle: 'none', padding: 0 }}>{draft.map((step, index) => {
      const ex = exOr(step.id)
      return <li className="item" key={step.id}>
        <span className="dim small" style={{ minWidth: '1ch' }}>{index + 1}</span>
        <MovementThumb ex={ex} />
        <button type="button" className="grow item-open" onClick={() => editMovement(index)}>
          <span className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</span>
          <span className="ss">{targetText(step)}</span>
        </button>
        <div style={{ display: 'flex', flex: 'none', gap: 2 }}>
          <button className="iconbtn" aria-label={t('Move up')} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="chevronUp" /></button>
          <button className="iconbtn" aria-label={t('Move down')} disabled={index === draft.length - 1} onClick={() => move(index, 1)}><Icon name="chevronDown" /></button>
        </div>
      </li>
    })}</ol>
    {replacing && <p className="small">{t('Replace your current warm-up with these movements?')}</p>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      <Button variant="primary" disabled={!draft.length} onClick={() => { onSave(draft); close() }}>{replacing ? t('Replace warm-up') : t('Add warm-up')}</Button>
      <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}

function MovementSettings({ step, close, onSave, onRemove }) {
  const [mode, setMode] = useState(step.mode)
  const [sec, setSec] = useState(step.sec || 30)
  const [reps, setReps] = useState(step.reps || 10)
  const [perSide, setPerSide] = useState(step.perSide === true)
  const ex = exOr(step.id)
  const save = () => {
    const target = { id: step.id, mode, ...(mode === 'time' ? { sec } : { reps }), ...(perSide ? { perSide: true } : {}) }
    const saved = normalizeWarmup({ enabled: true, steps: [target] }).steps[0]
    if (!saved) return
    onSave(saved)
    close()
  }
  return <div>
    <div className="row between" style={{ gap: 12, marginBottom: 16 }}>
      <h3 className={exerciseNameClass(ex)} style={{ margin: 0 }}>{exerciseNameFor(ex)}</h3>
      <Button size="sm" variant="ghost" onClick={save}>{t('Save')}</Button>
    </div>
    <Section>
      <Row title={t('Target')}>
        <Segmented className="seg-inline" value={mode} onChange={setMode}
          options={[{ value: 'time', label: t('Time') }, { value: 'reps', label: t('Repetitions') }]} />
      </Row>
      <Row title={mode === 'time' ? t('Duration') : t('Repetitions')}>
        {mode === 'time'
          ? <Stepper value={sec} min={WARMUP_TIME_LIMITS.min} max={WARMUP_TIME_LIMITS.max} step={5} decimal={false} unit={t('s')} onChange={setSec} />
          : <Stepper value={reps} min={WARMUP_REP_LIMITS.min} max={WARMUP_REP_LIMITS.max} decimal={false} onChange={setReps} />}
      </Row>
      <Row title={t('Per side')} subtitle={t('Complete the target on each side.')}>
        <Switch aria-label={t('Per side')} checked={perSide} onChange={setPerSide} />
      </Row>
    </Section>
    {onRemove && <Button variant="danger" icon="trash" onClick={() => { onRemove(); close() }}>{t('Remove')}</Button>}
  </div>
}

// Warm-up movements are a separate sequence: their targets never become lifting sets.
// Read the routine again in sheet callbacks because it can change or disappear during a sync.
export default function RoutineWarmup({ routineId }) {
  const routine = useStore(s => s.S.routines.find(r => r.id === routineId))
  if (!routine) return null
  const warmup = warmupOf(routine)
  const edit = change => {
    if (!useStore.getState().S.routines.some(r => r.id === routineId)) return
    useStore.getState().update(s => {
      const current = s.routines.find(r => r.id === routineId)
      if (!current) return
      const next = warmupOf(current)
      change(next)
      current.warmup = next
    })
  }
  const add = step => edit(next => {
    if (next.steps.length >= MAX_WARMUP_STEPS || next.steps.some(s => s.id === step.id)) return
    next.enabled = true
    next.steps.push(step)
  })
  const addMovement = () => {
    const picker = exercisePicker((ex, quick) => {
      const live = useStore.getState().S.routines.find(r => r.id === routineId)
      if (!live) { picker?.close(); return }
      const current = warmupOf(live)
      if (current.steps.length >= MAX_WARMUP_STEPS || current.steps.some(s => s.id === ex.id)) return
      const step = defaultWarmupStep(ex.id)
      if (!step) return
      if (quick) { add(step); return }
      useUI.getState().openSheet(close => <MovementSettings step={step} close={close} onSave={add} />)
    }, { title: t('Add warm-up movement'), ids: WARMUP_IDS })
  }
  const editMovement = index => {
    const step = warmup.steps[index]
    const snapshot = JSON.stringify(step)
    useUI.getState().openSheet(close => <MovementSettings step={step} close={close}
      onSave={saved => edit(next => { if (matches(next.steps[index], snapshot)) next.steps[index] = saved })}
      onRemove={() => edit(next => { if (matches(next.steps[index], snapshot)) next.steps.splice(index, 1) })} />)
  }
  const move = (index, direction) => edit(next => {
    if (!matches(next.steps[index], JSON.stringify(warmup.steps[index]))) return
    const target = index + direction
    if (target < 0 || target >= next.steps.length) return
    const [step] = next.steps.splice(index, 1)
    next.steps.splice(target, 0, step)
  })
  const suggest = () => {
    const state = useStore.getState().S
    const current = state.routines.find(r => r.id === routineId)
    if (!current?.ex?.length) return
    const proposal = warmupProposal(state, current.ex)
    if (!proposal.steps.length) {
      useUI.getState().toast(t('No warm-up suggestions are available for this routine. Add movements manually.'))
      return
    }
    const snapshot = routineSnapshot(current)
    const muscleNames = proposal.targetMuscles.map(muscle => t(MUSCLE_NAME[muscle])).join(', ')
    useUI.getState().openSheet(close => <SuggestionPreview steps={proposal.steps} muscleNames={muscleNames}
      replacing={warmupOf(current).steps.length > 0} close={close} onSave={steps => {
        const state = useStore.getState().S
        const live = state.routines.find(r => r.id === routineId)
        if (!live || routineSnapshot(live) !== snapshot || warmupProposal(state, live.ex).snapshot !== proposal.snapshot) {
          useUI.getState().toast(t('Plan or equipment changed. Open suggestions again to review an updated warm-up.'))
          return
        }
        useStore.getState().update(s => {
          const routine = s.routines.find(r => r.id === routineId)
          if (routine && routineSnapshot(routine) === snapshot) routine.warmup = { enabled: true, steps: structuredClone(steps) }
        })
      }} />)
  }
  return <section aria-label={t('Guided warm-up')}>
    <div className="row between plan-sec-h">
      <h4 className="sec">{t('Guided warm-up')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addMovement} disabled={warmup.steps.length >= MAX_WARMUP_STEPS}>{t('Add movement')}</Button>
    </div>
    <div className="sect-b">
      <Row icon="sunrise" title={t('Before this workout')} subtitle={t('Follow these movements before your working sets.')}>
        <Switch aria-label={t('Guided warm-up')} checked={warmup.enabled} onChange={enabled => edit(next => { next.enabled = enabled })} />
      </Row>
    </div>
    <Button variant="ghost" icon="sunrise" onClick={suggest} disabled={!routine.ex?.length}
      style={{ width: '100%', justifyContent: 'flex-start', marginTop: 4 }}>{t('Suggest for this routine')}</Button>
    {!!warmup.steps.length && <div className="list" style={{ marginTop: 8 }}>{warmup.steps.map((step, index) => {
      const ex = exOr(step.id)
      return <div className="item" key={`${step.id}-${index}`}>
        <MovementThumb ex={ex} />
        <button type="button" className="grow item-open" onClick={() => editMovement(index)}>
          <span className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</span>
          <span className="ss">{targetText(step)}</span>
        </button>
        <div style={{ display: 'flex', flex: 'none', gap: 2 }}>
          <button className="iconbtn" aria-label={t('Move up')} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="chevronUp" /></button>
          <button className="iconbtn" aria-label={t('Move down')} disabled={index === warmup.steps.length - 1} onClick={() => move(index, 1)}><Icon name="chevronDown" /></button>
        </div>
      </div>
    })}</div>}
    <div className="small dim" style={{ margin: '8px 2px 16px' }}>
      {!warmup.steps.length ? t('Add movements to build a guided warm-up.')
        : !warmup.enabled ? t('Warm-up is off. Your movements are saved for later.')
        : warmup.steps.length >= MAX_WARMUP_STEPS ? t('Up to {0} movements per warm-up.', MAX_WARMUP_STEPS) : null}
    </div>
  </section>
}
