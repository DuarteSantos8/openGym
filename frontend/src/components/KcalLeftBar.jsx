import { t } from '../lib/i18n.js'
import { useUnits } from '../lib/nutrition/use-units.js'

// "1,240 kcal left", pinned under the tab-root header once the calories card has scrolled away
// (ux-redesign-tabs §4.2). The bar takes no height, so the pill comes and goes without moving the
// page; the calories card says the same to a screen reader. `left` null: nothing shown.
export default function KcalLeftBar({ left }) {
  const units = useUnits()
  return <div className="kcal-left-bar" aria-hidden="true">
    {left != null && <span className={'kcal-left-pill' + (left < 0 ? ' over' : '')}>
      {left < 0 ? t('{0} over', units.energy(Math.abs(left))) : t('{0} left', units.energy(left))}
    </span>}
  </div>
}
