// Stats: the cardio of this week and the seven before it (D#84), with the weekly goals the profile
// set itself (1.4.5): any cardio or one activity (a run, a swim, the rower), in minutes, distance or
// sessions. The first goal is the big number and the bars; the others sit under it as small rows.
// 150 minutes is what the health advice usually names, and what a first goal starts at.
// The sums and the goals are lib/cardio-goals.js.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import {
  CARDIO_KINDS, KIND_LABEL, KIND_ICON, GOALS_MAX, GOAL_MAX, STEP, unitsOf, cardioGoalsOf, withCardioGoals,
  cardioWeekTotals, goalValue, shownUnit, toShown, fromShown, suggestedShown,
} from '../lib/cardio-goals.js'
import Icon from './Icon.jsx'
import { Button, Row, Section, Segmented, Stepper } from './ui.jsx'

/** "45 min", "3 sessions", "5 km", "1,000 m". */
export function amountText(v, u) {
  if (u === 'min') return t('{0} min', fmtNum(v))
  if (u === 'n') return t('{0} sessions', fmtNum(v))
  return `${fmtNum(v)} ${u}`
}
/** "45 of 150 min", "2 of 3 sessions", "4.2 of 10 km". */
export const progressText = (now, goal, u) => (u === 'min' ? t('{0} of {1} min', fmtNum(now), fmtNum(goal)) : t('{0} of {1}', fmtNum(now), amountText(goal, u)))

const UNIT_LABEL = { min: 'Minutes', km: 'Distance', n: 'Sessions' }

