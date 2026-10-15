import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { energyOf, foodKcal } from '../lib/nutrition/diary.js'
import { SORTS, categoriesOf, fmtAmount, foodErrorText, per100Unit, searchErrorText, visibleFoods } from '../lib/nutrition/foods.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { MIN_QUERY, useOnlineSearch } from '../lib/nutrition/use-online-search.js'
import Icon from '../components/Icon.jsx'
import { Card, Chip, ChipRow, EmptyState, ItemRow, Tag } from '../components/blocks.jsx'
import { Page, Stack } from '../components/layout.jsx'
import { foodDetailSheet } from '../components/FoodDetailSheet.jsx'
import { foodEditSheet } from '../components/FoodEditSheet.jsx'
import { Button, SearchField, Segmented } from '../components/ui.jsx'

const toast = m => useUI.getState().toast(m)

// Nutrition › Foods: your own foods (search, category, sort), and Open Food Facts for the ones
// you do not have yet. NutriTrace's Foods page without its Meals and Recipes tabs, which are
// their own pages here.
export default function Foods() {
  const user = useStore(s => s.user)
  const on = nutritionAvailable(user)
  const foods = useNutrition(s => s.foods)
  const settings = useNutrition(s => s.settings.data)
  const [mode, setMode] = useState('mine')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('alpha')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(() => new Set())
  const [saved, setSaved] = useState(() => new Set())
  const online = useOnlineSearch(q, { active: on && mode === 'online', lang: settings?.offSearchLanguage || 'en' })

  useEffect(() => {
    if (!on) return
    const n = useNutrition.getState()
    n.loadSettings()
    n.loadFoods({ force: true })
  }, [on])

  if (!on) {
    return <Page title={t('Foods')}>
      <Card>
        <EmptyState icon="apple" title={t('Foods live in the web app')}>{t('Sign in on the web app to keep your foods here.')}</EmptyState>
      </Card>
    </Page>
  }

  const categories = categoriesOf(foods.list)
  // A category nobody uses any more (its last food was deleted or moved) is no filter.
  const activeCategory = categories.includes(category) ? category : ''
  const list = visibleFoods(foods.list, { query: q, category: activeCategory, sort })
  const open = food => foodDetailSheet({ food, settings, onEdit: f => foodEditSheet({ food: f, settings }) })
  const saveResult = async food => {
    await useNutrition.getState().saveFood(food)
    toast(t('Saved to your foods'))
  }
  const owned = result => !!result.barcode && foods.list.some(f => f.barcode === result.barcode)
  const kcalTag = food => {
    const kcal = energyOf(foodKcal(food), settings)
    return <Tag>{kcal.value} {kcal.unit}</Tag>
  }

  const row = food => <ItemRow key={food.id} onClick={() => open(food)} chevron
    title={<>{food.favorite && <Icon name="starFill" className="fav-star" />}{food.name}</>}
    subtitle={[food.brand, `${fmtAmount(food.portion ?? 100)} ${food.unit || 'g'}`].filter(Boolean).join(' · ')}
    trailing={kcalTag(food)} />

  // A result row holds its own Save, so the row is no button itself: its text opens the result.
  // A Save in flight holds its button, so a second tap does not send a second create.
  const saveRow = async (result, key) => {
    setSaving(s => new Set(s).add(key))
    try {
      await saveResult(result)
      setSaved(s => new Set(s).add(key))
    } catch (e) {
      toast(foodErrorText(e, { write: true }))
    } finally {
      setSaving(s => { const next = new Set(s); next.delete(key); return next })
    }
  }
  const resultRow = (result, i) => {
    const key = result.barcode || result.client_key || String(i)
    const have = saved.has(key) || owned(result)
    return <ItemRow key={key}
      onOpen={() => foodDetailSheet({ food: result, settings, onSave: have ? undefined : saveResult })}
      title={result.name}
      subtitle={[result.brand, t('per 100 {0}', per100Unit(result) || 'g')].filter(Boolean).join(' · ')}
      trailing={<>
        {kcalTag(result)}
        {have
          ? <Tag tone="acc">{t('Saved')}</Tag>
          : <Button size="sm" variant="tinted" disabled={saving.has(key)} aria-busy={saving.has(key)} onClick={() => saveRow(result, key)}>{t('Save')}</Button>}
      </>} />
  }

  let body
  if (mode === 'online') {
    if (q.trim().length < MIN_QUERY) body = <EmptyState icon="globe">{t('Type a food to search Open Food Facts.')}</EmptyState>
    else if (online.status === 'error') body = <EmptyState><div role="alert">{searchErrorText(online.error)}</div></EmptyState>
    else if (online.status !== 'ready') body = <EmptyState><div role="status">{t('Searching…')}</div></EmptyState>
    else if (!online.results.length) body = <EmptyState icon="magnifier">{t('No results online.')}</EmptyState>
    else body = <div className="list">{online.results.map(resultRow)}</div>
  } else if (foods.status === 'error' && !foods.list.length) {
    body = <EmptyState>
      <div role="alert">{foodErrorText(foods.error)}</div>
      <Button size="sm" variant="tinted" onClick={() => useNutrition.getState().loadFoods({ force: true })}>{t('Try again')}</Button>
    </EmptyState>
  } else if (foods.status !== 'ready' && !foods.list.length) {
    body = <EmptyState><div role="status">{t('Loading…')}</div></EmptyState>
  } else if (!foods.list.length) {
    body = <EmptyState icon="apple" title={t('No foods yet')}>
      <div>{t('Create a food, or search online and save one.')}</div>
      <Button size="sm" variant="tinted" icon="plus" onClick={() => foodEditSheet({ settings })}>{t('New food')}</Button>
    </EmptyState>
  } else if (!list.length) {
    body = <EmptyState icon="magnifier">
      {t('No match')}
      {q.trim().length >= MIN_QUERY && <Button size="sm" variant="tinted" onClick={() => setMode('online')}>{t('Search online')}</Button>}
    </EmptyState>
  } else {
    body = <div className="list">{list.map(row)}</div>
  }

  return <Page title={t('Foods')} sub={mode === 'mine' && foods.status === 'ready' ? tn('{0} food', '{0} foods', foods.list.length) : undefined}
    action={<Button size="sm" variant="tinted" icon="plus" onClick={() => foodEditSheet({ settings })}>{t('New')}</Button>}>
    <Stack gap={5} className="mb-6">
      <Segmented value={mode} onChange={setMode} options={[{ value: 'mine', label: t('My foods') }, { value: 'online', label: t('Online') }]} />
      <SearchField value={q} placeholder={mode === 'online' ? t('Search Open Food Facts') : t('Search your foods')} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} />
      {mode === 'mine' && foods.list.length > 1 && <Segmented value={sort} onChange={setSort}
        options={SORTS.map(s => ({ value: s, label: s === 'alpha' ? t('A to Z') : s === 'recent' ? t('Recent') : t('Most used') }))} />}
      {mode === 'mine' && categories.length > 0 && <ChipRow>
        <Chip nocap on={!activeCategory} onClick={() => setCategory('')}>{t('All')}</Chip>
        {categories.map(c => <Chip key={c} nocap on={activeCategory === c} onClick={() => setCategory(c)}>{c}</Chip>)}
      </ChipRow>}
    </Stack>
    {body}
  </Page>
}
