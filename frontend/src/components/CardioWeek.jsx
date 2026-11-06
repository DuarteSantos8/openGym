// Stats: the cardio minutes of this week and the seven before it (D#84), with an optional weekly
// goal. 150 minutes is what the health advice usually names; 75 and 300 are its half and double.
// The sums are lib/lifetime.js cardioWeeks.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { cardioWeeks, cardioGoalOf } from '../lib/lifetime.js'
import { Button, Segmented } from './ui.jsx'

export const CARDIO_GOALS = [0, 75, 150, 300]

function GoalSheet({ close }) {
  const goal = useStore(s => cardioGoalOf(s.S))
  const update = useStore(s => s.update)
  return <>
    <h3>{t('Weekly cardio goal')}</h3>
    <p className="small muted" style={{ marginTop: 0 }}>{t('150 minutes a week is the number health advice keeps repeating. Pick yours, or none.')}</p>
    <Segmented value={CARDIO_GOALS.includes(goal) ? goal : 150} onChange={v => { update(s => { s.cardioGoal = v }); close() }}
      options={CARDIO_GOALS.map(v => ({ value: v, label: v ? t('{0} min', v) : t('None') }))} />
    <div style={{ height: 12 }} />
  </>
}
const goalSheet = () => useUI.getState().openSheet(close => <GoalSheet close={close} />)

export default function CardioWeekCard({ S }) {
  const weeks = cardioWeeks(S)
  const goal = cardioGoalOf(S)
  // Nothing to show for someone who never logged cardio: the card only takes room once it means something.
  if (!weeks.some(w => w.min > 0) && !goal) return null
  const now = weeks[weeks.length - 1].min
  const top = Math.max(goal, ...weeks.map(w => w.min), 1)
  const line = goal ? t('{0} of {1} min', fmtNum(now), fmtNum(goal)) : t('{0} min', fmtNum(now))
  return <div className="card cardio-week" data-cardio-week>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Cardio this week')}</h2>
        <div className="cardio-num">{line}</div>
        {goal > 0 && now >= goal && <div className="small cardio-done">{t('Goal reached. Your heart says thanks.')}</div>}
      </div>
      <Button size="sm" icon="target" onClick={goalSheet}>{goal ? t('{0} min', goal) : t('Goal')}</Button>
    </div>
    {goal > 0 && <div className="pbar" role="progressbar" aria-label={t('Cardio this week')} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(now, goal)}>
      <i style={{ '--p': Math.min(1, now / goal) }} />
    </div>}
    <div className="cardio-bars" role="img" aria-label={weeks.map(w => fmtDate(w.week, true) + ': ' + t('{0} min', w.min)).join(', ')}>
      {goal > 0 && <span className="cardio-goal" style={{ '--g': goal / top }} aria-hidden="true" />}
      {weeks.map((w, i) => <span key={w.week} className={'cardio-bar' + (i === weeks.length - 1 ? ' now' : '') + (goal && w.min >= goal ? ' met' : '')}
        style={{ '--h': w.min / top }} aria-hidden="true" />)}
    </div>
    <div className="row between small muted cardio-axis"><span>{fmtDate(weeks[0].week, true)}</span><span>{t('This week')}</span></div>
  </div>
}
