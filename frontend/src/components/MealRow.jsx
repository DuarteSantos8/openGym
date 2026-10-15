import { useId, useState } from 'react'
import { t, tn } from '../lib/i18n.js'
import { totalsOf } from '../lib/nutrition/diary.js'
import { mealRows } from '../lib/nutrition/meal-rows.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { diaryItemSheet } from './DiaryItemSheet.jsx'
import FoodPicker from './FoodPicker.jsx'
import Icon from './Icon.jsx'
import MacroLine from './MacroLine.jsx'

// One meal of the day, collapsed to its name and energy. Tapping it lists what is in it; its +
// opens the food picker right under it, logging to this meal on the shown date. What the list and
// the meal show follows Profile › Diary & meals (brand names, time logged, quick calories, macro
// summary).
export default function MealRow({ date, slot, name, items }) {
  const { energy } = useUnits()
  const settings = useNutrition(s => s.settings.data)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const listId = useId()
  const totals = totalsOf(items)
  const rows = mealRows(items, {
    summed: settingOf(settings, 'quickCaloriesDisplay') !== 'separate',
    brands: settingOf(settings, 'diaryShowBrands'),
    times: settingOf(settings, 'diaryShowTimestamps'),
    timeFormat: settings?.timeFormat,
  })
  return <div className={'meal-row' + (open || adding ? ' expanded' : '')}>
    <div className="meal-head">
      <button type="button" className="meal-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-controls={listId} disabled={!items.length}>
        <span className="meal-name">{name}</span>
        <span className="meal-sub small muted">{items.length ? tn('{0} item', '{0} items', items.length) : t('Nothing yet')}</span>
        <span className="meal-kcal small">{items.length ? energy(totals.calories) : ''}</span>
        {items.length > 0 && <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />}
      </button>
      <button type="button" className={'iconbtn meal-add' + (adding ? ' on' : '')} onClick={() => setAdding(a => !a)}
        aria-expanded={adding} aria-label={adding ? t('Stop adding to {0}', name) : t('Add to {0}', name)}>
        <Icon name={adding ? 'xmark' : 'plus'} />
      </button>
    </div>
    {items.length > 0 && settingOf(settings, 'diaryShowMacroSummary') && <MacroLine p={totals.proteins} c={totals.carbohydrates} f={totals.fat} />}
    {open && items.length > 0 && <ul className="meal-items" id={listId}>
      {rows.map(row => {
        const text = <>
          <span className="grow"><span className="tt">{row.name}</span><span className="ss small muted">{row.sub}</span></span>
          <span className="small">{energy(row.kcal)}</span>
        </>
        return <li key={row.key}>
          {row.item
            ? <button type="button" className="meal-item" onClick={() => diaryItemSheet({ date, item: row.item })}
              aria-label={t('Edit {0}, {1}, {2}', row.name, row.sub, energy(row.kcal))}>{text}</button>
            : <div className="meal-item">{text}</div>}
        </li>
      })}
    </ul>}
    {adding && <div className="meal-picker">
      <FoodPicker date={date} meal={slot} mealName={name} autoFocus onLogged={() => { setAdding(false); setOpen(true) }} />
    </div>}
  </div>
}
