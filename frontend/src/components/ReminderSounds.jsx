// Settings → Reminders → Sounds (Android app, v1.4.5): which sound each kind of reminder rings
// with (lib/reminder-sounds.js). The phone's default, silence, one of the phone's own sounds from
// the system picker, the timer's built-in tones or a sound of one's own. Tap one to hear it.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { unlock, chime } from '../lib/sound.js'
import { soundsOf } from '../lib/user-sounds.js'
import { REST_SOUND_IDS } from '../lib/rest-sounds.js'
import { reminderSoundOf, setReminderSound, reminderSoundsBuilt, pickPhoneSound, previewPhoneSound } from '../lib/reminder-sounds.js'
import { Section, Row, Button } from './ui.jsx'

// The same English keys as Settings → Timer alerts → Sound, so they are translated already.
const TONE_LABEL = { chime: 'Chime (louder)', classic: 'Classic beeps', bell: 'Bell', beep: 'Beep-beep', whistle: 'Whistle', soft: 'Soft' }
const KIND_COPY = {
  workout: () => [t('Workout reminders'), t('Workout days and the nudge when one slips by.')],
  checkin: () => [t('Check-in reminders'), t('Weigh-ins, measurements and progress photos.')],
  gym: () => [t('Gym reminder'), t('When you walk into your gym.')],
}

/** The name of a choice, as the row shows it. */
export function choiceName(S, c) {
  if (!c) return t('Phone default')
  if (c.tone === 'none') return t('Silent')
  if (c.tone === 'sys') return c.name || t('Phone sound')
  if (c.tone.startsWith('u:')) return soundsOf(S).find(e => 'u:' + e.id === c.tone)?.name || t('Sound')
  return t(TONE_LABEL[c.tone] || 'Chime (louder)')
}

/** Plays a choice the way the reminder will. */
function hear(S, c) {
  if (!c || c.tone === 'sys') { previewPhoneSound(c?.uri || null); return }
  if (c.tone === 'none') return
  unlock(true)
  const own = c.tone.startsWith('u:') ? soundsOf(S).find(e => 'u:' + e.id === c.tone) : null
  chime(true, own ? 'u:' + own.m.hash : c.tone)
}

export function ReminderSoundSheet({ kind, close }) {
  const S = useStore(s => s.S)
  const cur = reminderSoundOf(S, kind)
  const set = c => { useStore.getState().update(s => { setReminderSound(s, kind, c) }); hear(useStore.getState().S, c) }
  const is = tone => (cur ? cur.tone === tone : tone === null)
  const phone = async () => {
    const p = await pickPhoneSound(cur?.tone === 'sys' ? cur.uri : null)
    if (p) set({ tone: 'sys', uri: p.uri, name: p.name })
  }
  const row = (key, title, tone, onClick, subtitle) => <Row key={key} icon={is(tone) ? 'speaker' : 'play'} iconTint="var(--red)" title={title}
    subtitle={subtitle} accessory={is(tone) ? 'check' : 'none'} onClick={onClick} />
  const own = soundsOf(S)
  return <>
    <h3>{KIND_COPY[kind]()[0]}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Tap one to hear it. It rings even with the app closed.')}</div>
    <Section>
      {row('default', t('Phone default'), null, () => set(null), t('Whatever your phone uses for notifications.'))}
      {row('sys', t('Pick a phone sound…'), 'sys', phone, cur?.tone === 'sys' ? cur.name || null : t('Any of the sounds on your phone.'))}
      {row('none', t('Silent'), 'none', () => set({ tone: 'none' }), t('Shows up, keeps quiet.'))}
    </Section>
    <Section title={t('openGym sounds')}>
      {REST_SOUND_IDS.map(id => row(id, t(TONE_LABEL[id] || id), id, () => set({ tone: id })))}
    </Section>
    {own.length > 0 && <Section title={t('Your own sounds')}>
      {own.map(e => row('u' + e.id, e.name, 'u:' + e.id, () => set({ tone: 'u:' + e.id })))}
    </Section>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
const soundSheet = kind => useUI.getState().openSheet(close => <ReminderSoundSheet kind={kind} close={close} />)

/** The section on the Reminders page; only where the phone can do it (the Android app). */
export default function ReminderSounds({ gym = true, built = null }) {
  const S = useStore(s => s.S)
  const [ok, setOk] = useState(built)
  useEffect(() => { if (built == null) reminderSoundsBuilt().then(setOk, () => setOk(false)) }, [built])
  if (!ok) return null
  const kinds = ['workout', 'checkin', ...(gym ? ['gym'] : [])]
  return <Section title={t('Sounds')} footer={t('Each reminder can sound different, so you know which one it is before you look.')}>
    {kinds.map(k => <Row key={k} icon="bell" iconTint="var(--red)" title={KIND_COPY[k]()[0]} subtitle={KIND_COPY[k]()[1]}
      value={choiceName(S, reminderSoundOf(S, k))} accessory="chevron" onClick={() => soundSheet(k)} />)}
  </Section>
}
