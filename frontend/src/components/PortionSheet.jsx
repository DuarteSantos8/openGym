import { useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { atPortion, nutritionOf, unitsFor } from '../lib/nutrition/diary.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { writeErrorText, toastLogged } from '../lib/nutrition/log-feedback.js'
import { fmtDate } from '../lib/format.js'
import MacroLine from './MacroLine.jsx'
import { Button, NumberField } from './ui.jsx'
import { Chip, ChipRow, Stat } from './blocks.jsx'
import { SheetHeader } from './sheet-layout.jsx'

// How much of a food, then Log: NutriTrace's quantity prompt (Foods.svelte). Serving size in any
// unit NutriTrace knows (the food's own household units first), number of servings, and the
// nutrients of that amount as you type. A failed write keeps the sheet and what is in it; Log
// again sends the same entry, so a save whose answer was lost is not logged twice.
// `pending` ({ uuid, food }): the entry a failed write may still have saved, shared by the sheets
// of one picker. For the same food the next log reuses that uuid, so an amount edited after a
// lost answer updates the entry instead of adding a second one.
const foodKey = food => String(food.id ?? food.client_key ?? food.name)

export default function PortionSheet({ food, date, meal, mealName, onLogged, pending: shared, close }) {
  const units = useUnits()
  const own = useRef({ uuid: null, food: null })
  const pending = shared || own.current
  const [portion, setPortion] = useState(Number(food.portion) || 100)
  const [unit, setUnit] = useState(food.unit || 'g')
  const [servings, setServings] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // One draft per amount: the same inputs retry the same entry.
  const draft = useMemo(() => {
    try {
      const d = useNutrition.getState().draftFood({ food, meal, portion, unit, servings })
      return pending.uuid && pending.food === foodKey(food) ? { ...d, item: { ...d.item, uuid: pending.uuid } } : d
    } catch { return null }
  }, [food, meal, portion, unit, servings, pending])
  const scaled = nutritionOf({ ...atPortion(food, portion || food.portion, unit), quantity: servings || 1 })

  const log = async () => {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    try {
      const item = await useNutrition.getState().logFood(date, draft)
      pending.uuid = null
      pending.food = null
      close()
      if (onLogged) onLogged()
      toastLogged(t('Logged to {0}', mealName), () => useNutrition.getState().removeItem(date, item.uuid))
    } catch (e) {
      pending.uuid = draft.item.uuid
      pending.food = foodKey(food)
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  return <div className="portion-sheet">
    <SheetHeader title={food.name} sub={[food.brand, mealName, fmtDate(date, true)].filter(Boolean).join(' · ')} />
    <div className="portion-grid">
      <label className="portion-f">
        <span className="small muted">{t('Serving size')}</span>
        <NumberField value={portion} onChange={setPortion} aria-label={t('Serving size')} />
      </label>
      <label className="portion-f">
        <span className="small muted">{t('Servings')}</span>
        <NumberField value={servings} onChange={setServings} aria-label={t('Servings')} />
      </label>
    </div>
    <ChipRow className="portion-units" role="radiogroup" aria-label={t('Unit')}>
      {unitsFor(food).map(u => <Chip key={u} nocap on={u === unit} role="radio" aria-checked={u === unit} onClick={() => setUnit(u)}>{u}</Chip>)}
    </ChipRow>
    <div className="portion-sum">
      <Stat value={units.energy(scaled.calories || 0)} />
      <MacroLine p={scaled.proteins} c={scaled.carbohydrates} f={scaled.fat} />
    </div>
    {!draft && <div className="muted small" role="status">{t('Enter an amount above 0.')}</div>}
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={log} disabled={!draft || busy}>{busy ? t('Saving…') : t('Log')}</Button>
  </div>
}

export function portionSheet(props) {
  useUI.getState().openSheet(close => <PortionSheet {...props} close={close} />)
}
