import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, fmtWeight, todayISO } from '../lib/format.js'
import { GOAL_HORIZONS, GOAL_W_MAX, goalFor, goalProgress, withGoal } from '../lib/lift-goals.js'
import { Button, Segmented, Stepper } from './ui.jsx'
import Icon from './Icon.jsx'

// A target weight for one exercise with a horizon of 3, 6 or 12 months (lib/lift-goals.js). It sits
// in the exercise sheet under the best weight and stays one quiet button until someone sets a goal.
// `best` and `unit` are what the sheet already shows for the exercise (its own weight unit).

const update = (...a) => useStore.getState().update(...a)
const HORIZON_LABEL = { 3: '3 months', 6: '6 months', 12: '1 year' }
const STATUS_LABEL = {
  done: 'Goal reached', ahead: 'Ahead of schedule', on: 'On track', behind: 'Behind schedule', overdue: 'Past the due date',
}

// A first target worth aiming for: about a tenth above the best, on a 2.5 grid.
const suggestedTarget = best => best > 0 ? Math.ceil((best * 1.1) / 2.5) * 2.5 : 20

export default function LiftGoal({ ex, best, unit }) {
  const S = useStore(s => s.S)
  const goal = goalFor(S, ex.id)
  const [editing, setEditing] = useState(false)
  const [w, setW] = useState(0)
  const [h, setH] = useState(6)

  const open = () => {
    setW(goal ? goal.w : suggestedTarget(best))
    setH(goal ? goal.h : 6)
    setEditing(true)
  }
  const save = () => {
    if (!(w > 0)) return
    update(s => { s.exGoals = withGoal(s.exGoals, ex.id, { w, u: unit, h, d: todayISO(), b: best > 0 ? best : 0 }) })
    setEditing(false)
  }
  const remove = () => {
    update(s => { s.exGoals = withGoal(s.exGoals, ex.id, null) })
    setEditing(false)
  }

  if (editing) {
    return <div className="lgoal">
      <h4 className="sec">{t('Lift goal')}</h4>
      <div className="row cfgrow" style={{ marginBottom: 10 }}>
        <Stepper label={t('Target ({0})', unit)} of={t('Lift goal')} value={w} step={2.5} min={0} max={GOAL_W_MAX} onChange={setW} />
      </div>
      <Segmented value={h} onChange={setH} of={t('Lift goal')}
        options={GOAL_HORIZONS.map(m => ({ value: m, label: t(HORIZON_LABEL[m]) }))} />
      <div className="row lgoal-actions">
        <Button variant="primary" onClick={save} disabled={!(w > 0)}>{t('Save')}</Button>
        <Button onClick={() => setEditing(false)}>{t('Cancel')}</Button>
        {goal && <Button variant="ghost" onClick={remove}>{t('Remove goal')}</Button>}
      </div>
    </div>
  }

  if (!goal) {
    return <Button icon="target" style={{ marginTop: 4 }} onClick={open}>{t('Set a goal')}</Button>
  }

  const p = goalProgress(goal, best, unit, todayISO())
  return <div className="lgoal">
    <h4 className="sec">{t('Lift goal')}</h4>
    <div className="small">{t('Goal: {0} by {1}', fmtWeight(goal.w, goal.u), fmtDate(p.dueISO, true))}</div>
    <div className="lgoal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}
      aria-label={t('Lift goal')}><i className={'lgoal-' + p.status} style={{ width: p.pct + '%' }} /></div>
    <div className="row between small">
      <span className={'lgoal-st lgoal-' + p.status}>{p.done && <Icon name="trophy" />}{t(STATUS_LABEL[p.status])}</span>
      <span className="muted">{fmtNum(p.best)} / {fmtWeight(p.target, goal.u)}</span>
    </div>
    {p.perWeek > 0 && <div className="small dim">{t('Gain about {0} a week to get there', fmtWeight(p.perWeek, goal.u))}</div>}
    <Button style={{ marginTop: 6 }} icon="pencil" onClick={open}>{t('Edit')}</Button>
  </div>
}
