import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { foodKcal } from '../lib/nutrition/diary.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { OWN_SHOWN, useFoodSearch } from '../lib/nutrition/use-food-search.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { ItemRow, SectionTitle } from './blocks.jsx'
import { foodEditSheet } from './FoodEditSheet.jsx'
import Icon from './Icon.jsx'
import OnlineStatus from './OnlineStatus.jsx'
import SavedMealsGroup from './SavedMealsGroup.jsx'
import { scanSheet } from './ScanSheet.jsx'
import { Button, SearchField } from './ui.jsx'
import { Loading } from './Loader.jsx'

function FoodRow({ food, onPick, energy, disabled }) {
  return <ItemRow className="food-row" onClick={disabled ? undefined : () => onPick(food)} aria-disabled={disabled || undefined} title={food.name}
    subtitle={[food.brand, `${food.portion || 100} ${food.unit || 'g'}`].filter(Boolean).join(' · ')}
    trailing={<span className="food-kcal small">{energy(foodKcal(food))}</span>} />
}

// The one place a food is picked: search, scan or create, in groups. Recents, then your own
// foods, then Open Food Facts (labelled, Romanian products first). `onPick(food)` gets the food
// tapped; it has no `id` when it came from Open Food Facts or a barcode, so a place that needs a
// saved food saves it first (`disabled` holds the rows while it does). `scan` is what the barcode
// sheet needs besides the pick (a diary target to log to); pass `{ onPick }` to have the scanned
// food handed over instead of logged. A food made from "Create food" is picked once saved.
// `savedMeals` ({ date, meal, mealName, onLogged }) adds the Saved meals group, whose rows log a
// saved meal or recipe to that date and meal in one tap; leave it out where only a food fits (a
// recipe's ingredients). `children` follow the groups.
export default function FoodSearch({ onPick, scan = {}, savedMeals, autoFocus = false, disabled = false, children }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(OWN_SHOWN)
  const { query: q, recents, own, ownTotal, online, foods } = useFoodSearch(query, { limit })
  const settings = useNutrition(s => s.settings.data)
  const { energy } = useUnits()
  const rows = list => <div className="list">{list.map(f => <FoodRow key={f.id ?? f.client_key} food={f} onPick={onPick} energy={energy} disabled={disabled} />)}</div>
  const failed = foods.status === 'error' && !foods.list.length

  // One node that stays in the page, so a screen reader hears what changed in it.
  const total = ownTotal + online.results.length
  const announcement = online.status !== 'ready' ? '' : total ? t('Results: {0}', total) : t('No results')

  return <div className="food-picker">
    <div className="fp-search">
      <SearchField value={query} onChange={e => { setQuery(e.target.value); setLimit(OWN_SHOWN) }} onClear={() => setQuery('')}
        placeholder={t('Search foods')} aria-label={t('Search foods')} autoFocus={autoFocus} enterKeyHint="search"
        onKeyDown={e => { if (e.key === 'Enter' && online.status === 'tap') online.ask() }} />
      <Button size="sm" variant="tinted" icon="scanBarcode" className="fp-scan" aria-label={t('Scan a barcode')}
        onClick={() => scanSheet(scan)} />
    </div>
    <div className="muted small fp-note fp-live" role="status" aria-live="polite">{announcement}</div>

    <ItemRow className="food-row fp-create" onClick={() => foodEditSheet({ food: { name: q }, settings, onSaved: onPick })}
      lead={<span className="lrow-i tint-blue"><Icon name="plus" /></span>}
      title={t('Create food')} subtitle={q || undefined} chevron />

    {failed && <>
      <div className="nt-error small" role="alert">{t('Your foods did not load.')}</div>
      <Button size="sm" variant="tinted" onClick={() => useNutrition.getState().loadFoods({ force: true })}>{t('Try again')}</Button>
    </>}

    {!q && <>
      <SectionTitle>{t('Recent')}</SectionTitle>
      {foods.status === 'loading' && !foods.list.length && <Loading className="muted small fp-note" />}
      {foods.status === 'ready' && !recents.length && <div className="muted small fp-note">{t('Foods you log show up here. Search to find one.')}</div>}
      {rows(recents)}
    </>}

    {savedMeals && <SavedMealsGroup query={q} {...savedMeals} />}

    {(q || own.length > 0) && <>
      <SectionTitle>{t('Your foods')}</SectionTitle>
      {own.length ? rows(own) : <div className="muted small fp-note">{t('None of your foods match.')}</div>}
      {ownTotal > own.length && <Button size="sm" variant="tinted" onClick={() => setLimit(n => n + OWN_SHOWN)}>{t('Show more')}</Button>}
    </>}

    {q && settingOf(settings, 'offEnabled') && <>
      <SectionTitle>{t('Open Food Facts')}</SectionTitle>
      <OnlineStatus online={online} query={q} />
      {online.status === 'ready' && !online.results.length && <div className="muted small fp-note">{t('Nothing found online.')}</div>}
      {online.status === 'idle' && <div className="muted small fp-note">{t('Type at least two letters to search online.')}</div>}
      {rows(online.results)}
    </>}

    {children}
  </div>
}
