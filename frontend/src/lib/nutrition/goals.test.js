import { describe, expect, it } from 'vitest'
import { fixtureSettings } from './fake-nutritrace.js'
import {
  MACROS, applyPreset, applyTemplate, draftOf, goalNotes, goalsAfter, gramsToPercent, hasWearable, makeTemplate,
  migrateKilojoules, previewBase, toggleMacroUnit, waterFromUnit, waterToUnit, workoutAdjustState, writesFor,
} from './goals.js'

const base = () => fixtureSettings()

describe('what a draft writes', () => {
  it('writes nothing for an untouched page', () => {
    expect(writesFor(base(), draftOf(base()))).toEqual([])
  })

  it('writes only the settings that changed', () => {
    const draft = { ...draftOf(base()), mode: 'adaptive', factor: 0.8 }
    expect(writesFor(base(), draft)).toEqual([['calorieGoalMode', 'adaptive'], ['calorieGoalFactor', 0.8]])
  })

  it('keeps every other nutrient goal and the flags of the ones it edits', () => {
    const settings = { ...base(), goals: { ...base().goals, fiber: { max: 30, isMin: true, min: 30 }, proteins: { max: 160, showInDiary: false } } }
    const draft = draftOf(settings)
    draft.kcal = 2400
    draft.macros.proteins.value = 180
    const goals = writesFor(settings, draft).find(([k]) => k === 'goals')[1]
    expect(goals.fiber).toEqual({ max: 30, isMin: true, min: 30 })
    expect(goals.calories).toMatchObject({ sharedGoal: true, max: 2400, days: Array(7).fill(2400) })
    expect(goals.proteins).toMatchObject({ max: 180, showInDiary: false, isPercent: false })
  })

  it('removes a goal that is cleared, and leaves weekday goals alone', () => {
    const settings = { ...base(), goals: { calories: { sharedGoal: false, days: [1, 2, 3, 4, 5, 6, 7].map(n => n * 300), max: 2100 }, fat: { max: 70 } } }
    const draft = draftOf(settings)
    expect(draft.kcalPerWeekday).toBe(true)
    draft.macros.fat.value = null
    const goals = goalsAfter(settings.goals, draft)
    expect(goals.calories).toBe(settings.goals.calories)
    expect(goals.fat).toBeUndefined()
  })

  it('turns on the diary activity line with the workout setting, which the target needs', () => {
    const settings = { ...base(), diaryShowActivity: false }
    const draft = { ...draftOf(settings), adjust: true }
    expect(writesFor(settings, draft)).toEqual([['diaryShowActivity', true], ['calorieAdjustFromActivity', true]])
  })

  it('still writes the diary activity line on a retry after the workout setting went through', () => {
    // First attempt: calorieAdjustFromActivity landed, diaryShowActivity failed. Workouts would
    // stop counting while the switch shows ON, so the retry has to send it.
    const before = { ...base(), diaryShowActivity: false }
    const draft = { ...draftOf(before), adjust: true }
    const afterPartial = { ...before, calorieAdjustFromActivity: true }
    expect(writesFor(afterPartial, draft, before)).toEqual([['diaryShowActivity', true]])
  })

  it('only writes what was changed here, never reverting a change made elsewhere', () => {
    const snapshot = base()
    const draft = { ...draftOf(snapshot), waterMl: 3000 }
    const now = { ...snapshot, calorieGoalMode: 'adaptive', goals: { ...snapshot.goals, calories: { ...snapshot.goals.calories, max: 2400, min: 2400 } } }
    expect(writesFor(now, draft, snapshot)).toEqual([['waterGoalMl', 3000]])
    const edited = { ...draft, kcal: 2300 }
    const goals = writesFor(now, edited, snapshot).find(([k]) => k === 'goals')[1]
    expect(goals.calories.max).toBe(2300)
    expect(goals.proteins).toEqual(now.goals.proteins)
  })

  it('never removes the calorie goal when the target is blanked', () => {
    const draft = { ...draftOf(base()), kcal: null }
    expect(goalsAfter(base().goals, draft).calories).toEqual(base().goals.calories)
    expect(writesFor(base(), draft)).toEqual([])
  })

  it('writes a changed water goal in ml, and never a blank one', () => {
    const draft = { ...draftOf(base()), waterMl: 3000 }
    expect(writesFor(base(), draft)).toEqual([['waterGoalMl', 3000]])
    expect(writesFor(base(), { ...draft, waterMl: 0 })).toEqual([])
  })
})

