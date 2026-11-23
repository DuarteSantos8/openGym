// Coach → "Use your subscription" (sub-connect-146): Claude, ChatGPT or Gemini on the plan people
// already pay for, by adding openGym to that app as a connector (lib/assistants.js says why it is
// this and not a sign-in to the subscription). One screen: the address to paste, three cards with
// three steps each, a live "Connected via Claude" once the assistant has used its token, and the
// connected assistants with a way to cut them off. Where no assistant could reach this openGym
// (a phone on its own, connectors off, an address only the home network knows) it says so plainly
// and points at what works on the phone instead.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { copyText } from '../lib/clipboard.js'
import { fmtAgo } from '../lib/format.js'
import { listTokens, revokeToken, mcpAddress, tokenLine } from '../lib/api-tokens.js'
import { ASSISTANTS, assistantById, connectorsOf, connectionOf, reachability, SELF_HOSTING_DOCS, MCP_REMOTE_DOCS } from '../lib/assistants.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button } from '../components/ui.jsx'

const open = url => window.open(url, '_blank', 'noopener')
const POLL_MS = 5000

export default function Assistants() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const refreshConfig = useStore(s => s.refreshConfig)
  const toast = useUI(s => s.toast)
  const [tokens, setTokens] = useState(null)
  const [pick, setPick] = useState(null)
  const [qr, setQr] = useState(false)
  const [checking, setChecking] = useState(false)

  const mcp = !!(user && config?.mcp)
  const address = mcpAddress()
  const reach = reachability(address)

  useEffect(() => { if (user) refreshConfig?.() }, [user])
  const load = useCallback(() => listTokens().then(d => { setTokens(d.tokens || []); return d.tokens || [] }).catch(() => null), [])
  useEffect(() => { if (mcp) load() }, [mcp, load])

  // While a card is open and that assistant has not called yet, look again every few seconds: the
  // consent screen opens in another tab or app, and coming back should already say "Connected".
  const picked = assistantById(pick)
  const conn = picked && tokens ? connectionOf(tokens, picked.id) : null
  const waiting = !!(mcp && picked && !conn?.used)
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const back = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', back) }
  }, [waiting, load])

  const copy = async () => { if (await copyText(address)) toast(t('Copied')) }
  const check = async () => {
    setChecking(true)
    const list = await load()
    setChecking(false)
    const c = list && picked ? connectionOf(list, picked.id) : null
    if (!c) toast(t('Not connected yet. Finish the steps above, then try again.'))
    else if (!c.used) toast(t('Signed in, but {0} hasn’t called yet. Ask it something about your training.', picked.name))
  }
  const revoke = tok => confirmSheet({
    title: t('Disconnect {0}?', assistantById(tok.connector.assistant)?.name || tok.connector.client || t('this assistant')),
    message: t('It loses access right away. You can connect it again any time.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => revokeToken(tok.id).then(d => { setTokens(d.tokens || []); toast(t('Disconnected')) }).catch(e => toast(e?.message || t('Something went wrong'))),
  })

  const connected = connectorsOf(tokens)

  return <div className="narrow as-page">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Use your subscription')}</h1></div>
    </div>
    <p className="as-lead">{t('Already paying for Claude, ChatGPT or Gemini? Add openGym to that app as a connector. It reads your training and writes routines, on the plan you already have. No API key, no second bill.')}</p>

    {!mcp ? <Unavailable user={user} config={config} nav={nav} /> : <>
      <Section title={t('Your server address')} footer={reach === 'public'
        ? t('Paste it where the app asks for a connector or MCP server URL.')
        : <span className="as-warn">{reach === 'http'
          ? t('This address is plain http. The assistants only connect over https, so put openGym behind https first.')
          : t('This address only works on your home network. The assistant calls from the internet, so it needs a public https address, like a Cloudflare tunnel or a reverse proxy.')}</span>}>
        <div className="as-addr">
          <code translate="no">{address}</code>
          <div className="as-addr-b">
            <Button size="sm" variant="tinted" icon="copy" onClick={copy}>{t('Copy server address')}</Button>
            <Button size="sm" icon="qr" aria-expanded={qr} onClick={() => setQr(v => !v)}>{qr ? t('Hide QR code') : t('QR code')}</Button>
          </div>
          {qr && <QrCode value={address} />}
        </div>
      </Section>

      <Section title={t('Pick your assistant')}>
        <div className="as-cards" role="list">
          {ASSISTANTS.map(a => {
            const c = tokens ? connectionOf(tokens, a.id) : null
            return <button key={a.id} type="button" role="listitem" className={'as-card' + (pick === a.id ? ' on' : '')} aria-pressed={pick === a.id} onClick={() => setPick(p => (p === a.id ? null : a.id))}>
              <span className="as-card-i" style={{ color: a.tint }} aria-hidden="true"><Icon name="chat" /></span>
              <span className="as-card-t">{a.name}</span>
              <span className="as-card-s">{c?.used ? <span className="as-ok"><Icon name="checkCircle" /> {t('Connected')}</span> : a.limited ? t('Where available') : t('Connector')}</span>
            </button>
          })}
        </div>
      </Section>

      {picked && <div className="as-detail" key={picked.id}>
        <p className="as-plan"><b>{t('What you need')}</b> {picked.plan()}</p>
        <ol className="as-steps">
          {picked.steps().map((s, i) => <li key={i}><span className="as-n" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}
        </ol>
        <div className="as-btns">
          <Button variant="primary" icon="link" onClick={() => open(picked.settingsUrl)}>{t('Open {0}', picked.name)}</Button>
          <Button variant="tinted" icon="copy" onClick={copy}>{t('Copy server address')}</Button>
        </div>
        <div className={'as-status' + (conn?.used ? ' ok' : '')} role="status" aria-live="polite">
          {conn?.used
            ? <><Icon name="checkCircle" /><span><b>{t('Connected via {0}', picked.name)}</b>{t('Last used {0}', fmtAgo(conn.used))}</span></>
            : conn
              ? <><Icon name="hourglass" /><span><b>{t('Signed in')}</b>{t('Waiting for {0} to call. Ask it something about your training.', picked.name)}</span></>
              : <><Icon name="hourglass" /><span><b>{t('Not connected yet')}</b>{t('This turns green by itself once {0} has signed in and used openGym.', picked.name)}</span></>}
        </div>
        {conn?.used ? <p className="as-try">{picked.tryIt()}</p>
          : <Button size="sm" icon="reset" disabled={checking} onClick={check}>{checking ? t('Checking…') : t('Test the connection')}</Button>}
      </div>}

      <Section title={t('Connected assistants')} footer={connected.length ? t('Each one sees and changes only what you allowed when it signed in.') : t('None yet. The steps above take about a minute.')}>
        {connected.map(tok => {
          const a = assistantById(tok.connector.assistant)
          return <Row key={tok.id} icon="chat" iconTint={a?.tint || 'var(--grey)'} title={a?.name || tok.connector.client || tok.name}
            subtitle={[tokenLine(tok.scopes), tok.used ? t('Used {0}', fmtAgo(tok.used)) : t('Never used')].join(' · ')}
            value={t('Disconnect')} accessory="none" onClick={() => revoke(tok)} />
        })}
      </Section>
      <p className="sect-f">{t('How it works and what each app needs:')} <a href={MCP_REMOTE_DOCS} target="_blank" rel="noopener noreferrer">docs/MCP_REMOTE.md</a></p>
    </>}
  </div>
}

// Honest about why nothing here can work yet, and what does work right now instead.
function Unavailable({ user, config, nav }) {
  const why = !user
    ? (MOBILE
      ? t('Claude, ChatGPT and Gemini reach openGym over the internet, so they need an openGym server to talk to. This phone keeps your data to itself, so there is nothing for them to connect to yet.')
      : t('Sign in first: the assistant connects to your profile on this server.'))
    : config == null ? t('Loading…')
      : t('Connectors are switched off on this server. Its admin adds COMPOSE_PROFILES=mcp and MCP=on to the .env and restarts it.')
  const setup = () => nav(MOBILE ? '/coach/setup' : '/coach')
  return <>
    <div className="as-none" role="note"><Icon name="info" /><p>{why}</p></div>
    <Section title={t('What works right now')} footer={t('These run the openGym Coach with an AI of your choice. Nothing goes through a server of ours.')}>
      <Row icon="sparkles" iconTint="var(--indigo)" title={t('Sign in with OpenRouter')} subtitle={t('One sign-in for Claude, GPT, Gemini and more')} accessory="chevron" onClick={setup} />
      <Row icon="key" iconTint="var(--orange)" title={t('Use an API key')} subtitle={t('Got Claude Max? Your plan includes monthly API credits for a key.')} accessory="chevron" onClick={setup} />
      <Row icon="house" iconTint="var(--teal)" title={t('A model on your network')} subtitle={t('Ollama or LM Studio at home, nothing leaves your Wi-Fi')} accessory="chevron" onClick={setup} />
      <Row icon="rocket" iconTint="var(--purple)" title={t('Run your own openGym server')} subtitle={t('Then the connectors work too. About ten minutes with Docker.')} accessory="chevron" onClick={() => open(SELF_HOSTING_DOCS)} />
    </Section>
  </>
}

// The address as a QR code, for the assistant on another device. Plain black on white: phone
// cameras read that best, whatever the app's theme.
function QrCode({ value }) {
  const ref = useRef(null)
  useEffect(() => { import('../lib/qr.js').then(m => m.renderQrToCanvas(ref.current, value)).catch(() => {}) }, [value])
  return <div className="as-qr"><canvas ref={ref} className="qr-canvas" role="img" aria-label={t('QR code of the server address')} /></div>
}
