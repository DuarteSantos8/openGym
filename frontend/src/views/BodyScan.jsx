import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { SCAN_FIELDS, SCAN_SEGMENTS, parseScaleQr, readScan, scanDisplay, scanReadable, scanUnit } from '../lib/bodyscan.js'
import { applyScanImport, scanImportPreview } from '../lib/bodyscan-import.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { normalizeQr } from '../lib/exercise-qr.js'
import { t } from '../lib/i18n.js'
import { scanOnce } from '../components/CameraScan.jsx'
import { Button, Switch } from '../components/ui.jsx'

// A body-composition scale's QR code (lib/bodyscan.js): scanned from Body measurements or from a
// workout's scan button, shown before it is saved, then kept on the day's check-in.

const toast = message => useUI.getState().toast(message)
const MAIN = SCAN_FIELDS.filter(f => !f.seg)

/** The scan's headline numbers as tiles; `values` is readScan's `{ key: value }`. */
function ScanTiles({ values, unit }) {
  const shown = MAIN.filter(f => values[f.key] != null)
  if (!shown.length) return null
  return <div className="tiles bodyscan-tiles">{shown.map(f => <div className="tile" key={f.key}>
    <div className="l">{t(f.label)}</div>
    <div className="v">{fmtNum(scanDisplay(f.key, values[f.key], unit))} <span className="muted" style={{ fontSize: '.9rem', fontWeight: 400 }}>{scanUnit(f.key, unit)}</span></div>
  </div>)}</div>
}

/** Lean and fat mass per arm, leg and the trunk, when the scan has them. */
function ScanSegments({ values, unit }) {
  const cell = (seg, part) => {
    const key = SCAN_FIELDS.find(f => f.seg === seg && f.part === part).key
    return values[key] == null ? '–' : fmtNum(scanDisplay(key, values[key], unit))
  }
  if (!SCAN_SEGMENTS.some(s => values[s.seg + 'Lean'] != null || values[s.seg + 'Fat'] != null)) return null
  const u = unit === 'lb' ? 'lb' : 'kg'
  return <table className="bodyscan-seg">
    <thead><tr><th /><th>{t('Lean')} ({u})</th><th>{t('Fat')} ({u})</th></tr></thead>
    <tbody>{SCAN_SEGMENTS.map(s => <tr key={s.seg}>
      <th scope="row">{t(s.label)}</th><td>{cell(s.seg, 'lean')}</td><td>{cell(s.seg, 'fat')}</td>
    </tr>)}</tbody>
  </table>
}

/** A note for a scan whose layout is not known yet: kept, not read. */
const unreadableNote = scan => t('This scale’s code ({0} values) can’t be read yet. The scan is kept and shows once its layout is known.', scan.len)

function ScanImport({ values, close }) {
  const S = useStore(s => s.S)
  const date = todayISO()
  const p = scanImportPreview(S, values, date)
  const [weighIn, setWeighIn] = useState(p.weightKg != null)
  const read = readScan(p.scan)
  const save = () => {
    useStore.getState().update(s => { applyScanImport(s, values, { date, weighIn }) })
    close()
    toast(t('Body scan saved'))
  }
  return <>
    <h3>{t('Body scan')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('From the scale, {0}', fmtDate(date, true))}</div>
    {scanReadable(p.scan) ? <>
      <ScanTiles values={read} unit={S.unit} />
      <ScanSegments values={read} unit={S.unit} />
    </> : <div className="muted small" style={{ marginBottom: 12 }}>{unreadableNote(p.scan)}</div>}
    {p.weightKg != null && <div className="lrow" style={{ marginTop: 6 }}>
      <span className="lrow-m">
        <span className="lrow-t">{t('Log as today’s weigh-in')}</span>
        {p.hadWeight && <span className="lrow-s">{t('Replaces today’s {0}', fmtNum(p.hadWeight.w) + ' ' + (S.unit || 'kg'))}</span>}
      </span>
      <Switch checked={weighIn} onChange={setWeighIn} aria-label={t('Log as today’s weigh-in')} />
    </div>}
    {p.hadScan && <div className="small" style={{ marginTop: 10, color: 'var(--orange)' }}>{t('Replaces the scan already saved for today.')}</div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Show a scale's numbers and save them on confirm. `values` is parseScaleQr's array. */
export function bodyScanImportSheet(values) {
  return useUI.getState().openSheet(close => <ScanImport values={values} close={close} />)
}

/** Scan a code; a scale's opens the import, anything else says it is not one. */
export async function scanBodyScale() {
  const code = normalizeQr((await scanOnce())?.value)
  if (!code) return
  const values = parseScaleQr(code)
  if (values) bodyScanImportSheet(values)
  else toast(t('That isn’t a body scan code'))
}

/** The latest scan on Body measurements: its numbers, or why it cannot show them. */
export function BodyScanCard({ entry, unit }) {
  const scan = entry?.scan
  if (!scan) return null
  const values = readScan(scan)
  return <div className="card bodyscan-card">
    <div className="row between" style={{ marginBottom: 10 }}>
      <div><div className="muted small">{t('Body scan')}</div><b>{fmtDate(entry.d, true)}</b></div>
      <Button size="sm" icon="qr" onClick={scanBodyScale}>{t('Scan')}</Button>
    </div>
    {scanReadable(scan) ? <>
      <ScanTiles values={values} unit={unit} />
      <ScanSegments values={values} unit={unit} />
    </> : <div className="muted small">{unreadableNote(scan)}</div>}
  </div>
}
