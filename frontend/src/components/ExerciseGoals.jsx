import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, NumberField, TextField, Segmented, SelectRow, Section, Row, Switch } from './ui.jsx'
import LineChart from './LineChart.jsx'
import { exercisePicker, confirmSheet } from '../sheets.jsx'
import { EXIDX, isAssisted } from '../lib/exercises.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { fmtNum, fmtDate, isoOf, uid } from '../lib/format.js'
import { formulaOf } from '../lib/onerm.js'
import { currentDbLoad } from '../lib/dumbbells.js'
import { GOAL_TYPES, goalsOf, goalProgress, repeatGoal, goalKg, goalWeight, goalValue, goalUnit, validGoal, visibleGoals } from '../lib/exercise-goals.js'
import './exercise-goals.css'

const update = fn => useStore.getState().update(fn)
const nameOf = g => exerciseNameFor(EXIDX[g.exerciseId] || { n: g.exerciseName || g.exerciseId })
const typeOptions = () => Object.entries(GOAL_TYPES).map(([value, label]) => ({ value, label: t(label) }))
const show = (g, n, unit) => n == null ? '–' : fmtNum(goalValue(g, n, unit))
const goalDate = (date, timestamp) => fmtDate(date || isoOf(new Date(timestamp)), false, true)
const achievementsOf = g => Array.isArray(g.achievements) ? g.achievements : []
const targetNameOf = g => typeof g.name === 'string' ? g.name : ''
const waitingText = p => p.waiting ? t('Waiting for next session') : !p.baseline ? t('Waiting for first set') : ''
function cardLabel(goal, name, progress, unit, indicator) {
  const completion = progress.completion || achievementsOf(goal).at(-1)
  return [name, targetNameOf(goal), description(goal, unit),
    `${t('Best since starting')}: ${show(goal, progress.best?.y, unit)} ${goalUnit(goal, unit)}`,
    `${t('Goal')}: ${show(goal, goal.target, unit)} ${goalUnit(goal, unit)}`,
    t('{0}% of gap closed', Math.round(progress.percent)),
    indicator && goal.type === 'e1rm' && progress.current != null && `${t('Current e1RM (decay-adjusted)')}: ${show(goal, progress.current, unit)} ${unit}`,
    completion && `${t(progress.achieved ? 'Achieved' : 'Previously achieved')} · ${goalDate(completion.d || completion.date, completion.t || completion.completedAt)}`,
    waitingText(progress)].filter(Boolean).join('. ')
}
function GoalStatus({ goal, progress, unit }) {
  const previous = achievementsOf(goal).at(-1)
  return <div className="exercise-goal-status small muted">
    {progress.completion && <span className="exercise-goal-achieved">{t('Achieved')} · {goalDate(progress.completion.d, progress.completion.t)}</span>}
    {!progress.achieved && previous && <span className="exercise-goal-achieved">{t('Previously achieved')} · {goalDate(previous.date, previous.completedAt)}</span>}

  </div>
}
function GoalBar({ goal, progress, unit, indicator }) {
  const visible = indicator && goal.type === 'e1rm' && progress.current != null
  const start = progress.baseline?.y || 0
  const position = Math.max(0, Math.min(100, goal.target > start ? (progress.current - start) / (goal.target - start) * 100 : progress.current / goal.target * 100))
  return <div className={'exercise-goal-bar' + (visible ? ' has-indicator' : '')}>
    <div className="exercise-goal-track" role="progressbar" aria-label={t('Goal progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)} aria-valuetext={t('{0}% of gap closed', Math.round(progress.percent))}><span className={progress.achieved ? 'is-achieved' : undefined} style={{ width: progress.percent + '%' }} /></div>
    {visible && <span className="exercise-goal-marker" style={{ left: position + '%' }} aria-label={t('Current e1RM (decay-adjusted)') + ': ' + show(goal, progress.current, unit) + ' ' + unit}><span style={{ transform: `translateX(-${position}%)` }}>{show(goal, progress.current, unit)} {unit}</span></span>}
  </div>
}
function description(g, unit) {
  if (g.type === 'weight') return t('Weight for {0} reps', g.reps)
  if (g.type === 'reps') return t('Reps at {0} {1}', fmtNum(goalWeight(g.weightKg, unit)), unit)
  if (g.type === 'time') return t('Hold at {0} {1}', fmtNum(goalWeight(g.weightKg, unit)), unit)
  return t('Estimated 1RM')
}

function GoalForm({ existing, close }) {
  const S = useStore(s => s.S)
  const [exercise, setExercise] = useState(existing?.exerciseId || '')
  const [targetName, setTargetName] = useState(existing ? targetNameOf(existing) : '')
  const [type, setType] = useState(existing?.type || 'e1rm')
  const [target, setTarget] = useState(existing ? goalValue(existing, existing.target, S.unit) : null)
  const [reps, setReps] = useState(existing?.reps || 5)
  const [weight, setWeight] = useState(goalWeight(existing?.weightKg || 0, S.unit))
  const [deadline, setDeadline] = useState(existing?.deadline || '')
  const [error, setError] = useState('')
  const draft = { ...(existing || {}), exerciseId: exercise, exerciseName: EXIDX[exercise]?.n || existing?.exerciseName,
    name: targetName.trim().slice(0, 80), type, target: ['e1rm', 'weight'].includes(type) ? goalKg(target, S.unit) : target,
    reps, weightKg: goalKg(weight, S.unit), createdAt: existing?.createdAt || Date.now(), deadline,
    formula: existing?.formula || formulaOf(S), dbLoad: existing?.dbLoad || currentDbLoad(S, exercise) }
  const baseline = validGoal(draft) ? goalProgress(S, draft).baseline : null
  const save = () => {
    if (!validGoal(draft)) { setError(t('Choose an exercise and a positive target.')); return }
    if (isAssisted(exercise) && ['e1rm', 'weight'].includes(type)) { setError(t('For assisted exercises, use reps at a fixed assistance weight.')); return }
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)))) { setError(t('Choose a valid date')); return }
    const id = existing?.id || uid()
    if (existing && draft.target !== existing.target) delete draft.source
    update(s => { s.exerciseGoals = { ...s.exerciseGoals, [id]: { ...draft, _ts: Date.now() } } })
    close()
  }
  return <div className="exercise-goal-form">
    <h2>{t(existing ? 'Edit goal' : 'New goal')}</h2>
    <Section>
      <Row title={t('Exercise')} value={exercise ? nameOf(draft) : t('Choose exercise')} accessory={existing ? 'none' : 'chevron'} className="lrow-stack-value" onClick={existing ? undefined : () => { const picker = exercisePicker(ex => { setExercise(ex.id); picker.close() }) }} />
      {!existing ? <SelectRow title={t('Goal type')} value={type} options={typeOptions()} onChange={value => { setType(value); setTarget(null) }} /> : <Row title={t('Goal type')} value={description(draft, S.unit)} />}
      <Row title={t('Target')}><div className="goal-form-number"><NumberField aria-label={t('Target')} value={target} onChange={setTarget} nullable decimal={type !== 'reps'} placeholder="–" /><span className="muted">{goalUnit(draft, S.unit)}</span></div></Row>
      {type === 'weight' && <Row title={t('Required reps')}><div className="goal-form-number"><NumberField aria-label={t('Required reps')} decimal={false} value={reps} onChange={setReps} disabled={!!existing} /></div></Row>}
      {['reps', 'time'].includes(type) && <Row title={t('Weight')} subtitle={t('Use 0 for bodyweight without added load.')}><div className="goal-form-number"><NumberField aria-label={t('Weight')} value={weight} onChange={setWeight} disabled={!!existing} /><span className="muted">{S.unit}</span></div></Row>}
    </Section>
    <Section>
      <Row title={t('Target name (optional)')} className="goal-form-text"><TextField aria-label={t('Target name (optional)')} value={targetName} maxLength={80} onChange={e => setTargetName(e.target.value)} /></Row>
      <Row title={t('Target date (optional)')} className="goal-form-date"><TextField aria-label={t('Target date (optional)')} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></Row>
    </Section>
    <p className="sect-f">{baseline ? t('Starting point: {0} {1}', show(draft, baseline.y, S.unit), goalUnit(draft, S.unit)) : t('Your first qualifying set will establish the starting point.')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="goal-form-actions"><Button onClick={close}>{t('Cancel')}</Button><Button variant="primary" onClick={save}>{t('Save goal')}</Button></div>
  </div>
}
const editGoal = goal => useUI.getState().openSheet(close => <GoalForm existing={goal} close={close} />)

