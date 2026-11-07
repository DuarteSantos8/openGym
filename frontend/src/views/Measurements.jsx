import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import DateField from '../components/DateField.jsx'
import {
  MEASUREMENT_FIELDS, MEASUREMENT_KEYS, emptyMeasurement, enabledMeasurementFields,
  fromMeasurementDisplay, latestMeasurement, measurementEntryHasValues,
  measurementSeries, measurementUnit, measurementValue, normalizeMeasurementEntry,
  toMeasurementDisplay, normalizeMeasurementsState, CUSTOM_MEASUREMENT_UNITS, customMeasurementUnits,
  measurementUnitLabel, zeroIsReading, lengthUnitOf, BP_KEY, pairKeys, bpOf, bpText, bpSeries, bpProblem,
  MEASUREMENT_NOTE_MAX,
} from '../lib/measurements.js'
import { CheckinReminderRow } from '../components/CheckinReminder.jsx'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import HealthBodyCard from '../components/HealthBodyCard.jsx'
import { Button, NumberField, Section, Segmented, SelectRow, Switch, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// Every write leaves the list in its one-entry-per-day shape (normalizeMeasurementsState).
const update = (fn, ...rest) => useStore.getState().update(s => { fn(s); normalizeMeasurementsState(s) }, ...rest)
const toast = message => useUI.getState().toast(message)

// The label after a number: empty for a unitless field (#718).
const fieldUnit = (field, profileUnit) => measurementUnitLabel(measurementUnit(profileUnit, field))
const unitOptions = units => units.map(value => ({ value, label: value === 'none' ? t('No unit') : value }))
const withUnit = (value, unit) => unit ? fmtNum(value) + ' ' + unit : fmtNum(value)
const shownValue = (entry, field, profileUnit) => {
  const value = measurementValue(entry, field.key)
  if (value == null) return null
  return toMeasurementDisplay(value, profileUnit, field)
}

function MeasurementLog({ sourceDate, close }) {
  const S = useStore(s => s.S)
  const source = sourceDate ? S.measurements.find(e => e.d === sourceDate) : null
  const enabled = enabledMeasurementFields(S)
  const fields = [...enabled]
  // Editing must expose populated fields even if the user disabled them after logging.
  if (source) {
    for (const f of MEASUREMENT_FIELDS) {
      if (source[f.key] != null && !fields.some(x => x.key === f.key)) fields.push(f)
    }
    for (const o of source.other || []) {
      if (o.value != null && !fields.some(x => x.key === 'other:' + o.id)) {
        fields.push({ key: 'other:' + o.id, label: o.name, unit: o.unit, custom: true, group: 'Other' })
      }
    }
  }
  const [date, setDate] = useState(source?.d || todayISO())
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.key, shownValue(source, f, lengthUnitOf(S))])))
  const [note, setNote] = useState(source?.note || '')

  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) { toast(t('Choose a valid date')); return }
    if (date !== sourceDate && S.measurements.some(e => e.d === date)) {
      toast(t('That date already has measurements. Edit it instead.')); return
    }
    // Blood pressure (#313) is one reading of two numbers: both or neither, the top one higher.
    const bp = { sys: values.bpSys ?? null, dia: values.bpDia ?? null, pulse: values.pulse ?? null }
    const bpWhy = bpProblem(bp)
    if (bpWhy) {
      toast(bpWhy === 'pair' ? t('Blood pressure takes both numbers, like 120 over 80.')
        : bpWhy === 'order' ? t('The first number is the higher one, like 120 over 80.')
          : bpWhy === 'pulse' ? t('That pulse looks off. Check it again?') : t('That blood pressure looks off. Check it again?'))
      return
    }
    const base = source ? normalizeMeasurementEntry(source, S.customMeasurements) : emptyMeasurement(date, S.customMeasurements)
    base.d = date
    base.t = source && date === source.d ? source.t : (date === todayISO() ? Date.now() : new Date(date + 'T12:00:00').getTime())
    for (const field of fields) {
      const raw = values[field.key]
      const shown = measurementUnit(lengthUnitOf(S), field)
      const percent = shown === '%'
      const value = raw == null || (raw === 0 && !zeroIsReading(shown)) ? null : Math.round(+raw * 10) / 10
      if (percent && value != null && (value < 0 || value > 100)) {
        toast(field.key === 'bodyFat' ? t('Body fat must be between 0 and 100%.') : t('{0} must be between 0 and 100%.', field.label)); return
      }
      if (field.custom) {
        const item = base.other.find(o => o.id === field.key.slice(6))
        if (item) {
          item.value = fromMeasurementDisplay(value, lengthUnitOf(S), field)
          if (field.unit) item.unit = field.unit
        }
      } else if (field.key === 'bodyFat') base.bodyFat = value
      else base[field.key] = value == null ? null : fromMeasurementDisplay(value, lengthUnitOf(S), field)
    }
    const cleanNote = note.trim().slice(0, MEASUREMENT_NOTE_MAX)
    if (cleanNote) base.note = cleanNote; else delete base.note
    if (!measurementEntryHasValues(base) && !cleanNote) { toast(t('Enter at least one measurement')); return }
    // `t` is when the check-in was last saved: the newer one of a day wins a sync merge, the
    // way a weigh-in's does. The chart places it by its date, not by this.
    base.t = Date.now()
    update(state => {
      if (sourceDate) state.measurements = state.measurements.filter(e => e.d !== sourceDate)
      state.measurements.push(base)
    })
    close()
    toast(t('Measurements saved'))
  }

  return <>
    <h3>{source ? t('Edit measurements') : t('Log measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Fill only what you measured today. Empty fields stay empty.')}</div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <DateField value={date} max={todayISO()} onChange={setDate} label={t('Date')} />
    </label>
    {fields.length ? <div className="measure-form">
      {fields.map(field => field.key === 'bpDia' && fields.some(f => f.key === 'bpSys') ? null
        : field.key === 'bpSys' ? <div className="measure-field measure-bp" key="bp" role="group" aria-label={t('Blood pressure')}>
          <span>{t('Blood pressure')}</span>
          <span className="measure-input">
            <NumberField nullable decimal={false} value={values.bpSys} aria-label={t('Systolic')} placeholder="120" onChange={value => setValues(v => ({ ...v, bpSys: value }))} />
            <span className="bp-slash" aria-hidden="true">/</span>
            <NumberField nullable decimal={false} value={values.bpDia} aria-label={t('Diastolic')} placeholder="80" onChange={value => setValues(v => ({ ...v, bpDia: value }))} />
            <i>mmHg</i>
          </span>
        </div>
        : <label className="measure-field" key={field.key}>
        <span>{t(field.label)}</span>
        <span className="measure-input">
          <NumberField nullable decimal={!field.kind || field.kind === 'percent'} value={values[field.key]} onChange={value => setValues(v => ({ ...v, [field.key]: value }))} />
          <i>{fieldUnit(field, lengthUnitOf(S))}</i>
        </span>
      </label>)}
    </div> : <div className="empty small">{t('Choose at least one measurement first.')}</div>}
    <textarea className="input measure-note" rows={2} maxLength={MEASUREMENT_NOTE_MAX} value={note}
      aria-label={t('Note')} placeholder={t('A note for this check-in (optional), like “after the holidays”.')}
      onChange={e => setNote(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save} disabled={!fields.length && !note.trim()}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function measurementLogSheet(sourceDate = null) {
  return useUI.getState().openSheet(close => <MeasurementLog sourceDate={sourceDate} close={close} />)
}

function ManageMeasurements({ close }) {
  const S = useStore(s => s.S)
  const [name, setName] = useState('')
  // A new field's unit: what was picked here, else the lengths' own (#932: it used to start at
  // the weight unit's and forget a pick on every reopen, which read as the unit not sticking).
  const [unitPick, setUnit] = useState(null)
  const unit = unitPick || measurementUnit(lengthUnitOf(S))
  const lengths = lengthUnitOf(S)
  const setLengths = value => update(state => { state.measureUnit = value })
  const removeCustom = field => confirmSheet({
    title: t('Delete “{0}”?', field.name),
    message: t('Removes the field and every reading logged in it. The other measurements stay.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(state => {
      state.customMeasurements = state.customMeasurements.filter(c => c.id !== field.id)
      for (const e of state.measurements) if (Array.isArray(e.other)) e.other = e.other.filter(o => o.id !== field.id)
    }),
  })
  const groups = [...new Set(MEASUREMENT_FIELDS.map(f => f.group))]
  const toggleBuiltin = (key, on) => update(state => {
    const set = new Set(state.measurementEnabled || [])
    if (on) set.add(key); else set.delete(key)
    state.measurementEnabled = [...set]
  })
  const toggleCustom = (id, on) => update(state => {
    const item = state.customMeasurements.find(c => c.id === id)
    if (item) item.enabled = on
  })
  const setCustomUnit = (id, value) => update(state => {
    const item = state.customMeasurements.find(c => c.id === id)
    if (item && customMeasurementUnits(item, state.measurements).includes(value)) item.unit = value
  })
  // A custom field's name (#1009): its readings hang on its id, so a new name keeps every one of
  // them. Empty or taken leaves it as it was.
  const [renaming, setRenaming] = useState(null)
  const nameTaken = (clean, id) => S.customMeasurements.some(c => c.id !== id && c.name.toLowerCase() === clean.toLowerCase()) ||
    MEASUREMENT_FIELDS.some(f => f.label.toLowerCase() === clean.toLowerCase())
  const rename = (field, value) => {
    setRenaming(null)
    const clean = String(value || '').trim().slice(0, 60)
    if (!clean || clean === field.name) return
    if (nameTaken(clean, field.id)) { toast(t('A custom measurement with that name already exists.')); return }
    update(state => {
      const item = state.customMeasurements.find(c => c.id === field.id)
      if (item) item.name = clean
    })
  }
  const add = () => {
    const clean = name.trim()
    if (!clean) return
    if (nameTaken(clean, null)) {
      toast(t('A custom measurement with that name already exists.')); return
    }
    update(state => { state.customMeasurements.push({ id: uid(), name: clean.slice(0, 60), enabled: true, unit }) })
    setName('')
  }
  return <>
    <h3>{t('Choose measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Keep the logging form focused on the measurements you actually track.')}</div>
    {/* Lengths in cm or inches, whatever the weight unit (#932). Stored in cm, so a switch only
        changes how they read. */}
    <div className="sect-b" style={{ marginBottom: 18 }}>
      <SelectRow icon="ruler" iconTint="var(--teal)" title={t('Lengths in')} value={lengths} onChange={setLengths}
        options={unitOptions(['cm', 'in'])} />
    </div>
    {groups.map(group => <Section title={t(group)} key={group} className="measure-options">
      {/* A pair is one switch for all of its keys: blood pressure and the pulse beside it (#313). */}
      {group === 'Health' && <div className="lrow">
        <span className="lrow-m"><span className="lrow-t">{t('Blood pressure and pulse')}</span><span className="lrow-s">{t('Systolic over diastolic in mmHg, pulse in bpm')}</span></span>
        <Switch checked={pairKeys('bp').every(k => (S.measurementEnabled || []).includes(k))} onChange={on => update(state => {
          const set = new Set(state.measurementEnabled || [])
          for (const k of pairKeys('bp')) { if (on) set.add(k); else set.delete(k) }
          state.measurementEnabled = [...set]
        })} />
      </div>}
      {MEASUREMENT_FIELDS.filter(f => f.group === group && !f.pair).map(field => <div className="lrow" key={field.key}>
        <span className="lrow-m"><span className="lrow-t">{t(field.label)}</span></span>
        <Switch checked={(S.measurementEnabled || []).includes(field.key)} onChange={on => toggleBuiltin(field.key, on)} />
      </div>)}
      {group === 'Other' && S.customMeasurements.map(field => <div key={field.id}>
        <div className="lrow">
          {renaming === field.id
            ? <span className="lrow-m"><TextField autoFocus defaultValue={field.name} maxLength={60} aria-label={t('Rename “{0}”', field.name)}
                onBlur={e => rename(field, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = field.name; e.currentTarget.blur() } }} /></span>
            : <span className="lrow-m"><span className="lrow-t">{field.name}</span><span className="lrow-s">{t('Custom')}</span></span>}
          {renaming !== field.id && <button type="button" className="iconbtn" aria-label={t('Rename “{0}”', field.name)} onClick={() => setRenaming(field.id)}><Icon name="pencil" /></button>}
          <button type="button" className="iconbtn" aria-label={t('Remove “{0}”', field.name)} onClick={() => removeCustom(field)}><Icon name="trash" /></button>
          <Switch checked={field.enabled !== false} onChange={on => toggleCustom(field.id, on)} />
        </div>
        <SelectRow title={t('Measurement unit')} value={measurementUnit(lengthUnitOf(S), field)}
          options={unitOptions(customMeasurementUnits(field, S.measurements))}
          onChange={value => setCustomUnit(field.id, value)} />
      </div>)}
    </Section>)}
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged values keep their type. Add a new measurement to use a different type.')}</div>
    <h4 className="sec">{t('Custom measurement')}</h4>
    <div className="sect-b">
      <SelectRow title={t('Measurement unit')} value={unit} onChange={setUnit}
        options={unitOptions(CUSTOM_MEASUREMENT_UNITS)} />
    </div>
    <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
      <TextField value={name} maxLength={60} placeholder={t('Custom measurement')} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <Button icon="plus" onClick={add} disabled={!name.trim()}>{t('Add')}</Button>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export function manageMeasurementsSheet() {
  return useUI.getState().openSheet(close => <ManageMeasurements close={close} />)
}

