import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { SEGMENTS, segType } from '../../../api/health/composition.js'
import { sourceLabel } from '../lib/health/providers.js'

// Segmental analysis (an eight-electrode scale, RENPHO): the latest weigh-in that has segment
// values, muscle and fat apart, left against right for the arms and the legs, the trunk on its own,
// and the impedances at 20 and 100 kHz. The values are in the scale's own unit, shown as they came:
// what matters here is one side against the other.
const PAIRS = [['leftArm', 'rightArm', 'Arms'], ['leftLeg', 'rightLeg', 'Legs']]
const fmt = (v, dec = 1) => (v == null ? '–' : Number(v).toFixed(dec))

/** The latest group of records with segmental values, as { t, d, src, values }; null when none. */
export function latestSegmental(health) {
  const byG = new Map()
  for (const r of Array.isArray(health) ? health : []) {
    if (!r?.g || !/^(segFat|segMuscle|imp20|imp100)/.test(r.type)) continue
    let m = byG.get(r.g)
    if (!m) byG.set(r.g, m = { g: r.g, t: r.t, d: r.d, src: r.src, values: {} })
    m.values[r.type] = r.v
  }
  return [...byG.values()].sort((a, b) => b.t - a.t)[0] || null
}

function Pair({ title, left, right }) {
  const max = Math.max(left ?? 0, right ?? 0) || 1
  const diff = left != null && right != null && Math.max(left, right) > 0 ? Math.abs(left - right) / Math.max(left, right) * 100 : null
  return <div className="seg-pair">
    <div className="row between small"><span>{title}</span>{diff != null && <span className="dim">{t('{0}% apart', diff.toFixed(0))}</span>}</div>
    {[[t('Left'), left], [t('Right'), right]].map(([side, v]) => <div key={side} className="seg-bar">
      <span className="seg-side dim small">{side}</span>
      <span className="seg-track"><i style={{ width: (v == null ? 0 : v / max * 100) + '%' }} /></span>
      <b className="seg-val small">{fmt(v, 2)}</b>
    </div>)}
  </div>
}

function Block({ kind, title, values, color }) {
  const v = part => values[segType(kind, part)]
  if (!SEGMENTS.some(p => v(p) != null)) return null
  return <div className="card seg-card" style={{ '--seg': color }}>
    <div className="seg-h">{title}</div>
    {PAIRS.map(([l, r, name]) => (v(l) != null || v(r) != null) && <Pair key={name} title={t(name)} left={v(l)} right={v(r)} />)}
    {v('trunk') != null && <div className="row between small seg-trunk"><span>{t('Trunk')}</span><b>{fmt(v('trunk'), 2)}</b></div>}
  </div>
}

export default function SegmentalAnalysis({ health }) {
  const m = latestSegmental(health)
  if (!m) return null
  const imp = SEGMENTS.filter(p => m.values[segType('imp20', p)] != null || m.values[segType('imp100', p)] != null)
  const PART = { leftArm: 'Left arm', rightArm: 'Right arm', trunk: 'Trunk', leftLeg: 'Left leg', rightLeg: 'Right leg' }
  return <section className="seg-analysis">
    <h4 className="sec" style={{ margin: '18px 2px 4px' }}>{t('Segmental analysis')}</h4>
    <div className="small dim" style={{ margin: '0 2px 10px' }}>{fmtDate(m.d, true)} · {t(sourceLabel(m.src))} · {t('in the scale’s own units')}</div>
    <Block kind="segMuscle" title={t('Muscle')} values={m.values} color="var(--green)" />
    <Block kind="segFat" title={t('Fat')} values={m.values} color="var(--orange)" />
    {imp.length > 0 && <div className="card seg-card">
      <div className="seg-h">{t('Impedance')}</div>
      <div className="seg-imp small">
        <span /><b className="dim">20 kHz</b><b className="dim">100 kHz</b>
        {imp.map(p => [<span key={p}>{t(PART[p])}</span>,
          <b key={p + '20'}>{fmt(m.values[segType('imp20', p)], 0)} Ω</b>,
          <b key={p + '100'}>{fmt(m.values[segType('imp100', p)], 0)} Ω</b>])}
      </div>
    </div>}
  </section>
}
