import { useEffect, useMemo } from 'react'
import { useStore } from '../../store/useStore.js'
import { allExercises, exOr } from '../../lib/exercises.js'
import { exerciseNameText, todayISO, weekStartOf } from '../../lib/format.js'
import { baseLang, EXERCISE_NAME_LANGS, useLang } from '../../lib/i18n.js'
import { effectiveLang } from '../../lib/default-lang.js'
import { coachAvailable } from '../../lib/coach.js'
import { DEMO } from '../../lib/demo.js'
import { MOBILE } from '../../lib/mobile.js'
import { IS_ANDROID, webauthnOK } from '../../lib/api.js'
import { pushSupported } from '../../lib/push.js'
import { wakeLockSupported } from '../../lib/wakelock.js'
import { playOnSilentSupported, vibrateSupported } from '../../lib/sound.js'
import { systemReducesMotion } from '../../lib/reduced-motion.js'
import { referencedFiles } from '../../lib/media-refs.js'
import { nutritionAvailable } from '../../lib/nutrition/api.js'
import { useNutrition } from '../../lib/nutrition/store.js'
import { diaryIndexDays, syncDiaryIndex, useDiaryIndex } from '../../lib/nutrition/diary-index.js'
import { mealLabels } from '../../lib/nutrition/meal-name.js'
import { passwordOn } from '../PasswordAuth.jsx'

// Everything the overlay's local sources read, in one object (lib/search/results.js `data`), and
// the loads they need: your foods, meals, recipes and NutriTrace's settings when the overlay
// opens, and the diary index caught up (at most every 30 s, diary-index.js).
export function useSearchData(open) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const sync = useStore(s => s.sync)
  const langV = useLang()
  const nutrition = nutritionAvailable(user)
  const ntSettings = useNutrition(s => s.settings.data)
  const foods = useNutrition(s => s.foods)
  const meals = useNutrition(s => s.meals)
  const recipes = useNutrition(s => s.recipes)
  const index = useDiaryIndex()

  useEffect(() => {
    if (!open || !nutrition) return
    const n = useNutrition.getState()
    n.loadSettings()
    n.loadFoods()
    n.loadMeals({ recipes: false })
    n.loadMeals({ recipes: true })
    syncDiaryIndex()
  }, [open, nutrition])

  const exercises = useMemo(() => allExercises(S), [S.customEx]) // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = useMemo(() => {
    const cache = new Map()
    return id => {
      if (!cache.has(id)) { const ex = exOr(id); cache.set(id, ex.missing ? '' : exerciseNameText(ex)) }
      return cache.get(id)
    }
  }, [S.customEx, langV]) // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const lang = effectiveLang(S, config)
    const fastingOn = ntSettings?.fastingEnabled === true
    const settingsCtx = {
      user, mobile: MOBILE, android: MOBILE && IS_ANDROID, demo: DEMO, wakeOK: wakeLockSupported(), hasMedia: referencedFiles(S).length > 0,
      pwOn: passwordOn(config), webauthn: webauthnOK(), sound: !!S.sound, playOnSilent: playOnSilentSupported(), canVibrate: vibrateSupported(),
      vibrate: S.vibrate !== false, profiles: (S.equipProfiles || []).length > 0, nameLang: EXERCISE_NAME_LANGS.includes(baseLang(lang)),
      pushOK: !MOBILE && pushSupported(), reminderOn: !!S.reminder?.on, nudge: !!S.reminder?.nudge, autoBackup: !!S.autoBackup,
      synced: !!sync, installTip: false, androidWeb: IS_ANDROID, baseLang: baseLang(lang), systemMotion: systemReducesMotion(),
      nutrition, ntSettings, fastingOn, lang,
    }
    return {
      S, exercises, nameOf, nutrition, ntSettings, today: todayISO(), weekStart: weekStartOf(S),
      foods: foods.list, meals: meals.list, recipes: recipes.list,
      foodsReady: foods.status === 'ready', mealsReady: meals.status === 'ready' && recipes.status === 'ready',
      days: nutrition ? diaryIndexDays() : [], daysReady: index.complete, index,
      mealNames: mealLabels(ntSettings),
      pagesCtx: { nutrition, checkIn: S.checkIn !== false, coach: coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode }), fastingOn },
      settingsCtx,
    }
  }, [S, user, config, coachMode, sync, nutrition, ntSettings, foods, meals, recipes, index, exercises, nameOf, langV])
}
