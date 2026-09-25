// The PlanRule form. Controlled: `rule` in, a whole new rule out through onChange. It shows
// validatePlanRule's first error but decides nothing about what a rule means — that is
// lib/prescription's job.
import { useState } from 'react'
import Icon from './Icon.jsx'
import Stepper from './Stepper.jsx'
import { Button, Row, Segmented, SelectButton, SelectRow, Switch } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { INCREMENT_TYPES, INCREMENTING_GATES, PRESETS, PRESET_IDS, defaultPlanRule, rptOffsets, validatePlanRule } from '../lib/prescription/index.js'

export const PRESET_LABEL = {
  manual: 'Manual', autoregulated: 'Autoregulated', linear: 'Linear', greyskull: 'Greyskull LP',
  double: 'Double progression', triple: 'Triple progression', duration: 'Duration', hold_seconds: 'Timed hold progression',
  bodyweight_ladder: 'Bodyweight ladder', pyramid: 'Pyramid', reverse_pyramid: 'Reverse pyramid', five_three_one: '5/3/1'
}
export const PRESET_HINT = {
  manual: 'You set every value; nothing changes on its own.',
  autoregulated: 'You pick the load by feel each session; nothing is advanced for you.',
  linear: 'Add a fixed amount of weight after every successful session.',
  greyskull: 'Add weight when you hit the target; the last set is an AMRAP.',
  double: 'Reach the top of the rep or time range, then add weight and start again.',
  triple: 'Fill sets and reps up to the top of the range, then add weight.',
  duration: 'Hold or work for time; you set the seconds each session.',
  hold_seconds: 'Hold for time; the target seconds go up each time you reach the longest time.',
  bodyweight_ladder: 'Build reps and sets, then move to a harder variation.',
  pyramid: 'Sets climb in weight while reps go down.',
  reverse_pyramid: 'Heaviest set first, then lighter sets with more reps.',
  five_three_one: 'Wendler cycle: four weeks of percentages of your training max.',
}
const INCREMENT_LABEL = {
  absolute: 'Fixed amount', current_load_percent: '% of current load', snapshot_1rm_percent: '% of 1RM',
  target_load_percent: '% of target', percentage_points: 'Percentage points'
}
const METRIC_LABEL = {
  target_load: 'Reach the target load', max_sets: 'Reach the most sets', max_reps: 'Reach the most reps',
  max_duration: 'Reach the longest duration', cycle_count: 'Complete cycles', training_max: 'Reach a training max',
  difficulty_rung: 'Reach the final variation'
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

const withoutLoadTo = ({ loadTo, ...rest }) => rest

export default function RuleEditor({ rule, unit, effort, onChange }) {
  const def = PRESETS[rule.preset]
  const p = rule.parameters
  const s = rule.special || {}
  const loaded = INCREMENTING_GATES.includes(def.gate)
  const step = rule.rounding.step ?? (unit === 'lb' ? 5 : 2.5)
  const timed = !!p.durationSeconds
  const supportsTime = !['duration', 'hold_seconds', 'bodyweight_ladder', 'five_three_one'].includes(rule.preset)
  const { errors } = validatePlanRule(rule)
  const set = patch => onChange({ ...rule, ...patch })
  const setParams = patch => set({ parameters: { ...p, ...patch } })
  const setSpecial = patch => set({ special: { ...s, ...patch } })
  const setTargetMode = mode => {
    if (mode === 'time') return setParams({ durationSeconds: p.durationSeconds || (def.ranges.durationSeconds === 'range' ? { min: 45, max: 60 } : { min: 45, max: 45 }) })
    const { durationSeconds, ...parameters } = p
    set({ parameters })
  }

  const choosePreset = preset => onChange({ ...defaultPlanRule(preset, { id: rule.id, exerciseId: rule.exerciseId, routineId: rule.routineId, unit }), revision: rule.revision })
  // Defaults per the spec: absolute increments for absolute loads, percentage points for percent loads.
  // loadTo: the load range's high end, or undefined for a fixed load.
  const setLoad = (load, loadTo) => set({
    parameters: { ...withoutLoadTo(p), load, ...(loadTo ? { loadTo } : {}) },
    ...(loaded && load.mode === 'percent_1rm' ? { increment: { type: 'percentage_points', value: 2.5 } } : {}),
    ...(load.mode !== 'percent_1rm' && rule.increment.type === 'percentage_points' ? { increment: { type: 'absolute', value: step, unit } } : {})
  })
  const has = metric => rule.completion.some(c => c.metric === metric)
  const toggleMetric = (metric, on) => set({
    completion: on
      ? [...rule.completion, { metric, target: metric === 'cycle_count' ? 4 : metric === 'training_max' ? (s.trainingMax?.value ?? 100) : metric === 'max_duration' && rule.preset === 'hold_seconds' ? 120 : null }]
      : rule.completion.filter(c => c.metric !== metric)
  })
  const setMetricTarget = (metric, target) => set({ completion: rule.completion.map(c => (c.metric === metric ? { ...c, target } : c)) })
  const setOffsets = offsets => onChange({ ...rule, parameters: { ...p, sets: p.sets.min === p.sets.max ? { min: offsets.length, max: offsets.length } : p.sets }, special: { ...s, offsets } })
  const setOffset = (i, patch) => setOffsets(s.offsets.map((x, j) => (j === i ? patch(x) : x)))
  // A copied set keeps its place in the ladder: with per-set reps it also climbs two reps.
  const grown = o => ({ ...o, ...(o.reps ? { reps: o.reps + 2 } : {}) })
  const applyRpt = () => onChange({ ...rule, parameters: { ...p, reps: { min: 6, max: 6 } }, special: { ...s, offsets: rptOffsets(s.offsets.length, 6) } })
  const incrementTypes = INCREMENT_TYPES.filter(type => type !== 'seconds' && (type === 'percentage_points') === (p.load.mode === 'percent_1rm'))

  const stopSummary = rule.completion.length ? String(rule.completion.length) : t('None')

  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <SelectRow title={t('Progression')} sheetTitle={t('Progression')} value={rule.preset} onChange={choosePreset}
        options={PRESET_IDS.map(id => ({ value: id, label: t(PRESET_LABEL[id]), subtitle: t(PRESET_HINT[id]) }))} />
    </div>

    {loaded && <div style={{ marginTop: 22, marginBottom: 14 }}>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow title={t('Increase load by')} sheetTitle={t('Increase load by')} value={rule.increment.type}
          onChange={type => set({ increment: type === 'absolute' ? { type, value: step, unit } : { type, value: 2.5 } })}
          options={incrementTypes.map(type => ({ value: type, label: t(INCREMENT_LABEL[type]) }))} />
      </div>
      <div className="row cfgrow">
        <Stepper value={rule.increment.value} step={rule.increment.type === 'absolute' ? step : 0.5} unit={rule.increment.type === 'absolute' ? unit : '%'}
          onChange={value => set({ increment: { ...rule.increment, value } })} />
      </div>
    </div>}

    {rule.preset === 'hold_seconds' && <div className="row cfgrow" style={{ marginTop: 22, marginBottom: 14 }}>
      <Stepper label={t('Seconds added per step')} value={rule.increment.value} step={5} unit="s" decimal={false}
        onChange={value => set({ increment: { type: 'seconds', value } })} />
    </div>}

    <Disclosure title={t('Stop progressing when all of these are met')} value={stopSummary}>
      {def.metrics.map(metric => <div key={metric}>
        <Row title={t(timed && metric === 'max_reps' ? METRIC_LABEL.max_duration : METRIC_LABEL[metric])}><Switch checked={has(metric)} onChange={on => toggleMetric(metric, on)} /></Row>
        {has(metric) && (metric === 'cycle_count' || metric === 'training_max' || (metric === 'max_duration' && rule.preset === 'hold_seconds')) && <div className="row cfgrow">
          <Stepper value={rule.completion.find(c => c.metric === metric).target} step={metric === 'cycle_count' ? 1 : metric === 'max_duration' ? 5 : step}
            unit={metric === 'max_duration' ? 's' : undefined} decimal={metric === 'training_max'} onChange={v => setMetricTarget(metric, v)} />
        </div>}
      </div>)}
    </Disclosure>

    <h4 className="sec">{t('Target')}</h4>
    {rule.preset !== 'five_three_one' && <RangeField key={'sets' + rule.preset} label={t('Sets')} value={p.sets} policy={def.ranges.sets} onChange={sets => setParams({ sets })} />}
    {supportsTime && <div className="sect-b" style={{ marginBottom: 14 }}>
      <Segmented value={timed ? 'time' : 'reps'} onChange={setTargetMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    {rule.preset !== 'five_three_one' && (timed
      ? <RangeField key={'sec' + rule.preset} label={t('Seconds')} value={p.durationSeconds} step={5} policy={def.ranges.durationSeconds} onChange={durationSeconds => setParams({ durationSeconds })} />
      : <RangeField key={'reps' + rule.preset} label={t('Reps')} value={p.reps} policy={def.ranges.reps} onChange={reps => setParams({ reps })} />)}
    {rule.preset !== 'five_three_one' && <LoadField key={rule.preset} label={s.offsets ? t('Anchor load') : t('Starting load')} value={p.load} upTo={p.loadTo} rangeable={def.ranges.load === 'range'}
      unit={unit} step={step} noneMode={loaded ? null : 'empty'} onChange={setLoad} />}
    {s.offsets && <div style={{ marginBottom: 14 }}>
      <div className="small dim" style={{ marginBottom: 6 }}>{t('Each set as % of the anchor')}</div>
      {s.offsets.map((o, i) => <div key={i} className="row cfgrow">
        <Stepper label={t('Set {0}', i + 1)} value={o.percentOfAnchor} step={5} unit="%" decimal={false}
          onChange={v => setOffset(i, x => (v === 100 ? { percentOfAnchor: 100 } : { ...x, percentOfAnchor: v }))} />
        {o.percentOfAnchor !== 100 && <Stepper value={o.reps ?? p.reps.min} step={1} unit={t('reps')} decimal={false}
          onChange={reps => setOffset(i, x => ({ ...x, reps }))} />}
      </div>)}
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Button size="xs" onClick={() => setOffsets(rule.preset === 'pyramid' ? [grown(s.offsets[0]), ...s.offsets] : [...s.offsets, grown(s.offsets.at(-1))])}>{t('Add set')}</Button>
        <Button size="xs" disabled={s.offsets.length <= 1} onClick={() => setOffsets(rule.preset === 'pyramid' ? s.offsets.slice(1) : s.offsets.slice(0, -1))}>{t('Remove set')}</Button>
        {rule.preset === 'reverse_pyramid' && <Button size="xs" onClick={applyRpt}>{t('Apply RPT')}</Button>}
        {s.offsets.some(o => o.reps) && <Button size="xs" onClick={() => setOffsets(s.offsets.map(({ reps, ...o }) => o))}>{t('Same reps every set')}</Button>}
      </div>
    </div>}

    {rule.preset === 'five_three_one' && <div style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="small dim">{t('Training max')}</span>
        <Segmented value={s.trainingMax.mode}
          onChange={mode => setSpecial({ trainingMax: mode === 'direct' ? { mode, value: unit === 'lb' ? 225 : 100, unit } : { mode } })}
          options={[{ value: 'ninety_percent_1rm', label: t('90% of 1RM') }, { value: 'direct', label: unit }]} />
      </div>
      {s.trainingMax.mode === 'direct' && <div className="row cfgrow">
        <Stepper value={s.trainingMax.value} step={step} unit={unit} onChange={value => setSpecial({ trainingMax: { ...s.trainingMax, value } })} />
      </div>}
      <div className="row cfgrow" style={{ marginTop: 8 }}>
        <Stepper label={t('Training max increase per cycle')} value={s.endOfCycleIncrement.value} step={step} unit={unit}
          onChange={value => setSpecial({ endOfCycleIncrement: { value, unit } })} />
      </div>
    </div>}

    {rule.preset === 'bodyweight_ladder' && <textarea className="input" rows={3} style={{ marginBottom: 14 }}
      placeholder={t('Harder variations, one per line (optional)')}
      value={(s.rungs || []).join('\n')}
      onChange={e => setSpecial({ rungs: e.target.value.split('\n') })}
      onBlur={e => setSpecial({ rungs: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} />}

    {def.metrics.includes('target_load') && <LoadField label={t('Target load')} value={rule.target} unit={unit} step={step} noneMode="none" onChange={target => set({ target })} />}
    <div className="row cfgrow" style={{ marginBottom: 14 }}>
      <Stepper label={t('Rest (s)')} value={p.restSeconds} step={15} decimal={false} onChange={restSeconds => setParams({ restSeconds })} />
    </div>
    {effort && <div data-field="RIR" style={{ marginBottom: 14 }}>
      <div className="stp-l" style={{ textAlign: 'left', marginBottom: 6 }}>{t('Target effort (RIR)')}</div>
      <div className="row cfgrow">
        {p.rir ? <>
          <Stepper value={p.rir.min} step={1} decimal={false} onChange={min => setParams({ rir: { min, max: Math.max(min, p.rir.max) } })} />
          <Stepper value={p.rir.max} step={1} decimal={false} onChange={max => setParams({ rir: { min: Math.min(p.rir.min, max), max } })} />
        </> : <span className="small dim" style={{ alignSelf: 'center' }}>{t('None')}</span>}
        <SelectButton className="unit-btn" title={t('Target effort (RIR)')} value={p.rir ? 'rir' : ''}
          onChange={v => setParams({ rir: v ? { min: 1, max: 3 } : undefined })}
          options={[{ value: '', label: t('None') }, { value: 'rir', label: 'RIR' }]} />
      </div>
      {p.rir && <div className="small dim" style={{ marginTop: 6 }}>{t('Load only goes up if your hardest set left at least this many reps in reserve.')}</div>}
    </div>}

    {errors.length > 0 && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '10px 0 14px' }}>{errors[0]}</div>}
  </>
}
