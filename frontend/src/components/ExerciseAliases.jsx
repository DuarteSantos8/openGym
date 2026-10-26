import { useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exerciseAliases, normalizeAliases } from '../lib/exercise-aliases.js'
import { isCustomEx } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

// Other names an exercise is found by (#624). A power feature, so it stays one quiet line until
// someone asks for it: "Add another name", or the names already given, and only a tap opens the field.
export function ExerciseAliasesField({ value, onChange, autoFocus }) {
  const id = useId()
  return <div style={{ marginTop: 12 }}>
    <label className="small muted" htmlFor={id}>{t('Other names')}</label>
    <input id={id} className="input" value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}
      maxLength={1640} aria-describedby={id + '-help'} />
    <div id={id + '-help'} className="small dim">{t('The search finds it by these too. Separate them with commas.')}</div>
  </div>
}

/** The closed state of the field: what it is called besides its name, or the offer to add one. */
export function ExerciseAliasesLink({ names, onOpen }) {
  return <button type="button" className="small dim exfix-link exalias-link" onClick={onOpen}>
    <Icon name={names.length ? 'pencil' : 'plus'} /> {names.length ? t('Also called {0}', names.join(', ')) : t('Add another name')}
  </button>
}

export default function ExerciseAliasesEditor({ ex }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const current = isCustomEx(ex) ? st.customEx?.find(c => c.id === ex.id) || ex : ex
  const saved = exerciseAliases(current, st.exAliases)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const aliases = normalizeAliases(value)
  if (!open) return <ExerciseAliasesLink names={saved} onOpen={() => { setValue(saved.join(', ')); setOpen(true) }} />
  const save = () => {
    update(s => {
      if (isCustomEx(ex)) {
        const c = s.customEx?.find(c => c.id === ex.id)
        if (c) c.aliases = aliases
      } else s.exAliases = { ...s.exAliases, [ex.id]: aliases }
    })
    setOpen(false)
  }
  return <>
    <ExerciseAliasesField value={value} onChange={setValue} autoFocus />
    <Button onClick={save} disabled={JSON.stringify(aliases) === JSON.stringify(saved)} style={{ marginTop: 8 }}>{t('Save names')}</Button>
  </>
}
