// Learn (EP24, /learn): the basics and the vocabulary, inside the app, offline.
//
// Two parts on one screen: short guides that open in place, and a glossary with a search. The
// text is content/learn.js; nothing here is fetched, linked out to or measured. A guide can be
// opened directly with /learn?g=<id>, and a search with /learn?q=<words>.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t, getLang, baseLang, hasTranslation } from '../lib/i18n.js'
import { GUIDES, searchGlossary, guideById } from '../lib/learn.js'
import { LEARN_SESSIONS, learnSessionById, startLearnSession } from '../lib/learn-sessions.js'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { learnLaddersSheet } from '../components/Ladders.jsx'
import { Button, SearchField } from '../components/ui.jsx'
import './onboarding.css'

function SessionPicker() {
  const nav = useNavigate()
  const active = useStore(s => !!s.S.active)
  const [selected, setSelected] = useState('warmup-general')
  const session = learnSessionById(selected)
  return <div>
    <label>{t('Session')} <select value={selected} onChange={e => setSelected(e.target.value)}>
      {LEARN_SESSIONS.map(session => <option key={session.id} value={session.id}>{t(session.title)}</option>)}
    </select></label>
    <p>{t('Draft')} · {t('about {0} min', session.minutes)}</p>
    <p>{t(session.routine.sessions[0].note)}</p>
    <p data-session-source><strong>{t('Sources')}</strong> {session.routine.about}</p>
    <Button type="button" variant="primary" disabled={active} onClick={() => {
      if (startLearnSession(selected, useStore)) nav('/workout')
    }}>{t('Start this session')}</Button>
  </div>
}

function Guide({ guide, open, onToggle }) {
  const id = 'iv-learn-g-' + guide.id
  const texts = [guide.title, guide.summary, ...guide.blocks.flatMap(b => [b.h, b.p, ...(b.list || [])])].filter(Boolean)
  const hasEnglish = baseLang(getLang()) !== 'en' && texts.some(text => !hasTranslation(text))
  return <div className="iv-learn-guide" data-guide={guide.id}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span className="lrow-i" aria-hidden="true"><Icon name={guide.icon} /></span>
      <span className="iv-learn-guide-t"><span className="tt">{t(guide.title)}</span><br /><span className="ss">{t(guide.summary)}</span></span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />
    </button>
    {open && <div className="iv-learn-body" id={id}>
      {hasEnglish && <p className="small dim iv-learn-note">{t('These texts are in English for now.')}</p>}
      {guide.blocks.map((b, i) => <div key={i}>
        {b.h && <h3>{t(b.h)}</h3>}
        {b.p && <p>{t(b.p)}</p>}
        {b.list && <ul>{b.list.map((x, j) => <li key={j}>{t(x)}</li>)}</ul>}
      </div>)}
      {guide.id === 'warm-up' && <SessionPicker />}
      {guide.sources && <div className="iv-learn-sources">
        <strong>{t('Sources')}</strong>
        {guide.sources.map((s, i) => <p key={i}>{s}</p>)}
      </div>}
    </div>}
  </div>
}

export default function Learn() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [open, setOpen] = useState(() => (guideById(params.get('g')) ? params.get('g') : null))
  const [q, setQ] = useState(() => params.get('q') || '')
  const terms = useMemo(() => searchGlossary(q, t), [q])
  return <div className="iv-learn narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Learn')}</h1>
        <div className="sub">{t('The basics, explained plainly. Works offline.')}</div></div>
    </div>
    <h2 className="sec">{t('Guides')}</h2>
    <div className="iv-learn-guides">
      {GUIDES.map(g => <Guide key={g.id} guide={g} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />)}
    </div>

    <Button variant="tinted" icon="stairs" aria-haspopup="dialog" onClick={learnLaddersSheet}>{t('Skill ladders')}</Button>
    <h2 className="sec" id="iv-learn-glossary">{t('Glossary')}</h2>
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search the glossary')} aria-label={t('Search the glossary')} />
    {terms.length
      ? <ul className="iv-learn-terms" aria-labelledby="iv-learn-glossary">
        {terms.map(x => <li key={x.id} data-term={x.id}>
          <div className="iv-learn-term-n">{t(x.term)}</div>
          <div className="iv-learn-term-d">{t(x.def)}</div>
        </li>)}
      </ul>
      : <p className="muted" role="status">{t('No term matches.')}</p>}
    <p className="small dim iv-quiz-foot">{t('General training information for healthy adults, not medical advice.')}</p>
  </div>
}
