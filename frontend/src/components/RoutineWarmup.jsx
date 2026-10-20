import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { WARMUP_IDS, MAX_WARMUP_STEPS, normalizeWarmup, defaultWarmupStep } from '../../../api/training/guided-warmup.js'
import { exercisePicker } from '../sheets.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button, Row, Section, Segmented, Stepper, Switch } from './ui.jsx'

const warmupOf = routine => normalizeWarmup(routine?.warmup) || { enabled: false, steps: [] }
const matches = (step, snapshot) => step && JSON.stringify(step) === snapshot

function MovementSettings({ step, close, onSave, onRemove }) {
  const [mode, setMode] = useState(step.mode)
  const [sec, setSec] = useState(step.sec || 30)
  const [reps, setReps] = useState(step.reps || 10)
  const [perSide, setPerSide] = useState(step.perSide === true)
  const ex = exOr(step.id)
  const save = () => {
    const target = Math.round(mode === 'time' ? sec : reps) || 0
    onSave({ id: step.id, mode, ...(mode === 'time' ? { sec: Math.max(5, Math.min(180, target)) } : { reps: Math.max(1, Math.min(50, target)) }), ...(perSide ? { perSide: true } : {}) })
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
          ? <Stepper value={sec} min={5} max={180} step={5} decimal={false} unit={t('s')} onChange={setSec} />
          : <Stepper value={reps} min={1} max={50} decimal={false} onChange={setReps} />}
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
    {!!warmup.steps.length && <div className="list" style={{ marginTop: 8 }}>{warmup.steps.map((step, index) => {
      const ex = exOr(step.id)
      const target = step.mode === 'time' ? t('{0} s', step.sec) : t('{0} reps', step.reps)
      return <div className="item" key={`${step.id}-${index}`}>
        <Thumb ex={ex} />
        <button type="button" className="grow item-open" onClick={() => editMovement(index)}>
          <span className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</span>
          <span className="ss">{target}{step.perSide ? ' · ' + t('Per side') : ''}</span>
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
        : warmup.steps.length >= MAX_WARMUP_STEPS ? t('Up to 8 movements per warm-up.') : null}
    </div>
  </section>
}
