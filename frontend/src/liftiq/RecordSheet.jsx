// LIFTIQ-FORK: "Record with sensor" bottom sheet. One sheet, inline stages (no modal on modal):
//   Connect -> Ready check -> Recording -> Review (then the set is written through the workout's own handlers).
// Plain English on purpose (deliberate deviation, see LIFTIQ-FORK.md); upstream's t() keys need 25 locale packs.
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { Button, Stepper, Switch } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import SensorPanel from './SensorPanel.jsx'
import { sensorStore } from './mini-store.js'
import { getSensor } from './controller.js'
import { pickAnalysis, vbtFromReview, writeBack } from './review.js'
import { clock } from './format.js'
import PKG from './vendor/liftiq-sensor/VERSION.json'

/** Opens the sheet. ctx: { i, set, unit, title, subtitle, onField, onToggle, sensor? } */
export function openRecordSheet(ctx) {
  const sensor = ctx.sensor || getSensor()
  let handle = null
  handle = useUI.getState().openSheet(close => (
    <RecordSheet {...ctx} sensor={sensor} close={close} lock={v => handle?.lock(v)} />
  ), { locked: false })
  return handle
}

const Ring = ({ progress, ready }) => {
  const R = 54, C = 2 * Math.PI * R
  return <svg viewBox="0 0 128 128" width="150" height="150" role="img" aria-label={ready ? 'Ready' : 'Hold the handle still, ' + Math.round(progress * 100) + ' percent'}>
    <circle cx="64" cy="64" r={R} fill="none" stroke="var(--fill-3)" strokeWidth="10" />
    <circle cx="64" cy="64" r={R} fill="none" stroke={ready ? 'var(--green)' : 'var(--acc)'} strokeWidth="10" strokeLinecap="round"
      strokeDasharray={C} strokeDashoffset={C * (1 - (ready ? 1 : progress))} transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset .15s linear' }} />
    <text x="64" y="70" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--label)">{ready ? 'Ready' : 'Hold still'}</text>
  </svg>
}

// Peak velocity of each detected pull; a setup pull that is not counted is drawn faded.
function Bars({ bars }) {
  if (!bars.length) return null
  const max = Math.max(0.8, ...bars.map(b => b.vPeak))
  const W = 300, H = 96, gap = 6
  const bw = Math.min(34, (W - gap * (bars.length - 1)) / bars.length)
  const x0 = (W - (bw * bars.length + gap * (bars.length - 1))) / 2
  return <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label={'Peak velocity per rep: ' + bars.map(b => b.vPeak.toFixed(2)).join(', ') + ' metres per second'}>
    {bars.map((b, k) => {
      const h = Math.max(2, (b.vPeak / max) * (H - 14))
      const x = x0 + k * (bw + gap)
      return <g key={b.n} opacity={b.counted ? 1 : 0.35}>
        <rect x={x} y={H - h} width={bw} height={h} rx="4" fill={b.setup ? 'var(--orange)' : 'var(--acc)'} />
        <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize="10" fill="var(--label-2)">{b.vPeak.toFixed(2)}</text>
        <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize="10" fill="var(--label-2)">{b.setup ? 'setup' : String(b.n - (bars[0].setup ? 1 : 0))}</text>
      </g>
    })}
  </svg>
}

const stat = (label, value) => <div style={{ flex: 1, minWidth: 0 }}>
  <div className="muted small">{label}</div>
  <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
</div>

