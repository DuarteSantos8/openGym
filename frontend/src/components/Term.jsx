// A word that explains itself (EP24): tap it and the glossary's entry opens over the screen,
// with a way on to Learn. For the handful of places where a beginner meets jargon mid-task and
// should not have to leave to look it up. The entries live in content/learn.js.
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { termById } from '../lib/learn.js'
import { Button } from './ui.jsx'
import './term.css'

function TermCard({ entry, close, onLearn }) {
  return <div className="iv-term-card">
    <h3>{t(entry.term)}</h3>
    <p className="muted">{t(entry.def)}</p>
    <Button variant="primary" onClick={close}>{t('Got it')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={() => { close(); onLearn() }}>{t('Open the glossary')}</Button>
  </div>
}

/** Opens the entry for `id`. False when there is no such term. */
export function openTerm(id, onLearn = () => {}) {
  const entry = termById(id)
  if (!entry) return false
  useUI.getState().openSheet(close => <TermCard entry={entry} close={close} onLearn={onLearn} />, { kind: 'center' })
  return true
}

export default function Term({ id, children }) {
  const nav = useNavigate()
  const entry = termById(id)
  // An id with no entry is a typo in the caller: show the words, offer nothing that would not work.
  if (!entry) return <>{children}</>
  return <button type="button" className="iv-term" aria-haspopup="dialog" onClick={() => openTerm(id, () => nav('/learn'))}>
    {children ?? t(entry.term)}
  </button>
}
