import { t } from '../lib/i18n.js'
import { changeTitle, changeValues } from '../lib/coach.js'
import Icon from './Icon.jsx'

/**
 * One change the Coach proposed: its title, before → after, the Coach's reason, and a note when
 * it can no longer be applied. A change to the plan (CoachChat) reads its title and values from
 * the plan; a change to the workout in progress (WorkoutCoachSheet) brings its own, read from
 * the live session.
 */
export function ChangeRow({ c, S, title = changeTitle(c, S), vals = changeValues(c, S), stale, staleNote = t('Doesn’t match your plan any more, so it can’t be applied.'), badge, children }) {
  return <div className={'pcard-chg' + (stale ? ' stale' : '') + (c.status === 'rejected' ? ' declined' : '')}>
    <div className="grow">
      <div className="pcard-chg-t">{title}{c.routineName ? <span className="dim" style={{ fontWeight: 400 }}> · {c.routineName}</span> : null}</div>
      {vals && <div className="pcard-chg-v"><span className="tag">{vals.before}</span><Icon name="chevronRight" style={{ fontSize: 12, color: 'var(--label-3)' }} /><span className="tag acc">{vals.after}</span></div>}
      <div className="pcard-chg-w">{c.why}</div>
      {stale && <div className="pcard-chg-stale">{staleNote}</div>}
    </div>
    {badge}
    {children}
  </div>
}
