import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { todayISO, yesterdayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { againAttempt, againEntries, againItems, againKcal, againLogged } from '../lib/nutrition/again.js'
import { energyOf, mealItems } from '../lib/nutrition/diary.js'
import { foodErrorText } from '../lib/nutrition/foods.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Tag } from './blocks.jsx'
import { Button, Row, Section } from './ui.jsx'

const toast = (m, opts) => useUI.getState().toast(m, opts)

// "Yesterday's lunch [Log again]": the same meal logged to today, in one tap, when yesterday's
// meal is there and every entry in it can be logged again (lib/nutrition/again.js). The entries
// go in one write with uuids that come from the copy itself, so a second tap or a retry is the
// same entries, and "Logged" is read off today's diary, not remembered here. `whileEmpty` (Home's
// live row): only while today's meal is still empty; once it has anything the row goes, the
// toast's Undo still there.
export default function YesterdayMealRow({ settings, meal, whileEmpty = false }) {
  const today = todayISO()
  const yesterday = yesterdayISO()
  const entry = useNutrition(s => s.days[yesterday]?.entry)
  const target = useNutrition(s => s.days[today])
  const [busy, setBusy] = useState(false)

  useEffect(() => { useNutrition.getState().loadDay(yesterday) }, [yesterday])

  const items = againItems(entry, meal)
  if (!items) return null
  if (whileEmpty && (target?.status !== 'ready' || mealItems(target.entry, meal).length)) return null
  const names = mealLabels(settings)
  const label = names[meal] ?? names[0]
  const kcal = energyOf(againKcal(items), settings)
  const copy = { from: yesterday, to: today, target: target?.entry }
  // Which attempt is free depends on today's tombstones: nothing is sent before today is read.
  const ready = target?.status === 'ready'
  const attempt = againAttempt(items, copy)
  const done = ready && againLogged(items, copy, attempt)

  async function again() {
    if (busy || !ready) return
    setBusy(true)
    const n = useNutrition.getState()
    try {
      const logged = await n.logItems(today, againEntries(items, meal, { from: yesterday, to: today, attempt, n }))
      toast(t('Logged to {0}', label), {
        action: t('Undo'),
        onAction: () => { useNutrition.getState().removeItems(today, logged.map(i => i.uuid)).catch(e => toast(foodErrorText(e, { write: true }))) },
      })
    } catch (e) {
      toast(foodErrorText(e, { write: true }))
    } finally {
      setBusy(false)
    }
  }

  return <Section>
    <Row icon="history" iconTint="var(--indigo)" title={t('Yesterday’s {0}', label)} subtitle={`${items.map(i => i.name).join(', ')} · ${kcal.value} ${kcal.unit}`}>
      {done
        ? <Tag tone="acc">{t('Logged')}</Tag>
        : <Button size="sm" variant="tinted" onClick={again} disabled={busy || !ready}>{t('Log again')}</Button>}
    </Row>
  </Section>
}
