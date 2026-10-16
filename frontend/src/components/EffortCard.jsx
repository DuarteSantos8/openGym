import { useMemo, useState } from 'react'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { effortOf } from '../lib/history.js'
import {
  displayScale, scaleName, toScale, effortSummary, effortWeeks, effortHistogram, HARD_RIR, MIN_RATED,
} from '../lib/effort.js'
import { anchorsByWorkout, resolveSetRir } from '../lib/recovery.js'
import { bodyweightKgOf } from '../lib/structuralBalance.js'
import LineChart from './LineChart.jsx'
import { Card, SectionTitle } from './blocks.jsx'
import { Inline } from './layout.jsx'
import { Segmented } from './ui.jsx'

// Training load › Effort: how hard the training was — the half of the picture a volume chart
// cannot show. Everything is computed in RIR (lib/effort.js) and converted to whichever scale this
// profile reads. Every number carries how much of the training it speaks for: rating is optional
// and off by default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
export default function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const logged = effortSummary(S, win)
  // Thin or missing ratings fall back to estimates (same precedence fatigue scoring
  // uses), so imported histories get an effort card too. Well-rated windows keep
  // their logged numbers untouched - estimates never dilute a real average.
  const blend = logged.rated < MIN_RATED
  // Same options as the fatigue map (unit + profile bodyweight), so a bodyweight set is
  // estimated against the same body-mass-inclusive anchor in both places.
  const opts = useMemo(() => ({ unit: S.unit, bodyweightKg: bodyweightKgOf(S) }), [S.unit, S.bodyweight])
  const anchors = useMemo(
    () => (blend ? anchorsByWorkout(S.workouts, opts) : new Map()),
    [blend, S.workouts, opts],
  )
  const resolve = (s, w, e) => resolveSetRir(s, s, e, w, anchors.get(w), opts)
  const sum = blend ? effortSummary(S, win, resolve) : logged
  const weeks = blend ? effortWeeks(S, win, resolve) : effortWeeks(S, win)
  const hist = blend ? effortHistogram(S, win, resolve) : effortHistogram(S, win)
  const estimated = blend && sum.est > 0
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <Card title={<>{t('Effort')} <span className="dim">· {t('how close to failure')}{estimated ? ' · ' + t('estimated') : ''}</span></>}>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 && sum.est === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <Inline justify="between" align="end" gap={6}>
        <div>
          <div className="stat-v">{sum.avg == null ? '–' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div className="ta-end">
          <div className="stat-v ink-warn">{sum.hardPct == null ? '–' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </Inline>
      <div className="small dim mt-4">{estimated
        ? t('{0} rated · {1} estimated of {2} sets', sum.rated, sum.est, sum.done)
        : t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small ink-warn mt-2">
        {t('Effort per set is off. Turn it on in Settings → Workout to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <SectionTitle className="mt-6">{t('Week by week')}</SectionTitle>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} label={t('Week by week')} /></div>
      </>}
      <SectionTitle className="mt-6">{t('Where the sets land')}</SectionTitle>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i className={b.rir <= HARD_RIR ? 'bar-hard' : 'bar-soft'} style={{ width: Math.round(b.n / maxBin * 100) + '%' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '–'}</span>
      </div>)}
      <div className="small dim mt-4">
        {t('Most working sets belong close to failure, not at it. Half at the floor and half at the top still average out to a healthy-looking middle.')}
      </div>
    </>}
  </Card>
}
