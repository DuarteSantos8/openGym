import { lazy, Suspense, useState } from 'react'
import { t } from '../lib/i18n.js'
import './term.css'

const Term = lazy(() => import('./Term.jsx'))

export default function ScreenGlossary({ ids }) {
  const [open, setOpen] = useState(false)
  return <details className="iv-screen-glossary" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('Glossary')}</summary>
    {open && <Suspense fallback={null}>
      <div>{ids.map(id => <Term key={id} id={id} />)}</div>
    </Suspense>}
  </details>
}
