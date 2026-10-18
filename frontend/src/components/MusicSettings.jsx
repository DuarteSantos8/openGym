import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { appleMusicDevice, musicSource } from '../lib/music/index.js'
import { connectSpotify, disconnectSpotify, spotifyConnected, redirectUri } from '../lib/music/spotify.js'
import { authorizeAppleMusic } from '../lib/music/apple-music.js'
import { Section, Row, SelectRow, TextField, Button } from './ui.jsx'

// Spotify only takes an https redirect for a web page, or a loopback one (127.0.0.1, ::1).
const httpsOK = () => MOBILE || location.protocol === 'https:' || ['127.0.0.1', '[::1]', 'localhost'].includes(location.hostname)

/**
 * Settings → Workout → Music: which player the workout's music bar steers (components/MusicBar.jsx).
 * The choice is the account's (S.music), like the Spotify app's Client ID it signs in with; the
 * sign-in itself is this device's (lib/music/spotify.js), so each phone or browser connects once.
 */
export default function MusicSettings() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [connected, setConnected] = useState(spotifyConnected)
  const [clientId, setClientId] = useState(S.spotifyClientId || '')
  const source = musicSource(S)
  // Back from Spotify's sign-in in the phone app, with this page still open (App.jsx).
  useEffect(() => {
    const on = () => setConnected(spotifyConnected())
    window.addEventListener('opengym:spotify', on)
    return () => window.removeEventListener('opengym:spotify', on)
  }, [])
  const options = [
    { value: 'off', label: t('Off') },
    { value: 'spotify', label: 'Spotify', subtitle: t('Any device that plays your Spotify account. Controls need Premium.') },
    appleMusicDevice() && { value: 'apple', label: 'Apple Music', subtitle: t('The Music app on this iPhone.') },
  ].filter(Boolean)
  const choose = v => {
    update(s => { if (v === 'off') delete s.music; else s.music = v })
    if (v === 'apple') authorizeAppleMusic().catch(() => {})
  }
  const connect = () => {
    const id = clientId.trim()
    update(s => { s.spotifyClientId = id })
    connectSpotify(id).catch(() => useUI.getState().toast(t('Could not connect to Spotify.')))
  }
  const disconnect = () => { disconnectSpotify(); setConnected(false) }
  const footer = source === 'spotify' && !connected
    ? t('Make an app on developer.spotify.com, add this redirect URI to it and paste its Client ID here: {0}', redirectUri())
    : t('Shows what is playing at the top of a workout, with previous, pause and next.')
  return <Section title={t('Music')} footer={footer}>
    <SelectRow icon="music" iconTint="var(--pink)" title={t('Music player')} value={source || 'off'} options={options} onChange={choose} />
    {source === 'spotify' && (connected
      ? <Row icon="checkCircle" iconTint="var(--green)" title="Spotify" subtitle={t('Connected on this device')}>
          <Button size="sm" onClick={disconnect}>{t('Disconnect')}</Button>
        </Row>
      : <>
          <Row icon="link" iconTint="var(--green)" title={t('Spotify Client ID')}
            subtitle={httpsOK() ? null : t('Spotify needs this page on https to sign in.')}>
            <TextField value={clientId} onChange={e => setClientId(e.target.value)} placeholder="0123abcd…"
              aria-label={t('Spotify Client ID')} autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ maxWidth: 180 }} />
          </Row>
          <Row icon="music" iconTint="var(--green)" title={t('Connect Spotify')}>
            <Button size="sm" variant="primary" disabled={!/^[0-9a-zA-Z]{16,64}$/.test(clientId.trim()) || !httpsOK()} onClick={connect}>{t('Connect')}</Button>
          </Row>
        </>)}
  </Section>
}
