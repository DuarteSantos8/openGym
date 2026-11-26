import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { SCREEN_TERMS } from '../content/screen-terms.js'
import TermButton from './TermButton.jsx'

export default function ScreenGlossary({ ids }) {
  const [open, setOpen] = useState(false)
  return <details className="iv-screen-glossary" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('Glossary')}</summary>
    {open && <div>{ids.map(id => <TermButton key={id} entry={SCREEN_TERMS[id]} />)}</div>}
  </details>
}
