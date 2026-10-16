import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import { scanToSelection } from './scan-to-selection.js'
import { ActionButton, ActionRow } from './tab-kit.jsx'
import WaterAction from './WaterAction.jsx'

// Nutrition's action row (ux-redesign-tabs §2): [Log food] [Scan] [Saved meals] [+250 ml], all
// outlined (Owner decision 7). Each runs the flow the + sheet and Home already run: the food
// picker and the scanner on the shared date and meal, the Saved meals page, a glass of water.
export default function NutritionActions({ date, day }) {
  const nav = useNavigate()
  return <ActionRow>
    <ActionButton icon="utensils" label={t('Log food')} onClick={foodPickerSheet} />
    <ActionButton icon="scanBarcode" label={t('Scan')} onClick={scanToSelection} />
    <ActionButton icon="bookOpen" label={t('Saved meals')} onClick={() => nav('/food/meals')} />
    <WaterAction date={date} day={day} />
  </ActionRow>
}
