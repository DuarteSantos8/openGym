import { useCallback, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { writeErrorText } from './log-feedback.js'
import { useNutrition } from './store.js'

// What NutriTrace reads when a key was never saved (src/stores/settings.js). The pages show these
// and the search and Features read them, so a person who never touched a switch sees the state
// NutriTrace itself shows.
export const NT_DEFAULTS = {
  diaryShowBrands: true,
  diaryShowTimestamps: false,
  diaryShowMacroSummary: true,
  diaryPromptQuantity: true,
  diaryDefaultField: 'servings',
  showQuickCalories: true,
  quickCaloriesDisplay: 'summed',
  diaryShowActivity: false,
  calorieAdjustFromActivity: false,
  manualActivityPolicy: 'wearable_wins',
  waterUnit: 'ml',
  waterShowInDiary: true,
  waterShowInStats: true,
  // NutriTrace starts with two bottles; Gains keeps its plain 250 ml button until the person adds
  // a container, so an account that never set any sees no buttons it did not ask for.
  waterContainers: [],
  foodsShowCategories: true,
  foodsShowLabels: true,
  foodsShowNotes: true,
  foodsDefaultSource: 'local',
  foodsSort: 'alpha',
  mealsSort: 'alpha',
  recipesSort: 'alpha',
  barcodeBeep: false,
  offEnabled: true,
  offSearchLanguage: 'en',
  offSearchCountry: 'World',
  usdaEnabled: false,
  foodCategories: [],
  customUnits: [],
}

/** A setting as NutriTrace would read it: the saved value, or its default. */
export const settingOf = (data, key) => (data?.[key] != null ? data[key] : NT_DEFAULTS[key])

/**
 * NutriTrace's settings and one way to write them: `save(key, value)` resolves true once the hub
 * has the value, and false after a toast with the reason (the value on screen is the saved one
 * until then, so what was typed stays where it was). `busy[key]` is set while that key saves.
 */
export function useNtSettings() {
  const data = useNutrition(s => s.settings.data)
  const [busy, setBusy] = useState({})
  const save = useCallback(async (key, value) => {
    setBusy(b => ({ ...b, [key]: true }))
    try {
      await useNutrition.getState().saveSetting(key, value)
      return true
    } catch (e) {
      useUI.getState().toast(writeErrorText(e))
      return false
    } finally {
      setBusy(b => ({ ...b, [key]: false }))
    }
  }, [])
  // A change to a list (an add, a remove, a rename): see applyListSetting. Resolves true when saved.
  // A rule it refuses (`errorOf` words it) or a failed save is a toast, and the list stays as it was.
  const update = useCallback(async (key, change, errorOf) => {
    setBusy(b => ({ ...b, [key]: true }))
    try {
      const built = await applyListSetting(key, change)
      if (built.error) { useUI.getState().toast(errorOf(built.error)); return false }
      return true
    } catch (e) {
      useUI.getState().toast(writeErrorText(e))
      return false
    } finally {
      setBusy(b => ({ ...b, [key]: false }))
    }
  }, [])
  return { data, busy, save, update }
}

/**
 * Writes a list setting as a change over the list as the server has it now. A list is one value,
 * so a write built from the copy this page loaded earlier would undo what was changed since in
 * NutriTrace or on another device (for the meal names, that moves logged entries to other meals).
 * It reads the settings again, builds the new list from them (`change(data)` answers `{ list }` or
 * `{ error }`) and only then writes. Throws an NtError when the read or the write fails.
 */
export async function applyListSetting(key, change) {
  await useNutrition.getState().loadSettings({ force: true })
  const { status, error, data } = useNutrition.getState().settings
  if (status === 'error' || !data) throw error
  const built = change(data)
  if (built.error) return built
  await useNutrition.getState().saveSetting(key, built.list)
  return built
}

/**
 * The save behind a sheet that edits a list setting. `submit(key, change, errorOf)` is
 * applyListSetting, then closes the sheet. A refused or failed save leaves the sheet open with
 * its fields and says why.
 */
export function useSheetSave(close) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (key, change, errorOf) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const built = await applyListSetting(key, change)
      if (built.error) { setError(errorOf(built.error)); setBusy(false); return }
      close()
    } catch (e) {
      setError(writeErrorText(e))
      setBusy(false)
    }
  }
  return { busy, error, submit }
}
