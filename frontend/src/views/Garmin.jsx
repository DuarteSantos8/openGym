// Garmin Connect: the account's own watch data, pulled hourly by the server with a Personal API
// key (contrib/cloudflare/garmin.js). Read only. Strings are plain English on purpose: this
// screen is ours, not upstream's, and its words stay out of the shared locale packs.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import {
  connectGarmin, syncGarmin, probeGarmin, disconnectGarmin, dayOf, readiness, READY_TITLE,
  fmtDuration, activityLine, activityType, activityDay, keyDaysLeft, fmtPace,
} from '../lib/garmin.js'
import { useGarmin, setGarmin, refreshGarmin } from '../components/useGarmin.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)
const openSheet = render => useUI.getState().openSheet(render)
const KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken'
const n0 = v => fmtNum(Math.round(v))

export default function Garmin() {
  const nav = useNavigate()
  const g = useGarmin()
  const [busy, setBusy] = useState(false)
  const sync = async () => {
    setBusy(true)
    try { setGarmin(await syncGarmin()) } catch (e) { toast(e.message) }
    setBusy(false)
  }
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/" onClick={() => nav(-1)} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Garmin</h1><div className="sub">Sleep, recovery and activities from your watch</div></div>
      {g?.connected && <button className="iconbtn" onClick={sync} disabled={busy} aria-label="Sync now"><Icon name="repeat" /></button>}
    </div>
    {g === undefined && <p className="muted">Loading…</p>}
    {g === null && <div className="card"><p className="muted">This server has no Garmin connection, or it could not be reached. <Button size="sm" variant="ghost" onClick={() => refreshGarmin()}>Try again</Button></p></div>}
    {g && !g.connected && <Connect />}
    {g?.connected && <Connected g={g} />}
  </div>
}

function Connect() {
  const [key, setKey] = useState('')
  const [days, setDays] = useState(365)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { setGarmin(await connectGarmin(key.trim(), days)); toast('Garmin connected') }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  return <>
    <div className="card">
      <p style={{ marginTop: 0 }}>Bring in your sleep, HRV, body battery, steps, calories and every run or ride from Garmin Connect. Each account uses its own key, and openGym only reads.</p>
      <ol className="small" style={{ paddingInlineStart: 18, lineHeight: 1.6 }}>
        <li>Open <a href={KEY_PAGE} target="_blank" rel="noopener noreferrer">Personal API key</a> in Garmin Connect on the web.</li>
        <li>Create key, accept the terms, pick how long it lasts.</li>
        <li>Copy the key (Garmin shows it only once) and paste it here.</li>
      </ol>
      <TextField value={key} onChange={e => setKey(e.target.value)} placeholder="Paste your Garmin API key" autoComplete="off" spellCheck={false} />
      <div className="muted small" style={{ margin: '12px 0 6px' }}>The key lasts</div>
      <Segmented value={days} onChange={setDays} options={[30, 90, 180, 365].map(v => ({ value: v, label: v === 365 ? '1 year' : v + ' days' }))} />
      <div style={{ height: 14 }} />
      <Button variant="primary" onClick={go} disabled={busy || key.trim().length < 10}>{busy ? 'Checking with Garmin…' : 'Connect'}</Button>
    </div>
    <p className="muted small">The key is stored encrypted on your server and never leaves it. Garmin emails you a week before it runs out.</p>
  </>
}

const TRENDS = {
  sleep: { label: 'Sleep', unit: 'h', color: 'var(--indigo)', y: d => d.sleepSec != null ? d.sleepSec / 3600 : null },
  hrv: { label: 'HRV', unit: 'ms', color: 'var(--teal)', y: d => d.hrv },
  rhr: { label: 'Resting HR', unit: 'bpm', color: 'var(--red)', y: d => d.restHr },
  steps: { label: 'Steps', unit: '', color: 'var(--green)', y: d => d.steps },
  bb: { label: 'Battery', unit: '', color: 'var(--blue)', y: d => d.bbMax },
}