function GoalDetail({ id, close }) {
  const S = useStore(s => s.S)
  const goal = goalsOf(S).find(g => g.id === id)
  const progress = useMemo(() => goal ? goalProgress(S, goal) : null, [S, goal])
  if (!goal) return <><p>{t('Goal removed')}</p><Button onClick={close}>{t('Close')}</Button></>
  const unit = goalUnit(goal, S.unit)
  const points = progress.points.map(p => ({ ...p, y: goalValue(goal, p.y, S.unit) }))
  return <div>
    <h2>{nameOf(goal)}</h2><p className="muted small">{description(goal, S.unit)}</p>
    {targetNameOf(goal) && <p className="exercise-goal-name">{targetNameOf(goal)}</p>}
    <div className="row between"><b>{show(goal, progress.best?.y, S.unit)} {unit}</b><span>{t('Goal')}: {show(goal, goal.target, S.unit)} {unit}</span></div>
    <LineChart points={points} unit={unit} goal={goalValue(goal, goal.target, S.unit)} />
    <dl className="exercise-goal-facts">
      <div><dt>{t('Starting point')}</dt><dd>{show(goal, progress.baseline?.y, S.unit)} {unit}{progress.baseline?.d && <> · {fmtDate(progress.baseline.d, true)}</>}</dd></div>
      <div><dt>{t('Best since starting')}</dt><dd>{show(goal, progress.best?.y, S.unit)} {unit}{progress.best?.d && <> · {fmtDate(progress.best.d, true)}</>}</dd></div>
      <div><dt>{t('Latest session')}</dt><dd>{show(goal, progress.latest?.y, S.unit)} {unit}</dd></div>
      <div><dt>{t('Target date')}</dt><dd>{goal.deadline ? fmtDate(goal.deadline) : t('No deadline')}</dd></div>
    </dl>
    <p className="small muted">{progress.repeating ? t('Only sessions after restarting count toward this goal. Earlier history stays visible.') : t('Progress runs from your first qualifying session to your best result.')}</p>
    {progress.repeating && <p className="small muted">{t('Restarted')} · {goalDate(null, goal.attemptStartedAt)}</p>}
    <GoalStatus goal={goal} progress={progress} unit={S.unit} />
    {progress.baseline && !progress.achieved && <p className="small">{t('{0}% of gap closed', Math.round(progress.percent))}</p>}

    {goal.type === 'e1rm' && <p className="small muted">{t('Estimated from logged sets, not a verified single-rep lift.')} · {goal.formula || formulaOf(S)}</p>}
    {goal.type === 'e1rm' && <p className="small muted">{t('Decay: 14-day grace period, 28-day half-life, 50% floor.')}</p>}
    {achievementsOf(goal).length > 0 && <Section><h3>{t('Previous achievements')}</h3>{achievementsOf(goal).map((a, i) => <p className="small" key={i}>{targetNameOf(a) && <>{targetNameOf(a)} · </>}{goalDate(a.date, a.completedAt)} · {t('Goal')}: {show(goal, a.target, S.unit)} {unit}</p>)}</Section>}
    {goal.source?.url?.startsWith('https://strengthlevel.com/strength-standards/') && <p className="small muted"><a href={goal.source.url} target="_blank" rel="noreferrer">Strength Level</a> · {goal.source.note}</p>}
    <div className="row" style={{ flexWrap: 'wrap' }}>
      {progress.achieved && <Button variant="tinted" onClick={() => { update(s => { const next = repeatGoal(s, s.exerciseGoals[id]); if (next) { s.exerciseGoals[id] = next; if (s.goalStatus === 'achieved' || s.goalStatus === 'archived') s.goalStatus = 'active' } }) }}>{t('Achieve again')}</Button>}
      <Button onClick={() => editGoal(goal)}>{t('Edit goal')}</Button>
      <Button onClick={() => { update(s => { s.exerciseGoals[id] = { ...s.exerciseGoals[id], archived: !goal.archived, _ts: Date.now() } }); close() }}>{t(goal.archived ? 'Restore goal' : 'Archive goal')}</Button>
      <Button onClick={() => confirmSheet({ title: t('Delete goal?'), message: t('Your workout history will be kept.'), onConfirm: () => { update(s => { s.exerciseGoals[id] = { _ts: Date.now() } }); close() } })}>{t('Delete')}</Button>
    </div>
  </div>
}

