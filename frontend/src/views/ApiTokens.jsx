import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { copyText } from '../lib/clipboard.js'
import { fmtAgo } from '../lib/format.js'
import { listTokens, createToken, revokeToken, mcpAddress, tokenLine, TOKEN_CATEGORIES, TOKEN_DAYS, endsLabel } from '../lib/api-tokens.js'
import { categoryLabel, levelLabel } from '../lib/sharing-api.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, SelectRow, Button, TextField } from '../components/ui.jsx'

/* Settings → Integrations → API tokens (docs/API_TOKENS.md): a token per program (an AI assistant
   over MCP, a planner, a script), each seeing and changing only what is ticked, revoked here. The
   server keeps only a hash, so a new token is shown once. */

export const MCP_REMOTE_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/MCP_REMOTE.md'
export const ICON = { workouts: 'dumbbell', plans: 'calendar', bodyweight: 'scale', measurements: 'ruler', notes: 'pencil' }
export const TINT = { workouts: 'var(--green)', plans: 'var(--orange)', bodyweight: 'var(--teal)', measurements: 'var(--indigo)', notes: 'var(--yellow)' }
const sheet = render => useUI.getState().openSheet(render)
const errText = e => e?.message || t('Something went wrong')

export default function ApiTokensPage() {
  const config = useStore(s => s.config)
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const load = useCallback(() => listTokens().then(d => { setData(d); setError(false) }).catch(() => setError(true)), [])
  useEffect(() => { load() }, [load])
  const mcp = data?.mcp || !!config?.mcp
  const address = mcpAddress()
  const tokens = data?.tokens || []

  const open = tok => sheet(close => <TokenDetail tok={tok} close={close} onRevoked={d => { setData(cur => ({ ...cur, tokens: d.tokens })); toast(t('Token revoked')) }} />)
  const add = () => sheet(close => <NewToken close={close} defaultDays={data?.defaultDays || 90} onMade={d => setData(cur => ({ ...cur, tokens: d.tokens }))} />)
  const revokeAll = () => confirmSheet({
    title: t('Revoke all tokens?'), message: t('Every program using one stops getting in right away.'), confirmText: t('Revoke all'), danger: true,
    onConfirm: () => revokeToken(null).then(d => { setData(cur => ({ ...cur, tokens: d.tokens })); toast(t('Token revoked')) }).catch(e => toast(errText(e))),
  })

  return <>
    <p className="sect-f intg-intro">{t('A token lets one program, like an AI assistant, see or change only what you tick. Never more than you can, and only your own profile.')}</p>
    {error && <Section><Row icon="warning" iconTint="var(--orange)" title={t('Could not reach your server')} subtitle={t('Tap to try again')} onClick={load} /></Section>}
    {mcp && <Section title={t('MCP address')} footer={t('Add it as a custom connector in Claude or ChatGPT and sign in with openGym when it asks. Other assistants take a token from below.')}>
      <Row icon="plug" iconTint="var(--purple)" title={<span translate="no" className="tok-url">{address}</span>} accessory="none"
        onClick={async () => { if (await copyText(address)) toast(t('Copied')) }} value={t('Copy')} />
      <Row icon="chat" iconTint="var(--acc)" title={t('Step by step for Claude, ChatGPT and Gemini')} accessory="chevron" onClick={() => { window.location.hash = '#/assistants' }} />
    </Section>}
    <Section title={t('Your tokens')} footer={tokens.length ? null : t('No tokens yet. Make one for each program, so you can revoke them one by one.')}>
      {tokens.map(tok => <Row key={tok.id} icon="key" iconTint="var(--purple)" title={tok.name} accessory="chevron" onClick={() => open(tok)}
        subtitle={[tokenLine(tok.scopes), tok.used ? t('Used {0}', fmtAgo(tok.used)) : t('Never used')].join(' · ')} />)}
      <Row icon="plus" iconTint="var(--acc)" title={t('New token')} onClick={add} />
    </Section>
    {tokens.length > 1 && <Section><Row icon="trash" danger title={t('Revoke all tokens')} onClick={revokeAll} /></Section>}
    <p className="sect-f">{t('How to connect an assistant:')} <a href={MCP_REMOTE_DOCS} target="_blank" rel="noopener noreferrer">docs/MCP_REMOTE.md</a></p>
  </>
}

