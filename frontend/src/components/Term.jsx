import { termById } from '../lib/learn.js'
import TermButton, { openTermEntry } from './TermButton.jsx'

export function openTerm(id, onLearn = () => {}) {
  const entry = termById(id)
  if (!entry) return false
  openTermEntry(entry, onLearn)
  return true
}

export default function Term({ id, children }) {
  return <TermButton entry={termById(id)}>{children}</TermButton>
}
