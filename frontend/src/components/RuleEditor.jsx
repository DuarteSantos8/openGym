// The PlanRule form. Controlled: `rule` in, a whole new rule out through onChange. It edits a
// template's numbers (planOptions) and lets the template rebuild the program (editPlan); it shows
// validatePlanRule's first error but decides nothing about what a rule means — that is
// lib/prescription's job. A program edited past its template is shown, not edited.
import { useState } from 'react'
import Icon from './Icon.jsx'
import Stepper from './Stepper.jsx'
import { Button, Row, Segmented, SelectButton, SelectRow, Switch } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { durationSheet } from './DurationWheel.jsx'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import { pyramidLabel, PYRAMID_PRESETS, PYRAMID_MAX, MAX_PYRAMID_SETS } from '../lib/pyramid.js'
import { INCREMENT_TYPES, PRESETS, PRESET_IDS, defaultDeload, defaultPlanRule, editPlan, isTemplateRule, planOptions, pyramidDirection, rptOffsets, validatePlanRule } from '../lib/prescription/index.js'

export const PRESET_LABEL = {
  autoregulated: 'Autoregulated', linear: 'Linear', greyskull: 'Greyskull LP',
  double: 'Double progression', triple: 'Triple progression', hold_seconds: 'Timed hold progression',
  bodyweight_ladder: 'Bodyweight ladder', pyramid_reps: 'Pyramid sets', pyramid: 'Pyramid', five_three_one: '5/3/1',
  top_set_backoff: 'Top set and back-off', accumulation_intensification: 'Accumulation then intensification', density: 'Density'
}
export const PRESET_HINT = {
  autoregulated: 'You set every value by feel (reps, load or seconds); nothing is advanced for you.',
  linear: 'Add a fixed amount of weight after every successful session.',
  greyskull: 'Add weight when you hit the target; the last set is an AMRAP.',
  double: 'Reach the top of the rep or time range, then add weight and start again.',
  triple: 'Fill sets and reps up to the top of the range, then add weight.',
  hold_seconds: 'Hold for time; the target seconds go up each time you reach the longest time.',
  bodyweight_ladder: 'Build reps and sets, then move to a harder variation.',
  pyramid_reps: 'A different rep target for each set, e.g. 12 · 8 · 6 · Max · 12.',
  pyramid: 'Sets at different shares of one anchor load, lightest first or heaviest first.',
  five_three_one: 'Wendler cycle: four weeks of percentages of your training max.',
  top_set_backoff: 'One heavy top set, then lighter back-off sets; the top set decides the next load.',
  accumulation_intensification: 'Build reps at a lighter percentage of your training max, then a heavier block of fewer reps.',
  density: 'Same work, a little less rest after every clean session.',
}
const INCREMENT_LABEL = {
  absolute: 'Fixed amount', current_load_percent: '% of current load', snapshot_1rm_percent: '% of 1RM',
  target_load_percent: '% of target', percentage_points: 'Percentage points'
}
const METRIC_LABEL = {
  target_load: 'Reach the target load', max_sets: 'Reach the most sets', max_reps: 'Reach the most reps',
  max_duration: 'Reach the longest duration', cycle_count: 'Complete cycles', training_max: 'Reach a training max',
  difficulty_rung: 'Reach the final variation', rest_floor: 'Reach the shortest rest'
}

// A closed row that shows its current value and opens in place. Kept inline rather than in a
// sub-sheet so the fields stay bound to the live rule.
export function Disclosure({ title, value, children }) {
  const [open, setOpen] = useState(false)
  return <div className={'sect-b disc' + (open ? ' open' : '')} style={{ marginBottom: 14 }}>
    <Row title={title} value={open ? null : value} accessory="chevron" onClick={() => setOpen(o => !o)} />
    {open && <div className="disc-body">{children}</div>}
  </div>
}

// Small button at the end of the input row: opens a single value into from/to, or closes it back.
function RangeToggle({ ranged, onToggle }) {
  const label = ranged ? t('Fixed') : t('Range')
  return <button type="button" className="iconbtn rng-btn" aria-label={label} title={label} aria-pressed={ranged} onClick={onToggle}>
    <Icon name={ranged ? 'minimize' : 'expand'} />
  </button>
}

