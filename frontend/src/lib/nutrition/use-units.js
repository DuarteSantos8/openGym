import { dateLocale } from '../i18n.js'
import { useNutrition } from './store.js'
import { energyOf, waterOf } from './diary.js'

// Energy and water as the person reads them (NutriTrace's energyUnit and waterUnit). Values
// are stored as kcal and ml; this is display only.
export function useUnits() {
  const settings = useNutrition(s => s.settings.data)
  const fmt = v => v.toLocaleString(dateLocale())
  return {
    energyUnit: energyOf(0, settings).unit,
    energy: kcal => { const e = energyOf(kcal, settings); return fmt(e.value) + ' ' + e.unit },
    energyValue: kcal => fmt(energyOf(kcal, settings).value),
    water: ml => { const w = waterOf(ml, settings); return fmt(w.value) + ' ' + w.unit },
    /** The water amount and its unit apart, for a big number with a small unit. */
    waterParts: ml => { const w = waterOf(ml, settings); return { value: fmt(w.value), unit: w.unit } },
  }
}