describe('macros', () => {
  it('converts a macro between grams and percent so the target stays put', () => {
    const m = { value: 150, percent: false, perWeekday: false }
    const pct = toggleMacroUnit(m, 'proteins', 2000)
    expect(pct).toMatchObject({ percent: true, value: 30 })
    expect(toggleMacroUnit(pct, 'proteins', 2000)).toMatchObject({ percent: false, value: 150 })
  })

  it('fills a preset as grams against the calorie target', () => {
    expect(applyPreset('balanced', 2000)).toMatchObject({ proteins: { value: 150 }, carbohydrates: { value: 200 }, fat: { value: 67 } })
    expect(applyPreset('balanced', 0)).toBeNull()
  })

  it('leaves a weekday-specific macro alone when a preset is applied', () => {
    const settings = { ...base(), goals: { ...base().goals, fat: { sharedGoal: false, days: [60, 60, 60, 60, 60, 80, 80], max: 70 } } }
    const draft = draftOf(settings)
    const macros = applyPreset('balanced', 2000, draft.macros)
    expect(macros.fat).toBe(draft.macros.fat)
    expect(macros.fat.perWeekday).toBe(true)
    expect(macros.proteins).toMatchObject({ value: 150, perWeekday: false })
    const allWeekday = Object.fromEntries(MACROS.map(id => [id, { value: null, percent: false, perWeekday: true }]))
    expect(applyPreset('balanced', 2000, allWeekday)).toBeNull()
  })

  it('converts grams to the fewest-decimal percent that returns the same grams', () => {
    // 151 g protein at 2200 kcal is 27.45 %: a whole 27 % would come back as 149 g.
    expect(gramsToPercent(151, 2200, 4)).toBe(27.5)
    const pct = { value: 27.5, percent: true, perWeekday: false }
    expect(toggleMacroUnit(pct, 'proteins', 2200)).toMatchObject({ percent: false, value: 151 })
    const grams = { value: 151, percent: false, perWeekday: false }
    expect(toggleMacroUnit(toggleMacroUnit(grams, 'proteins', 2200), 'proteins', 2200)).toMatchObject({ percent: false, value: 151 })
    expect(gramsToPercent(150, 2000, 4)).toBe(30)
    expect(gramsToPercent(137, 1828, 4)).toBe(30)
  })

  it('notes an extreme target and macros that do not add up', () => {
    expect(goalNotes(1000, {}).map(n => n.code)).toEqual(['low'])
    expect(goalNotes(6000, {}).map(n => n.code)).toEqual(['high'])
    expect(goalNotes(2000, { proteins: 100, carbohydrates: 100, fat: 30 }).map(n => n.code)).toEqual(['mismatch'])
    expect(goalNotes(2000, { proteins: 150, carbohydrates: 200, fat: 67 })).toEqual([])
  })
})

