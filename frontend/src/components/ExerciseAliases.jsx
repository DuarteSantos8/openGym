import { useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exerciseAliases, normalizeAliases } from '../lib/exercise-aliases.js'
import { isCustomEx } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export function ExerciseAliasesField({ value, onChange }) {
  const id = useId()
  return <div style={{ marginTop: 12 }}>
    <label className="small muted" htmlFor={id}>{t('Aliases')}</label>
    <input id={id} className="input" value={value} onChange={e => onChange(e.target.value)}
      maxLength={1640} aria-describedby={id + '-help'} />
    <div id={id + '-help'} className="small dim">{t('Alternative names for search. Separate with commas.')}</div>
  </div>
}

export default function ExerciseAliasesEditor({ ex }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const current = isCustomEx(ex) ? st.customEx?.find(c => c.id === ex.id) || ex : ex
  const saved = exerciseAliases(current, st.exAliases)
  const [value, setValue] = useState(() => saved.join(', '))
  const aliases = normalizeAliases(value)
  const save = () => {
    update(s => {
      if (isCustomEx(ex)) {
        const c = s.customEx?.find(c => c.id === ex.id)
        if (c) c.aliases = aliases
      } else s.exAliases = { ...s.exAliases, [ex.id]: aliases }
    })
    setValue(aliases.join(', '))
  }
  return <>
    <ExerciseAliasesField value={value} onChange={setValue} />
    <Button onClick={save} disabled={JSON.stringify(aliases) === JSON.stringify(saved)} style={{ marginTop: 8 }}>{t('Save aliases')}</Button>
  </>
}