function Connected({ g }) {
  const today = todayISO()
  const d = dayOf(g, today) || {}
  const ready = readiness(g, today)
  const [trend, setTrend] = useState('sleep')
  const tr = TRENDS[trend]
  const points = g.days.slice(-30).map(x => ({ t: Date.parse(x.date + 'T12:00:00'), d: x.date, y: tr.y(x) })).filter(p => p.y != null)
  const left = keyDaysLeft(g)
  const tile = (label, value, sub) => <div className="tile"><div className="l">{label}</div><div className="v">{value ?? '–'}</div>{sub && <div className="muted small">{sub}</div>}</div>
  const im = d.imMod != null || d.imVig != null ? (d.imMod || 0) + 2 * (d.imVig || 0) : null

  return <>
    {g.error && <div className="card" style={{ color: 'var(--red-ink)' }}><Icon name="warning" /> {g.error}</div>}
    {left != null && left <= 14 && <div className="card" style={{ color: 'var(--orange-ink, var(--orange))' }}>
      Your Garmin key runs out {left <= 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}. Make a new one and connect again.
    </div>}

    {ready && <div className="card">
      <div className="muted small">Today</div>
      <div className="big" style={{ marginTop: 3 }}>{READY_TITLE[ready.level]}</div>
      <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>
        {ready.bad.map(s => <div key={s} style={{ color: 'var(--orange-ink, var(--orange))' }}>• {s}</div>)}
        {ready.good.map(s => <div key={s} className="muted">• {s}</div>)}
      </div>
    </div>}

    <div className="tiles">
      {tile('Body battery', d.bbNow ?? d.bbMax, d.bbMax != null ? `high ${d.bbMax}, low ${d.bbMin ?? '–'}` : null)}
      {tile('Sleep', d.sleepSec ? fmtDuration(d.sleepSec) : null, [d.sleepScore != null && `score ${d.sleepScore}`, d.deepSec && `deep ${fmtDuration(d.deepSec)}`, d.remSec && `REM ${fmtDuration(d.remSec)}`].filter(Boolean).join(' · ') || null)}
      {tile('HRV', d.hrv != null ? d.hrv + ' ms' : null, d.hrvStatus ? d.hrvStatus.toLowerCase() + (d.hrvLow ? ` (usual ${d.hrvLow} to ${d.hrvHigh})` : '') : null)}
      {tile('Resting heart rate', d.restHr != null ? d.restHr + ' bpm' : null, d.sleepHr ? `${Math.round(d.sleepHr)} bpm asleep` : null)}
      {tile('Steps', d.steps != null ? n0(d.steps) : null, d.stepGoal ? `goal ${n0(d.stepGoal)}` : null)}
      {tile('Calories burned', d.kcal != null ? n0(d.kcal) : null, d.kcalActive != null ? `${n0(d.kcalActive)} active` : null)}
      {tile('Stress', d.stress != null && d.stress >= 0 ? d.stress : null, d.stressQ ? d.stressQ.toLowerCase().replace(/_/g, ' ') : null)}
      {tile('Intensity minutes', im, d.imGoal ? `weekly goal ${d.imGoal}` : null)}
    </div>

    <div className="card">
      <Segmented value={trend} onChange={setTrend} options={Object.entries(TRENDS).map(([value, x]) => ({ value, label: x.label }))} />
      <div style={{ height: 10 }} />
      {points.length >= 2
        ? <div className="chart"><LineChart points={points} h={160} unit={tr.unit} color={tr.color} /></div>
        : <p className="muted small">Not enough days yet.</p>}
    </div>

    {g.fitnessAge && <div className="card">
      <div className="muted small">Fitness age</div>
      <div className="big" style={{ marginTop: 3 }}>{fmtNum(g.fitnessAge.age)}</div>
      <div className="muted small">{[g.fitnessAge.real && `actual age ${g.fitnessAge.real}`, g.fitnessAge.best && `could reach ${fmtNum(g.fitnessAge.best)}`].filter(Boolean).join(' · ')}</div>
    </div>}

    <Section title="Activities">
      {!g.acts.length && <Row title="No activities in the last weeks" />}
      {g.acts.slice(0, 30).map(a => <Row key={a.id} title={a.name || activityType(a.type)}
        subtitle={`${fmtDate(activityDay(a))} · ${activityLine(a)}`} value={a.kcal ? n0(a.kcal) + ' kcal' : null}
        accessory="chevron" onClick={() => openSheet(c => <ActivitySheet a={a} close={c} />)} />)}
    </Section>

    <Section footer={g.lastSync ? `Last pulled from Garmin ${new Date(g.lastSync).toLocaleString()}. It pulls again every hour.` : null}>
      <Row icon="list" iconTint="var(--indigo)" title="What your key can read" accessory="chevron" onClick={() => openSheet(c => <ProbeSheet close={c} />)} />
      <Row icon="key" iconTint="var(--grey)" title="Replace key" accessory="chevron" onClick={() => setGarmin({ connected: false })} />
      <Row icon="trash" danger title="Disconnect Garmin" onClick={() => confirmSheet({
        title: 'Disconnect Garmin?', message: 'openGym forgets the key and everything it pulled. Your data in Garmin Connect stays as it is.',
        confirmText: 'Disconnect', danger: true,
        onConfirm: async () => { try { setGarmin(await disconnectGarmin()) } catch (e) { toast(e.message) } },
      })} />
    </Section>
  </>
}

