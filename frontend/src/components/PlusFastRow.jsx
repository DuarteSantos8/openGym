import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDur } from '../lib/format.js'
import { closeThenNav } from '../lib/nav.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { DEFAULT_GOAL_HOURS, progressOf, validGoal } from '../lib/nutrition/fasting.js'
import { useFasting, useFastingOn, useNow } from '../lib/nutrition/use-fasting.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { Button, Row } from './ui.jsx'

// The + sheet's Fast row, there only while fasting is switched on (ia-proposal §4). Idle, one tap
// starts a fast of the plan used last; running, it shows the time fasted and opens the Fasting page.
export default function PlusFastRow({ close }) {
  const on = useFastingOn()
  const { status, active } = useFasting()
  const defaultHours = useNutrition(s => s.settings.data?.fastingDefaultHours)
  const [busy, setBusy] = useState(false)
  const now = useNow(!!active)

  useEffect(() => { if (on) useFasting.getState().load() }, [on])

  if (!on || status !== 'ready') return null

  if (active) {
    return <Row icon="timer" iconTint="var(--indigo)" title={t('Fasting')} accessory="chevron" onClick={() => closeThenNav(close, '/food/fasting')}>
      <span className="lrow-v">{fmtDur(progressOf(active, now).elapsedMs)}</span>
    </Row>
  }

  const hours = validGoal(Number(defaultHours)) ? Number(defaultHours) : DEFAULT_GOAL_HOURS
  const start = async () => {
    setBusy(true)
    try {
      const { started } = await useFasting.getState().start(hours)
      close()
      useUI.getState().toast(started ? t('Fast started: {0} h goal', hours) : t('A fast is already running'))
    } catch (e) {
      useUI.getState().toast(writeErrorText(e))
      setBusy(false)
    }
  }
  return <Row icon="timer" iconTint="var(--indigo)" title={t('Fast')}>
    <Button size="sm" variant="tinted" icon="plus" onClick={start} disabled={busy}
      aria-label={t('Start a {0} hour fast', hours)}>{t('{0} h', hours)}</Button>
  </Row>
}
