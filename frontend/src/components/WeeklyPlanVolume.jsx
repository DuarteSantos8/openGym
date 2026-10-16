import { useState } from 'react'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { loadOfWeeklyPlan, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { Card } from './blocks.jsx'
import { Spacer } from './layout.jsx'
import { Button } from './ui.jsx'

const ROWS = 5

// Training load › Plan: the muscle volume your plan programs in a week, every weekday routine
// once plus each session of a running rotation (lib/muscles.js loadOfWeeklyPlan). Plan's "Weekly
// muscle volume" row links here (/progress/load?view=plan).
export default function WeeklyPlanVolume({ S }) {
  const [all, setAll] = useState(false)
  const load = loadOfWeeklyPlan(S)
  const muscles = rankOf(load).worked
  const shown = all ? muscles : muscles.slice(0, ROWS)
  const max = muscles.length ? load[muscles[0]] : 0
  return <Card data-weekly-muscle-volume>
    <h2 className="mb-1">{t('Weekly muscle volume')}</h2>
    <div className="muted small mb-5">{t('Planned sets per week, from your plan.')}</div>
    {muscles.length ? shown.map(muscle => <div className="mrow" key={muscle}>
      <span className="nm">{t(MUSCLE_NAME[muscle])}</span>
      <span className="bar"><i style={{ width: Math.round(load[muscle] / max * 100) + '%' }} /></span>
      <span className="v">{t('{0} sets', fmtNum(Math.round(load[muscle] * 10) / 10))}</span>
    </div>) : <div className="muted small">{t('No muscle volume planned.')}</div>}
    {muscles.length > ROWS && <>
      <Spacer size={4} />
      <Button className="weekly-plan-toggle" trailingIcon={all ? 'chevronUp' : 'chevronDown'} aria-expanded={all}
        onClick={() => setAll(v => !v)}>{t(all ? 'Show less' : 'Show more')}</Button>
    </>}
  </Card>
}
