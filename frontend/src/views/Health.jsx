import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtDate, isoOf, uid, weekStartOf } from '../lib/format.js'
import { MOBILE } from '../lib/mobile.js'
import { BIA_TYPES, BODY_CORE, GROUPS, GROUP_CORE, HEALTH_GROUPS, HEALTH_METRICS, OVERVIEW_TYPES, metricOf, typesInGroup } from '../lib/health/metrics.js'
import { workoutLabel } from '../../../api/health/catalogue.js'
import {
  bridgeWeights, compositionMeasurements, deleteComposition, hasData, historyOf, latestOf, normalizeHealthState,
  saveComposition, seriesOf,
} from '../lib/health/records.js'
import { chartValue, displayUnit, fmtHealth, fmtHealthDelta, fmtMinutes, fromDisplay, toDisplay } from '../lib/health/units.js'
import { PROVIDERS, sourceLabel } from '../lib/health/providers.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// Every write leaves S.health in shape (normalizeHealthState): one record per id, in time order.
const update = fn => useStore.getState().update(s => { fn(s); normalizeHealthState(s) })
const toast = m => useUI.getState().toast(m)
const openSheet = render => useUI.getState().openSheet(render)

const RANGE_OPTS = () => [{ value: 'week', label: '7d' }, { value: 'month', label: '30d' }, { value: 'year', label: '1Y' }, { value: 'all', label: t('All') }]
const fmtTime = ms => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
const label = type => t(metricOf(type)?.label || type)
// The chart's unit: sleep is charted in hours, everything else in what the card shows.
const chartUnit = (type, S) => (metricOf(type)?.unit === 'min' ? 'h' : displayUnit(type, S))

