import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { appBase } from '../lib/api.js'
import { fmtAgo } from '../lib/format.js'
import { loadLink, onNutritionChange, link, unlink, refresh, setShown, guessUrl, cleanUrl, fastingNow } from '../lib/sister-nutrition.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Section, Row, Switch, Button, TextField } from './ui.jsx'

/* Sister apps (v1.4.5, gm-hooks): Settings → Integrations → Sister apps → openNutrition. Linking
   this device to an openNutrition account, read-only (lib/sister-nutrition.js), what it may show
   where, and the Home line about the fasting window. openRunning has no app yet: its contract is
   docs/dev/SISTER_APPS.md, and runs come in through Apple Health / Health Connect meanwhile. */

export const SISTER_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/dev/SISTER_APPS.md'

/** This device's openNutrition link, kept up to date; with `range`, the days of it are fetched too. */
export function useNutritionLink(range = null) {
  const [l, setL] = useState(() => loadLink())
  useEffect(() => onNutritionChange(setL), [])
  const from = range?.from, to = range?.to
  useEffect(() => { if (loadLink()) refresh(from && to ? { from, to } : {}) }, [from, to])
  return l
}

const ERRORS = {
  url: 'That does not look like an address.',
  code: 'That code did not work. Codes expire after a few minutes, so grab a fresh one.',
  unreachable: 'openGym could not reach openNutrition there. Check the address, or that this device can see it.',
  revoked: 'openNutrition said no. The link was revoked there, so link again.',
  missing: 'That openNutrition does not know this kind of link yet. Create a token there and paste it instead.',
  notnutrition: 'Something answered, but it was not openNutrition.',
  busy: 'openNutrition asked to slow down. Try again in a minute.',
  failed: 'Something went wrong. Try again.',
}
export const linkErrorText = code => t(ERRORS[code] || ERRORS.failed)

const host = url => { try { return new URL(url).host } catch { return url } }

function Head({ status }) {
  return <div className="intg-head">
    <h3 className="intg-h"><Icon name="tree" /><span translate="no">openNutrition</span></h3>
    {status && <span className={'intg-pill ' + status}>{t(status === 'connected' ? 'Connected' : status === 'attention' ? 'Needs attention' : 'Off')}</span>}
  </div>
}

function LinkSetup({ close }) {
  const [url, setUrl] = useState(() => guessUrl(appBase() || (typeof location !== 'undefined' ? location.origin : '')))
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      await link(url, code)
      useUI.getState().toast(t('Linked. Your meals now have a seat at the table.'))
      close()
    } catch (e) { setErr(linkErrorText(e?.code)) } finally { setBusy(false) }
  }
  return <>
    <Head status="off" />
    <p className="intg-lead">{t('What you ate next to what you lifted: calories, protein and protein meals in your report and month story, and your fasting window on Home. openGym only reads, it never changes a thing there.')}</p>
    <label className="intg-label" htmlFor="on-url">{t('openNutrition address')}</label>
    <TextField id="on-url" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      placeholder="https://nutrition.example.com" value={url} onChange={e => setUrl(e.target.value)} />
    <label className="intg-label" htmlFor="on-code">{t('Code or token')}</label>
    <TextField id="on-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="one-time-code"
      placeholder="ABCD1234" value={code} onChange={e => setCode(e.target.value)} />
    <p className="sect-f" style={{ marginTop: 6 }}>{t('In openNutrition: Settings, Connected apps, Link openGym. Type the code it shows, or paste a token with summary access. The token stays on this device.')}</p>
    {err && <div className="small" role="alert" style={{ color: 'var(--red-ink)', margin: '4px 0 10px' }}>{err}</div>}
    <Button variant="primary" disabled={busy || !cleanUrl(url) || !code.trim()} onClick={go}>{busy ? t('Checking…') : t('Link')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function LinkManage({ l, close }) {
  const [busy, setBusy] = useState(false)
  const now = async () => {
    setBusy(true)
    const r = await refresh({ force: true })
    setBusy(false)
    useUI.getState().toast(r?.error ? linkErrorText(r.error) : t('Up to date'))
  }
  const off = () => confirmSheet({
    title: t('Unlink openNutrition?'),
    message: t('This device forgets the link and the numbers it read. Nothing changes in openNutrition; revoke the token there too if you like.'),
    confirmText: t('Unlink'), danger: true,
    onConfirm: async () => { await unlink(); close(); useUI.getState().toast(t('Unlinked')) },
  })
  return <>
    <Head status={l.error ? 'attention' : 'connected'} />
    <Section>
      <Row icon="link" iconTint="var(--green)" title={t('Linked to {0}', host(l.url))} subtitle={l.hint ? t('Token ending in {0}', l.hint) : null} />
      <Row icon="clock" iconTint="var(--blue)" title={t('Last read')} value={l.at ? fmtAgo(l.at) : t('Not yet')} />
      {l.error && <Row icon="warning" iconTint="var(--orange)" title={linkErrorText(l.error)}>
        <button className="btn xs tinted" onClick={now} disabled={busy}>{t('Retry')}</button>
      </Row>}
    </Section>
    <Section title={t('Show it in')} footer={t('Read on this device only. Nothing is written to openNutrition, and nothing it sends goes into your backup or your sync.')}>
      <Row icon="note" iconTint="var(--indigo)" title={t('Performance report')} subtitle={t('Calories, protein and protein meals for the stretch you print.')}>
        <Switch aria-label={t('Performance report')} checked={l.show.report !== false} onChange={v => setShown('report', v)} />
      </Row>
      <Row icon="sparkles" iconTint="var(--pink)" title={t('Your month')} subtitle={t('A nutrition card in the month story.')}>
        <Switch aria-label={t('Your month')} checked={l.show.story !== false} onChange={v => setShown('story', v)} />
      </Row>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Fasting window on Home')} subtitle={t('When a fast runs in openNutrition, Home says until when.')}>
        <Switch aria-label={t('Fasting window on Home')} checked={l.show.home !== false} onChange={v => setShown('home', v)} />
      </Row>
    </Section>
    <Button variant="tinted" icon="reset" disabled={busy} onClick={now}>{busy ? t('Checking…') : t('Read now')}</Button>
    <div className="sect-b intg-end">
      <button type="button" className="lrow tap danger" onClick={off}>
        <Icon name="trash" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Unlink')}</span></span>
      </button>
    </div>
  </>
}

function NutritionSheet({ close }) {
  const l = useNutritionLink()
  return l ? <LinkManage l={l} close={close} /> : <LinkSetup close={close} />
}

export const nutritionSheet = () => useUI.getState().openSheet(close => <NutritionSheet close={close} />)

const clock = ms => { try { return new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) } catch { return new Date(ms).toTimeString().slice(0, 5) } }

/** The Home line under today's session: the fasting window, when linked and allowed. */
export function FastingLine() {
  const l = useNutritionLink()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60e3); return () => clearInterval(id) }, [])
  if (!l || l.show.home === false) return null
  const f = fastingNow(l, now)
  if (!f || f.kind === 'done') return null
  const text = f.kind === 'fasting' ? t('Fasting until {0}. Water counts, the bar does not.', clock(f.until))
    : f.kind === 'window' ? t('Eating window open until {0}.', clock(f.until))
      : t('Eating window opens at {0}.', clock(f.at))
  return <div className="small dim fast-line" data-fast={f.kind}><Icon name="moon" /><span>{text}</span></div>
}