describe('calorie modes', () => {
  it('previews the target each mode lands on, falling back to fixed without data', () => {
    const settings = base()
    const draft = { ...draftOf(settings), factor: 1.2 }
    expect(previewBase(settings, { ...draft, mode: 'fixed' })).toMatchObject({ kcal: 2200, fromBurn: false })
    expect(previewBase(settings, { ...draft, mode: 'adaptive' }, { adaptive: { ready: false } })).toMatchObject({ kcal: 2200, fromBurn: false })
    expect(previewBase(settings, { ...draft, mode: 'adaptive' }, { adaptive: { ready: true, tdee: 2500 } })).toMatchObject({ kcal: 3000, fromBurn: true })
    expect(previewBase(settings, { ...draft, mode: 'dynamic' }, { caloriesOut: 2000 })).toMatchObject({ kcal: 2400, fromBurn: true })
  })

  it('previews a weekday-specific calorie target as today’s, not the highest', () => {
    const days = [1800, 1900, 2000, 2100, 2200, 2300, 2400]
    const settings = { ...base(), goals: { ...base().goals, calories: { sharedGoal: false, days, max: 2400 } } }
    const draft = draftOf(settings)
    // 2026-10-14 is a Wednesday (getDay 3).
    expect(previewBase(settings, draft, { date: '2026-10-14' }).kcal).toBe(2100)
    expect(previewBase(settings, draft, { date: '2026-10-18' }).kcal).toBe(1800)
  })

  it('does not know whether a workout applies while the Adaptive estimate is loading or failed', () => {
    expect(workoutAdjustState('adaptive', null, 'loading')).toBe('pending')
    expect(workoutAdjustState('adaptive', null, 'failed')).toBe('pending')
    expect(workoutAdjustState('adaptive', { ready: true }, 'ready')).toBe('burn')
    expect(workoutAdjustState('fixed', null, 'loading')).toBe('optin')
  })

  it('lets a workout change the target only in Fixed and while Adaptive is still learning', () => {
    expect(workoutAdjustState('fixed', null)).toBe('optin')
    expect(workoutAdjustState('adaptive', { ready: false })).toBe('optin')
    expect(workoutAdjustState('adaptive', { ready: true })).toBe('burn')
    expect(workoutAdjustState('dynamic', null)).toBe('burn')
  })

  it('reads a wearable from the connection flags', () => {
    expect(hasWearable(base())).toBe(false)
    expect(hasWearable({ garminEnabled: true })).toBe(true)
  })
})

describe('water and templates', () => {
  it('shows ml in the person’s unit and stores it back as ml', () => {
    expect(waterToUnit(2000, 'ml')).toBe(2000)
    expect(waterToUnit(2000, 'L')).toBe(2)
    expect(waterFromUnit(2, 'L')).toBe(2000)
    expect(waterFromUnit(64, 'oz')).toBe(1893)
  })

  it('converts a kilojoule template to kcal the way NutriTrace does', () => {
    const tpl = { goals: { kilojoules: { max: 8368, min: 8368, days: [8368, null, 4184], sharedGoal: true }, fat: { max: 50 } } }
    const next = applyTemplate(draftOf(base()), tpl)
    expect(next.kcal).toBe(2000)
    expect(next.baseGoals.kilojoules).toBeUndefined()
    expect(next.baseGoals.calories.days).toEqual([2000, null, 1000])
    const kept = migrateKilojoules({ calories: { max: 1800 }, kilojoules: { max: 9999 } })
    expect(kept).toEqual({ calories: { max: 1800 } })
  })

  it('applies a template as the saved goals, kilojoule leftovers dropped', () => {
    const tpl = makeTemplate('Cut', { calories: { max: 1800, sharedGoal: true }, kilojoules: { max: 9999 }, fat: { max: 50 } }, 3000, 1000)
    expect(tpl).toMatchObject({ id: 1000, name: 'Cut', goalCount: 4 })
    const next = applyTemplate(draftOf(base()), tpl)
    expect(next).toMatchObject({ kcal: 1800, waterMl: 3000 })
    expect(next.macros.fat.value).toBe(50)
    expect(next.macros.proteins.value).toBeNull()
    expect(next.baseGoals.kilojoules).toBeUndefined()
    expect(writesFor(base(), next).map(([k]) => k)).toEqual(['goals', 'waterGoalMl'])
  })
})