// "2026-10-13T07:30" for a datetime-local input, in local time.
const localInput = ms => {
  const d = new Date(ms)
  return `${isoOf(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* ---------------- body composition form (the "+") ---------------- */

function CompositionForm({ g, close }) {
  const S = useStore(s => s.S)
  const source = g ? compositionMeasurements(S.health).find(m => m.g === g) : null
  const [when, setWhen] = useState(() => localInput(source?.t || Date.now()))
  const [values, setValues] = useState(() => Object.fromEntries(BIA_TYPES.map(k => [k, source?.values[k] != null ? toDisplay(k, source.values[k], S) : null])))

  const save = () => {
    const at = new Date(when).getTime()
    if (!Number.isFinite(at) || at > Date.now() + 60000) { toast(t('Choose a valid date')); return }
    const canonical = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? null : fromDisplay(k, v, S)]))
    const group = g || uid()
    let health
    try { health = saveComposition(S.health, { g: group, t: at, values: canonical }) } catch (e) {
      toast(e.message === 'empty' ? t('Enter at least one value') : t('{0} is out of range', label(e.type)))
      return
    }
    update(s => {
      s.health = health
      // The weight of a scale reading is that day's weigh-in, as one logged in the weigh-in sheet is.
      const w = health.filter(r => r.type === 'weight' && r.g === group)
      if (w.length) {
        const b = bridgeWeights(s.bodyweight, w, s.unit)
        if (b.changed) s.bodyweight = b.bodyweight
      }
    })
    close()
    toast(t('Measurement saved'))
  }
  const remove = () => confirmSheet({
    title: t('Delete this measurement?'),
    message: t('Deletes the body composition values logged on {0}. The weigh-in of that day stays.', fmtDate(source.d, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.health = deleteComposition(s.health, g) }); close(); toast(t('Measurement deleted')) },
  })

  return <>
    <h3>{source ? t('Edit measurement') : t('New measurement')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('From a body composition scale or analyser. Fill only what it measured.')}</div>
    <label className="measure-date">
      <span>{t('Date and time')}</span>
      <input className="field" type="datetime-local" value={when} max={localInput(Date.now())} onChange={e => setWhen(e.target.value)} />
    </label>
    <div className="measure-form">
      {BIA_TYPES.map(k => <label className="measure-field" key={k}>
        <span>{label(k)}</span>
        <span className="measure-input">
          <NumberField nullable value={values[k]} onChange={v => setValues(x => ({ ...x, [k]: v }))} />
          <i>{displayUnit(k, S)}</i>
        </span>
      </label>)}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {source && <><div style={{ height: 8 }} /><Button className="dim" style={{ color: 'var(--red)' }} icon="trash" onClick={remove}>{t('Delete')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const compositionSheet = (g = null) => openSheet(close => <CompositionForm g={g} close={close} />)

/* ---------------- one metric: chart and history ---------------- */

function MetricDetail({ type, close }) {
  const S = useStore(s => s.S)
  const [range, setRange] = useState(metricOf(type)?.daily === 'sum' ? 'week' : 'month')
  const m = metricOf(type)
  const latest = latestOf(S, type)
  const points = useMemo(() => seriesOf(S, type, range, { ws: weekStartOf(S) })
    .map(p => ({ t: p.t, d: p.d, y: chartValue(type, p.v, S) })), [S, type, range])
  const rows = historyOf(S, type).slice(0, 60)

  const removeRow = r => confirmSheet({
    title: t('Delete this reading?'),
    message: r.src === 'manual' || r.weighIn ? t('Deletes the reading of {0}.', fmtDate(r.d, true))
      : t('Deletes the reading of {0}. It will not be imported again.', fmtDate(r.d, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => {
      if (r.weighIn) s.bodyweight = s.bodyweight.filter(b => b.d !== r.d)
      else s.health = s.health.filter(x => x.id !== r.id)
    }),
  })

  return <>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h3 style={{ margin: 0 }}>{label(type)}</h3>
        <div style={{ marginTop: 6, fontSize: 30, fontWeight: 600, letterSpacing: '-.026em', lineHeight: 1.1 }}>{latest ? fmtHealth(type, latest.v, S) : '–'}</div>
        {latest && <div className="small dim" style={{ marginTop: 3 }}>
          {fmtDate(latest.d, true)}{latest.delta && fmtHealthDelta(type, latest.delta, S) ? ` · ${fmtHealthDelta(type, latest.delta, S)} ${t('since previous')}` : ''}
          {latest.lo != null && latest.hi != null ? ` · ${fmtHealth(type, latest.lo, S, { unit: false })}–${fmtHealth(type, latest.hi, S)}` : ''}
          {latest.derived ? ` · ${t('from weight and height')}` : ''}
        </div>}
      </div>
      {m?.bia && <Button size="sm" icon="plus" onClick={() => compositionSheet()}>{t('Log')}</Button>}
    </div>
    <div style={{ height: 12 }} />
    <Segmented className="seg-range" value={range} onChange={setRange} options={RANGE_OPTS()} />
    <div className="chart"><LineChart points={points} h={170} unit={chartUnit(type, S)} color={m?.color} /></div>
    {(range === 'year' || range === 'all') && m?.daily === 'sum' && <div className="small dim">{t('Each point is the daily average of its week or month.')}</div>}
    <h4 className="sec" style={{ marginTop: 16 }}>{t('History')}</h4>
    {rows.length ? <div className="list">{rows.map(r => <div key={r.id} className="mrow" style={{ minHeight: 44 }}>
      <span className="nm" style={{ cursor: r.g ? 'pointer' : undefined }} onClick={r.g ? () => compositionSheet(r.g) : undefined}>
        <b>{fmtHealth(type, r.v, S)}</b>
        <span className="small dim" style={{ display: 'block', fontWeight: 400 }}>
          {r.a ? t(workoutLabel(r.a)) + ' · ' : ''}{fmtDate(r.d, true)}{metricOf(type)?.daily !== 'sum' || r.a ? ' · ' + fmtTime(r.t) : ''} · {t(sourceLabel(r.src))}
        </span>
      </span>
      <button className="iconbtn" style={{ color: 'var(--red)' }} aria-label={t('Delete')} onClick={() => removeRow(r)}><Icon name="trash" /></button>
    </div>)}</div> : <div className="empty small">{t('No readings yet')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}

export const metricSheet = type => openSheet(close => <MetricDetail type={type} close={close} />)

/* ---------------- the screen ---------------- */

export function MetricCard({ S, type }) {
  const latest = latestOf(S, type)
  const m = HEALTH_METRICS[type]
  const spark = useMemo(() => seriesOf(S, type, 'month').map(p => ({ t: p.t, d: p.d, y: chartValue(type, p.v, S) })), [S, type])
  return <button className="card health-card" onClick={() => metricSheet(type)}>
    <div className="l"><Icon name={m.icon} style={{ color: m.color }} />{label(type)}</div>
    <div className="v">{latest ? fmtHealth(type, latest.v, S) : '–'}</div>
    <div className="small dim">{latest
      ? (latest.delta && fmtHealthDelta(type, latest.delta, S) ? `${fmtHealthDelta(type, latest.delta, S)} · ` : '') + fmtDate(latest.d, true)
      : t('No data yet')}</div>
    {spark.length > 1 && <div className="health-spark"><LineChart points={spark} h={40} axes={false} color={m.color} /></div>}
  </button>
}

// The tabs that are always there; every other one shows once it has a reading.
const MAIN_TABS = ['overview', 'body', 'activity', 'heart', 'sleep']

/** The workouts Health recorded, newest first: activity, length, energy, distance. */
function WorkoutList({ S }) {
  const rows = (S.health || []).filter(r => r?.type === 'workout').sort((a, b) => b.t - a.t).slice(0, 100)
  if (!rows.length) return <div className="empty small">{t('No readings yet')}</div>
  const remove = r => confirmSheet({
    title: t('Delete this reading?'), message: t('Deletes the reading of {0}. It will not be imported again.', fmtDate(r.d, true)),
    confirmText: t('Delete'), danger: true, onConfirm: () => update(s => { s.health = s.health.filter(x => x.id !== r.id) }),
  })
  return <div className="list">{rows.map(r => <div key={r.id} className="mrow" style={{ minHeight: 48 }}>
    <span className="nm">
      <b>{t(workoutLabel(r.a))}</b>
      <span className="small dim" style={{ display: 'block', fontWeight: 400 }}>
        {[fmtDate(r.d, true) + ' · ' + fmtTime(r.t), fmtMinutes(r.v), r.kc ? fmtHealth('activeEnergy', r.kc, S) : null,
          r.km ? fmtHealth('distance', r.km, S) : null].filter(Boolean).join(' · ')}
      </span>
    </span>
    <button className="iconbtn" style={{ color: 'var(--red)' }} aria-label={t('Delete')} onClick={() => remove(r)}><Icon name="trash" /></button>
  </div>)}</div>
}

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [tab, setTab] = useState('overview')
  // Whether this device can read from a source at all (the iPhone app: Apple Health), for the
  // empty state's pointer to Settings.
  const [canConnect, setCanConnect] = useState(false)
  useEffect(() => {
    // The web app and the PWA always can: Health's export, or a Shortcut (Settings → Health).
    if (!MOBILE) { setCanConnect(true); return }
    let gone = false
    Promise.all(PROVIDERS.map(p => p.isAvailable().catch(() => false))).then(r => { if (!gone) setCanConnect(r.some(Boolean)) })
    return () => { gone = true }
  }, [])

  // The types the profile has any reading of, found once: a tab lists those and its core ones.
  const present = useMemo(() => {
    const set = new Set((S.health || []).map(r => r?.type))
    if ((S.bodyweight || []).length) set.add('weight')
    return set
  }, [S.health, S.bodyweight])
  const tabs = HEALTH_GROUPS.filter(g => MAIN_TABS.includes(g) || typesInGroup(g).some(k => present.has(k)))
  const core = tab === 'body' ? BODY_CORE : GROUP_CORE[tab] || []
  const shown = tab === 'overview' ? OVERVIEW_TYPES.filter(k => hasData(S, k))
    : [...core, ...typesInGroup(tab).filter(k => !core.includes(k) && present.has(k))]
  const measurements = tab === 'body' ? compositionMeasurements(S.health) : []

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1>{t('Health')}</h1><div className="sub">{t('Body composition, activity, heart and sleep')}</div></div>
      <button className="iconbtn" onClick={() => compositionSheet()} aria-label={t('New measurement')}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ marginBottom: 4 }} role="tablist">
      {tabs.map(g => <button key={g} role="tab" aria-selected={tab === g} className={'chip nocap' + (tab === g ? ' on' : '')}
        onClick={e => { setTab(g); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}>{t(GROUPS[g].label)}</button>)}
    </div>

    {tab === 'overview' && !shown.length && <div className="card">
      <div className="muted small">{t('Log a body composition measurement, or connect a source in Settings → Health, and your readings show up here with their trends.')}</div>
      <div style={{ height: 10 }} />
      <Button icon="plus" onClick={() => compositionSheet()}>{t('New measurement')}</Button>
      {canConnect && <><div style={{ height: 8 }} /><Button icon="heart" onClick={() => nav('/settings/health')}>{t('Connect a source')}</Button></>}
    </div>}

    {tab !== 'overview' && !shown.length && <div className="empty small">{t('No readings yet')}</div>}
    <div className="health-grid">{shown.map(k => <MetricCard key={k} S={S} type={k} />)}</div>

    {tab === 'workouts' && <><h4 className="sec" style={{ marginTop: 18 }}>{t('History')}</h4><WorkoutList S={S} /></>}

    {tab === 'body' && <>
      <div className="row between" style={{ margin: '18px 2px 10px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Measurements')}</h4>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => compositionSheet()}>{t('Log')}</Button>
      </div>
      {measurements.length ? <div className="list">{measurements.slice(0, 50).map(m => <button key={m.g} className="card measure-history" style={{ width: '100%', textAlign: 'start' }} onClick={() => compositionSheet(m.g)}>
        <div className="row between">
          <b>{fmtDate(m.d, true)} · {fmtTime(m.t)}</b>
          <Icon name="pencil" />
        </div>
        <div className="measure-preview">{Object.entries(m.values).slice(0, 6).map(([k, v]) => <span key={k}>{label(k)} <b>{fmtHealth(k, v, S)}</b></span>)}</div>
      </button>)}</div> : <div className="empty small">{t('No measurements yet')}</div>}
    </>}
  </div>
}