function RecordSheet({ i, set, unit = 'kg', title, subtitle, onField, onToggle, sensor, close, lock }) {
  const s = sensorStore.use()
  const connected = s.status === 'connected'
  const stage = s.mode === 'recording' ? 'recording' : s.mode === 'review' ? 'review' : connected ? 'ready' : 'connect'
  const [includeSetup, setIncludeSetup] = useState(false)
  const [edited, setEdited] = useState(null)
  const [weight, setWeight] = useState(Number(set?.w) || 0)
  const [editCount, setEditCount] = useState(false)

  // Connected and idle: start the stillness check. Closing the sheet drops whatever is in flight.
  useEffect(() => { if (connected && s.mode === 'idle') sensor.beginReady() }, [connected, s.mode, sensor])
  // `lock` is a fresh closure on every render: it must not be a dependency (it would loop).
  useEffect(() => { lock(stage === 'recording' || stage === 'review') }, [stage]) // eslint-disable-line
  useEffect(() => () => { if (sensorStore.getState().mode !== 'idle') sensor.discard() }, [sensor])

  const review = stage === 'review' ? sensor.getReview() : null
  const chosen = review ? pickAnalysis(review, includeSetup) : null
  const count = edited ?? chosen?.count ?? 0
  const exit = () => { sensor.discard(); close() }
  const confirm = () => {
    const vbt = vbtFromReview(review, includeSetup, PKG.version)
    writeBack({ i, set, reps: count, weight, vbt, onField, onToggle })
    sensor.discard()
    close()
  }
  const step = unit === 'lb' ? 5 : 2.5

  return <div className="liftiq-record" style={{ paddingBottom: 4 }}>
    <h3 style={{ marginBottom: 2 }}>Record with sensor</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{[title, subtitle].filter(Boolean).join(' · ')}</div>

    {stage === 'connect' && <>
      <SensorPanel sensor={sensor} />
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" onClick={exit}>Cancel</Button>
    </>}

    {stage === 'ready' && <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '4px 0 14px' }}>
        <Ring progress={s.ready.progress} ready={s.ready.ready} />
        <div className="muted small" style={{ textAlign: 'center' }}>
          {s.ready.ready ? 'Hold the handle, then start and pull.' : 'Let the weight hang still for a moment.'}
        </div>
      </div>
      <Button variant="primary" icon="play" disabled={!s.ready.ready} onClick={() => sensor.startRecording()}>Start recording</Button>
      <div style={{ height: 6 }} />
      {!s.ready.ready && <Button variant="plain" onClick={() => sensor.startRecording()}>Start without the check</Button>}
      <Button variant="ghost" className="dim" onClick={exit}>Cancel</Button>
    </>}

    {stage === 'recording' && <>
      <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
        <div aria-live="polite" style={{ fontSize: 96, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em' }} data-testid="liftiq-count">{s.count}</div>
        <div className="muted small">{s.counterReady ? 'reps (live estimate, the setup pull counts here)' : 'getting ready, hold still…'}</div>
        <div style={{ fontSize: 20, marginTop: 6, fontVariantNumeric: 'tabular-nums' }} data-testid="liftiq-elapsed">{clock(s.elapsedS)}</div>
      </div>
      <Button variant="danger" icon="pause" style={{ minHeight: 64, fontSize: 20, fontWeight: 600 }} onClick={() => sensor.stop()}>STOP</Button>
      <div style={{ height: 6 }} />
      <Button variant="ghost" className="dim" onClick={exit}>Discard</Button>
    </>}

    {stage === 'review' && review && <>
      {review.interrupted && <div className="small" role="alert" style={{ color: 'var(--orange)', marginBottom: 10 }}>The sensor disconnected during the set. Review what was captured.</div>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }} data-testid="liftiq-review-count">{count}</div>
        <div className="muted">{count === 1 ? 'rep' : 'reps'}{edited !== null && edited !== chosen.count ? ' (edited, detected ' + chosen.count + ')' : ' detected'}</div>
      </div>
      <Bars bars={chosen.bars} />
      <div style={{ display: 'flex', gap: 12, margin: '8px 0 12px' }}>
        {stat('Mean peak velocity', chosen.metrics.meanPeakVelocity == null ? '-' : chosen.metrics.meanPeakVelocity.toFixed(2) + ' m/s')}
        {stat('Velocity loss', chosen.metrics.velocityLossPct == null ? '-' : Math.round(chosen.metrics.velocityLossPct) + ' %')}
      </div>
      {review.setupFlagged && <div className="lrow" style={{ marginBottom: 6 }}>
        <span className="lrow-m"><span className="lrow-t">Include setup pull</span><span className="lrow-s">The first, longer pull looks like setting up</span></span>
        <Switch checked={includeSetup} onChange={v => { setIncludeSetup(v); setEdited(null) }} aria-label="Include setup pull" />
      </div>}
      <div style={{ margin: '8px 0 12px' }}>
        <Stepper label={'Weight'} unit={unit} value={weight} step={step} min={0} max={1000} onChange={setWeight} />
      </div>
      {(editCount || chosen.count === 0) && <div style={{ margin: '0 0 12px' }}>
        <Stepper label="Reps" value={count} step={1} min={0} max={99} decimal={false} onChange={v => setEdited(v)} />
      </div>}
      <Button variant="primary" icon="check" disabled={count < 1} onClick={confirm}>{'Use ' + count + (count === 1 ? ' rep' : ' reps')}</Button>
      <div style={{ height: 6 }} />
      {!(editCount || chosen.count === 0) && <Button variant="tinted" icon="pencil" onClick={() => setEditCount(true)}>Edit count</Button>}
      <div style={{ height: 6 }} />
      <Button variant="ghost" className="dim" onClick={exit}>Discard</Button>
    </>}
  </div>
}
