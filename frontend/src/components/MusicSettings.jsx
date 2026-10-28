import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { appleMusicDevice, musicBarOn, musicSource } from '../lib/music/index.js'
import { connectSpotify, disconnectSpotify, spotifyConnected, redirectUri } from '../lib/music/spotify.js'
import { accountStatus, connectAccount, disconnectAccount } from '../lib/music/spotify-account.js'
import { authorizeAppleMusic } from '../lib/music/apple-music.js'
import { Section, Row, SelectRow, Switch, TextField, Button } from './ui.jsx'

// Spotify only takes an https redirect for a web page, or a loopback one (127.0.0.1, ::1).
const httpsOK = () => MOBILE || location.protocol === 'https:' || ['127.0.0.1', '[::1]', 'localhost'].includes(location.hostname)

/**
 * Settings → Features → Music: whether the music bar shows (components/MusicDock.jsx, and at the
 * top of a workout) and which player it steers (components/MusicBar.jsx). Turning the bar off
 * hides it and keeps the rest — the player chosen, Spotify's connection — for when it comes back.
 *
 * Spotify, two ways. On an instance that has a Spotify app of its own (SPOTIFY_CLIENT_ID), the
 * profile connects its Spotify account once and every device signed in to it can steer the music
 * (lib/music/spotify-account.js). Anywhere else (no such app, a guest, the phone without a server)
 * a Spotify app of the person's own signs in on each device (lib/music/spotify.js), with its Client
 * ID kept in S so the other devices find it.
 */
export default function MusicSettings() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [connected, setConnected] = useState(spotifyConnected)
  const [clientId, setClientId] = useState(S.spotifyClientId || '')
  const [acct, setAcct] = useState(null)
  const [busy, setBusy] = useState(false)
  const source = musicSource(S)
  const reload = () => accountStatus(true).then(setAcct)
  useEffect(() => { if (source === 'spotify') reload() }, [source])
  // Back from Spotify's sign-in in the phone app, with this page still open (App.jsx).
  useEffect(() => {
    const on = () => { setConnected(spotifyConnected()); reload() }
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
  const failed = () => useUI.getState().toast(t('Could not connect to Spotify.'))
  const account = source === 'spotify' && acct?.available

  let rows = null, footer = t('Shows what is playing at the top of a workout, with previous, pause and next.')
  if (account) {
    rows = acct.connected
      ? <Row icon="checkCircle" iconTint="var(--green)" title="Spotify"
          subtitle={acct.name ? t('Connected to your account as {0}', acct.name) : t('Connected to your account')}>
          <Button size="sm" disabled={busy} onClick={() => { setBusy(true); disconnectAccount().catch(() => {}).finally(() => { setBusy(false); reload() }) }}>{t('Disconnect')}</Button>
        </Row>
      : <Row icon="music" iconTint="var(--green)" title={t('Connect Spotify')}>
          <Button size="sm" variant="primary" disabled={busy}
            onClick={() => { setBusy(true); connectAccount().catch(() => { setBusy(false); failed() }) }}>{t('Connect')}</Button>
        </Row>
    footer = t('Spotify is linked to your openGym account: every device you sign in on can show and control it.')
  } else if (source === 'spotify' && acct) {
    rows = connected
      ? <Row icon="checkCircle" iconTint="var(--green)" title="Spotify" subtitle={t('Connected on this device')}>
          <Button size="sm" onClick={() => { disconnectSpotify(); setConnected(false) }}>{t('Disconnect')}</Button>
        </Row>
      : <>
          <Row icon="link" iconTint="var(--green)" title={t('Spotify Client ID')}
            subtitle={httpsOK() ? null : t('Spotify needs this page on https to sign in.')}>
            <TextField value={clientId} onChange={e => setClientId(e.target.value)} placeholder="0123abcd…"
              aria-label={t('Spotify Client ID')} autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ maxWidth: 180 }} />
          </Row>
          <Row icon="music" iconTint="var(--green)" title={t('Connect Spotify')}>
            <Button size="sm" variant="primary" disabled={!/^[0-9a-zA-Z]{16,64}$/.test(clientId.trim()) || !httpsOK()}
              onClick={() => {
                const id = clientId.trim()
                update(s => { s.spotifyClientId = id })
                connectSpotify(id).catch(failed)
              }}>{t('Connect')}</Button>
          </Row>
        </>
    if (!connected) footer = t('Make an app on developer.spotify.com, add this redirect URI to it and paste its Client ID here: {0}', redirectUri())
  }
  const bar = musicBarOn(S)
  return <Section title={t('Music')} footer={bar ? footer : t('Off hides the music bar everywhere. The player and Spotify stay connected: turn it back on whenever you like.')}>
    <Row icon="music" iconTint="var(--pink)" title={t('Music bar')}
      subtitle={t('Above the tab bar and at the top of a workout.')}>
      <Switch aria-label={t('Music bar')} checked={bar} onChange={v => update(s => { if (v) delete s.musicBar; else s.musicBar = false })} />
    </Row>
    {bar && <SelectRow icon="music" iconTint="var(--pink)" title={t('Music player')} value={source || 'off'} options={options} onChange={choose} />}
    {bar && rows}
  </Section>
}
