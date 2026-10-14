import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { Card } from './blocks.jsx'
import { Inline } from './layout.jsx'

export const WATER_STEP_ML = 250

// A glass whose write failed, by date: the next tap sends that same entry again, so a save whose
// answer was lost is not counted twice.
const pending = {}

/** Logs a glass (250 ml) to the date, with Undo. A failure is a toast; nothing changes. */
export async function addWater(date) {
  const n = useNutrition.getState()
  const log = pending[date] || n.draftWater(WATER_STEP_ML)
  pending[date] = log
  try {
    await n.logWater(date, log)
    delete pending[date]
    toastLogged(t('Water added'), () => useNutrition.getState().removeWater(date, log.uuid))
    return true
  } catch (e) {
    useUI.getState().toast(writeErrorText(e))
    return false
  }
}

// Water for the day against its goal, with one tap for a glass (ia-proposal §2).
export default function WaterCard({ date, water, ready }) {
  const units = useUnits()
  const [busy, setBusy] = useState(false)
  const pct = water.goal ? Math.min(100, (water.total / water.goal) * 100) : 0
  const add = async () => { setBusy(true); await addWater(date); setBusy(false) }
  return <Card className="water-card">
    <Inline justify="between">
      <Inline gap={4} className="nt-lead">
        <span className="lrow-i tint-blue"><Icon name="droplet" /></span>
        <div>
          <div className="lbl2">{t('Water')}</div>
          <div className="ttl">{units.water(water.total)} / {units.water(water.goal)}</div>
        </div>
      </Inline>
      <Button size="sm" variant="tinted" icon="plus" onClick={add} disabled={busy || !ready}
        aria-label={t('Add a glass of water, {0}', units.water(WATER_STEP_ML))}>{units.water(WATER_STEP_ML)}</Button>
    </Inline>
    <div className="macro-track water-track" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
  </Card>
}