// policy (PRESETS[preset].ranges): 'fixed' one value, 'range' from/to, 'either' the planner's
// choice. A fixed value is stored as min === max, so an 'either' field opened to a range keeps
// showing from/to (open) until it is toggled back.
function RangeField({ label, value, step = 1, policy = 'range', onChange }) {
  const [open, setOpen] = useState(false)
  const ranged = policy === 'range' || (policy === 'either' && (open || value.min !== value.max))
  const toggle = () => { if (ranged) onChange({ min: value.min, max: value.min }); setOpen(!ranged) }
  return <div data-field={label} style={{ marginBottom: 14 }}>
    <div className="row cfgrow">
      {ranged ? <>
        <Stepper label={t('{0} from', label)} value={value.min} step={step} decimal={false} onChange={min => onChange({ min, max: Math.max(min, value.max) })} />
        <Stepper label={t('{0} to', label)} value={value.max} step={step} decimal={false} onChange={max => onChange({ min: Math.min(value.min, max), max })} />
      </> : <Stepper label={label} value={value.min} step={step} decimal={false} onChange={v => onChange({ min: v, max: v })} />}
      {policy === 'either' && <RangeToggle ranged={ranged} onToggle={toggle} />}
    </div>
  </div>
}

// `value` is the low end; `upTo` the optional high end (loadTo), offered when `rangeable`.
function LoadField({ label, value, upTo, rangeable = false, unit, step, noneMode, onChange }) {
  const [open, setOpen] = useState(false)
  const modes = [
    ...(noneMode ? [{ value: noneMode, label: t('None') }] : []),
    { value: 'absolute', label: unit },
    { value: 'percent_1rm', label: t('% 1RM') }
  ]
  const loaded = value.mode === 'absolute' || value.mode === 'percent_1rm'
  const ranged = rangeable && loaded && (open || !!upTo)
  // Changing the mode drops the high end: it must share the low end's mode.
  const setMode = mode => { setOpen(false); onChange(mode === 'absolute' ? { mode, value: 0, unit } : mode === 'percent_1rm' ? { mode, percent: 70 } : { mode }) }
  const toggle = () => { setOpen(!ranged); onChange(value, ranged ? undefined : { ...value }) }
  const key = value.mode === 'absolute' ? 'value' : 'percent'
  // Keep low ≤ high: raising the low end lifts the high end, lowering the high end drags the low one.
  const setLow = v => onChange({ ...value, [key]: v }, upTo && { ...upTo, [key]: Math.max(v, upTo[key]) })
  const setHigh = v => onChange({ ...value, [key]: Math.min(value[key], v) }, { ...(upTo ?? value), [key]: v })
  const stepper = (v, set) => <Stepper value={v} step={key === 'value' ? step : 2.5} unit={key === 'value' ? unit : '%'} onChange={set} />
  return <div data-field={label} style={{ marginBottom: 14 }}>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span className="stp-l" style={{ textAlign: 'left' }}>{label}</span>
    </div>
    <div className="row cfgrow">
      {loaded ? stepper(value[key], setLow) : <span className="small dim" style={{ alignSelf: 'center' }}>{t('None')}</span>}
      {ranged && stepper((upTo ?? value)[key], setHigh)}
      <SelectButton className="unit-btn" title={label} value={value.mode} options={modes} onChange={setMode} />
      {rangeable && loaded && <RangeToggle ranged={ranged} onToggle={toggle} />}
    </div>
  </div>
}

