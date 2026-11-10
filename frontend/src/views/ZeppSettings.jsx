// Settings → Zepp OS watch (signed in to a server): pairing an Amazfit or other Zepp OS watch, and
// the watches paired. The watch's Side Service lives in the Zepp app, so it reaches openGym through
// this server (lib/watch-relay.js, docs/ZEPP_OS.md): the code below goes into the openGym watch
// app's settings page in the Zepp app, with the server's address.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row, Button } from '../components/ui.jsx'
import { relayLinks, relayPairCode, relayUnlink, relayChanged } from '../lib/watch-relay.js'
import { remoteAuth } from '../lib/api.js'
import { appBase } from '../lib/app-base.js'
import { fmtAgo } from '../lib/format.js'

/** The address the Zepp app's settings page wants: the paired server, else this page's own. */
const pairedServer = () => { try { return remoteAuth() } catch { return null } }
export function serverAddress (remote = pairedServer(), loc = typeof location !== 'undefined' ? location : null) {
  if (remote?.base) return String(remote.base).replace(/\/+$/, '')
  if (!loc) return ''
  return (loc.origin + appBase(loc)).replace(/\/+$/, '')
}

export default function ZeppSettingsPage ({ api = { relayLinks, relayPairCode, relayUnlink } }) {
  const [links, setLinks] = useState(null)   // null while asking
  const [pair, setPair] = useState(null)     // { code, exp } on screen
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fail = () => setErr(t('Couldn’t reach your server. Try again in a moment.'))

  const reload = () => api.relayLinks().then(l => { setLinks(l); setErr('') }).catch(() => { setLinks([]); fail() })
  useEffect(() => { reload() }, [])
  // While a code is on screen, the list is asked again now and then: the watch shows up in it
  // once the Zepp app redeems the code, and the code goes away then.
  useEffect(() => {
    if (!pair) return
    const tm = setInterval(() => {
      if (Date.now() > pair.exp) { setPair(null); return }
      api.relayLinks().then(l => {
        setLinks(prev => {
          if (prev && l.length > prev.length) { setPair(null); relayChanged() }
          return l
        })
      }).catch(() => {})
    }, 4000)
    return () => clearInterval(tm)
  }, [pair])

  const newCode = async () => {
    setBusy(true)
    try { setPair(await api.relayPairCode()); setErr('') } catch { fail() } finally { setBusy(false) }
  }
  const unlink = async id => {
    try { setLinks(await api.relayUnlink(id)) } catch { fail() }
  }
  const address = serverAddress()

  return <>
    <Section footer={err || t('Amazfit and other Zepp OS watches talk to openGym through this server. Pair one and your workouts show up on your wrist.')}>
      <Row icon="watch" iconTint="var(--orange)" title={t('Pair a watch')} accessory="chevron" onClick={busy ? undefined : newCode} />
    </Section>
    {pair && <Section title={t('Pairing code')} footer={t('In the Zepp app, open the openGym watch app’s settings and type in this address and code. The code lasts ten minutes.')}>
      <Row icon="globe" iconTint="var(--blue)" title={t('Server address')} subtitle={address} />
      <Row icon="key" iconTint="var(--green)" title={t('Pairing code')}>
        <span className="lrow-v" style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }} data-testid="zepp-code">{pair.code}</span>
      </Row>
    </Section>}
    {links && links.length > 0 && <Section title={t('Paired watches')}>
      {links.map(l => (
        <Row key={l.id} icon="watch" iconTint="var(--grey)" title={l.name}
          subtitle={l.seen && l.seen !== l.created ? t('Last heard from the watch: {0}', fmtAgo(l.seen)) : t('Not heard from yet')}>
          <Button size="sm" variant="tinted" onClick={() => unlink(l.id)}>{t('Unpair')}</Button>
        </Row>
      ))}
    </Section>}
  </>
}
