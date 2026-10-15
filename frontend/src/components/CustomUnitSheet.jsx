import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { addCustomUnit, CUSTOM_UNIT_ABBR_MAX, CUSTOM_UNIT_FULL_MAX } from '../lib/nutrition/settings-lists.js'
import { settingOf, useSheetSave } from '../lib/nutrition/use-nt-settings.js'
import { Button, TextField } from './ui.jsx'
import { SheetHeader } from './sheet-layout.jsx'

const errorOf = code => ({
  abbr: t('Give the unit an abbreviation of up to {0} characters.', CUSTOM_UNIT_ABBR_MAX),
  full: t('The full name can be up to {0} characters.', CUSTOM_UNIT_FULL_MAX),
  builtin: t('That unit is already in the list.'),
  duplicate: t('You already have a unit with that abbreviation.'),
  'full-list': t('That is the most custom units there can be. Remove one first.'),
})[code]

// NutriTrace's custom unit form (CustomUnits.svelte): an abbreviation, and a full name that
// defaults to it. A refused save keeps the sheet and what was typed.
export default function CustomUnitSheet({ close }) {
  const [abbr, setAbbr] = useState('')
  const [full, setFull] = useState('')
  const { busy, error, submit } = useSheetSave(close)
  const add = () => submit('customUnits', data => addCustomUnit(settingOf(data, 'customUnits'), { abbr, full }), errorOf)

  return <div className="quick-sheet">
    <SheetHeader title={t('Add a custom unit')} />
    <label className="portion-f">
      <span className="small muted">{t('Abbreviation')}</span>
      <TextField value={abbr} maxLength={CUSTOM_UNIT_ABBR_MAX} placeholder={t('shot')}
        onChange={e => setAbbr(e.target.value)} aria-label={t('Abbreviation')} autoFocus />
    </label>
    <label className="portion-f">
      <span className="small muted">{t('Full name (optional)')}</span>
      <TextField value={full} maxLength={CUSTOM_UNIT_FULL_MAX} placeholder={t('shot glass')}
        onChange={e => setFull(e.target.value)} aria-label={t('Full name (optional)')} />
    </label>
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={add} disabled={busy}>{busy ? t('Saving…') : t('Add')}</Button>
  </div>
}

export function customUnitSheet() {
  useUI.getState().openSheet(close => <CustomUnitSheet close={close} />)
}
