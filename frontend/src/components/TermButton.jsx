import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
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

export function openTermEntry(entry, onLearn) {
  useUI.getState().openSheet(close => <TermCard entry={entry} close={close} onLearn={onLearn} />, { kind: 'center' })
}

export default function TermButton({ entry, children }) {
  const nav = useNavigate()
  // An id with no entry is a typo in the caller: show the words, offer nothing that would not work.
  if (!entry) return <>{children}</>
  return <button type="button" className="iv-term" aria-haspopup="dialog" onClick={() => openTermEntry(entry, () => nav('/learn'))}>
    {children ?? t(entry.term)}
  </button>
}
