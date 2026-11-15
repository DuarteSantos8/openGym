// Settings → Workout → Forgotten workouts (lib/forgotten-workout.js), this device only.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { readForgottenPrefs, writeForgottenPrefs, leaveGymOn, ASK_CHOICES, GRACE_CHOICES, gymReminderOn } from '../lib/forgotten-workout.js'
import { Row, Section, SelectRow, Switch } from './ui.jsx'
import { useStore } from '../store/useStore.js'

export const askLabel = m => (m ? t('{0} min', m) : t('Off'))

export default function ForgottenRows({ mobile = true }) {
  const [p, setP] = useState(readForgottenPrefs)
  const set = patch => {
    setP(writeForgottenPrefs(patch))
    // The native gym reminder keeps the switch and the words with its status: told again now.
    import('../lib/gym-reminder.js').then(m => m.pushGymStatus(useStore.getState().S, true)).catch(() => {})
  }
  const gym = gymReminderOn()
  return <Section title={t('Forgotten workouts')}
    footer={t('If nobody answers, it finishes by itself and never throws anything away. The end is your last set plus its rest, so the time stays honest. Reopen it from History for a day. Your watch asks too.')}>
    <SelectRow icon="clock" iconTint="var(--orange)" title={t('Ask “Still training?”')} sheetTitle={t('Ask “Still training?”')}
      value={p.askMin} onChange={v => set({ askMin: v })}
      options={ASK_CHOICES.map(m => ({ value: m, label: askLabel(m), subtitle: m === 0 ? t('Never asks and never ends one by itself.') : m === 45 ? t('The default. Long enough for a chat at the water fountain.') : null }))} />
    {mobile && <Row icon="mapPin" iconTint="var(--green)" title={t('End by itself when I leave the gym')}
      subtitle={gym ? t('Asks the moment your phone walks out of your gym, then wraps up.') : t('Needs the gym reminder: {0}.', [t('Settings'), t('Reminders'), t('Gym reminder')].join(' › '))}>
      <Switch aria-label={t('End by itself when I leave the gym')} checked={leaveGymOn(p, gym)} disabled={!gym}
        onChange={v => set({ leaveGym: v })} />
    </Row>}
    <SelectRow icon="timer" iconTint="var(--yellow)" title={t('Time to answer')} sheetTitle={t('Time to answer')}
      value={p.graceMin} onChange={v => set({ graceMin: v })}
      options={GRACE_CHOICES.map(m => ({ value: m, label: t('{0} min', m) }))} />
  </Section>
}
