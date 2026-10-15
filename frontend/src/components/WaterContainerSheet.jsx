import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { addContainer, WATER_CONTAINER_NAME_MAX, WATER_CONTAINER_ML_MAX } from '../lib/nutrition/settings-lists.js'
import { settingOf, useSheetSave } from '../lib/nutrition/use-nt-settings.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Button, NumberField, Segmented, TextField } from './ui.jsx'
import { SheetHeader } from './sheet-layout.jsx'

const UNIT_OPTIONS = [
  { value: 'ml', label: 'ml' },
  { value: 'oz', label: 'fl oz' },
  { value: 'L', label: 'L' },
  { value: 'G', label: 'G' },
]

const errorOf = code => ({
  name: t('Give the container a name of up to {0} characters.', WATER_CONTAINER_NAME_MAX),
  volume: t('Enter a volume between 1 ml and {0} ml.', WATER_CONTAINER_ML_MAX.toLocaleString()),
  full: t('That is the most containers there can be. Remove one first.'),
})[code]

// NutriTrace's "Add container" (Water.svelte): a name and a volume in the unit you pick, stored
// as whole ml. A refused save keeps the sheet and what was typed.
export default function WaterContainerSheet({ close }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(null)
  const [unit, setUnit] = useState(() => settingOf(useNutrition.getState().settings.data, 'waterUnit'))
  const { busy, error, submit } = useSheetSave(close)
  const add = () => submit('waterContainers',
    data => addContainer(settingOf(data, 'waterContainers'), { name, amount, unit }), errorOf)

  return <div className="quick-sheet">
    <SheetHeader title={t('Add a container')} />
    <label className="portion-f">
      <span className="small muted">{t('Name')}</span>
      <TextField value={name} maxLength={WATER_CONTAINER_NAME_MAX} onChange={e => setName(e.target.value)} aria-label={t('Name')} autoFocus />
    </label>
    <label className="portion-f">
      <span className="small muted">{t('Volume')}</span>
      <NumberField value={amount} onChange={setAmount} nullable aria-label={t('Volume')} />
    </label>
    <Segmented options={UNIT_OPTIONS} value={unit} onChange={setUnit} ariaLabel={t('Unit')} />
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={add} disabled={busy}>{busy ? t('Saving…') : t('Add')}</Button>
  </div>
}

export function waterContainerSheet() {
  useUI.getState().openSheet(close => <WaterContainerSheet close={close} />)
}
