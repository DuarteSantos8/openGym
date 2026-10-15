import { useEffect, useMemo, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { energyOf, foodKcal, matchesFood, unitsFor } from '../lib/nutrition/diary.js'
import { ingredientOf, mealLoadErrorText, rescaleIngredient } from '../lib/nutrition/meals.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Chip, ChipRow, EmptyState, ItemRow, Tag } from './blocks.jsx'
import MealNutrition from './MealNutrition.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, NumberField, SearchField } from './ui.jsx'

const SHOWN = 50

// One ingredient of a meal or recipe: pick one of your foods and say how much, or (with `item`)
// change the amount of one already in it, or take it out (`onRemove`). Hands the ingredient to
// `onDone` and closes.
export function IngredientSheet({ item = null, onDone, onRemove = null, close }) {
  const foods = useNutrition(s => s.foods)
  const settings = useNutrition(s => s.settings.data)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(item)
  const [amount, setAmount] = useState(item ? (parseFloat(item.portion) || 0) * (parseFloat(item.quantity) || 1) : 0)
  const [unit, setUnit] = useState(item?.unit || 'g')

  useEffect(() => { useNutrition.getState().loadSettings() }, [])
  useEffect(() => { if (!item) useNutrition.getState().loadFoods() }, [item])

  const ingredient = useMemo(() => {
    if (!picked) return null
    try { return item ? rescaleIngredient(item, amount, unit) : ingredientOf(picked, amount, unit) } catch { return null }
  }, [picked, item, amount, unit])

  const pick = food => {
    setPicked(food)
    setAmount(Number(food.portion) || 100)
    setUnit(food.unit || 'g')
  }

  const done = () => {
    if (!ingredient) return
    onDone(ingredient)
    close()
  }

  const remove = () => {
    onRemove()
    close()
  }

  if (!picked) {
    const list = foods.list.filter(f => matchesFood(f, q)).slice(0, SHOWN)
    let body
    if (foods.status === 'error' && !foods.list.length) {
      body = <EmptyState>
        <div role="alert">{mealLoadErrorText(foods.error)}</div>
        <Button size="sm" variant="tinted" onClick={() => useNutrition.getState().loadFoods({ force: true })}>{t('Try again')}</Button>
      </EmptyState>
    } else if (foods.status !== 'ready' && !foods.list.length) {
      body = <EmptyState><div role="status">{t('Loading…')}</div></EmptyState>
    } else if (!foods.list.length) {
      body = <EmptyState icon="apple">{t('No foods yet. Save some under Foods first.')}</EmptyState>
    } else if (!list.length) {
      body = <EmptyState icon="magnifier">{t('No match')}</EmptyState>
    } else {
      body = <div className="list">{list.map(f => {
        const kcal = energyOf(foodKcal(f), settings)
        return <ItemRow key={f.id} title={f.name} onClick={() => pick(f)} trailing={<Tag>{kcal.value} {kcal.unit}</Tag>}
          subtitle={[f.brand, `${Math.round((Number(f.portion) || 100) * 100) / 100} ${f.unit || 'g'}`].filter(Boolean).join(' · ')} />
      })}</div>
    }
    return <>
      <SheetHeader title={t('Add ingredient')} onClose={close} />
      <SearchField value={q} placeholder={t('Search your foods')} autoFocus onChange={e => setQ(e.target.value)} onClear={() => setQ('')} />
      {body}
    </>
  }

  return <>
    <SheetHeader title={picked.name} onClose={close} />
    <label className="measure-date">
      <span>{t('Amount')}</span>
      <NumberField value={amount} onChange={setAmount} aria-label={t('Amount')} />
    </label>
    <ChipRow role="radiogroup" aria-label={t('Unit')}>
      {unitsFor(picked).map(u => <Chip key={u} nocap on={u === unit} role="radio" aria-checked={u === unit} onClick={() => setUnit(u)}>{u}</Chip>)}
    </ChipRow>
    {ingredient
      ? <MealNutrition nutrition={ingredient.nutrition} settings={settings} />
      : <div className="small muted" role="status">{t('Enter an amount above 0.')}</div>}
    <SheetActions>
      <Button variant="primary" onClick={done} disabled={!ingredient}>{item ? t('Save') : t('Add')}</Button>
      {!item && <Button variant="ghost" onClick={() => setPicked(null)}>{t('Choose another food')}</Button>}
      {item && onRemove && <Button variant="ghost" onClick={remove}>{t('Remove {0}', item.name)}</Button>}
    </SheetActions>
  </>
}

/** Opens the sheet over the editor. */
export function ingredientSheet(props) {
  useUI.getState().openSheet(close => <IngredientSheet {...props} close={close} />)
}
