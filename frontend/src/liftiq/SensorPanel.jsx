// LIFTIQ-FORK: connection panel of the LiftIQ sensor (used by Settings and by the Connect stage of
// the set sheet). Plain English on purpose, see LIFTIQ-FORK.md.
import { sensorStore } from './mini-store.js'
import { bluetoothSupport, SUPPORT_TEXT } from './feature.js'
import { batteryText, statusText } from './format.js'
import { Button } from '../components/ui.jsx'

export default function SensorPanel({ sensor }) {
  const s = sensorStore.use()
  const support = bluetoothSupport()
  const busy = s.status === 'connecting'
  const connected = s.status === 'connected'
  return <div className="liftiq-panel">
    {!support.ok && <div className="muted small" role="alert" style={{ marginBottom: 12, lineHeight: 1.45 }}>{SUPPORT_TEXT[support.reason]}</div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: connected ? 'var(--green)' : 'var(--label-3)', flex: 'none' }} />
      <strong>{statusText(s)}</strong>
      {s.simulated && <span className="tag">Simulated</span>}
    </div>
    {connected && <div className="muted small" style={{ lineHeight: 1.6, marginBottom: 6 }}>
      <div>Battery: {batteryText(s.battery)}</div>
      <div>Firmware: {s.info || 'Unknown'}</div>
    </div>}
    {s.error && !connected && <div className="small" role="alert" style={{ color: 'var(--red)', marginBottom: 8 }}>{s.error}</div>}
    <div style={{ height: 8 }} />
    {connected
      ? <Button variant="plain" onClick={() => sensor.disconnect()}>Disconnect</Button>
      : <Button variant="primary" icon="bolt" disabled={busy || !support.ok} onClick={() => sensor.connect()}>{busy ? 'Connecting…' : 'Connect sensor'}</Button>}
    {!connected && support.ok && !busy && <div className="dim small" style={{ marginTop: 8 }}>Pick the device named LiftIQ-XXXX in the browser's list.</div>}
  </div>
}
