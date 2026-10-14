import { t } from '../lib/i18n.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import Icon from './Icon.jsx'
import { SectionTitle } from './blocks.jsx'

// NutriTrace's wearable sources, by the name their makers use.
const DEVICE = { garmin: 'Garmin', fitbit: 'Fitbit', withings: 'Withings', google_health: 'Google Health', health_connect: 'Health Connect', polar: 'Polar', oura: 'Oura' }
const deviceName = source => DEVICE[source] || String(source).replace(/_/g, ' ')

// Why an activity row does not count toward the target, or null when it does
// (fitness-hub docs/reviews/decision-workout-kcal.md §2-3): a wearable reporting the day's active
// kcal stands in for the workout estimate; an Adaptive or Dynamic target already includes
// training; a fixed target only takes activity with "Adjust goal from activity" on. A manual row
// on a day a wearable reports counts only as the person's policy says
// (server/lib/active-calories.js effectiveActiveCalories): not under wearable_wins.
export function activityNote(row, target, { sum, policy } = {}) {
  if (row.covered_by) return t('Covered by {0}', deviceName(row.covered_by))
  if (target.fromBurn) return t('Your target already includes training')
  if (!target.adjust) return t('Not added to your target')
  const wearableDay = (Number(sum?.wearable) || 0) > 0
  if (wearableDay && row.source !== 'opengym' && (policy || 'wearable_wins') === 'wearable_wins') return t('Not counted: your wearable reports this day')
  return null
}

// The day's activity, under the meals: the finished workouts' kcal entries (source 'opengym',
// written by the hub) and anything logged in NutriTrace. Rows that do not count read muted with
// the reason. Shown only with NutriTrace's activity section on (diaryShowActivity).
export default function ActivityRows({ rows, target, sum, policy }) {
  const { energy } = useUnits()
  if (!rows.length) return null
  return <div className="activity-rows">
    <SectionTitle>{t('Activity')}</SectionTitle>
    <ul>
      {rows.map(row => {
        const note = activityNote(row, target, { sum, policy })
        const workout = row.source === 'opengym'
        return <li key={row.id} className={'activity-row' + (note ? ' muted-row' : '')}>
          <span className={'lrow-i ' + (workout ? 'tint-purple' : 'tint-teal')}><Icon name={workout ? 'dumbbell' : 'figureRun'} /></span>
          <span className="grow">
            <span className="tt">{row.name}</span>
            <span className="ss small muted">{[workout ? t('Workout (estimate)') : null, note].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="small">{energy(row.kcal || 0)}</span>
        </li>
      })}
    </ul>
  </div>
}
