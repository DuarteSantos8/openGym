import { t } from '../lib/i18n.js'
import { useUnits } from '../lib/nutrition/use-units.js'

// "1,240 left", in the tab-root header's context slot once the hero has scrolled away
// (ux-redesign-tabs §4.2). The unit is in the name, not on the pill, to fit beside the search
// pill at 320px. Tapping it goes back to the top, where the hero says the same.
export default function KcalLeftButton({ left }) {
  const units = useUnits()
  const over = left < 0
  const amount = Math.abs(left)
  return <button type="button" className={'hdr-left' + (over ? ' over' : '')} onClick={() => window.scrollTo(0, 0)}
    aria-label={over ? t('{0} over', units.energy(amount)) : t('{0} left', units.energy(amount))}>
    {over ? t('{0} over', units.energyValue(amount)) : t('{0} left', units.energyValue(amount))}
  </button>
}
