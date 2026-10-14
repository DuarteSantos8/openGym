import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { nutritionAvailable } from './api.js'
import { useNutrition } from './store.js'
import { calorieTarget, macroTarget, totalsOf, waterGoalOf, waterTotal } from './diary.js'

// One day of the diary as Home shows it: loads what it needs for `date` (the day, the settings,
// the activity rows and the target's inputs) and adds it up.
//
// `status` is 'ready' only once everything the numbers depend on is in: the day, the settings,
// the Adaptive or Dynamic input when that mode is on, and the activity when it adjusts the
// target. Until then 'loading', so the target never shows a default that then jumps. A failed
// day or settings read is 'error' (`error` says which), with `reload` retrying both.
export function useDiaryDay(date) {
  const user = useStore(s => s.user)
  const on = nutritionAvailable(user)
  const settingsState = useNutrition(s => s.settings)
  const day = useNutrition(s => s.days[date])
  const activity = useNutrition(s => s.activity[date])
  const goalInputs = useNutrition(s => s.goalInputs)
  const settings = settingsState.data
  const mode = settings?.calorieGoalMode
  const showActivity = !!settings?.diaryShowActivity
  const policy = settings?.manualActivityPolicy
  // The goal-input load that last finished, as "date|mode": a failed one is not kept in the store
  // (the next read retries), so the page needs its own word that the attempt is over.
  const [inputsTried, setInputsTried] = useState(null)

  useEffect(() => {
    if (!on) return
    const n = useNutrition.getState()
    n.loadSettings()
    // A cached day shows at once and is read again behind it: another device may have logged.
    n.loadDay(date, { force: true })
  }, [on, date])

  useEffect(() => {
    if (!on || settingsState.status !== 'ready') return undefined
    let live = true
    const n = useNutrition.getState()
    n.loadGoalInputs(date, mode).then(() => { if (live) setInputsTried(`${date}|${mode}`) })
    n.loadActivity(date, policy)
    return () => { live = false }
  }, [on, date, settingsState.status, mode, policy])

  const entry = day?.entry || null
  const totals = totalsOf(entry?.items)
  const effective = showActivity ? activity?.sum?.effective ?? 0 : 0
  const target = calorieTarget({
    settings,
    date,
    caloriesOut: goalInputs[date] ?? null,
    adaptiveTdee: goalInputs.adaptive ?? null,
    effectiveActive: effective,
  })
  const macros = {
    proteins: macroTarget(settings, 'proteins', date, target.base),
    carbohydrates: macroTarget(settings, 'carbohydrates', date, target.base),
    fat: macroTarget(settings, 'fat', date, target.base),
  }

  const settingsFailed = settingsState.status === 'error' && !settings
  const inputsIn = (mode !== 'dynamic' || date in goalInputs) && (mode !== 'adaptive' || 'adaptive' in goalInputs)
  const inputsReady = inputsIn || inputsTried === `${date}|${mode}`
  const activityReady = !target.adjust || !!activity
  const status = day?.status === 'error' || settingsFailed ? 'error'
    : day?.status === 'ready' && settingsState.status === 'ready' && inputsReady && activityReady ? 'ready'
    : on ? 'loading' : 'idle'

  return {
    on,
    status,
    error: day?.status === 'error' ? day.error : settingsFailed ? settingsState.error : null,
    // The day itself is in (water and meals can show while the target still loads).
    dayReady: day?.status === 'ready' && !!settings,
    settings,
    settingsStatus: settingsState.status,
    entry,
    totals,
    target,
    macros,
    left: Math.round(target.target - totals.calories),
    water: { total: waterTotal(entry), goal: waterGoalOf(settings) },
    activityRows: showActivity ? activity?.rows || [] : [],
    activitySum: activity?.sum || null,
    reload: () => {
      const n = useNutrition.getState()
      if (settingsState.status !== 'ready') n.loadSettings({ force: true })
      n.loadDay(date, { force: true })
    },
  }
}
