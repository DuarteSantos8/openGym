import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { addCategory, CATEGORY_LABEL_MAX, CATEGORY_NAME_MAX } from '../lib/nutrition/settings-lists.js'
import { settingOf, useSheetSave } from '../lib/nutrition/use-nt-settings.js'
import { Button, TextField } from './ui.jsx'
import { SheetHeader } from './sheet-layout.jsx'

const errorOf = code => ({
  name: t('Give the category a name of up to {0} characters.', CATEGORY_NAME_MAX),
  label: t('The label can be up to {0} characters.', CATEGORY_LABEL_MAX),
  duplicate: t('You already have a category with that name.'),
  full: t('That is the most categories there can be. Remove one first.'),
})[code]

// NutriTrace's category form (Categories.svelte): a name, and an optional label (an emoji) shown
// before it. A refused save keeps the sheet and what was typed.
export default function FoodCategorySheet({ close }) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const { busy, error, submit } = useSheetSave(close)
  const add = () => submit('foodCategories', data => addCategory(settingOf(data, 'foodCategories'), { name, label }), errorOf)

  return <div className="quick-sheet">
    <SheetHeader title={t('Add a category')} />
    <label className="portion-f">
      <span className="small muted">{t('Name')}</span>
      <TextField value={name} maxLength={CATEGORY_NAME_MAX} placeholder={t('Dairy, Proteins…')}
        onChange={e => setName(e.target.value)} aria-label={t('Name')} autoFocus />
    </label>
    <label className="portion-f">
      <span className="small muted">{t('Label (an emoji, optional)')}</span>
      <TextField value={label} maxLength={CATEGORY_LABEL_MAX} onChange={e => setLabel(e.target.value)} aria-label={t('Label (an emoji, optional)')} />
    </label>
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={add} disabled={busy}>{busy ? t('Saving…') : t('Add')}</Button>
  </div>
}

export function foodCategorySheet() {
  useUI.getState().openSheet(close => <FoodCategorySheet close={close} />)
}
