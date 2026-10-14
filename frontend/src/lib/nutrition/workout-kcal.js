import { t, dateLocale } from '../i18n.js'
import { useUI } from '../../store/useUI.js'
import { calorieTarget, energyOf } from './diary.js'
import { useNutrition } from './store.js'
import { workoutSyncRow } from './sync.js'

// What finishing a workout did to the day's calorie target, in the words of fitness-hub
// docs/reviews/decision-workout-kcal.md §3: the estimate it added (rounded to 10, only when it
// moved the target), or that the target already counts training. Nothing when it neither moved
// the target nor was already in it (a fixed target with "Adjust goal from activity" off).

// In the person's energy unit (kJ for some), rounded to 10 in that unit.
function about(kcal, settings) {
  const e = energyOf(kcal, settings)
  return (Math.round(e.value / 10) * 10).toLocaleString(dateLocale()) + ' ' + e.unit
}

/** The toast for a workout's `kcal`, given the day's settings, whether a wearable covers the day
 *  and the target's inputs ({ date, caloriesOut, adaptiveTdee }). Null for no toast. */
export function workoutKcalMessage({ kcal, settings, covered, inputs }) {
  if (!(kcal > 0)) return null
  const { adjust, fromBurn } = calorieTarget({ settings, ...inputs })
  if (adjust && !fromBurn && !covered) return t('Added to your day: about {0} (estimate)', about(kcal, settings))
  if (fromBurn || (adjust && covered)) return t('Logged. Your target already includes training.')
  return null
}

/** After syncNow: reads the workout's kcal row from the hub, refreshes that day's activity and
 *  says what it did to the target. Silent when the row has not reached NutriTrace yet. */
export async function reportWorkoutKcal(workout) {
  const row = await workoutSyncRow(workout?.id)
  if (row?.state !== 'synced') return null
  const n = useNutrition.getState()
  const settings = await n.loadSettings()
  const date = row.date || workout.d
  await n.loadGoalInputs(date, settings?.calorieGoalMode)
  await n.loadActivity(date, settings?.manualActivityPolicy)
  const after = useNutrition.getState()
  const msg = workoutKcalMessage({
    kcal: row.kcal,
    settings,
    covered: !!after.activity[date]?.sum?.covered_by,
    inputs: { date, caloriesOut: after.caloriesOut(date), adaptiveTdee: after.adaptiveTdee() },
  })
  if (msg) useUI.getState().toast(msg)
  return msg
}