function TokenDetail({ tok, close, onRevoked }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const revoke = () => {
    setBusy(true)
    revokeToken(tok.id).then(d => { close(); onRevoked(d) }).catch(e => { setBusy(false); toast(errText(e)) })
  }
  return <>
    <h3>{tok.name}</h3>
    <p className="intg-lead">{tokenLine(tok.scopes)}</p>
    <Section>
      <Row title={t('Starts with')} value={<span translate="no">ogt_{tok.hint}…</span>} />
      <Row title={t('Made')} value={fmtAgo(tok.created)} />
      <Row title={t('Last used')} value={tok.used ? fmtAgo(tok.used) : t('Never used')} />
      <Row title={t('Ends')} value={endsLabel(tok.exp)} />
    </Section>
    <div className="intg-btns">
      <Button variant="danger" icon="trash" disabled={busy} onClick={revoke}>{t('Revoke')}</Button>
      <Button onClick={close}>{t('Done')}</Button>
    </div>
  </>
}

function NewToken({ close, defaultDays, onMade }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState({ workouts: 'view', plans: 'view', bodyweight: 'off', measurements: 'off', notes: 'off' })
  const [days, setDays] = useState(defaultDays)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [token, setToken] = useState(null)
  const nameRef = useRef(null)
  const make = async () => {
    if (TOKEN_CATEGORIES.every(c => scopes[c.id] === 'off')) { setProblem(t('Pick at least one thing it may see.')); return }
    setBusy(true); setProblem(null)
    try {
      const d = await createToken({ name: name.trim() || t('API token'), scopes, days })
      setToken(d.token)
      onMade(d)
    } catch (e) { setProblem(errText(e)) }
    setBusy(false)
  }
  if (token) return <>
    <h3>{t('Your new token')}</h3>
    <p className="intg-lead">{t('Copy it now: this is the only time openGym shows it. Treat it like a password.')}</p>
    <div className="intg-secret" role="group" aria-label={t('Your new token')} translate="no">{token}</div>
    <div className="intg-btns">
      <Button variant="tinted" icon="copy" onClick={async () => { if (await copyText(token)) toast(t('Copied')) }}>{t('Copy')}</Button>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </div>
  </>
  return <>
    <h3>{t('New token')}</h3>
    <div className="intg-field">
      <label className="intg-label" htmlFor="tok-name">{t('Name')}</label>
      <TextField ref={nameRef} id="tok-name" name="token-name" autoComplete="off" placeholder={t('For example: Claude')} value={name}
        onChange={e => setName(e.target.value)} maxLength={40} />
    </div>
    <Section title={t('It can')} footer={t('See reads. Change directly also writes, over the exact version it read.')}>
      {TOKEN_CATEGORIES.map(c => {
        const opts = c.max === 'apply' ? ['off', 'view', 'apply'] : ['off', 'view']
        return <SelectRow key={c.id} icon={ICON[c.id]} iconTint={TINT[c.id]} title={categoryLabel(c.id)} value={scopes[c.id]}
          options={opts.map(lv => ({ value: lv, label: levelLabel(lv) }))} onChange={v => { setScopes(s => ({ ...s, [c.id]: v })); setProblem(null) }} />
      })}
    </Section>
    <Section>
      <SelectRow icon="clock" iconTint="var(--grey)" title={t('Ends')} value={days}
        options={TOKEN_DAYS.map(d => ({ value: d, label: d === 365 ? t('After a year') : d ? t('After {0} days', d) : t('When you revoke it') }))} onChange={setDays} />
    </Section>
    {problem && <div className="intg-problem" role="alert">{problem}</div>}
    <Button variant="primary" disabled={busy} onClick={make}>{busy ? t('Making…') : t('Make token')}</Button>
  </>
}
