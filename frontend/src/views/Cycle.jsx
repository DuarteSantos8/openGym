// Cycle tracking: log periods and symptoms, see where you are in the cycle, the estimated next
// period and fertile window, a calendar and your own averages. Private to the account unless it
// picks who may see its phase (components/CycleSheets.jsx). Plain English: ours, not upstream's.
// Every date and phase is an ESTIMATE from the person's own logs: not contraception, not medical advice.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, todayISO, weekStartOf, DAYS } from '../lib/format.js'
import { PHASES, SYMPTOMS, addDays, forecast, kindOn, monthGrid, periods, phaseOn, stats, symptomsByPhase } from '../lib/cycle.js'
import { useCycle, saveDay, savePrefs, refreshCycle } from '../components/useCycle.js'
import { DaySheet, CycleSettings, PhaseAsks } from '../components/CycleSheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section } from '../components/ui.jsx'

const openSheet = render => useUI.getState().openSheet(render)
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null } })()

export default function Cycle() {
  const nav = useNavigate()
  const c = useCycle()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/" onClick={() => nav(-1)} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Cycle</h1><div className="sub">Private to you</div></div>
      {c && <button className="iconbtn" onClick={() => openSheet(() => <CycleSettings />)} aria-label="Cycle settings"><Icon name="gear" /></button>}
    </div>
    {c === undefined && <p className="muted">Loading…</p>}
    {c === null && <div className="card"><p className="muted">This server has no cycle tracking, or it could not be reached. <Button size="sm" variant="ghost" onClick={() => refreshCycle()}>Try again</Button></p></div>}
    {c && <Body c={c} />}
  </div>
}

function Body({ c }) {
  const S = useStore(s => s.S)
  const days = c.days, today = todayISO()
  const ps = useMemo(() => periods(days), [days])
  const st = useMemo(() => stats(days), [days])
  const fc = useMemo(() => forecast(days), [days])
  const ph = phaseOn(days, today, ps, st)
  // The wearer's own clock decides "today" for reminders and for what a friend sees.
  useEffect(() => { if (TZ && c.prefs.tz !== TZ) savePrefs({ tz: TZ }).catch(() => {}) }, [c.prefs.tz])
  const next = fc[0]
  const range = next && st.spread > 0 ? `${fmtDate(addDays(next.start, -st.spread))} to ${fmtDate(addDays(next.start, st.spread))}` : next && fmtDate(next.start)
  const startToday = () => saveDay(today, { ...days[today], flow: 2 }).catch(e => useUI.getState().toast(e.message))
  return <>
    <div className="card cy-hero">
      {!ph && <>
        <div className="cy-phase">Welcome</div>
        <p className="muted" style={{ margin: '6px 0 12px' }}>Log the first day of your last period and openGym will start estimating your cycle. The more you log, the better it gets.</p>
        <Button variant="primary" onClick={startToday}>Period started today</Button>
      </>}
      {ph && <>
        <div className="cy-eyebrow">Today</div>
        <div className="cy-phase">{PHASES[ph.phase].label}</div>
        <div className="muted">Cycle day {ph.day}{ph.late > 0 ? `, ${ph.late} day${ph.late === 1 ? '' : 's'} past the expected start. Cycles vary, this can be normal.` : ''}</div>
        <p style={{ margin: '10px 0 0' }}>{PHASES[ph.phase].tip}</p>
        <div className="cy-facts">
          {next && ph.late === 0 && <div><span className="muted">Next period</span><b>{range}</b></div>}
          {next && ph.late === 0 && <div><span className="muted">Fertile window</span><b>{fmtDate(next.fertile.from)} to {fmtDate(next.fertile.to)}</b></div>}
        </div>
        {!days[today]?.flow && <Button size="sm" variant="tinted" onClick={startToday}>Period started today</Button>}
      </>}
      <p className="muted small cy-note">Estimates from your own logs. Not contraception and not medical advice.</p>
    </div>

    <Section title={ph ? `How are you feeling? ${PHASES[ph.phase].label}` : 'How are you feeling?'}>
      <PhaseAsks date={today} day={days[today]} />
      <Row icon="pencil" iconTint="var(--pink)" title="Flow, mood, more symptoms and notes" accessory="chevron" onClick={() => openSheet(() => <DaySheet date={today} />)} />
    </Section>

    <Calendar days={days} fc={fc} today={today} weekStart={weekStartOf(S)} />
    <History days={days} ps={ps} st={st} />
    {c.partners?.length > 0 && <Section title="Shared with you">
      {c.partners.map(p => <Row key={p.uid} icon="person" iconTint="var(--pink)" title={p.name}
        subtitle={`${PHASES[p.phase].label}, day ${p.day}`} value={p.next ? `Next ${fmtDate(p.next.from)}${p.next.to !== p.next.from ? ' to ' + fmtDate(p.next.to) : ''}` : null} />)}
    </Section>}
  </>
}

