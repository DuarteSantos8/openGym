import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  MEASUREMENT_FIELDS, MEASUREMENT_KEYS, emptyMeasurement, enabledMeasurementFields,
  fromMeasurementDisplay, latestMeasurement, measurementEntryHasValues,
  measurementSeries, measurementUnit, measurementValue, normalizeMeasurementEntry,
  toMeasurementDisplay, normalizeMeasurementsState,
} from '../lib/measurements.js'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { rangeFrom, rangeOptions, storedRange } from '../lib/progress-range.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Inline } from '../components/layout.jsx'
import { Card, EmptyState } from '../components/blocks.jsx'
import { ActionButton, ActionRow, HeroStatus, SectionHeader, TabSection } from '../components/tab-kit.jsx'
import { SheetHeader, SheetActions } from '../components/sheet-layout.jsx'
import { Button, NumberField, Row, Section, Segmented, SelectRow, Switch, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// Every write leaves the list in its one-entry-per-day shape (normalizeMeasurementsState).
const update = (fn, ...rest) => useStore.getState().update(s => { fn(s); normalizeMeasurementsState(s) }, ...rest)
const toast = message => useUI.getState().toast(message)

const fieldUnit = (field, profileUnit) => field.key === 'bodyFat' ? '%' : measurementUnit(profileUnit)
const shownValue = (entry, field, profileUnit) => {
  const value = measurementValue(entry, field.key)
  if (value == null) return null
  return field.key === 'bodyFat' ? value : toMeasurementDisplay(value, profileUnit)
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
        fields.push({ key: 'other:' + o.id, label: o.name, custom: true, group: 'Other' })
      }
    }
  }
  const [date, setDate] = useState(source?.d || todayISO())
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.key, shownValue(source, f, S.unit)])))

  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) { toast(t('Choose a valid date')); return }
    if (date !== sourceDate && S.measurements.some(e => e.d === date)) {
      toast(t('That date already has measurements. Edit it instead.')); return
    }
    const base = source ? normalizeMeasurementEntry(source, S.customMeasurements) : emptyMeasurement(date, S.customMeasurements)
    base.d = date
    base.t = source && date === source.d ? source.t : (date === todayISO() ? Date.now() : new Date(date + 'T12:00:00').getTime())
    for (const field of fields) {
      const raw = values[field.key]
      const value = raw == null || raw === 0 ? null : Math.round(+raw * 10) / 10
      if (field.key === 'bodyFat' && value > 100) { toast(t('Body fat must be between 0 and 100%.')); return }
      if (field.custom) {
        const item = base.other.find(o => o.id === field.key.slice(6))
        if (item) item.value = value == null ? null : fromMeasurementDisplay(value, S.unit)
      } else if (field.key === 'bodyFat') base.bodyFat = value
      else base[field.key] = value == null ? null : fromMeasurementDisplay(value, S.unit)
    }
    if (!measurementEntryHasValues(base)) { toast(t('Enter at least one measurement')); return }
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
    <SheetHeader title={source ? t('Edit measurements') : t('Log measurements')} />
    <div className="muted small mb-6">{t('Fill only what you measured today. Empty fields stay empty.')}</div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <input className="field" type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
    </label>
    {fields.length ? <div className="measure-form">
      {fields.map(field => <label className="measure-field" key={field.key}>
        <span>{t(field.label)}</span>
        <span className="measure-input">
          <NumberField nullable value={values[field.key]} onChange={value => setValues(v => ({ ...v, [field.key]: value }))} />
          <i>{fieldUnit(field, S.unit)}</i>
        </span>
      </label>)}
    </div> : <EmptyState className="small">{t('Choose at least one measurement first.')}</EmptyState>}
    <SheetActions>
      <Button variant="primary" onClick={save} disabled={!fields.length}>{t('Save')}</Button>
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </SheetActions>
  </>
}

export function measurementLogSheet(sourceDate = null) {
  return useUI.getState().openSheet(close => <MeasurementLog sourceDate={sourceDate} close={close} />)
}

function ManageMeasurements({ close }) {
  const S = useStore(s => s.S)
  const [name, setName] = useState('')
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
  const add = () => {
    const clean = name.trim()
    if (!clean) return
    if (S.customMeasurements.some(c => c.name.toLowerCase() === clean.toLowerCase()) ||
      MEASUREMENT_FIELDS.some(f => f.label.toLowerCase() === clean.toLowerCase())) {
      toast(t('A custom measurement with that name already exists.')); return
    }
    update(state => { state.customMeasurements.push({ id: uid(), name: clean.slice(0, 60), enabled: true }) })
    setName('')
  }
  return <>
    <SheetHeader title={t('Choose measurements')} />
    <div className="muted small mb-6">{t('Keep the logging form focused on the measurements you actually track.')}</div>
    {groups.map(group => <Section title={t(group)} key={group} className="measure-options">
      {MEASUREMENT_FIELDS.filter(f => f.group === group).map(field => <Row key={field.key} title={t(field.label)}>
        <Switch checked={(S.measurementEnabled || []).includes(field.key)} onChange={on => toggleBuiltin(field.key, on)} />
      </Row>)}
      {group === 'Other' && S.customMeasurements.map(field => <Row key={field.id} title={field.name} subtitle={t('Custom')}>
        <Switch checked={field.enabled !== false} onChange={on => toggleCustom(field.id, on)} />
      </Row>)}
    </Section>)}
    <Inline gap={4} align="stretch">
      <TextField value={name} maxLength={60} placeholder={t('Custom measurement')} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <Button icon="plus" onClick={add} disabled={!name.trim()}>{t('Add')}</Button>
    </Inline>
    <SheetActions>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </SheetActions>
  </>
}

