import { t } from '../lib/i18n.js'
import { energyOf } from '../lib/nutrition/diary.js'

const grams = v => Math.round((Number(v) || 0) * 10) / 10

// Energy, protein, carbs and fat of a meal, a recipe serving or an ingredient.
export default function MealNutrition({ nutrition, settings, label }) {
  const energy = energyOf(Number(nutrition?.calories) || 0, settings)
  return <div className="measure-preview">
    {label && <span>{label}</span>}
    <span><b>{energy.value} {energy.unit}</b></span>
    <span>{t('Protein')} <b>{grams(nutrition?.proteins)} g</b></span>
    <span>{t('Carbs')} <b>{grams(nutrition?.carbohydrates)} g</b></span>
    <span>{t('Fat')} <b>{grams(nutrition?.fat)} g</b></span>
  </div>
}