function ActivitySheet({ a }) {
  const rows = [
    ['Date', a.start?.slice(0, 16).replace('T', ' ')],
    ['Duration', a.dur && fmtDuration(a.dur)],
    ['Distance', a.dist >= 100 && (a.dist / 1000).toFixed(2) + ' km'],
    ['Pace', /running|walking|hiking/.test(a.type || '') && a.speed && fmtPace(a.speed)],
    ['Speed', /cycling|biking/.test(a.type || '') && a.speed && (a.speed * 3.6).toFixed(1) + ' km/h'],
    ['Calories', a.kcal && n0(a.kcal) + ' kcal'],
    ['Average heart rate', a.hr && Math.round(a.hr) + ' bpm'],
    ['Max heart rate', a.maxHr && Math.round(a.maxHr) + ' bpm'],
    ['Elevation gain', a.elev && n0(a.elev) + ' m'],
    ['Aerobic training effect', a.te && a.te.toFixed(1)],
    ['Anaerobic training effect', a.ana && a.ana.toFixed(1)],
    ['Training load', a.load && n0(a.load)],
    ['Effect', a.label && a.label.toLowerCase().replace(/_/g, ' ')],
    ['VO2 max', a.vo2],
    ['Body battery', a.bb && (a.bb > 0 ? '+' : '') + a.bb],
    ['Steps', a.steps && n0(a.steps)],
    ['Sets', a.sets], ['Reps', a.reps],
  ].filter(([, v]) => v)
  return <>
    <h3>{a.name || activityType(a.type)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{activityType(a.type)}</div>
    <Section>{rows.map(([k, v]) => <Row key={k} title={k} value={String(v)} />)}</Section>
  </>
}

function ProbeSheet() {
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { setRes(await probeGarmin()) } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const copy = () => navigator.clipboard?.writeText(JSON.stringify(res, null, 1)).then(() => toast('Copied'), () => {})
  return <>
    <h3>What your key can read</h3>
    <p className="muted small">Asks every part of Garmin's Personal API once, and lists the fields that came back for you. Field names only, no values.</p>
    {!res && <Button variant="primary" onClick={run} disabled={busy}>{busy ? 'Asking Garmin… (about 30 s)' : 'Check now'}</Button>}
    {res?.endpoints && <>
      <Button size="sm" variant="ghost" icon="copy" onClick={copy}>Copy the list</Button>
      {res.endpoints.map(e => <Section key={e.path} title={e.path.split('/').filter(Boolean).slice(0, 3).join(' / ')}>
        <Row title={e.ok ? `${e.fields.length} fields` : `Not available (${e.status || 'no answer'})`}
          subtitle={e.ok ? e.fields.slice(0, 40).join(', ') : e.error} />
      </Section>)}
    </>}
  </>
}