export default function ExerciseGoals() {
  const S = useStore(s => s.S)
  const filtersOpen = S.goalFiltersOpen || false
  const status = S.goalStatus || 'active'
  const type = S.goalType || 'all'
  const sort = S.goalSort || 'added'
  const setStatus = value => update(s => { s.goalStatus = value })
  const setType = value => update(s => { s.goalType = value })
  const setSort = value => update(s => { s.goalSort = value })
  const compact = S.goalView !== 'normal'
  const rows = useMemo(() => goalsOf(S).map(goal => ({ goal, name: nameOf(goal), progress: goalProgress(S, goal) })), [S])
  const shown = visibleGoals(rows, { status, type, sort })
  return <section className="exercise-goals">
    <div className="row between"><h2>{t('Your goals')}</h2><Button size="sm" variant="tinted" icon="plus" onClick={() => editGoal()}>{t('Add goal')}</Button></div>
    <div className="row between exercise-goal-toolbar">
      <Segmented value={compact ? 'compact' : 'normal'} onChange={v => update(s => { s.goalView = v })} options={[{ value: 'normal', label: t('Normal') }, { value: 'compact', label: t('Compact') }]} />
      <Button size="sm" aria-expanded={filtersOpen} aria-controls="exercise-goal-filters" onClick={() => update(s => { s.goalFiltersOpen = !filtersOpen })}>{t('Sort / filter')}{type !== 'all' || status !== 'active' ? ' ·' : ''}</Button>
    </div>
    {filtersOpen && <Section className="exercise-goal-filters"><div id="exercise-goal-filters">
      <SelectRow title={t('Sort by')} value={sort} onChange={setSort} options={[{ value: 'added', label: t('Recently added') }, { value: 'progress', label: t('Closest to goal') }, { value: 'name', label: t('Exercise A–Z') }, { value: 'deadline', label: t('Target date') }]} />
      <SelectRow title={t('Status')} value={status} onChange={setStatus} options={['active', 'achieved', 'archived', 'all'].map((value, i) => ({ value, label: [t('Active'), t('Achieved'), t('Archived'), t('All')][i] }))} />
      <SelectRow title={t('Goal type')} value={type} onChange={setType} options={[{ value: 'all', label: t('All types') }, ...typeOptions()]} />
      <Row title={t('Current strength')}><Switch aria-label={t('Current strength')} checked={S.goalE1rmIndicator !== false} onChange={v => update(s => { s.goalE1rmIndicator = v })} /></Row>
      <Button onClick={() => { setStatus('active'); setType('all'); setSort('added') }}>{t('Reset filters')}</Button>
    </div></Section>}
    <div className={'exercise-goal-list' + (compact ? ' is-compact' : '')} aria-live="polite">
      {shown.map(({ goal, name, progress }) => <button key={goal.id} className="exercise-goal" data-goal-type={goal.type} aria-label={cardLabel(goal, name, progress, S.unit, S.goalE1rmIndicator !== false)} onClick={() => useUI.getState().openSheet(close => <GoalDetail id={goal.id} close={close} />)}>
        <div className="exercise-goal-top"><div className="exercise-goal-title"><b>{name}</b>{targetNameOf(goal) && <span className="exercise-goal-name small muted">{targetNameOf(goal)}</span>}<span className="small muted">{description(goal, S.unit)}</span></div><div className="exercise-goal-numbers"><b>{show(goal, progress.best?.y, S.unit)} {goalUnit(goal, S.unit)}</b><span className="small muted">{t('Goal')}: {show(goal, goal.target, S.unit)} {goalUnit(goal, S.unit)}</span><GoalStatus goal={goal} progress={progress} unit={S.unit} /></div></div>
        <GoalBar goal={goal} progress={progress} unit={S.unit} indicator={S.goalE1rmIndicator !== false} />
        {compact && !progress.achieved && waitingText(progress) && <div className="exercise-goal-waiting small muted">{waitingText(progress)}</div>}
        {!compact && !progress.achieved && <div className="row between small muted"><span>{progress.waiting ? t('Waiting for next session') : progress.baseline ? t('{0}% of gap closed', Math.round(progress.percent)) : t('Waiting for first set')}</span><span>{progress.remaining != null && t('{0} {1} to go', show(goal, progress.remaining, S.unit), goalUnit(goal, S.unit))}</span></div>}
      </button>)}
    </div>
    {!shown.length && <p className="empty">{rows.length ? t('No goals match these filters.') : t('Choose an exercise and set your first goal.')}</p>}
    {status === 'active' && rows.some(r => r.progress.achieved && !r.goal.archived) && <Button onClick={() => setStatus('achieved')}>{t('Achieved')} · {rows.filter(r => r.progress.achieved && !r.goal.archived).length}</Button>}
    {status !== 'active' && <Button onClick={() => setStatus('active')}>{t('Active goals')}</Button>}
  </section>
}
