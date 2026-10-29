// "Your week" / "Your month" (lib/recap.js): the Home card, and the sheet behind it with the
// numbers, Share as image (components/ShareCard.jsx) and Save as PDF (the performance report for
// that stretch, lib/report-print.js).
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtNum, fmtVol, fmtDateRange } from '../lib/format.js'
import { recapDue, recapOf } from '../lib/recap.js'
import { recapCardImage } from '../lib/recap-card.js'
import { printReport } from '../lib/report-print.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import ShareCardSheet from './ShareCard.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const titleOf = r => (r.kind === 'month' ? t('Your month') : t('Your week'))
const datesOf = r => fmtDateRange(r.from, r.to, true)

/** The four headline tiles, translated, for the sheet and the picture. */
function tilesOf(r, unit) {
  return [
    { label: tn('workout', 'workouts', r.workouts), value: fmtNum(r.workouts) },
    { label: t('Volume'), value: fmtVol(r.volume, unit) },
    { label: tn('new best', 'new bests', r.prs), value: fmtNum(r.prs) },
    { label: tn('week in a row', 'weeks in a row', r.streak), value: fmtNum(r.streak) },
  ]
}
const topOf = r => (r.top ? t('Most work: {0}, {1} sets', t(r.top.name), fmtNum(r.top.sets)) : null)

/** One line for the Home card: "4 workouts · 12,300 kg · 2 new bests". */
function lineOf(r, unit) {
  return [tn('{0} workout', '{0} workouts', r.workouts), fmtVol(r.volume, unit), r.prs ? tn('{0} new best', '{0} new bests', r.prs) : null].filter(Boolean).join(' · ')
}

/** Home: the recap due today, or nothing. */
export function RecapHomeCard({ S }) {
  const update = useStore(s => s.update)
  const r = recapDue(S)
  if (!r) return null
  const dismiss = ev => { ev.stopPropagation(); update(s => { s.recapSeen = r.key }) }
  return <div className="card tappable recap-card" data-recap={r.kind} style={{ cursor: 'pointer' }} {...tappable(() => recapSheet(r))}>
    <div className="row between" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: 'var(--purple)' }}><Icon name="chart" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{datesOf(r)}</div>
          <div className="ttl">{titleOf(r)}</div>
          <div className="ss">{lineOf(r, S.unit)}</div>
        </div>
      </div>
      <button type="button" className="iconbtn" aria-label={t('Put it away')} onClick={dismiss}><Icon name="xmark" /></button>
    </div>
  </div>
}

function RecapSheet({ period, close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const r = recapOf(S, period)
  const tiles = tilesOf(r, S.unit)
  const words = { title: titleOf(r), dates: datesOf(r), tiles, top: topOf(r) }
  const shareImage = () => useUI.getState().openSheet(c => <ShareCardSheet title={titleOf(r)} close={c} toast={m => useUI.getState().toast(m)}
    name={`opengym-${r.kind}-${r.from}.png`} shareTitle={titleOf(r)} render={pref => recapCardImage(words, pref)} />)
  const pdf = () => printReport(S, { range: 'custom', from: r.from, to: r.to, owner: user?.name || '' })
  return <>
    <div className="lbl2">{datesOf(r)}</div>
    <h3 style={{ marginTop: 2 }}>{titleOf(r)}</h3>
    <div className="recap-tiles">
      {tiles.map(tile => <div key={tile.label} className="recap-tile"><div className="recap-v">{tile.value}</div><div className="small muted">{tile.label}</div></div>)}
    </div>
    {r.top && <div className="small muted" style={{ margin: '4px 0 14px' }}><Icon name="figureStrength" /> {topOf(r)}</div>}
    <Button variant="primary" icon="share" onClick={shareImage}>{t('Share as image')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="note" onClick={pdf}>{t('Save as PDF')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
export const recapSheet = period => useUI.getState().openSheet(close => <RecapSheet period={period} close={close} />)
