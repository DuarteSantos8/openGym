import { useId, useState } from 'react'
import { t, tn } from '../lib/i18n.js'
import { nutritionOf, totalsOf } from '../lib/nutrition/diary.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import FoodPicker from './FoodPicker.jsx'
import Icon from './Icon.jsx'

const amountOf = item => (item.type === 'quick_calories' ? t('Quick kcal')
  : `${item.quantity && Number(item.quantity) !== 1 ? item.quantity + ' × ' : ''}${item.portion ?? ''} ${item.unit || ''}`.trim())

// One meal of the day, collapsed to its name and energy. Tapping it lists what is in it; its +
// opens the food picker right under it, logging to this meal on the shown date.
export default function MealRow({ date, slot, name, items }) {
  const { energy } = useUnits()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const listId = useId()
  const kcal = totalsOf(items).calories
  return <div className={'meal-row' + (open || adding ? ' expanded' : '')}>
    <div className="meal-head">
      <button type="button" className="meal-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-controls={listId} disabled={!items.length}>
        <span className="meal-name">{name}</span>
        <span className="meal-sub small muted">{items.length ? tn('{0} item', '{0} items', items.length) : t('Nothing yet')}</span>
        <span className="meal-kcal small">{items.length ? energy(kcal) : ''}</span>
        {items.length > 0 && <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />}
      </button>
      <button type="button" className={'iconbtn meal-add' + (adding ? ' on' : '')} onClick={() => setAdding(a => !a)}
        aria-expanded={adding} aria-label={adding ? t('Stop adding to {0}', name) : t('Add to {0}', name)}>
        <Icon name={adding ? 'xmark' : 'plus'} />
      </button>
    </div>
    {open && items.length > 0 && <ul className="meal-items" id={listId}>
      {items.map(item => <li key={item.uuid || item.addedAt} className="meal-item">
        <span className="grow"><span className="tt">{item.name}</span><span className="ss small muted">{amountOf(item)}</span></span>
        <span className="small">{energy(nutritionOf(item).calories || 0)}</span>
      </li>)}
    </ul>}
    {adding && <div className="meal-picker">
      <FoodPicker date={date} meal={slot} mealName={name} autoFocus onLogged={() => { setAdding(false); setOpen(true) }} />
    </div>}
  </div>
}
