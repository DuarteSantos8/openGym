import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { SCAN_FIELDS, SCAN_SEGMENTS, parseScaleQr, readScan, scanDisplay, scanReadable, scanUnit } from '../lib/bodyscan.js'
import { applyScanImport, scanImportPreview } from '../lib/bodyscan-import.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { normalizeQr } from '../lib/exercise-qr.js'
import { t } from '../lib/i18n.js'
import { scanOnce } from '../components/CameraScan.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { Button, Segmented, SelectRow, Switch } from '../components/ui.jsx'
import { bodyScaleOn } from '../lib/features.js'

// A body-composition scale's QR code (lib/bodyscan.js): scanned from Body measurements or from a
// workout's scan button, shown before it is saved, then kept on the day's check-in.

const toast = message => useUI.getState().toast(message)
const MAIN = SCAN_FIELDS.filter(f => !f.seg)

/*
 * How a field moved since the scan before, as it shows ("+0.4"), or null. Neutral on purpose:
 * whether less fat or more water is the better news depends on what you are after.
 */
function deltaText(key, now, before, unit) {
  if (now == null || before == null) return null
  const d = Math.round((scanDisplay(key, now, unit) - scanDisplay(key, before, unit)) * 10) / 10
  return d ? (d > 0 ? '+' : '−') + fmtNum(Math.abs(d)) : null
}

/** The scan's headline numbers as tiles; `values` is readScan's `{ key: value }`, `prev` the scan before. */
function ScanTiles({ values, unit, prev }) {
  const shown = MAIN.filter(f => values[f.key] != null)
  if (!shown.length) return null
  return <div className="tiles bodyscan-tiles">{shown.map(f => {
    const d = prev && deltaText(f.key, values[f.key], prev[f.key], unit)
    return <div className="tile" key={f.key}>
      <div className="l">{t(f.label)}</div>
      <div className="v">{fmtNum(scanDisplay(f.key, values[f.key], unit))} <span className="muted" style={{ fontSize: '.9rem', fontWeight: 400 }}>{scanUnit(f.key, unit)}</span></div>
      {d && <div className="bodyscan-delta">{d}</div>}
    </div>
  })}</div>
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
  const scaleOn = useStore(s => bodyScaleOn(s.config))
  const scan = entry?.scan
  if (!scan) return null
  const values = readScan(scan)
  return <div className="card bodyscan-card">
    <div className="row between" style={{ marginBottom: 10 }}>
      <div><div className="muted small">{t('Body scan')}</div><b>{fmtDate(entry.d, true)}</b></div>
      {scaleOn && <Button size="sm" icon="qr" onClick={scanBodyScale}>{t('Scan')}</Button>}
    </div>
    {scanReadable(scan) ? <>
      <ScanTiles values={values} unit={unit} />
      <ScanSegments values={values} unit={unit} />
    </> : <div className="muted small">{unreadableNote(scan)}</div>}
  </div>
}

/*
 * The segment analysis: the body from the front, the trunk above it, each arm and leg beside it
 * — your right on the left, as the scale and a mirror show you. Lean or fat mass, by toggle.
 */
function SegmentFigure({ values, prev, unit, body }) {
  const [part, setPart] = useState('lean')
  const u = unit === 'lb' ? 'lb' : 'kg'
  if (!SCAN_SEGMENTS.some(s => values[s.seg + 'Lean'] != null || values[s.seg + 'Fat'] != null)) return null
  const box = seg => {
    const key = seg + (part === 'lean' ? 'Lean' : 'Fat')
    const label = SCAN_SEGMENTS.find(s => s.seg === seg).label
    const d = prev && deltaText(key, values[key], prev[key], unit)
    return <div className={'bodyseg-box bodyseg-' + seg} key={seg}>
      <div className="bodyseg-n">{t(label)}</div>
      <div className="bodyseg-v">{values[key] == null ? '–' : <>{fmtNum(scanDisplay(key, values[key], unit))} <span>{u}</span></>}</div>
      {d && <div className="bodyscan-delta">{d}</div>}
    </div>
  }
  return <>
    <h2 style={{ margin: '18px 2px 10px' }}>{t('Segment analysis')}</h2>
    <Segmented value={part} onChange={setPart} options={[{ value: 'lean', label: t('Lean mass') }, { value: 'fat', label: t('Fat') }]} />
    <div className="bodyseg">
      {box('trunk')}
      <div className="bodyseg-side">{box('armR')}{box('legR')}</div>
      <div className="bodyseg-fig"><BodyMap side="front" body={body} /></div>
      <div className="bodyseg-side">{box('armL')}{box('legL')}</div>
    </div>
  </>
}

/**
 * Stats' Body data tab: one body scan at a time (the latest unless you pick another), its numbers
 * with how they moved since the scan before, and the segment analysis. `onTrends` opens Body
 * measurements, where each value has its curve.
 */
export function BodyData({ S, onTrends }) {
  const scans = useMemo(() => (S.measurements || []).filter(e => e?.scan).slice().reverse(), [S.measurements])
  const [day, setDay] = useState(null)
  const scaleOn = useStore(s => bodyScaleOn(s.config))
  const idx = Math.max(0, scans.findIndex(e => e.d === day))
  const entry = scans[idx]
  if (!entry) return <div className="card">
    <h2>{t('Body data')}</h2>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Scan the QR code your gym’s body-composition scale shows after a measurement. Weight, body fat, muscle mass and the segment analysis then show here.')}</div>
    {scaleOn && <Button variant="primary" icon="qr" onClick={scanBodyScale}>{t('Scan body scan code')}</Button>}
  </div>
  const values = readScan(entry.scan)
  const before = scans.slice(idx + 1).find(e => scanReadable(e.scan))
  const prev = before ? readScan(before.scan) : null
  return <>
    <div className="card">
      <div className="row between" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{t('Body scan')}</div>
          <b>{fmtDate(entry.d, true)}</b>
          {before && <div className="small dim" style={{ marginTop: 2 }}>{t('Changes since {0}', fmtDate(before.d, true))}</div>}
        </div>
        {scaleOn && <Button size="sm" variant="tinted" icon="qr" onClick={scanBodyScale}>{t('Scan')}</Button>}
      </div>
      {scans.length > 1 && <div className="sect-b" style={{ marginTop: 10 }}><SelectRow
        title={t('Measurement')} sheetTitle={t('Choose measurement')} value={entry.d} onChange={setDay}
        options={scans.map(e => ({ value: e.d, label: fmtDate(e.d, true) }))} /></div>}
    </div>
    {scanReadable(entry.scan) ? <>
      <ScanTiles values={values} unit={S.unit} prev={prev} />
      <SegmentFigure values={values} prev={prev} unit={S.unit} body={S.body} />
    </> : <div className="card muted small">{unreadableNote(entry.scan)}</div>}
    {onTrends && <div className="card row between" style={{ alignItems: 'center', gap: 12, marginTop: 12 }}>
      <div style={{ minWidth: 0 }}><h2 style={{ margin: 0 }}>{t('Body measurements')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>{t('Muscle mass, fat mass, water and more, each with its own curve.')}</div></div>
      <Button size="sm" variant="tinted" trailingIcon="chevronRight" style={{ flexShrink: 0 }} onClick={onTrends}>{t('Open')}</Button>
    </div>}
  </>
}
