// The cycle screen's sheets: logging a day (flow, the questions of that day's phase, mood, a note)
// and the settings (reminder, who can see what, delete). Plain English: ours, not upstream's.
import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { FLOW, SYMPTOMS, MOODS, PHASES, PHASE_ASKS, phaseOn } from '../lib/cycle.js'
import { useCycle, saveDay, savePrefs, wipeCycle } from './useCycle.js'
import { Row, Segmented, Switch, TextArea, Section } from './ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)
const fail = e => toast(e.message)
const GENERIC = ['cramps', 'headache', 'fatigue', 'bloating', 'tender']

function AskRow({ title, on, set }) {
  return <div className="lrow">
    <span className="lrow-m"><span className="lrow-t">{title}</span></span>
    <Switch checked={!!on} onChange={set} aria-label={title} />
  </div>
}

/** The questions a phase asks, as rows to switch on. Used on the cycle screen and in the day sheet. */
export function PhaseAsks({ date, day }) {
  const c = useCycle()
  const ph = phaseOn(c?.days || {}, date)
  const ids = ph ? PHASE_ASKS[ph.phase] : GENERIC
  const has = day?.sym || []
  const flip = (id, v) => saveDay(date, { ...day, sym: v ? [...new Set([...has, id])] : has.filter(x => x !== id) }).catch(fail)
  return <>{ids.map(id => <AskRow key={id} title={SYMPTOMS[id].q} on={has.includes(id)} set={v => flip(id, v)} />)}</>
}

export function DaySheet({ date }) {
  const c = useCycle()
  const day = c?.days?.[date] || {}
  const ph = phaseOn(c?.days || {}, date)
  const ids = ph ? PHASE_ASKS[ph.phase] : GENERIC
  const rest = Object.keys(SYMPTOMS).filter(id => !ids.includes(id))
  const [note, setNote] = useState(day.note || '')
  const timer = useRef(null), latest = useRef({})
  latest.current = { day, note }
  const put = next => saveDay(date, next).catch(fail)
  // The note is saved a moment after typing stops, and once more when the sheet closes.
  const typed = v => { setNote(v); clearTimeout(timer.current); timer.current = setTimeout(() => put({ ...latest.current.day, note: v }), 600) }
  useEffect(() => () => {
    clearTimeout(timer.current)
    const { day: d, note: n } = latest.current
    if ((d.note || '') !== n.trim()) put({ ...d, note: n })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (key, id) => { const l = day[key] || []; put({ ...day, [key]: l.includes(id) ? l.filter(x => x !== id) : [...l, id] }) }
  return <>
    <h3>{fmtDate(date, true, true)}</h3>
    <p className="muted small">{ph ? `${PHASES[ph.phase].label}, day ${ph.day} (an estimate)` : 'Log the first day of a period to see your phase.'}</p>
    <div className="muted small" style={{ margin: '12px 0 6px' }}>Flow</div>
    <Segmented value={day.flow || 0} onChange={v => put({ ...day, flow: v })} options={FLOW.map((label, value) => ({ value, label }))} />
    <Section title={ph ? `Often asked in your ${PHASES[ph.phase].label.toLowerCase()}` : 'How are you feeling?'}><PhaseAsks date={date} day={day} /></Section>
    <div className="muted small" style={{ margin: '12px 0 6px' }}>More symptoms</div>
    <div className="chips wrap">{rest.map(id => <button key={id} className={'chip' + ((day.sym || []).includes(id) ? ' on' : '')} onClick={() => flip('sym', id)}>{SYMPTOMS[id].label}</button>)}</div>
    <div className="muted small" style={{ margin: '12px 0 6px' }}>Mood</div>
    <div className="chips wrap">{Object.entries(MOODS).map(([id, label]) => <button key={id} className={'chip' + ((day.mood || []).includes(id) ? ' on' : '')} onClick={() => flip('mood', id)}>{label}</button>)}</div>
    <div className="muted small" style={{ margin: '12px 0 6px' }}>Notes</div>
    <TextArea rows={3} maxLength={1000} placeholder="Anything worth remembering" value={note} onChange={e => typed(e.target.value)} />
  </>
}

const LEVEL = [{ value: 'off', label: 'Off' }, { value: 'phase', label: 'Phase' }, { value: 'period', label: '+ Next period' }]

export function CycleSettings() {
  const c = useCycle()
  if (!c) return null
  const p = c.prefs || {}, share = p.share || {}
  const setLevel = (uid, v) => {
    const next = { ...share }
    if (v === 'off') delete next[uid]; else next[uid] = v
    savePrefs({ share: next }).catch(fail)
  }
  return <>
    <h3>Cycle settings</h3>
    <p className="muted small">Your log stays on the server, encrypted, and is not part of your synced profile. Only you can read it.</p>
    <Section title="Reminder" footer="One plain notification the morning before an expected period, with no detail on the lock screen. Sent to the devices where notifications are on in openGym's settings.">
      <AskRow title="Remind me the day before" on={p.push?.period} set={v => savePrefs({ push: { period: v } }).catch(fail)} />
    </Section>
    <Section title="Share with" footer="Nobody sees anything until you pick them. Phase shows only the name of your current phase; the other level adds when your next period is expected. Symptoms, moods, notes and fertile days are never shared. You can stop at any time.">
      {(c.people || []).length === 0 && <div className="lrow"><span className="lrow-m"><span className="lrow-s">No other accounts on this server yet.</span></span></div>}
      {(c.people || []).map(u => <div className="lrow" key={u.uid} style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="lrow-m"><span className="lrow-t">{u.name || 'Account'}</span></span>
        <Segmented value={share[u.uid] || 'off'} onChange={v => setLevel(u.uid, v)} options={LEVEL} />
      </div>)}
    </Section>
    <Section title="Your data">
      <Row icon="trash" danger title="Delete all cycle data" onClick={() => confirmSheet({
        title: 'Delete all cycle data?', message: 'Every day you logged and your settings are removed from the server. This cannot be undone.',
        confirmText: 'Delete', danger: true,
        onConfirm: () => wipeCycle().then(() => toast('Cycle data deleted'), fail),
      })} />
    </Section>
  </>
}