export function manageMeasurementsSheet() {
  return useUI.getState().openSheet(close => <ManageMeasurements close={close} />)
}

// Body › Measurements: [Log measurements] [Choose fields], the picked measurement's latest value and
// change, its curve over the range the Progress root was on, then every check-in, each to edit or
// delete.
export default function Measurements() {
  const S = useStore(s => s.S)
  const { search } = useLocation()
  const [range, setRange] = useState(() => rangeFrom(search, storedRange()))
  const available = useMemo(() => {
    const out = enabledMeasurementFields(S)
    for (const field of MEASUREMENT_FIELDS) {
      if (latestMeasurement(S, field.key) && !out.some(f => f.key === field.key)) out.push(field)
    }
    for (const custom of S.customMeasurements || []) {
      const key = 'other:' + custom.id
      if (latestMeasurement(S, key) && !out.some(f => f.key === key)) out.push({ key, label: custom.name, custom: true, group: 'Other' })
    }
    return out
  }, [S])
  const fallback = available.find(f => f.key === 'waist')?.key || available[0]?.key || null
  const [selected, setSelected] = useState(fallback)
  const key = available.some(f => f.key === selected) ? selected : fallback
  const field = available.find(f => f.key === key)
  const points = key ? measurementSeries(S, key, range) : []
  const unit = key === 'bodyFat' ? '%' : measurementUnit(S.unit)
  const all = key ? measurementSeries(S, key) : []
  const latest = all.at(-1)
  const previous = all.at(-2)
  const delta = latest && previous ? Math.round((latest.y - previous.y) * 10) / 10 : null
  const recent = [...S.measurements].reverse()

  const remove = entry => confirmSheet({
    title: t('Delete measurements?'),
    message: t('Deletes the measurements logged on {0}.', fmtDate(entry.d, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(state => { state.measurements = state.measurements.filter(e => e.d !== entry.d) }); toast(t('Measurements deleted')) },
  })

  return <>
    <TabSection>
      <ActionRow>
        <ActionButton icon="plus" label={t('Log measurements')} onClick={() => measurementLogSheet()} />
        <ActionButton icon="gear" label={t('Choose fields')} onClick={manageMeasurementsSheet} />
      </ActionRow>
    </TabSection>

    <TabSection>
      {available.length ? <>
        <HeroStatus eyebrow={t(field.label)} value={latest ? fmtNum(latest.y) : null} unit={unit} status={latest ? 'ready' : 'empty'}
          caption={delta ? (delta > 0 ? '+' : '') + fmtNum(delta) + ' ' + unit + ' ' + t('since previous') : latest ? fmtDate(latest.d, true) : t('No measurements yet')} />
        <Card>
          <div className="sect-b measure-select"><SelectRow
            title={t('Measurement')} sheetTitle={t('Choose measurement')} value={key} onChange={setSelected}
            options={available.map(f => ({ value: f.key, label: t(f.label) }))} />
          </div>
          <Segmented className="seg-range" value={range} onChange={setRange} options={rangeOptions()} />
          <div className="chart"><LineChart points={points} h={170} unit={unit} color="var(--teal)" label={t(field.label)} /></div>
        </Card>
      </> : <EmptyState icon="ruler" title={t('Nothing to chart yet')}
        secondary={{ icon: 'gear', label: t('Choose measurements'), onClick: manageMeasurementsSheet }}>
        {t('Choose the measurements you want to track, then log your first check-in.')}
      </EmptyState>}
    </TabSection>

    <SectionHeader title={t('Measurement history')} />
    {recent.length ? <div className="list">{recent.map(entry => {
      const count = MEASUREMENT_KEYS.filter(k => entry[k] != null).length + (entry.other || []).filter(o => o.value != null).length
      const previewFields = enabledMeasurementFields(S).map(f => ({ field: f, value: shownValue(entry, f, S.unit) })).filter(x => x.value != null).slice(0, 3)
      return <Card className="measure-history" key={entry.d}>
        <Inline justify="between">
          <div><b>{fmtDate(entry.d, true)}</b><div className="small dim mt-1">{t(count === 1 ? '{0} measurement' : '{0} measurements', count)}</div></div>
          <Inline gap={2}>
            <button className="iconbtn" onClick={() => measurementLogSheet(entry.d)} aria-label={t('Edit')}><Icon name="pencil" /></button>
            <button className="iconbtn ink-danger" onClick={() => remove(entry)} aria-label={t('Delete')}><Icon name="trash" /></button>
          </Inline>
        </Inline>
        {previewFields.length > 0 && <div className="measure-preview">{previewFields.map(({ field: f, value }) => <span key={f.key}>{t(f.label)} <b>{fmtNum(value)} {fieldUnit(f, S.unit)}</b></span>)}</div>}
      </Card>
    })}</div> : <EmptyState className="small">{t('No measurements yet')}</EmptyState>}
  </>
}
