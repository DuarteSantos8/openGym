// The question the Coach asks once per AI provider, right before your training would first go
// there (lib/coach-api.js ensureAiConsent), and the list in the Coach settings that takes it back.
//
// The lines below say what the payload actually carries (api/coach/core/payload.js build): one
// per DATA_CATEGORIES entry, plus what you type, which rides along as the review note or the
// refine text. Short on purpose; the intake's consent screen has the long version.
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'
import { aiConsents, withdrawAi, onAiConsentChange } from '../lib/coach-consent.js'
import { emptyCoach } from '../lib/coach.js'
import Icon from './Icon.jsx'
import { Button, Section, Row } from './ui.jsx'
import '../coach.css'

// Literal t() calls, so check-source-strings sees every line.
const LINES = {
  plan: () => t('Your plan: routines, exercises, sets, reps and schedule'),
  training: () => t('Your workouts: weights, reps, times, effort and session notes'),
  bodyweight: () => t('Your body weight and goal weight'),
  profile: () => t('Your answers to the Coach: goal, days, equipment, limits and injuries'),
  prefs: () => t('Your unit and language')
}
export const sharedLines = () => [...DATA_CATEGORIES.map(k => LINES[k]?.()).filter(Boolean), t('Anything you type to the Coach')]

/** Resolves true for "Allow", false for "Not now" and for a sheet closed any other way. */
export function askAiConsent(target) {
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; unsub && unsub(); resolve(v) } }
    const ui = useUI.getState()
    const { id, close } = ui.openSheet(() => <ConsentSheet target={target} onAnswer={v => { finish(v); close() }} />)
    // Swiped away or closed from outside: that is a "not now", and the request must not hang.
    const unsub = useUI.subscribe?.(s => { if (!s.sheets.some(x => x.id === id)) finish(false) })
  })
}

function ConsentSheet({ target, onAnswer }) {
  const server = target.via === 'server'
  return <div className="ai-consent">
    <div className="ob-eyebrow">{t('Your data, your call')}</div>
    <h3>{t('Send your training to {0}?', target.name)}</h3>
    <p className="muted" style={{ lineHeight: 1.5, margin: '6px 0 12px' }}>
      {server
        ? t('To answer, the Coach sends this through your openGym server to {0}, an AI service outside openGym that your server’s admin picked:', target.name)
        : t('To answer, this device sends this straight to {0}, an AI service outside openGym, with your API key:', target.name)}
    </p>
    <div className="ob-consent">
      {sharedLines().map(line => <div key={line} className="ob-consent-row"><Icon name="check" /><div><span>{line}</span></div></div>)}
    </div>
    <div className="ob-fine">
      <div>{t('Your name, email and sign-in stay put. {0} handles the rest under its own privacy terms.', target.name)}</div>
      <div>{t('Change your mind anytime under AI data sharing in the Coach menu.')}</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button variant="primary" onClick={() => onAnswer(true)}>{t('Allow')}</Button>
      <Button onClick={() => onAnswer(false)}>{t('Not now')}</Button>
    </div>
  </div>
}

/** The allowed providers on this device, each with a way to take it back. */
export function AiConsentSection() {
  const [list, setList] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => {
    const load = () => aiConsents().then(setList).catch(() => setList([]))
    load()
    return onAiConsentChange(load)
  }, [])
  const withdraw = async c => {
    await withdrawAi(c.key)
    // Automatic reviews run on the server with nobody there to ask, so a "no" to the server's
    // provider switches them off too; turning them back on asks again (CoachChat CadenceSheet).
    const { S, update } = useStore.getState()
    const cadence = S?.coach?.cadence
    if (c.via === 'server' && cadence && cadence !== 'off') update(s => { (s.coach = s.coach || emptyCoach()).cadence = 'off' })
    toast(t('Withdrawn. The Coach will ask before it sends anything again.'))
  }
  if (!list) return null
  return <Section title={t('AI data sharing')}
    footer={t('Who the Coach may send your training to from this device. Withdraw it and the Coach asks again next time. A model on your own network never needs asking.')}>
    {!list.length && <Row icon="lock" iconTint="var(--green)" title={t('Nothing allowed yet')} subtitle={t('The Coach asks before anything leaves.')} />}
    {list.map(c => <Row key={c.key} icon="shield" iconTint="var(--acc)" title={c.name}
      subtitle={(c.via === 'server' ? t('Through your server') : t('With your API key')) + ' · ' + t('Allowed {0}', fmtDate(isoOf(new Date(c.at)), false, true))}>
      <Button size="sm" onClick={() => withdraw(c)}>{t('Withdraw')}</Button>
    </Row>)}
  </Section>
}
