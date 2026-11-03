// "Export as spreadsheet (CSV)" (#647): pick a stretch of days, then the workouts (one row per
// set) or body weight and measurements (one row per day) as a CSV file (lib/export-csv.js). The
// phone hands the file to the share sheet, the browser downloads it, the same way the JSON backup goes.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { reportRange } from '../lib/report.js'
import { workoutsCSV, bodyCSV, csvCounts } from '../lib/export-csv.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { Button, Segmented, Row } from './ui.jsx'

/** Save a text file: the share sheet on the phone (WKWebView can't download a blob), a download on the web. */
export async function saveCSV(text, name) {
  if (MOBILE) { await shareExport(text, name); return }
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}

export function CsvExportSheet({ close }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const today = todayISO()
  const [range, setRange] = useState('all')
  const [from, setFrom] = useState(() => reportRange('4w', { today }).from)
  const [to, setTo] = useState(today)
  // "All" is no range at all, so a first workout from years ago is in without picking a date.
  const r = range === 'all' ? { from: null, to: null } : reportRange(range, { from, to, today })
  const counts = csvCounts(S, r)
  const save = async (kind) => {
    const st = useStore.getState().S
    const text = kind === 'body' ? bodyCSV(st, r) : workoutsCSV(st, r)
    const name = 'opengym-' + (kind === 'body' ? 'body' : 'workouts') + '-' + today + '.csv'
    close()
    try { await saveCSV(text, name); toast?.(t('CSV exported')) } catch (e) { /* share sheet dismissed */ }
  }
  return <>
    <h3>{t('Export as spreadsheet (CSV)')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('One row per set, for Excel, Sheets, your coach or another app. openGym reads it back too.')}
    </div>
    <Segmented value={range} onChange={setRange} options={[
      { value: 'all', label: t('All') },
      { value: '3m', label: t('3 months') },
      { value: '4w', label: t('4 weeks') },
      { value: 'custom', label: t('Custom') },
    ]} />
    {range === 'custom' && <div style={{ marginTop: 10 }}>
      <Row icon="calendar" title={t('From')}>
        <input type="date" className="timef" value={from} max={to || today} onChange={e => setFrom(e.target.value)} /></Row>
      <Row icon="calendar" title={t('To')}>
        <input type="date" className="timef" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Row>
    </div>}
    <div className="small dim" style={{ margin: '10px 2px 14px' }} data-csv-summary>
      {range === 'all' ? t('All') : r.from === r.to ? fmtDate(r.from, true, true) : fmtDate(r.from, false, true) + ' – ' + fmtDate(r.to, false, true)}
    </div>
    {/* Each file says what it holds: sets don't go into the body file, weigh-ins don't go into the workouts one. */}
    <Button variant="primary" icon="share" onClick={() => save('workouts')}>{t('Workouts (CSV)')}</Button>
    <div className="small dim" style={{ margin: '4px 2px 12px' }} data-csv-count="workouts">
      {tn('{0} workout', '{0} workouts', counts.workouts) + ' · ' + tn('{0} set', '{0} sets', counts.sets)}
    </div>
    <Button icon="share" onClick={() => save('body')}>{t('Body weight & measurements (CSV)')}</Button>
    <div className="small dim" style={{ margin: '4px 2px 0' }} data-csv-count="body">
      {tn('{0} weigh-in', '{0} weigh-ins', counts.weighIns) + (counts.measurements ? ' · ' + tn('{0} measurement', '{0} measurements', counts.measurements) : '')}
    </div>
  </>
}

export const csvExportSheet = () => useUI.getState().openSheet(close => <CsvExportSheet close={close} />)