// `restDefault`: the exercise takes the profile's rest (`defaultRest`) instead of its own; the wheel's 0:00 says so.
export default function RuleEditor({ rule, unit, effort, assisted = false, bodyweight = false, restDefault = false, defaultRest = 90, onRestDefault, onChange }) {
  const def = PRESETS[rule.preset]
  // The template's numbers (planOptions): the plan's sets, reps, load… and its extras (offsets, rungs…).
  const p = planOptions(rule)
  const loaded = def.steps === 'load'
  const step = rule.rounding.step ?? (unit === 'lb' ? 5 : 2.5)
  const timed = !!p.durationSeconds
  const supportsTime = !['hold_seconds', 'bodyweight_ladder', 'five_three_one', 'pyramid_reps', 'top_set_backoff', 'accumulation_intensification', 'density'].includes(rule.preset)
  const { errors } = validatePlanRule(rule)
  // Every edit is a set of new numbers; the template rebuilds the program from them. null removes an optional one.
  const set = patch => onChange(editPlan(rule, patch))
  const setTargetMode = mode => set({ durationSeconds: mode === 'time' ? p.durationSeconds || (def.ranges.durationSeconds === 'range' ? { min: 45, max: 60 } : { min: 45, max: 45 }) : null })
  const choosePreset = preset => onChange({ ...defaultPlanRule(preset, { id: rule.id, exerciseId: rule.exerciseId, routineId: rule.routineId, unit }), revision: rule.revision })
  const presetRow = <div className="sect-b" style={{ marginBottom: 14 }}>
    <SelectRow title={t('Progression')} sheetTitle={t('Progression')} value={rule.preset} onChange={choosePreset}
      options={PRESET_IDS.filter(id => id !== 'triple' || !bodyweight || (p.load.mode === 'absolute' && p.load.value > 0) || rule.preset === 'triple').map(id => ({ value: id, label: t(PRESET_LABEL[id]), subtitle: t(PRESET_HINT[id]) }))} />
  </div>
  const errorLine = errors.length > 0 && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '10px 0 14px' }}>{errors[0]}</div>
  // A program edited past its template (an import, a future builder) is shown, not edited: rebuilding
  // it from these numbers would drop what the template does not know. Choosing a template replaces it.
  if (!isTemplateRule(rule)) return <>
    <h4 className="sec">{t('Progression')}</h4>
    {presetRow}
    <div className="small dim" style={{ marginBottom: 14 }}>{t('This plan was set up outside the editor. Pick a progression to replace it.')}</div>
    {errorLine}
  </>

  // Defaults: absolute increments for absolute loads, percentage points for percent loads.
  // loadTo: the load range's high end, or undefined for a fixed load.
  const setLoad = (load, loadTo) => set({
    load, loadTo: loadTo ?? null,
    ...(loaded && load.mode === 'percent_1rm' ? { step: { type: 'percentage_points', value: 2.5 } } : {}),
    ...(load.mode !== 'percent_1rm' && p.step?.type === 'percentage_points' ? { step: { type: 'absolute', value: step, unit } } : {})
  })
  const has = metric => p.completion.some(c => c.metric === metric)
  const toggleMetric = (metric, on) => set({
    completion: on
      ? [...p.completion, { metric, target: metric === 'cycle_count' ? 4 : metric === 'training_max' ? (p.trainingMax?.value ?? 100) : metric === 'max_duration' && rule.preset === 'hold_seconds' ? 120 : metric === 'rest_floor' ? p.restFloor : null }]
      : p.completion.filter(c => c.metric !== metric)
  })
  const setMetricTarget = (metric, target) => set({ completion: p.completion.map(c => (c.metric === metric ? { ...c, target } : c)) })
  const setOffsets = offsets => set({ offsets, sets: p.sets.min === p.sets.max ? { min: offsets.length, max: offsets.length } : p.sets })
  const direction = p.offsets && pyramidDirection(p.offsets)
  const setOffset = (i, patch) => setOffsets(p.offsets.map((x, j) => (j === i ? patch(x) : x)))
  // A copied set keeps its place in the ladder: with per-set reps it also climbs two reps.
  const grown = o => ({ ...o, ...(o.reps ? { reps: o.reps + 2 } : {}) })
  const applyRpt = () => set({ reps: { min: 6, max: 6 }, offsets: rptOffsets(p.offsets.length, 6) })
  // Pyramid sets: the list is the prescription, so sets and reps follow it (the rule's validation holds them to it).
  const targets = p.setReps
  const setTargets = (setReps, setRest, setWeights = p.setWeights) => {
    const rest = setRest && setRest.some(v => v > 0) ? setRest.slice(0, setReps.length) : undefined
    const first = setReps.find(v => v !== PYRAMID_MAX)
    set({ sets: { min: setReps.length, max: setReps.length }, reps: { min: first ?? p.reps.min, max: first ?? p.reps.min }, setReps, setRest: rest, setWeights: setWeights?.slice(0, setReps.length) })
  }
  const restAt = i => (p.setRest || [])[i] || 0
  const withRest = (setReps, i, v) => setTargets(setReps, Array.from({ length: setReps.length }, (_, j) => (j === i ? v : restAt(j))))
  const incrementTypes = INCREMENT_TYPES.filter(type => (type === 'percentage_points') === (p.load.mode === 'percent_1rm'))
  const backoff = patch => set({ backoff: { ...p.backoff, ...patch } })
  const intensification = patch => set({ intensification: { ...p.intensification, ...patch } })

  const stopSummary = p.completion.length ? String(p.completion.length) : t('None')

  return <>
    <h4 className="sec">{t('Progression')}</h4>
    {presetRow}
    <div className="small dim" style={{ marginBottom: 14 }}>{t(PRESET_HINT[rule.preset])}</div>

    {loaded && <div style={{ marginTop: 22, marginBottom: 14 }}>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow title={assisted ? t('Reduce assistance by') : t('Increase load by')} sheetTitle={assisted ? t('Reduce assistance by') : t('Increase load by')} value={p.step.type}
          onChange={type => set({ step: type === 'absolute' ? { type, value: step, unit } : { type, value: 2.5 } })}
          options={incrementTypes.map(type => ({ value: type, label: t(INCREMENT_LABEL[type]) }))} />
      </div>
      <div className="row cfgrow">
        <Stepper value={p.step.value} step={p.step.type === 'absolute' ? step : 0.5} unit={p.step.type === 'absolute' ? unit : '%'}
          onChange={value => set({ step: { ...p.step, value } })} />
      </div>
    </div>}

    {def.steps === 'seconds' && <div className="row cfgrow" style={{ marginTop: 22, marginBottom: 14 }}>
      <Stepper label={t('Seconds added per step')} value={p.step.value} step={5} unit="s" decimal={false}
        onChange={value => set({ step: { type: 'seconds', value } })} />
    </div>}

    {rule.preset === 'density' && <div className="row cfgrow" style={{ marginTop: 22, marginBottom: 14 }}>
      <Stepper label={t('Rest taken off per step')} value={p.restStep} step={5} unit="s" decimal={false} onChange={restStep => set({ restStep: Math.max(0, restStep) })} />
      <Stepper label={t('Shortest rest')} value={p.restFloor} step={5} unit="s" decimal={false} onChange={restFloor => set({ restFloor: Math.max(0, restFloor) })} />
    </div>}

    {def.metrics.length > 0 && <Disclosure title={t('Stop progressing when all of these are met')} value={stopSummary}>
      {def.metrics.map(metric => <div key={metric}>
        <Row title={t(timed && metric === 'max_reps' ? METRIC_LABEL.max_duration : METRIC_LABEL[metric])}><Switch checked={has(metric)} onChange={on => toggleMetric(metric, on)} /></Row>
        {has(metric) && (metric === 'cycle_count' || metric === 'training_max' || metric === 'rest_floor' || (metric === 'max_duration' && rule.preset === 'hold_seconds')) && <div className="row cfgrow">
          <Stepper value={p.completion.find(c => c.metric === metric).target} step={metric === 'cycle_count' ? 1 : metric === 'max_duration' || metric === 'rest_floor' ? 5 : step}
            unit={metric === 'max_duration' || metric === 'rest_floor' ? 's' : undefined} decimal={metric === 'training_max'} onChange={v => setMetricTarget(metric, v)} />
        </div>}
      </div>)}
    </Disclosure>}

    {def.stalls && <Disclosure title={t('Back off when stuck')}
      value={p.deload ? t('after {0} · to {1}%', p.deload.after, Math.round(p.deload.factor * 100)) : t('None')}>
      <Row title={t('Back off after repeated misses')}>
        <Switch checked={!!p.deload} onChange={on => set({ deload: on ? defaultDeload(rule.preset) ?? { after: 3, factor: 0.9 } : null })} />
      </Row>
      {p.deload && <>
        <div className="row cfgrow">
          <Stepper label={t('Missed sessions in a row')} value={p.deload.after} step={1} decimal={false}
            onChange={after => set({ deload: { ...p.deload, after: Math.min(10, Math.max(1, after)) } })} />
        </div>
        <div className="row cfgrow">
          <Stepper label={t('Back off to (%)')} value={Math.round(p.deload.factor * 100)} step={5} unit="%" decimal={false}
            onChange={pct => set({ deload: { ...p.deload, factor: Math.min(95, Math.max(50, pct)) / 100 } })} />
        </div>
        <div className="small dim">{t('After this many sessions short of the plan at the same load, the load goes back down and builds up again.')}</div>
      </>}
    </Disclosure>}

    <h4 className="sec">{t('Target')}</h4>
    {!['five_three_one', 'pyramid_reps', 'top_set_backoff'].includes(rule.preset) && <RangeField key={'sets' + rule.preset} label={t('Sets')} value={p.sets} policy={def.ranges.sets} onChange={sets => set({ sets })} />}
    {supportsTime && <div className="sect-b" style={{ marginBottom: 14 }}>
      <Segmented value={timed ? 'time' : 'reps'} onChange={setTargetMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    {!['five_three_one', 'pyramid_reps'].includes(rule.preset) && (timed
      ? <RangeField key={'sec' + rule.preset} label={t('Seconds')} value={p.durationSeconds} step={5} policy={def.ranges.durationSeconds} onChange={durationSeconds => set({ durationSeconds })} />
      : <RangeField key={'reps' + rule.preset} label={rule.preset === 'top_set_backoff' ? t('Top set reps') : t('Reps')} value={p.reps} policy={def.ranges.reps} onChange={reps => set({ reps })} />)}
    {!['five_three_one', 'accumulation_intensification'].includes(rule.preset) && <LoadField key={rule.preset} label={p.offsets || rule.preset === 'top_set_backoff' ? t('Anchor load') : t('Starting load')} value={p.load} upTo={p.loadTo ?? undefined} rangeable={def.ranges.load === 'range'}
      unit={unit} step={step} noneMode={loaded || rule.preset === 'density' ? null : 'empty'} onChange={setLoad} />}
    {rule.preset === 'top_set_backoff' && <div style={{ marginBottom: 14 }}>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow title={t('Decides the next load')} sheetTitle={t('Decides the next load')} value={p.scope} onChange={scope => set({ scope })}
          options={[{ value: 'top', label: t('The top set') }, { value: 'all', label: t('Every set') }]} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Back-off sets')} value={p.backoff.sets} step={1} decimal={false} onChange={sets => backoff({ sets: Math.max(1, sets) })} />
        <Stepper label={t('Back-off reps')} value={p.backoff.reps} step={1} decimal={false} onChange={reps => backoff({ reps: Math.max(1, reps) })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Back-off load (%)')} value={p.backoff.percent} step={5} unit="%" decimal={false} onChange={percent => backoff({ percent: Math.min(100, Math.max(5, percent)) })} />
        <Stepper label={t('Back-off rest (s)')} value={p.backoff.restSeconds} step={15} decimal={false} onChange={restSeconds => backoff({ restSeconds: Math.max(0, restSeconds) })} />
      </div>
    </div>}
    {rule.preset === 'accumulation_intensification' && <div style={{ marginBottom: 14 }}>
      <div className="row cfgrow">
        <Stepper label={t('Accumulation: % of training max')} value={p.accumulation.percent} step={2.5} unit="%" onChange={percent => set({ accumulation: { percent } })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Intensification sets')} value={p.intensification.sets} step={1} decimal={false} onChange={sets => intensification({ sets: Math.max(1, sets) })} />
        <Stepper label={t('Intensification reps')} value={p.intensification.reps} step={1} decimal={false} onChange={reps => intensification({ reps: Math.max(1, reps) })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Intensification: % of training max')} value={p.intensification.percent} step={2.5} unit="%" onChange={percent => intensification({ percent })} />
        <Stepper label={t('Clean sessions to finish')} value={p.intensification.successes} step={1} decimal={false} onChange={successes => intensification({ successes: Math.max(1, successes) })} />
      </div>
      <Row title={t('Start over when done')}><Switch checked={p.end === 'repeat'} onChange={on => set({ end: on ? 'repeat' : 'complete' })} /></Row>
    </div>}
    {targets && <div style={{ marginBottom: 14 }}>
      {/* Presets replace the list (and its rests) in one tap; nothing is saved until Save. */}
      <div className="chips" style={{ marginBottom: 10 }}>
        {PYRAMID_PRESETS.map((preset, k) => <button key={k} type="button" className="chip" onClick={() => setTargets([...preset])}>{pyramidLabel(preset)}</button>)}
      </div>
      {targets.map((v, i) => <div key={i} style={{ marginBottom: 10 }}>
        <div className="row cfgrow" style={{ marginBottom: 4 }}>
          {v === PYRAMID_MAX
            ? <div className="small"><strong>{t('Set {0}', i + 1)}</strong> · {t('Max: as many reps as you can')}</div>
            : <Stepper label={t('Set {0}', i + 1)} value={v} step={1} min={1} decimal={false} onChange={n => setTargets(targets.map((x, j) => (j === i ? n : x)), p.setRest)} />}
          {!bodyweight && <Stepper label={t('Weight ({0})', unit)} value={p.setWeights?.[i] || 0} step={step}
            onChange={v => set({ setWeights: targets.map((_, j) => j === i ? v : p.setWeights?.[j] || 0) })} />}
          <Stepper label={t('Rest (s)')} value={restAt(i)} step={15} decimal={false} onChange={n => withRest(targets, i, n)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button size="sm" variant={v === PYRAMID_MAX ? 'primary' : 'plain'} aria-pressed={v === PYRAMID_MAX}
            onClick={() => setTargets(targets.map((x, j) => (j === i ? (v === PYRAMID_MAX ? p.reps.min : PYRAMID_MAX) : x)), p.setRest)}>{t('Max')}</Button>
          {targets.length > 1 && <Button size="sm" icon="trash" aria-label={t('Remove set')} title={t('Remove set')}
            onClick={() => setTargets(targets.filter((_, j) => j !== i), p.setRest?.filter((_, j) => j !== i), p.setWeights?.filter((_, j) => j !== i))} />}
        </div>
      </div>)}
      <Button size="sm" icon="plus" disabled={targets.length >= MAX_PYRAMID_SETS}
        onClick={() => setTargets([...targets, targets.at(-1)], p.setRest ? [...targets.map((_, j) => restAt(j)), restAt(targets.length - 1)] : undefined)}>{t('Add set')}</Button>
      <div className="small dim" style={{ marginTop: 8 }}>{t('A set left at 0 rest uses the exercise’s rest.')}</div>
    </div>}
    {p.offsets && <div style={{ marginBottom: 14 }}>
      <SelectRow title={t('Direction')} sheetTitle={t('Direction')} value={direction} onChange={d => d !== direction && setOffsets([...p.offsets].reverse())}
        options={[{ value: 'ascending', label: t('Lightest set first') }, { value: 'descending', label: t('Heaviest set first') }]} />
      <div className="small dim" style={{ marginBottom: 6 }}>{t('Each set as % of the anchor')}</div>
      {p.offsets.map((o, i) => <div key={i} className="row cfgrow">
        <Stepper label={t('Set {0}', i + 1)} value={o.percentOfAnchor} step={5} unit="%" decimal={false}
          onChange={v => setOffset(i, x => (v === 100 ? { percentOfAnchor: 100 } : { ...x, percentOfAnchor: v }))} />
        {o.percentOfAnchor !== 100 && <Stepper value={o.reps ?? p.reps.min} step={1} unit={t('reps')} decimal={false}
          onChange={reps => setOffset(i, x => ({ ...x, reps }))} />}
      </div>)}
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Button size="xs" onClick={() => setOffsets(direction === 'ascending' ? [grown(p.offsets[0]), ...p.offsets] : [...p.offsets, grown(p.offsets.at(-1))])}>{t('Add set')}</Button>
        <Button size="xs" disabled={p.offsets.length <= 1} onClick={() => setOffsets(direction === 'ascending' ? p.offsets.slice(1) : p.offsets.slice(0, -1))}>{t('Remove set')}</Button>
        {direction === 'descending' && <Button size="xs" onClick={applyRpt}>{t('Apply RPT')}</Button>}
        {p.offsets.some(o => o.reps) && <Button size="xs" onClick={() => setOffsets(p.offsets.map(({ reps, ...o }) => o))}>{t('Same reps every set')}</Button>}
      </div>
    </div>}

    {p.trainingMax && <div style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="small dim">{t('Training max')}</span>
        <Segmented value={p.trainingMax.mode}
          onChange={mode => set({ trainingMax: mode === 'direct' ? { mode, value: unit === 'lb' ? 225 : 100, unit } : { mode } })}
          options={[{ value: 'ninety_percent_1rm', label: t('90% of 1RM') }, { value: 'direct', label: unit }]} />
      </div>
      {p.trainingMax.mode === 'direct' && <div className="row cfgrow">
        <Stepper value={p.trainingMax.value} step={step} unit={unit} onChange={value => set({ trainingMax: { ...p.trainingMax, value } })} />
      </div>}
      <div className="row cfgrow" style={{ marginTop: 8 }}>
        <Stepper label={t('Training max increase per cycle')} value={p.cycleIncrement.value} step={step} unit={unit}
          onChange={value => set({ cycleIncrement: { value, unit } })} />
      </div>
    </div>}

    {rule.preset === 'bodyweight_ladder' && <textarea className="input" rows={3} style={{ marginBottom: 14 }}
      placeholder={t('Harder variations, one per line (optional)')}
      value={(p.rungs || []).join('\n')}
      onChange={e => set({ rungs: e.target.value.split('\n') })}
      onBlur={e => set({ rungs: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} />}

    {def.metrics.includes('target_load') && <LoadField label={t('Target load')} value={p.target} unit={unit} step={step} noneMode="none" onChange={target => set({ target })} />}
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <Row icon="timer" iconTint="var(--orange)" title={rule.preset === 'density' ? t('Starting rest') : t('Rest for this exercise')} accessory="chevron"
        value={restDefault ? t('Default ({0})', fmtRest(defaultRest)) : fmtRest(p.restSeconds)}
        onClick={() => durationSheet({
          title: t('Rest for this exercise'), value: restDefault ? 0 : p.restSeconds, max: REST_MAX,
          off: t('Default ({0})', fmtRest(defaultRest)),
          footer: t('Rest after each set of this exercise. 0:00 means your default rest.'),
          onDone: v => {
            if (v === 0 && onRestDefault) onRestDefault(true)
            else { set({ restSeconds: v }); onRestDefault?.(false) }
          },
        })} />
    </div>
    {effort && <div data-field="RIR" style={{ marginBottom: 14 }}>
      <div className="stp-l" style={{ textAlign: 'left', marginBottom: 6 }}>{t('Target effort (RIR)')}</div>
      <div className="row cfgrow">
        {p.rir ? <>
          <Stepper value={p.rir.min} step={1} decimal={false} onChange={min => set({ rir: { min, max: Math.max(min, p.rir.max) } })} />
          <Stepper value={p.rir.max} step={1} decimal={false} onChange={max => set({ rir: { min: Math.min(p.rir.min, max), max } })} />
        </> : <span className="small dim" style={{ alignSelf: 'center' }}>{t('None')}</span>}
        <SelectButton className="unit-btn" title={t('Target effort (RIR)')} value={p.rir ? 'rir' : ''}
          onChange={v => set({ rir: v ? { min: 1, max: 3 } : null })}
          options={[{ value: '', label: t('None') }, { value: 'rir', label: 'RIR' }]} />
      </div>
      {p.rir && <div className="small dim" style={{ marginTop: 6 }}>{t('Load only goes up if your hardest set left at least this many reps in reserve.')}</div>}
    </div>}

    {errorLine}
  </>
}
