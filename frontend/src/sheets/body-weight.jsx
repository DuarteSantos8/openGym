import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { fmtDate, fmtNum, todayISO, weekStartOf } from '../lib/format.js'
import { lastBW } from '../lib/history.js'
import { t, tn } from '../lib/i18n.js'
import { closeThenNav } from '../lib/nav.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Slider, NumberField } from '../components/ui.jsx'
import { syncNow } from '../lib/nutrition/sync.js'
import { deltaTone, weeklyWeights } from '../lib/bodyweight.js'
import { S, update, ui, toast } from './shared.js'
import { confirmSheet } from './confirm-menu.jsx'

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons, and typing straight into the read-out, cover
// exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
// A typed body weight may sit past the slider (a 320 kg lifter is real), but not past any
// person: 9999 saved, drew the chart from -0 to 10,000 and set a goal 9,922 kg away.
const bwMax = unit => (unit === 'lb' ? 1500 : 700)
const bwTooHeavy = (n, unit) => {
  if (n <= bwMax(unit)) return false
  toast(t('That looks too heavy. Keep it at {0} or less.', fmtNum(bwMax(unit)) + ' ' + unit))
  return true
}
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  const onType = v => setValue(v)

  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label={t('Decrease by {0}', fmtNum(0.1))}><Icon name="minus" /></button>
      <label className="bw-read">
        <NumberField fit value={value} onChange={onType} aria-label={t('Weight ({0})', unit)} enterKeyHint="done"
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <span className="u"> {unit}</span>
      </label>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label={t('Increase by {0}', fmtNum(0.1))}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
// `date`: the day the weigh-in is for (Home on a past day); today when absent.
function BwSheet({ required, onDone, close, date }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  // Never a day to come: a weight logged ahead would read as the current one (lastBW).
  const day = date && date < todayISO() ? date : todayISO()
  const onDay = st.bodyweight.find(b => b.d === day)
  const [v, setV] = useState(onDay ? onDay.w : bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    if (bwTooHeavy(n, unit)) return
    // `t` is when the weigh-in was logged, the sync's change stamp (lib/sync-merge.js stampChange
    // restamps it on every edit); charts place it by its day `d` (lib/bodyweight.js weighInTime).
    update(s => {
      const ex = s.bodyweight.find(b => b.d === day)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: day, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    // The weight goes to NutriTrace now rather than at the hub's next poll.
    void syncNow()
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  return <>
    {/* This sheet opens `locked` — swipe/backdrop/Escape/Android-back all no-op on it (see
        Modals.jsx) so an accidental tap on "Start" can't be walked back by reflex the way
        every other sheet in the app can. The two buttons below already cover leaving it
        deliberately; this is the same close a normal sheet gets everywhere else, just
        opted back in explicitly instead of by omission. Plain close() — no onDone, no
        nav — so it's a true no-op: the screen underneath is exactly where you left it. */}
    {required
      ? <div className="row between" style={{ marginBottom: 14 }}>
          <h3 style={{ marginBottom: 0 }}>{t('Quick check-in')}</h3>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={() => close()}><Icon name="xmark" /></button>
        </div>
      : <h3>{t('Log body weight')}</h3>}
    <div className="muted small">{required ? t('Slide or tap to set your weight. We ask before your first workout each day so your curve stays honest.') : day === todayISO() ? t('Today') + ', ' + fmtDate(day, true) : fmtDate(day, true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="swap" onClick={() => closeThenNav(close, '/train/workout')}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <WeighInRow key={b.d} b={b} unit={unit} />)}
      </div>
      {st.bodyweight.length > recent.length && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
      </div>}
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

// One weigh-in with its delete button, in the log sheet's recent three and in the full list.
// The full list asks first (`confirm`): it is months of history scrolled through on a phone, and a
// stray tap on one of its trash buttons took a past weigh-in with nothing to bring it back. The log
// sheet's three are the ones just typed, where taking back a typo in one tap is the point.
function WeighInRow({ b, unit, confirm = false }) {
  const delEntry = () => update(s => { s.bodyweight = s.bodyweight.filter(x => x.d !== b.d) })
  const ask = () => confirmSheet({
    title: t('Delete weigh-in?'), message: `${fmtDate(b.d, true)} · ${fmtNum(b.w)} ${unit}`,
    confirmText: t('Delete'), danger: true, onConfirm: delEntry,
  })
  return <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
    <span className="small muted">{fmtDate(b.d, true)}</span>
    <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red-ink)' }} onClick={confirm ? ask : delEntry} aria-label={t('Delete weigh-in')}><Icon name="trash" /></button></span>
  </div>
}

/* ============================ weigh-ins ============================ */
// Every weigh-in, week by week (Discord 'Weight'): each week under its mean and how far that
// moved from the week before, the numbers behind the curve on the card. The chart plots the
// weekly means, since the swing from one morning to the next is what makes a single weigh-in
// hard to read. The weeks start on the profile's first day of the week.
function WeighIns() {
  const st = useStore(s => s.S)
  const ws = weekStartOf(st)
  const weeks = useMemo(() => weeklyWeights(st.bodyweight, ws), [st.bodyweight, ws])
  const points = useMemo(() => [...weeks].reverse()
    .map(w => ({ t: new Date(w.key + 'T12:00:00').getTime(), y: Math.round(w.avg * 100) / 100, d: w.key })), [weeks])
  const n = weeks.reduce((sum, w) => sum + w.n, 0)
  if (!n) return <>
    <h3>{t('Weigh-ins')}</h3>
    <div className="empty"><div className="ico"><Icon name="scale" /></div>{t('No weigh-ins yet. Log your weight to start the curve.')}</div>
  </>
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Weigh-ins')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{tn('{0} weigh-in', '{0} weigh-ins', n)}</div>
    <div className="chart"><LineChart points={points} h={140} unit={st.unit} goal={st.targetW} label={t('Weight')} /></div>
    <div className="small dim" style={{ marginTop: 6 }}>{t('Weekly average')}</div>
    {weeks.map(w => {
      // Only a change the display can show: at one decimal, 0.02 kg is "0", and an arrow over a
      // zero says something moved when, as far as the screen goes, nothing did.
      const moved = w.delta != null && fmtNum(Math.abs(w.delta)) !== fmtNum(0)
      return <div key={w.key} data-week={w.key}>
        <div className="row between" style={{ margin: '16px 2px 4px', gap: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t('Week of {0}', fmtDate(w.key))}</span>
          <span className="small row" style={{ gap: 8 }}>
            {moved && <span className="row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(w.delta, w.avg) }}>
              <Icon name={w.delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(w.delta))}
            </span>}
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{t('Average {0}', fmtNum(w.avg) + ' ' + st.unit)}</span>
          </span>
        </div>
        <div className="list" style={{ gap: 0 }}>{w.entries.map(b => <WeighInRow key={b.d} b={b} unit={st.unit} confirm />)}</div>
      </div>
    })}
  </>
}
export const weighInsSheet = () => ui().openSheet(close => <WeighIns close={close} />)

/* ============================ target weight ============================ */
const DELTA_COLOR = { none: 'var(--label-2)', plain: 'var(--label)', toward: 'var(--acc-ink)', away: 'var(--red-ink)' }
export const bwDeltaColor = (delta, currentW) => DELTA_COLOR[deltaTone(delta, currentW, S().targetW)]
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      if (bwTooHeavy(n, st.unit)) return
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)
