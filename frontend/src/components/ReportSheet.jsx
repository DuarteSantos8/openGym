// "Performance report (PDF)": pick a stretch of days, get everything it adds up to on paper
// (lib/report-print.js). Opened from Stats, History and Settings > Data.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { reportRange, inRange } from '../lib/report.js'
import { printReport } from '../lib/report-print.js'
import { Button, Segmented, Row } from './ui.jsx'

export function ReportSheet({ close }) {
  const S = useStore(s => s.S)
  const today = todayISO()
  const [range, setRange] = useState('4w')
  const [from, setFrom] = useState(() => reportRange('4w', { today }).from)
  const [to, setTo] = useState(today)
  const r = reportRange(range, { from, to, today })
  const count = inRange(S, r).length
  const make = () => {
    const owner = useStore.getState().user?.name || ''
    close()
    printReport(S, { range, from: r.from, to: r.to, owner })
  }
  return <>
    <h3>{t('Performance report')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Your training on paper: totals, charts, new bests and every set. Frame it, print it or send it to your coach.')}
    </div>
    <Segmented value={range} onChange={setRange} options={[
      { value: '7d', label: t('7 days') },
      { value: '4w', label: t('4 weeks') },
      { value: '3m', label: t('3 months') },
      { value: 'custom', label: t('Custom') },
    ]} />
    {range === 'custom' && <div style={{ marginTop: 10 }}>
      <Row icon="calendar" title={t('From')}>
        <input type="date" className="timef" value={from} max={to || today} onChange={e => setFrom(e.target.value)} /></Row>
      <Row icon="calendar" title={t('To')}>
        <input type="date" className="timef" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Row>
    </div>}
    <div className="small dim" style={{ margin: '10px 2px 14px' }} data-report-summary>
      {(r.from === r.to ? fmtDate(r.from, true, true) : fmtDate(r.from, false, true) + ' – ' + fmtDate(r.to, false, true)) + ' · ' + tn('{0} workout', '{0} workouts', count)}
    </div>
    <Button variant="primary" icon="note" onClick={make}>{t('Create PDF')}</Button>
  </>
}

export const reportSheet = () => useUI.getState().openSheet(close => <ReportSheet close={close} />)
