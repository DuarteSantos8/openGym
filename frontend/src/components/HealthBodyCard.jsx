// Body composition as the phone's health hub has it (lib/health-read.js bodyCompSummary): the
// latest body fat, lean mass, bone mass and BMR a scale saved there, with the change over about a
// month. Read-only and only on this phone; the switch is in Settings → Health.
import { useEffect, useState } from 'react'
import { loadHealth, onHealthChange } from '../lib/health-sync.js'
import { bodyCompSummary, LB_PER_KG } from '../lib/health-read.js'
import { MOBILE, nativePlatform } from '../lib/mobile.js'
import { fmtDate, fmtNum, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const LABEL = { fat: 'Body fat', lean: 'Lean mass', bone: 'Bone mass', water: 'Body water', bmr: 'Basal metabolic rate' }

/** One row's number and unit in the profile's weight unit: { v, unit }. */
export function bodyCompValue(kind, v, unit) {
  if (kind === 'fat') return { v: Math.round(v * 10) / 10, unit: '%' }
  if (kind === 'bmr') return { v: Math.round(v), unit: 'kcal' }
  const lb = unit === 'lb'
  return { v: Math.round((lb ? v * LB_PER_KG : v) * 10) / 10, unit: lb ? 'lb' : 'kg' }
}

export default function HealthBodyCard({ unit }) {
  const [h, setH] = useState(null)
  const [platform, setPlatform] = useState(null)
  useEffect(() => {
    if (!MOBILE) return
    let gone = false
    loadHealth().then(f => { if (!gone) setH(f) }).catch(() => {})
    nativePlatform().then(p => { if (!gone) setPlatform(p) }).catch(() => {})
    const off = onHealthChange(f => { if (!gone) setH(f) })
    return () => { gone = true; off() }
  }, [])
  if (!h?.readBody) return null
  const rows = bodyCompSummary(h.body)
  if (!rows.length) return null
  return <div className="card hc-body">
    <div className="muted small">{platform === 'ios' ? t('From Apple Health') : t('From Health Connect')}</div>
    <div className="hc-body-grid">
      {rows.map(r => {
        const now = bodyCompValue(r.kind, r.v, unit)
        const ch = r.change == null || r.change === 0 ? null : bodyCompValue(r.kind, Math.abs(r.change), unit)
        return <div className="hc-body-cell" key={r.kind}>
          <span className="hc-body-k">{t(LABEL[r.kind])}</span>
          <b>{fmtNum(now.v)} <i>{now.unit}</i></b>
          <span className="hc-body-s">{ch ? t('{0} in a month', (r.change > 0 ? '+' : '−') + fmtNum(ch.v) + ' ' + ch.unit) : fmtDate(isoOf(new Date(r.t)), true)}</span>
        </div>
      })}
    </div>
    <div className="small dim" style={{ marginTop: 10 }}>{t('Straight from your scale, read-only. Change it where it was measured.')}</div>
  </div>
}