function GoalEditor({ S, goals, edit, setEdit, save }) {
  const { at, kind, unit, val } = edit
  const u = shownUnit({ kind, unit }, S)
  // Another activity or unit: the number it already has, else the one it starts at.
  const pick = (k, un) => {
    const un2 = unitsOf(k).includes(un) ? un : 'min'
    const had = goals.find(g => g.kind === k && g.unit === un2)
    const su = shownUnit({ kind: k, unit: un2 }, S)
    setEdit({ ...edit, kind: k, unit: un2, val: had ? toShown(had.v, su) : suggestedShown(k, su) })
  }
  const ok = val > 0
  const commit = () => {
    if (!ok) return
    const goal = { kind, unit, v: unit === 'km' ? fromShown(val, u) : Math.round(val) }
    // One goal per activity and unit: saving over another one replaces it.
    const list = goals.map((g, i) => (i === at ? goal : g)).filter((g, i) => i === at || g.kind !== kind || g.unit !== unit)
    if (at < 0) list.push(goal)
    save(list)
    setEdit(null)
  }
  const remove = () => { save(goals.filter((_, i) => i !== at)); setEdit(null) }
  const first = () => { save([goals[at], ...goals.filter((_, i) => i !== at)]); setEdit(null) }
  return <div data-cardio-goal-edit>
    <h3>{at < 0 ? t('Add a goal') : t(KIND_LABEL[goals[at].kind])}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Activity')}</div>
    <div className="chips rec-kinds" role="radiogroup" aria-label={t('Activity')} style={{ margin: '0 0 12px', flexWrap: 'wrap' }}>
      {CARDIO_KINDS.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} data-kind={k}
        className={'chip nocap ichip' + (kind === k ? ' on' : '')} onClick={() => pick(k, unit)}>
        <Icon name={KIND_ICON[k]} />{t(KIND_LABEL[k])}</button>)}
    </div>
    <Segmented value={unit} onChange={un => pick(kind, un)} options={unitsOf(kind).map(v => ({ value: v, label: t(UNIT_LABEL[v]) }))} />
    <div style={{ height: 12 }} />
    <Stepper label={t('Per week')} value={val} min={0} max={toShown(GOAL_MAX[unit], u)} step={STEP[u]} decimal={u === 'km' || u === 'mi'}
      unit={u === 'min' ? t('min') : u === 'n' ? t('Sessions') : u} ariaLabel={t('Goal')} onChange={v => setEdit({ ...edit, val: v })} />
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={commit} disabled={!ok}>{at < 0 ? t('Add') : t('Save')}</Button>
    {at > 0 && <><div style={{ height: 8 }} /><Button icon="arrowUp" onClick={first}>{t('Show first')}</Button></>}
    {at >= 0 && <><div style={{ height: 8 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove goal')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={() => setEdit(null)}>{t('Cancel')}</Button>
  </div>
}

export function GoalSheet({ initial = null }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const goals = cardioGoalsOf(S)
  const [edit, setEdit] = useState(initial)
  const save = list => update(s => { withCardioGoals(s, list) })
  if (edit) return <GoalEditor S={S} goals={goals} edit={edit} setEdit={setEdit} save={save} />
  const fresh = () => {
    const kind = goals.some(g => g.kind === 'any' && g.unit === 'min') ? 'run' : 'any'
    setEdit({ at: -1, kind, unit: 'min', val: suggestedShown(kind, 'min') })
  }
  return <div data-cardio-goals-sheet>
    <h3>{t('Weekly cardio goals')}</h3>
    <p className="small muted" style={{ marginTop: 0 }}>{t('150 minutes a week is the number health advice keeps repeating. Pick yours, or none.')}</p>
    {goals.length > 0
      ? <Section>{goals.map((g, i) => {
        const u = shownUnit(g, S)
        return <Row key={g.kind + g.unit} icon={KIND_ICON[g.kind]} title={t(KIND_LABEL[g.kind])} value={amountText(toShown(g.v, u), u)}
          accessory="chevron" onClick={() => setEdit({ at: i, kind: g.kind, unit: g.unit, val: toShown(g.v, u) })} />
      })}</Section>
      : <p className="small muted">{t('No goal yet. The card just counts.')}</p>}
    {goals.length < GOALS_MAX && <Button icon="plus" onClick={fresh}>{t('Add a goal')}</Button>}
    <p className="small dim" style={{ marginBottom: 12 }}>{t('Cardio exercises count by their name, sport from Apple Health, Health Connect or an import by its type.')}</p>
  </div>
}
const goalSheet = () => useUI.getState().openSheet(() => <GoalSheet />)

export default function CardioWeekCard({ S }) {
  const goals = cardioGoalsOf(S)
  const weeks = cardioWeekTotals(S)
  // Nothing to show for someone who never logged cardio: the card only takes room once it means something.
  if (!weeks.some(w => (w.by.any?.min || 0) > 0 || (w.by.any?.n || 0) > 0) && !goals.length) return null
  const main = goals[0] || { kind: 'any', unit: 'min', v: 0 }
  const mu = shownUnit(main, S)
  const series = weeks.map(w => toShown(goalValue(w, main), mu))
  const goal = main.v ? toShown(main.v, mu) : 0
  const now = series[series.length - 1]
  const top = Math.max(goal, ...series, 1)
  const cur = weeks[weeks.length - 1]
  const line = goal ? progressText(now, goal, mu) : amountText(now, mu)
  const label = goals.length === 1 ? amountText(goal, mu) : goals.length ? t('Goals') : t('Goal')
  return <div className="card cardio-week" data-cardio-week>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Cardio this week')}</h2>
        {main.kind !== 'any' && <div className="small muted cardio-kind"><Icon name={KIND_ICON[main.kind]} />{t(KIND_LABEL[main.kind])}</div>}
        <div className="cardio-num">{line}</div>
        {goal > 0 && now >= goal && <div className="small cardio-done">{t('Goal reached. Your heart says thanks.')}</div>}
      </div>
      <Button size="sm" icon="target" onClick={goalSheet}>{label}</Button>
    </div>
    {goal > 0 && <div className="pbar" role="progressbar" aria-label={t('Cardio this week')} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(now, goal)}>
      <i style={{ '--p': Math.min(1, now / goal) }} />
    </div>}
    {goals.length > 1 && <ul className="cardio-goals">
      {goals.slice(1).map(g => {
        const u = shownUnit(g, S)
        const v = toShown(goalValue(cur, g), u), gv = toShown(g.v, u)
        const name = t(KIND_LABEL[g.kind])
        return <li key={g.kind + g.unit} className={'cardio-goal-row' + (v >= gv ? ' met' : '')} data-goal={g.kind + '-' + g.unit}>
          <Icon name={KIND_ICON[g.kind]} />
          <span className="cg-name">{name}</span>
          <span className="cg-num">{progressText(v, gv, u)}</span>
          <span className="pbar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={gv} aria-valuenow={Math.min(v, gv)}>
            <i style={{ '--p': Math.min(1, v / gv) }} />
          </span>
        </li>
      })}
    </ul>}
    <div className="cardio-bars" role="img" aria-label={weeks.map((w, i) => fmtDate(w.week, true) + ': ' + amountText(series[i], mu)).join(', ')}>
      {goal > 0 && <span className="cardio-goal" style={{ '--g': goal / top }} aria-hidden="true" />}
      {weeks.map((w, i) => <span key={w.week} className={'cardio-bar' + (i === weeks.length - 1 ? ' now' : '') + (goal && series[i] >= goal ? ' met' : '')}
        style={{ '--h': series[i] / top }} aria-hidden="true" />)}
    </div>
    <div className="row between small muted cardio-axis"><span>{fmtDate(weeks[0].week, true)}</span><span>{t('This week')}</span></div>
  </div>
}
