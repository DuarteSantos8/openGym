import { useId, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'
import { waterButtons } from '../lib/nutrition/water.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import { Button, Row, Section } from './ui.jsx'

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
// when there are none (ia-proposal §2), as an inset-list row of the diary. Hidden when
// Profile › Water says not to show it here. The buttons are a group named by the row's title and
// total ("Water, 250 ml / 2,500 ml"), which is what tells them from the action row's button of
// the same name.
export default function WaterCard({ date, water, ready }) {
  const units = useUnits()
  const settings = useNutrition(s => s.settings.data)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const titleId = id + '-t'
  const totalId = id + '-v'
  if (!settingOf(settings, 'waterShowInDiary')) return null
  const add = async ml => { setBusy(true); await addWater(date, ml); setBusy(false) }
  return <Section className="water-card">
    <Row glyph="droplet" title={t('Water')} titleId={titleId} subtitle={`${units.water(water.total)} / ${units.water(water.goal)}`} subtitleId={totalId}>
      <span className="water-adds" role="group" aria-labelledby={`${titleId} ${totalId}`}>
        {waterButtons(settings).map(b => (
          <Button key={b.id} size="sm" variant="tinted" icon="plus" onClick={() => add(b.ml)} disabled={busy || !ready}
            aria-label={waterAria(b, units)}>{units.water(b.ml)}</Button>
        ))}
      </span>
    </Row>
  </Section>
}