export default function Measurements() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const available = useMemo(() => {
    const out = enabledMeasurementFields(S)
    for (const field of MEASUREMENT_FIELDS) {
      if (latestMeasurement(S, field.key) && !out.some(f => f.key === field.key)) out.push(field)
    }
    // Systolic and diastolic chart as one: blood pressure, both lines (#313). The pulse stays its own.
    const sys = out.findIndex(f => f.key === 'bpSys' || f.key === 'bpDia')
    if (sys >= 0) out.splice(sys, 0, { key: BP_KEY, label: 'Blood pressure', group: 'Health', kind: 'mmHg' })
    for (let i = out.length - 1; i >= 0; i--) if (out[i].key === 'bpSys' || out[i].key === 'bpDia') out.splice(i, 1)
    for (const custom of S.customMeasurements || []) {
      const key = 'other:' + custom.id
      if (latestMeasurement(S, key) && !out.some(f => f.key === key)) out.push({ key, label: custom.name, unit: custom.unit, custom: true, group: 'Other' })
    }
    return out
  }, [S])
  const fallback = available.find(f => f.key === 'waist')?.key || available[0]?.key || null
  const [selected, setSelected] = useState(fallback)
  const key = available.some(f => f.key === selected) ? selected : fallback
  const field = available.find(f => f.key === key)
  const isBp = key === BP_KEY
  const points = key && !isBp ? measurementSeries(S, key, range) : []
  const bpLines = isBp ? bpSeries(S, range) : null
  const unit = isBp ? 'mmHg' : fieldUnit(field, lengthUnitOf(S))
  const all = key ? measurementSeries(S, isBp ? 'bpSys' : key) : []
  const latest = all.at(-1)
  const previous = all.at(-2)
  const delta = !isBp && latest && previous ? Math.round((latest.y - previous.y) * 10) / 10 : null
  const latestBp = isBp && latest ? bpOf(S.measurements.find(e => e.d === latest.d)) : null
  const recent = [...S.measurements].reverse()

  const remove = entry => confirmSheet({
    title: t('Delete measurements?'),
    message: t('Deletes the measurements logged on {0}.', fmtDate(entry.d, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(state => { state.measurements = state.measurements.filter(e => e.d !== entry.d) }); toast(t('Measurements deleted')) },
  })

  return <div className="narrow">
    <ScreenHeader title={t('Body measurements')} sub={t('Circumference & composition')}
      left={<button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>}
      right={<button className="iconbtn" onClick={manageMeasurementsSheet} aria-label={t('Choose measurements')}><Icon name="gear" /></button>} />

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div>
          <div className="muted small">{field ? t(field.label) : t('Body measurements')}</div>
          <div className="big" style={{ marginTop: 3 }}>{latest ? <>{latestBp ? bpText(latestBp) : fmtNum(latest.y)} <span className="muted" style={{ fontSize: 'var(--fs-callout)' }}>{unit}</span></> : '–'}</div>
          {latestBp?.pulse != null && <div className="small" style={{ marginTop: 3, color: 'var(--label-2)' }}>{t('Pulse {0} bpm', latestBp.pulse)}</div>}
          {delta != null && delta !== 0 && <div className="small" style={{ marginTop: 3, color: 'var(--label-2)' }}>{delta > 0 ? '+' : ''}{withUnit(delta, unit)} {t('since previous')}</div>}
        </div>
        <Button size="sm" icon="plus" onClick={() => measurementLogSheet()}>{t('Log')}</Button>
      </div>
      {available.length > 0 && <div className="sect-b measure-select"><SelectRow
        title={t('Measurement')} sheetTitle={t('Choose measurement')} value={key} onChange={setSelected}
        options={available.map(f => ({ value: f.key, label: t(f.label) }))} />
      </div>}
      <Segmented className="seg-range" value={range} onChange={setRange}
        options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
      <div className="chart">{isBp
        ? <LineChart points={bpLines.sys} h={170} unit={unit} series={[{ points: bpLines.sys, color: 'var(--red)' }, { points: bpLines.dia, color: 'var(--blue)' }]} />
        : <LineChart points={points} h={170} unit={unit} color="var(--teal)" />}</div>
      {isBp && <div className="cal-legend" style={{ justifyContent: 'center' }}>
        <span><i style={{ background: 'var(--red)' }} />{t('Systolic')}</span>
        <span><i style={{ background: 'var(--blue)' }} />{t('Diastolic')}</span>
      </div>}
    </div>

    <HealthBodyCard unit={S.unit} />

    {/* Check-in reminders (components/CheckinReminder.jsx): how often, bundled into one notification. */}
    <div className="sect-b" style={{ marginBottom: 14 }}><CheckinReminderRow /></div>

    {!available.length && <div className="card">
      <div className="muted small">{t('Choose the measurements you want to track, then log your first check-in.')}</div>
      <div style={{ height: 10 }} /><Button onClick={manageMeasurementsSheet}>{t('Choose measurements')}</Button>
    </div>}

    <div className="row between" style={{ margin: '18px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Measurement history')}</h4>
      <Button size="sm" variant="ghost" icon="gear" onClick={manageMeasurementsSheet}>{t('Fields')}</Button>
    </div>
    {recent.length ? <div className="list">{recent.map(entry => {
      // Blood pressure is one reading, though two numbers (#313).
      const count = MEASUREMENT_KEYS.filter(k => k !== 'bpDia' && entry[k] != null).length + (entry.other || []).filter(o => o.value != null).length
      const bp = bpOf(entry)
      const previewFields = enabledMeasurementFields(S).filter(f => !f.pair).map(f => ({ field: f, value: shownValue(entry, f, lengthUnitOf(S)) })).filter(x => x.value != null).slice(0, bp ? 2 : 3)
      return <div className="card measure-history" key={entry.d}>
        <div className="row between">
          <div><b>{fmtDate(entry.d, true)}</b><div className="small dim" style={{ marginTop: 2 }}>{t(count === 1 ? '{0} measurement' : '{0} measurements', count)}</div></div>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" onClick={() => measurementLogSheet(entry.d)} aria-label={t('Edit')}><Icon name="pencil" /></button>
            <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(entry)} aria-label={t('Delete')}><Icon name="trash" /></button>
          </div>
        </div>
        {(previewFields.length > 0 || bp) && <div className="measure-preview">
          {bp && bpText(bp) && <span>{t('Blood pressure')} <b>{bpText(bp)}</b></span>}
          {bp?.pulse != null && <span>{t('Pulse')} <b>{bp.pulse}</b></span>}
          {previewFields.map(({ field: f, value }) => <span key={f.key}>{t(f.label)} <b>{withUnit(value, fieldUnit(f, lengthUnitOf(S)))}</b></span>)}</div>}
        {entry.note && <div className="measure-note-line">{entry.note}</div>}
      </div>
    })}</div> : <div className="empty small">{t('No measurements yet')}</div>}
  </div>
}
