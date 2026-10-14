import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import RootHeader from '../components/RootHeader.jsx'

// The Nutrition tab's root. Food logging, saved meals, recipes and goals come with the Nutrition
// update; until then the tab says so instead of showing controls that do nothing.
export default function FoodHub() {
  return <div className="narrow">
    <RootHeader title={t('Nutrition')} />
    <div className="card">
      <div className="empty">
        <div className="ico"><Icon name="utensils" /></div>
        <strong>{t('Food logging is on its way')}</strong>
        <div>{t('Meals, foods, recipes and calorie goals will live here.')}</div>
      </div>
    </div>
  </div>
}
