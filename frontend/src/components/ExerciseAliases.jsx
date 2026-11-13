import { useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exerciseAliases, normalizeAliases, shownNameOf } from '../lib/exercise-aliases.js'
import { isCustomEx } from '../lib/exercises.js'
import { t, exerciseOwnName, exerciseOwnNameClass } from '../lib/i18n.js'
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
  if (!open) return <>
    <ExerciseAliasesLink names={saved} onOpen={() => { setValue(saved.join(', ')); setOpen(true) }} />
    {saved.length > 0 && <ShownAs ex={current} names={saved} picked={shownNameOf(current, st.exShownName, st.exAliases)}
      onPick={name => update(s => { s.exShownName = { ...(s.exShownName || {}), [ex.id]: name || null } })} />}
  </>
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

// Which name the exercise goes by everywhere (#903): its own, or one of its other names, the way
// your gym says it ("Pec deck" for "lever seated fly"). Logged workouts, exports and the API keep
// the id and the catalogue title; only what you read changes. `null` is its own name again.
function ShownAs({ ex, names, picked, onPick }) {
  const opts = [{ name: null, label: exerciseOwnName(ex), cls: exerciseOwnNameClass(ex) }, ...names.map(n => ({ name: n, label: n, cls: '' }))]
  return <div className="exshown" role="group" aria-label={t('Shown as')} style={{ marginTop: 8 }}>
    <div className="small dim" style={{ marginBottom: 6 }}>{t('Shown as')}</div>
    <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', touchAction: 'auto' }}>
      {opts.map(o => {
        const on = (picked || null) === o.name
        return <button key={o.name ?? ''} type="button" className={'chip nocap' + (on ? ' on' : '')} aria-pressed={on}
          onClick={() => onPick(o.name)}><span className={o.cls}>{o.label}</span></button>
      })}
    </div>
  </div>
}