function Calendar({ days, fc, today, weekStart }) {
  const now = new Date(today + 'T00:00:00')
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()])
  const grid = monthGrid(ym[0], ym[1], weekStart)
  const go = n => { const d = new Date(ym[0], ym[1] + n, 1); setYm([d.getFullYear(), d.getMonth()]) }
  const heads = [...DAYS.slice(weekStart), ...DAYS.slice(0, weekStart)]
  return <div className="card">
    <div className="hdr" style={{ marginBottom: 0 }}>
      <button className="iconbtn" onClick={() => go(-1)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{new Date(ym[0], ym[1], 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
      <button className="iconbtn" onClick={() => go(1)} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="cal-grid">
      {heads.map((h, i) => <div key={i} className="cal-h">{h}</div>)}
      {grid.flat().map((d, i) => {
        if (!d) return <div key={i} />
        const kind = kindOn(days, d, fc), logged = days[d] && (days[d].sym?.length || days[d].mood?.length || days[d].note)
        const future = d > today
        return <button key={i} className={'cal-d' + (kind ? ' cy-' + kind : '') + (d === today ? ' today' : '')} disabled={future}
          aria-label={fmtDate(d, true) + (kind ? ', ' + kind : '')} onClick={() => openSheet(() => <DaySheet date={d} />)}>
          {Number(d.slice(8))}<i className={logged ? 'done' : ''} />
        </button>
      })}
    </div>
    <div className="cal-legend" style={{ flexWrap: 'wrap' }}>
      <span><i style={{ background: 'var(--pink)' }} />Period</span>
      <span><i style={{ background: 'var(--pink)', opacity: 0.4 }} />Expected</span>
      <span><i style={{ background: 'var(--teal)' }} />Fertile</span>
      <span><i style={{ background: 'var(--indigo)' }} />Ovulation</span>
    </div>
  </div>
}

function History({ days, ps, st }) {
  const by = useMemo(() => symptomsByPhase(days), [days])
  if (!ps.length) return null
  const lens = st.lengths.slice(-6)
  const top = Math.max(...lens, st.cycle)
  return <>
    <Section title="Your averages" footer={st.known ? 'From your last six cycles. Cycles of fewer than 15 or more than 60 days are left out.' : 'Until two periods are logged, the usual 28-day cycle and 5-day period are used.'}>
      <Row title="Average cycle" value={`${st.cycle} days`} subtitle={st.known && st.min !== st.max ? `Between ${st.min} and ${st.max}` : null} />
      <Row title="Average period" value={`${st.period} day${st.period === 1 ? '' : 's'}`} />
      <Row title="Periods logged" value={String(st.count)} />
    </Section>
    {lens.length > 0 && <Section title="Recent cycles">
      {lens.map((n, i) => {
        const p = ps[ps.length - lens.length - 1 + i]
        return <div className="lrow" key={i}>
          <span className="lrow-m"><span className="lrow-t">{fmtDate(p.start)}</span>
            <span className="cy-bar"><span style={{ width: `${(n / top) * 100}%` }} /></span></span>
          <span className="lrow-v">{n} days</span>
        </div>
      })}
    </Section>}
    {Object.keys(by).length > 0 && <Section title="What you log most, by phase">
      {Object.entries(by).map(([phase, list]) => <Row key={phase} title={PHASES[phase].label} subtitle={list.map(([id, n]) => `${SYMPTOMS[id].label} (${n})`).join(', ')} />)}
    </Section>}
  </>
}
