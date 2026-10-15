import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { setFastingEnabled } from '../lib/nutrition/use-fasting.js'
import { featuresFor, pageTrail, PAGES } from '../views/settings-pages.js'
import { Button, Row, Section, Switch } from './ui.jsx'

// Profile › Features (ia-proposal §5, §9 q12): every switch that starts off, whether it is on, and
// the page it is on. A tap opens that page with the switch flashed (or, for a reminder that waits
// on push, the push switch), so each one is set in one place only. A switch only its page can read
// (web push, Health Connect) shows no value here. Fasting has no other page of settings, so its
// switch is here: on, the + sheet gets its Fast row. It waits for NutriTrace's settings; settings
// that did not load say so, with a way to ask again.
export default function FeaturesList({ S, ctx }) {
  const nav = useNavigate()
  const settingsStatus = useNutrition(s => s.settings.status)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState(null)
  const rows = featuresFor(ctx)
  const valueOf = e => {
    const on = e.feature(S, ctx)
    return on == null ? null : on ? t('On') : t('Off')
  }
  const fasting = async on => {
    setSwitching(true)
    setError(null)
    try { await setFastingEnabled(on) } catch (e) { setError(writeErrorText(e)) }
    setSwitching(false)
  }
  const unread = ctx.nutrition && !ctx.ntSettings && settingsStatus === 'error'
  return <>
    {ctx.nutrition && <Section title={t('Nutrition')} footer={error || undefined}>
      <Row icon="timer" iconTint="var(--indigo)" title={t('Fasting')}
        subtitle={unread ? t('Your settings did not load.') : t('Adds Fast to the + sheet, and a timer and history under Nutrition › Fasting.')}>
        {unread
          ? <Button size="sm" onClick={() => useNutrition.getState().loadSettings({ force: true })}>{t('Try again')}</Button>
          : <Switch aria-label={t('Fasting')} checked={!!ctx.fastingOn} disabled={switching || !ctx.ntSettings} onChange={fasting} />}
      </Row>
    </Section>}
    <Section title={t('Off until you turn them on')} footer={t('Tap one to go to its switch.')}>
      {rows.map(e => (
        <Row key={e.page + ':' + e.title} icon={PAGES[e.page].icon} iconTint={PAGES[e.page].tint} title={t(e.title)}
          subtitle={pageTrail(e.page)} value={valueOf(e)} accessory="chevron"
          onClick={() => nav('/me/' + e.page, { state: e.via ? { find: e.title, via: e.via } : { find: e.title } })} />
      ))}
    </Section>
  </>
}
