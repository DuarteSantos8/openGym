import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'
import { waterButtons } from '../lib/nutrition/water.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { Card } from './blocks.jsx'
import { Inline } from './layout.jsx'

// A water entry whose write failed, by date and amount: the next tap sends that same entry again,
// so a save whose answer was lost is not counted twice.
const pending = {}

/** Logs `ml` of water (a glass, or a container) to the date, with Undo. A failure is a toast;
 *  nothing changes. */
export async function addWater(date, ml) {
  const n = useNutrition.getState()
  const key = date + ':' + ml
  const log = pending[key] || n.draftWater(ml)
  pending[key] = log
  try {
    await n.logWater(date, log)
    delete pending[key]
    toastLogged(t('Water added'), () => useNutrition.getState().removeWater(date, log.uuid))
    return true
  } catch (e) {
    useUI.getState().toast(writeErrorText(e))
    return false
  }
}

/** The label of a quick-add: the amount in the person's water unit, with the container's name. */
export const waterAria = (button, units) => (button.name
  ? t('Add {0}, {1}', button.name, units.water(button.ml))
  : t('Add a glass of water, {0}', units.water(button.ml)))

// Water for the day against its goal, with a tap for each container (Profile › Water), or a glass
// when there are none (ia-proposal §2). Hidden when Profile › Water says not to show it here.
export default function WaterCard({ date, water, ready }) {
  const units = useUnits()
  const settings = useNutrition(s => s.settings.data)
  const [busy, setBusy] = useState(false)
  if (!settingOf(settings, 'waterShowInDiary')) return null
  const pct = water.goal ? Math.min(100, (water.total / water.goal) * 100) : 0
  const add = async ml => { setBusy(true); await addWater(date, ml); setBusy(false) }
  return <Card className="water-card">
    <Inline justify="between" gap={4} wrap>
      <Inline gap={4} className="nt-lead">
        <span className="lrow-i tint-blue"><Icon name="droplet" /></span>
        <div>
          <div className="lbl2">{t('Water')}</div>
          <div className="ttl">{units.water(water.total)} / {units.water(water.goal)}</div>
        </div>
      </Inline>
      <Inline gap={3} wrap>
        {waterButtons(settings).map(b => (
          <Button key={b.id} size="sm" variant="tinted" icon="plus" onClick={() => add(b.ml)} disabled={busy || !ready}
            aria-label={waterAria(b, units)}>{units.water(b.ml)}</Button>
        ))}
      </Inline>
    </Inline>
    <div className="macro-track water-track" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
  </Card>
}
