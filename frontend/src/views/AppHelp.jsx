import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Row, SearchField, Section } from '../components/ui.jsx'
import { useOnline } from '../components/ServerSync.jsx'
import { helpMatches } from '../lib/app-help.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { ensureAiConsent } from '../lib/coach-api.js'

export default function AppHelp({ ctx, canExplain }) {
  const nav = useNavigate()
  const online = useOnline()
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const version = useRef(0)
  useEffect(() => () => { version.current++ }, [])
  const matches = helpMatches(question, ctx)
  function change(text) {
    version.current++
    setQuestion(text)
    setBusy(false)
    setSelected(null)
    setError(false)
  }
  async function explain() {
    const current = ++version.current
    setBusy(true)
    setError(false)
    try {
      await ensureAiConsent()
      if (current !== version.current) return
      const entries = matches.map(({ title, steps }) => ({ title, steps }))
      const result = await api('/api/coach/help', { method: 'POST', timeout: 0, body: JSON.stringify({ question: question.trim(), entries }) })
      if (current !== version.current) return
      if (Number.isInteger(result.index) && matches[result.index]) setSelected(matches[result.index])
      else setError(true)
    } catch (e) {
      if (!e?.quiet && current === version.current) setError(true)
    } finally {
      if (current === version.current) setBusy(false)
    }
  }
  const open = hit => nav(hit.route, { state: hit.state })
  return <main className="narrow">
    <div className="sp-nav"><button className="sp-back" onClick={() => nav('/settings')}>{t('Settings')}</button></div>
    <h1 className="sp-root-title">{t('App help')}</h1>
    <SearchField type="search" aria-label={t('App help')} placeholder={t('Search…')} value={question}
      onChange={e => change(e.target.value)} onClear={() => change('')} maxLength={1000} />
    {matches.length > 0 && <Section>
      {matches.map(hit => <Row key={hit.route + hit.title} title={hit.title} subtitle={hit.steps.join(' › ')}
        accessory="chevron" onClick={() => open(hit)} />)}
    </Section>}
    {question.trim() && !matches.length && <p role="status">{t('No matching help found.')}</p>}
    {!matches.length && <Section>
      <Row title={t('Search settings')} accessory="chevron" onClick={() => nav('/settings')} />
      <Row title={t('Learn')} accessory="chevron" onClick={() => nav('/learn')} />
    </Section>}
    {!!matches.length && online && canExplain && <Button disabled={busy} onClick={explain}>{t('Ask Coach to pick a result')}</Button>}
    {selected && matches.some(hit => hit.route === selected.route && hit.title === selected.title) &&
      <section aria-live="polite"><h2>{selected.title}</h2><ol>{selected.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></section>}
    {error && <p role="status">{t('Could not ask the Coach')}</p>}
  </main>
}
