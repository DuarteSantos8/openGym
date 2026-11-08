import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { TOKEN_CATEGORIES, TOKEN_DAYS } from '../lib/api-tokens.js'
import { categoryLabel, levelLabel } from '../lib/sharing-api.js'
import { ICON, TINT } from './ApiTokens.jsx'
import Icon from '../components/Icon.jsx'
import { Section, SelectRow, Button } from '../components/ui.jsx'

/* The consent screen of the MCP connector's sign-in (api/oauth.js, docs/MCP_REMOTE.md): Claude,
   ChatGPT or another assistant sent the browser here. It says who is asking and where the answer
   goes, lets the person pick what it may see and change, and only then makes the token. */
export default function Connect() {
  const { id } = useParams()
  const nav = useNavigate()
  const [req, setReq] = useState(null)
  const [gone, setGone] = useState(false)
  const [scopes, setScopes] = useState(null)
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    api('/api/oauth/request?id=' + encodeURIComponent(id || '')).then(r => {
      setReq(r)
      // What the assistant asked for, else enough to read the training and plan it.
      const asked = r.scopes && Object.values(r.scopes).some(v => v !== 'off')
      setScopes(asked ? r.scopes : { workouts: 'view', plans: 'apply', bodyweight: 'view', measurements: 'off', notes: 'off' })
    }).catch(() => setGone(true))
  }, [id])

  const answer = async yes => {
    if (yes && TOKEN_CATEGORIES.every(c => scopes[c.id] === 'off')) { setProblem(t('Pick at least one thing it may see.')); return }
    setBusy(true); setProblem(null)
    try {
      const r = await api(yes ? '/api/oauth/approve' : '/api/oauth/deny', { method: 'POST', body: JSON.stringify(yes ? { id, scopes, days } : { id }) })
      window.location.assign(r.redirect)
    } catch (e) { setProblem(e?.message || t('Something went wrong')); setBusy(false) }
  }

  if (gone) return <div className="narrow connect">
    <h1>{t('This sign-in has expired')}</h1>
    <p className="intg-lead">{t('Start it again from the assistant. It only waits ten minutes.')}</p>
    <Button onClick={() => nav('/home')}>{t('Back to openGym')}</Button>
  </div>
  if (!req || !scopes) return <div className="narrow connect"><p className="intg-lead">{t('Loading…')}</p></div>

  return <div className="narrow connect">
    <div className="connect-head">
      <span className="connect-i"><Icon name="plug" /></span>
      <h1>{t('{0} wants to use your openGym', req.client)}</h1>
      <p className="intg-lead">{t('After you say yes, it goes back to {0}. Only say yes if you just started this there.', req.redirectHost)}</p>
      {req.loopback && <p className="intg-problem" role="note">{t('This goes back to a program on this computer, not to a website. Only allow it if you started it there yourself just now.')}</p>}
    </div>
    <Section title={t('It can')} footer={t('See reads. Change directly also writes, over the exact version it read.')}>
      {TOKEN_CATEGORIES.map(c => {
        const opts = c.max === 'apply' ? ['off', 'view', 'apply'] : ['off', 'view']
        return <SelectRow key={c.id} icon={ICON[c.id]} iconTint={TINT[c.id]} title={categoryLabel(c.id)} value={scopes[c.id]}
          options={opts.map(lv => ({ value: lv, label: levelLabel(lv) }))} onChange={v => { setScopes(s => ({ ...s, [c.id]: v })); setProblem(null) }} />
      })}
    </Section>
    <Section footer={t('It shows up under Settings → API tokens, where you can revoke it any time.')}>
      <SelectRow icon="clock" iconTint="var(--grey)" title={t('Ends')} value={days}
        options={TOKEN_DAYS.map(d => ({ value: d, label: d === 365 ? t('After a year') : d ? t('After {0} days', d) : t('When you revoke it') }))} onChange={setDays} />
    </Section>
    {problem && <div className="intg-problem" role="alert">{problem}</div>}
    <div className="intg-btns">
      <Button variant="primary" icon="check" disabled={busy} onClick={() => answer(true)}>{t('Allow')}</Button>
      <Button disabled={busy} onClick={() => answer(false)}>{t('Not now')}</Button>
    </div>
  </div>
}
