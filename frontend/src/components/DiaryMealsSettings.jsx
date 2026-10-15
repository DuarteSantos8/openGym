import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DEFAULT_GOAL_HOURS, PLANS } from '../lib/nutrition/fasting.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Button, Row, Section, SelectRow, Switch } from './ui.jsx'
import { EmptyState } from './blocks.jsx'

// Profile › Diary & meals (ia-proposal §5, NutriTrace's Diary section): the settings of it the
// hub lets Gains write. The activity section under the meals (`diaryShowActivity`), and the plan
// the + sheet's Fast row starts (`fastingDefaultHours`, also written when a fast is started with
// another plan). Saved one key at a time; a refused save keeps the old value and says so.
export default function DiaryMealsSettings() {
  const settings = useNutrition(s => s.settings)
  const [busy, setBusy] = useState(null)
  useEffect(() => { useNutrition.getState().loadSettings() }, [])

  const data = settings.data
  if (!data) {
    if (settings.status === 'error') {
      return <EmptyState className="small">
        <div role="alert">{t('Your settings did not load.')}</div>
        <Button size="sm" onClick={() => useNutrition.getState().loadSettings({ force: true })}>{t('Try again')}</Button>
      </EmptyState>
    }
    return <EmptyState className="small">{t('Loading…')}</EmptyState>
  }

  const save = async (key, value) => {
    setBusy(key)
    try { await useNutrition.getState().saveSetting(key, value) }
    catch (e) { useUI.getState().toast(writeErrorText(e)) }
    setBusy(null)
  }
  const hours = Number(data.fastingDefaultHours) || DEFAULT_GOAL_HOURS
  return <>
    <Section title={t('Diary')} footer={t('Off also stops workouts counting toward your calorie target.')}>
      <Row icon="flame" iconTint="var(--orange)" title={t('Show activity under meals')}
        subtitle={t('Workouts and other activity, with the calories they burned, on Home.')}>
        <Switch aria-label={t('Show activity under meals')} checked={data.diaryShowActivity === true} disabled={busy === 'diaryShowActivity'}
          onChange={v => save('diaryShowActivity', v)} />
      </Row>
    </Section>
    {data.fastingEnabled === true && <Section title={t('Fasting')}>
      <SelectRow icon="timer" iconTint="var(--indigo)" title={t('Default fasting plan')} value={hours}
        onChange={v => save('fastingDefaultHours', v)}
        options={PLANS.map(p => ({ value: p.hours, label: p.label, subtitle: t('{0} h fast', p.hours) }))} />
    </Section>}
  </>
}
