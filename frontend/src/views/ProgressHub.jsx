import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { doneUnits, setsDone, streakWeeks, workoutDay } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { bwDeltaColor } from '../sheets.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from '../components/Icon.jsx'
import RootHeader from '../components/RootHeader.jsx'
import { Segmented } from '../components/ui.jsx'
import { rangeFrom, rangeOptions } from './Stats.jsx'

const DAY = 86400000

// One live card that opens a pushed page: a title, the number that matters over the range, and a
// line of context under it.
function HubCard({ icon, tint, title, value, note, onOpen }) {
  return (
    <div className="card tappable hub-card" role="button" {...tappable(onOpen)}>
      <div className="row between">
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="hub-card-t">{title}</div>
            <div className="hub-card-v">{value}</div>
            {note && <div className="hub-card-n">{note}</div>}
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  )
}

// The Progress tab's root: one range for the whole page, and a card per area — Body, Strength,
// Training load — each opening its page at the same range.
export default function ProgressHub() {
  const nav = useNavigate()
  const { search } = useLocation()
  const S = useStore(s => s.S)
  const range = rangeFrom(search, 90)
  // Kept in the address, so the tab's stack (and a reload) comes back to the range it was left on.
  const setRange = v => nav('/progress?range=' + v, { replace: true })
  const from = range ? Date.now() - range * DAY : 0
  const at = w => new Date(workoutDay(w) + 'T12:00').getTime()

  const weights = S.bodyweight.filter(b => (b.t || new Date(b.d).getTime()) >= from)
  const last = S.bodyweight[S.bodyweight.length - 1]
  const change = weights.length > 1 ? weights[weights.length - 1].w - weights[0].w : null
  const inRange = S.workouts.filter(w => at(w) >= from)
  const prs = inRange.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0)
  const lifted = new Set(inRange.flatMap(w => w.entries.filter(e => e.sets.some(s => doneUnits(s) > 0)).map(e => e.id))).size
  const sets = inRange.reduce((n, w) => n + setsDone(w), 0)
  const open = path => nav(path + '?range=' + range)

  return <div className="narrow">
    <RootHeader title={t('Progress')} />
    <Segmented className="seg-range" value={range} onChange={setRange} options={rangeOptions()} />
    <HubCard icon="scale" tint="var(--teal)" title={t('Body')}
      value={last ? fmtNum(last.w) + ' ' + S.unit : t('No weigh-ins yet')}
      note={change === null ? t('Weight, measurements and photos')
        : <span style={{ color: bwDeltaColor(change, last?.w || 0) }}>{(change > 0 ? '+' : '') + fmtNum(change) + ' ' + S.unit}</span>}
      onOpen={() => open('/progress/body')} />
    <HubCard icon="trophy" tint="var(--orange)" title={t('Strength')}
      value={t('Personal records: {0}', prs)}
      note={t('Exercises trained: {0}', lifted)}
      onOpen={() => open('/progress/strength')} />
    <HubCard icon="flame" tint="var(--red)" title={t('Training load')}
      value={tn('{0} workout', '{0} workouts', inRange.length)}
      note={tn('{0} set', '{0} sets', sets) + ' · ' + t('{0} week streak', streakWeeks(S))}
      onOpen={() => open('/progress/load')} />
  </div>
}
