import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { foodKcal, matchesFood, recentFoods } from '../lib/nutrition/diary.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { portionSheet } from './PortionSheet.jsx'
import { quickKcalSheet } from './QuickKcalSheet.jsx'
import { scanSheet } from './ScanSheet.jsx'
import Icon from './Icon.jsx'
import { SearchField } from './ui.jsx'
import { ItemRow, SectionTitle } from './blocks.jsx'

const OWN_MAX = 20
const ONLINE_DELAY_MS = 450

function FoodRow({ food, onPick, energy }) {
  return <ItemRow className="food-row" onClick={() => onPick(food)} title={food.name}
    subtitle={[food.brand, `${food.portion || 100} ${food.unit || 'g'}`].filter(Boolean).join(' · ')}
    trailing={<span className="food-kcal small">{energy(foodKcal(food))}</span>} />
}

// Choosing what to log, for one date and meal: recents first, then your own foods matching the
// search, then Open Food Facts. Picking one asks how much (PortionSheet). Inline under a meal
// on Home, and inside the Log food sheet. `onLogged` runs once something is logged from it.
export default function FoodPicker({ date, meal, mealName, autoFocus = false, onLogged }) {
  const foods = useNutrition(s => s.foods)
  const lang = useNutrition(s => s.settings.data?.offSearchLanguage)
  const { energy } = useUnits()
  const [query, setQuery] = useState('')
  const [online, setOnline] = useState({ status: 'idle', list: [] })
  const q = query.trim()

  useEffect(() => { useNutrition.getState().loadFoods() }, [])

  // A newer search aborts the one before; its results never replace the newer ones.
  useEffect(() => {
    if (q.length < 2) { setOnline({ status: 'idle', list: [] }); return }
    const ctl = new AbortController()
    setOnline(o => ({ ...o, status: 'loading' }))
    const timer = setTimeout(async () => {
      try {
        const list = await useNutrition.getState().searchOnline(q, typeof lang === 'string' ? lang : 'en', { signal: ctl.signal })
        if (!ctl.signal.aborted) setOnline({ status: 'ready', list })
      } catch (e) {
        if (!ctl.signal.aborted) setOnline({ status: e?.status === 429 ? 'busy' : 'error', list: [] })
      }
    }, ONLINE_DELAY_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [q, lang])

  // The entry a failed write may have saved, for as long as this picker is open: an amount edited
  // and logged again updates it (PortionSheet, QuickKcalSheet).
  const pending = useRef({ uuid: null, food: null }).current
  const quickPending = useRef({ uuid: null }).current
  const pick = food => portionSheet({ food, date, meal, mealName, onLogged, pending })
  const recents = recentFoods(foods.list)
  const own = q ? foods.list.filter(f => matchesFood(f, q)).slice(0, OWN_MAX) : []

  return <div className="food-picker">
    <div className="fp-search">
      <SearchField value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery('')}
        placeholder={t('Search foods')} aria-label={t('Search foods')} autoFocus={autoFocus} enterKeyHint="search" />
      <button type="button" className="iconbtn fp-scan" aria-label={t('Scan a barcode')}
        onClick={() => scanSheet({ date, meal, mealName, onLogged })}><Icon name="scanBarcode" /></button>
    </div>

    {!q && <>
      <SectionTitle>{t('Recent')}</SectionTitle>
      {foods.status === 'loading' && !foods.list.length && <div className="muted small fp-note">{t('Loading…')}</div>}
      {foods.status === 'error' && <div className="nt-error small" role="alert">{t('Your foods did not load.')}</div>}
      {foods.status === 'ready' && !recents.length && <div className="muted small fp-note">{t('Foods you log show up here. Search to find one.')}</div>}
      <div className="list">{recents.map(f => <FoodRow key={f.id} food={f} onPick={pick} energy={energy} />)}</div>
    </>}

    {q && <>
      <SectionTitle>{t('Your foods')}</SectionTitle>
      {own.length ? <div className="list">{own.map(f => <FoodRow key={f.id} food={f} onPick={pick} energy={energy} />)}</div>
        : <div className="muted small fp-note">{t('None of your foods match.')}</div>}
      <SectionTitle>{t('Online')}</SectionTitle>
      {online.status === 'loading' && <div className="muted small fp-note" aria-live="polite">{t('Searching Open Food Facts…')}</div>}
      {online.status === 'error' && <div className="nt-error small" role="alert">{t('Online search failed. Your own foods still work.')}</div>}
      {online.status === 'busy' && <div className="nt-error small" role="alert">{t('Too many online searches. Wait a minute and try again.')}</div>}
      {online.status === 'ready' && !online.list.length && <div className="muted small fp-note">{t('Nothing found online.')}</div>}
      {online.status === 'idle' && <div className="muted small fp-note">{t('Type at least two letters to search online.')}</div>}
      <div className="list">{online.list.map(f => <FoodRow key={f.client_key} food={f} onPick={pick} energy={energy} />)}</div>
    </>}

    <ItemRow className="food-row fp-quick" onClick={() => quickKcalSheet({ date, meal, mealName, onLogged, pending: quickPending })}
      lead={<span className="lrow-i tint-pink"><Icon name="bolt" /></span>}
      title={t('Quick kcal')} subtitle={t('Just a number, no food')} chevron />
  </div>
}
