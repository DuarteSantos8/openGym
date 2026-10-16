import { useEffect, useState } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtDur } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { hitGoal, lengthOf } from '../lib/nutrition/fasting.js'
import { setFastingEnabled, useFasting } from '../lib/nutrition/use-fasting.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import FastCard from '../components/FastCard.jsx'
import FastInsights from '../components/FastInsights.jsx'
import Icon from '../components/Icon.jsx'
import { Card, EmptyState } from '../components/blocks.jsx'
import { Page, Stack } from '../components/layout.jsx'
import { Button, Row, Section } from '../components/ui.jsx'
import { Loading } from '../components/Loader.jsx'

const HISTORY_SHOWN = 20

function HistoryRow({ fast }) {
  const when = new Date(fast.start_at).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
  const remove = () => confirmSheet({
    title: t('Remove this fast?'),
    message: t('The {0} fast on {1} is deleted from your history.', fmtDur(lengthOf(fast)), when),
    confirmText: t('Remove'),
    danger: true,
    onConfirm: () => useFasting.getState().remove(fast.id).catch(e => useUI.getState().toast(writeErrorText(e))),
  })
  return <Row icon={hitGoal(fast) ? 'checkCircle' : 'timer'} iconTint={hitGoal(fast) ? 'var(--green)' : 'var(--grey)'}
    title={fmtDur(lengthOf(fast))} subtitle={`${when} · ${t('Goal {0} h', fast.goal_hours)}`}>
    <button type="button" className="iconbtn fast-remove" onClick={remove} aria-label={t('Delete fast {0}', when)}><Icon name="trash" /></button>
  </Row>
}

// Fasting (ia-proposal §3, a row of the Nutrition hub): start and end a fast on a plan, the time
// fasted and left, the history and the insights. NutriTrace keeps the fasts; whether the tracker
// is on is its `fastingEnabled` setting.
export default function Fasting() {
  const user = useStore(s => s.user)
  const available = nutritionAvailable(user)
  const settings = useNutrition(s => s.settings)
  const { status, history } = useFasting()
  const on = settings.data?.fastingEnabled === true
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(null)

  useEffect(() => {
    if (!available) return
    useNutrition.getState().loadSettings()
  }, [available])
  // A fast started or ended on another device shows up when the page opens and when the app
  // comes back to the front.
  useEffect(() => {
    if (!available || !on) return undefined
    useFasting.getState().load({ force: true })
    const refresh = () => { if (document.visibilityState === 'visible') useFasting.getState().load({ force: true }) }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [available, on])

  const turn = async next => {
    setSwitching(true)
    setSwitchError(null)
    try {
      await setFastingEnabled(next)
    } catch (e) {
      setSwitchError(writeErrorText(e))
    }
    setSwitching(false)
  }

  let body
  if (!available) {
    body = <Card>
      <EmptyState icon="timer" title={t('Fasting lives in the web app')}>{t('Sign in on the web app to track your fasts.')}</EmptyState>
    </Card>
  } else if (!settings.data && (settings.status === 'loading' || settings.status === 'idle')) {
    body = <Loading className="muted small fp-note" />
  } else if (!settings.data) {
    body = <Card>
      <Stack gap={4}>
        <div className="nt-error small" role="alert">{t('Your settings did not load.')}</div>
        <Button variant="tinted" onClick={() => useNutrition.getState().loadSettings({ force: true })}>{t('Try again')}</Button>
      </Stack>
    </Card>
  } else if (!on) {
    body = <Card>
      <Stack gap={4}>
        <EmptyState icon="timer" title={t('Fasting is off')}>{t('Track intermittent fasting: pick a plan, see the time fasted and left, and keep a history.')}</EmptyState>
        {switchError && <div className="nt-error small" role="alert">{switchError}</div>}
        <Button variant="primary" onClick={() => turn(true)} disabled={switching}>{t('Turn on fasting')}</Button>
      </Stack>
    </Card>
  } else {
    body = <>
      {status === 'error' && <Card>
        <Stack gap={4}>
          <div className="nt-error small" role="alert">{t('Your fasts did not load.')}</div>
          <Button variant="tinted" onClick={() => useFasting.getState().load({ force: true })}>{t('Try again')}</Button>
        </Stack>
      </Card>}
      {status === 'loading' && <Loading className="muted small fp-note" />}
      {status === 'ready' && <>
        <FastCard />
        <FastInsights />
        {history.length > 0 && <Section title={t('History')}>
          {history.slice(0, HISTORY_SHOWN).map(f => <HistoryRow key={f.id} fast={f} />)}
        </Section>}
        <div className="fast-off">
          {switchError && <div className="nt-error small" role="alert">{switchError}</div>}
          <Button variant="ghost" className="dim" onClick={() => turn(false)} disabled={switching}>{t('Turn off fasting')}</Button>
        </div>
      </>}
    </>
  }

  return <Page title={t('Fasting')}>{body}</Page>
}
