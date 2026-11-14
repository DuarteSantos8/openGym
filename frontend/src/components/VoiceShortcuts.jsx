// Settings → Siri & Shortcuts (iPhone) / Assistant & shortcuts (Android), v1.4.4: what to say, or
// where to touch and hold. Nothing to switch on: iOS and Android offer them once the app is
// installed (ios/App/App/VoiceIntents.swift, android res/xml/shortcuts.xml, lib/voice.js).
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { platformNow } from '../lib/platform-now.js'
import { Button, Section, Row } from './ui.jsx'

const ui = () => useUI.getState()

export const voiceRowTitle = () => (platformNow() === 'android' ? t('Assistant & shortcuts') : t('Siri & Shortcuts'))

function VoiceShortcuts({ close }) {
  const android = platformNow() === 'android'
  return <>
    <h3>{voiceRowTitle()}</h3>
    {android
      ? <>
        <div className="small muted" style={{ marginBottom: 10 }}>{t('Touch and hold the openGym icon. You can also drag a shortcut onto your home screen.')}</div>
        <Section>
          <Row icon="play" iconTint="var(--green)" title={t('Start workout')} subtitle={t('Starts what’s planned for today, or opens the one already running.')} />
          <Row icon="scale" iconTint="var(--green)" title={t('Log body weight')} />
          <Row icon="chart" iconTint="var(--blue)" title={t('Stats')} />
        </Section>
        <div className="small dim" style={{ marginBottom: 12 }}>{t('Google Assistant can open them by voice too.')}</div>
      </>
      : <>
        <div className="small muted" style={{ marginBottom: 10 }}>{t('Ask Siri:')}</div>
        <Section>
          <Row icon="play" iconTint="var(--green)" title={t('“Start my workout in openGym”')} subtitle={t('Starts what’s planned for today, or opens the one already running.')} />
          <Row icon="scale" iconTint="var(--green)" title={t('“Log my weight in openGym”')} subtitle={t('Siri asks for the number and logs it without opening the app.')} />
          <Row icon="calendar" iconTint="var(--blue)" title={t('“What’s my workout today in openGym”')} />
          <Row icon="flame" iconTint="var(--orange)" title={t('“How’s my streak in openGym”')} />
        </Section>
        <div className="small dim" style={{ marginBottom: 12 }}>{t('They are in the Shortcuts app and in Spotlight too, ready for an automation or the Action button.')}</div>
      </>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const voiceShortcutsSheet = () => ui().openSheet(close => <VoiceShortcuts close={close} />)
