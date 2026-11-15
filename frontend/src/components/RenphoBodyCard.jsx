// Body composition as RENPHO has it, read by the server (api/providers/renpho, GET
// /api/renpho/summary): the latest value of each kind the scale gives, with the change over about
// a month, and the segmental analysis when the scale has eight electrodes. Read-only, beside what
// Apple Health or Health Connect has (HealthBodyCard.jsx); connected in Settings → Integrations →
// RENPHO Health. Nothing shows without a server to ask, or before RENPHO sent anything.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { DEMO } from '../lib/demo.js'
import { fmtDate, fmtNum, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { renphoRows, renphoValue, renphoLabel, renphoSegments } from '../lib/renpho-body.js'
import SegmentalAnalysis from './SegmentalAnalysis.jsx'

export default function RenphoBodyCard({ unit }) {
  const user = useStore(s => s.user)
  const [sum, setSum] = useState(null)
  useEffect(() => {
    if (!user || DEMO) return
    let gone = false
    // A server without RENPHO, or out of reach: the card is simply not there.
    api('/api/renpho/summary').then(s => { if (!gone) setSum(s || null) }).catch(() => {})
    return () => { gone = true }
  }, [user?.id])
  if (!sum?.connected) return null
  const rows = renphoRows(sum.items)
  const seg = renphoSegments(sum.items)
  if (!rows.length && !seg) return null
  return <>
    {rows.length > 0 && <div className="card hc-body">
      <div className="muted small">{t('From RENPHO')}</div>
      <div className="hc-body-grid">
        {rows.map(r => {
          const now = renphoValue(r.type, r.v, unit)
          const ch = r.change == null || r.change === 0 ? null : renphoValue(r.type, Math.abs(r.change), unit)
          return <div className="hc-body-cell" key={r.type}>
            <span className="hc-body-k">{t(renphoLabel(r.type))}</span>
            <b>{fmtNum(now.v)}{now.unit && <> <i>{now.unit}</i></>}</b>
            <span className="hc-body-s">{ch ? t('{0} in a month', (r.change > 0 ? '+' : '−') + fmtNum(ch.v) + (ch.unit ? ' ' + ch.unit : '')) : fmtDate(isoOf(new Date(r.t)), true)}</span>
          </div>
        })}
      </div>
      <div className="small dim" style={{ marginTop: 10 }}>{t('Straight from your scale, read-only. Change it where it was measured.')}</div>
    </div>}
    <SegmentalAnalysis seg={seg} />
  </>
}
