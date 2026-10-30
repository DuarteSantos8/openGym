// "Check exercise matches" in an import's summary: every name the file uses and what it becomes,
// a library exercise or your own, with a tap to change it before anything is written. The picks
// live in the summary until Import, which keeps them as other names (lib/import-matches.js).
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn, exerciseNameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { OWN, aliasMatches, reviewList } from '../lib/import-matches.js'
import { menuSheet, exercisePicker } from '../sheets.jsx'
import { Button, Row, Section } from './ui.jsx'

const nameOf = (st, id) => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : (st.customEx || []).find(c => c.id === id)?.n || id)

/** The summary's row: how many names the file uses, and the review behind a tap. */
export function ImportMatchesRow({ parts, picks, reparse, onChange }) {
  const list = reviewList(...parts)
  if (!list.length) return null
  const open = () => useUI.getState().openSheet(close =>
    <ImportMatchesSheet picks={picks} reparse={reparse} onChange={onChange} close={close} />)
  return <Section>
    <Row icon="magnifier" title={t('Check exercise matches')} subtitle={tn('{0} exercise', '{0} exercises', list.length)}
      accessory="chevron" onClick={open} className="import-matches" />
  </Section>
}

/**
 * The list. `reparse(picks)` reads the file again with these picks and returns its parts, so the
 * list shows what the import will do; `onChange(picks)` hands them back to the summary.
 */
function ImportMatchesSheet({ picks: first, reparse, onChange, close }) {
  const st = useStore(s => s.S)
  const [picks, setPicks] = useState(first)
  const list = useMemo(() => reviewList(...reparse(picks)), [reparse, picks])
  const remembered = useMemo(() => aliasMatches(st), [st])
  const set = (key, value) => {
    const next = { ...picks, [key]: value }
    setPicks(next)
    onChange(next)
  }
  const choose = x => {
    const chosen = picks[x.key] != null || (picks[x.key] === undefined && remembered.has(x.key))
    menuSheet({
      title: x.name,
      sections: [{ items: [
        { icon: 'magnifier', label: t('Pick from the library'), onClick: () => {
          const picker = exercisePicker(ex => { picker?.close?.(); set(x.key, ex.id) }, { title: x.name, like: x.own ? undefined : x.id })
        } },
        { icon: 'person', label: t('Keep as your own exercise'), on: x.own, onClick: () => set(x.key, OWN) },
        ...(chosen ? [{ icon: 'undo', label: t('Use the automatic match'), onClick: () => set(x.key, null) }] : []),
      ] }],
    })
  }
  return <>
    <h3>{t('Check exercise matches')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Tap a name to change what it becomes. Your pick is remembered for the next import.')}
    </div>
    <Section>
      {list.map(x => {
        const chosen = picks[x.key] != null || (picks[x.key] === undefined && remembered.has(x.key))
        const what = x.own ? t('Your own exercise') : '→ ' + nameOf(st, x.id)
        return <Row key={x.key} title={<span className="capitalize">{x.name}</span>}
          subtitle={chosen ? what + ' · ' + t('your pick') : what} accessory="chevron" onClick={() => choose(x)} />
      })}
    </Section>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
