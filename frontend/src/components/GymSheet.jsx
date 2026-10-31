// The gym picker (lib/gyms.js): shown when a workout starts, from the workout's ⋯ menu to change
// the gym of the running session, and from Settings to look after the list.
//
// The same machine loads differently in each club, so every workout is tied to the gym it was
// done in and the weights a session opens with come from that gym. Nothing here is required: a
// profile with no gym listed starts workouts exactly as before.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { uid } from '../lib/format.js'
import { gymsOf, withGym, renamedGym, cleanGymName, MAX_GYMS, GYM_NAME_MAX } from '../lib/gyms.js'
import Icon from './Icon.jsx'
import { Button, TextField } from './ui.jsx'

const update = (...a) => useStore.getState().update(...a)
const toast = m => useUI.getState().toast(m)

function GymSheet({ current, required, manage, allowNone = true, onPick, close }) {
  const st = useStore(s => s.S)
  const gyms = gymsOf(st)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState({})

  const choose = id => { close(); onPick && onPick(id) }

  const add = () => {
    const made = withGym(gymsOf(useStore.getState().S), name, uid())
    if (!made) { toast(cleanGymName(name) ? t('You can keep up to {0} gyms.', MAX_GYMS) : t('Enter a name for the gym')); return }
    update(s => { s.gyms = made.gyms })
    setName('')
    // Picking a place to train: the one just typed is the one you are in.
    if (!manage) choose(made.id)
  }

  const rename = g => {
    const value = renaming[g.id]
    if (value == null || cleanGymName(value) === g.name) return
    const next = renamedGym(gymsOf(useStore.getState().S), g.id, value)
    if (!next) { toast(t('That name is taken or empty')); setRenaming(r => ({ ...r, [g.id]: g.name })); return }
    update(s => { s.gyms = next })
  }

  const remove = g => {
    // Workouts keep the id they were done under: deleting a name from the list never rewrites
    // history, it only stops offering the gym. Its past sessions still seed nothing new.
    update(s => {
      s.gyms = gymsOf(s).filter(x => x.id !== g.id)
      if (s.gymLast === g.id) s.gymLast = null
    })
  }

  return <>
    {required
      ? <div className="row between" style={{ marginBottom: 6 }}>
          <h3 style={{ marginBottom: 0 }}>{t('Which gym?')}</h3>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={() => close()}><Icon name="xmark" /></button>
        </div>
      : <h3>{manage ? t('Gyms') : t('Which gym?')}</h3>}
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Weights come from your last workout in the same gym, so a lighter machine does not start you too heavy.')}
    </div>

    <div className="list" style={{ gap: 0 }}>
      {gyms.map(g => <div key={g.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 8 }}>
        {editing
          ? <>
              <TextField value={renaming[g.id] ?? g.name} maxLength={GYM_NAME_MAX} style={{ flex: 1 }} aria-label={t('Gym name')}
                onChange={e => setRenaming(r => ({ ...r, [g.id]: e.target.value }))} onBlur={() => rename(g)} />
              <button className="iconbtn" style={{ color: 'var(--red)' }} aria-label={t('Delete gym')} onClick={() => remove(g)}><Icon name="trash" /></button>
            </>
          : <button type="button" className="row between grow" style={{ padding: '6px 0', textAlign: 'left' }} onClick={() => !manage && choose(g.id)}>
              <span><b>{g.name}</b></span>
              {current === g.id && <Icon name="check" />}
            </button>}
      </div>)}
      {!gyms.length && <div className="muted small" style={{ padding: '10px 2px' }}>{t('No gym yet. Add the ones you train at.')}</div>}
    </div>

    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <TextField value={name} maxLength={GYM_NAME_MAX} placeholder={t('New gym (Basic-Fit, Gigafit…)')} style={{ flex: 1, minWidth: 0 }} aria-label={t('New gym')}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <Button variant="primary" style={{ width: 'auto', flexShrink: 0 }} onClick={add}>{t('Add')}</Button>
    </div>

    {gyms.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
      <Button size="sm" variant="ghost" onClick={() => setEditing(e => !e)}>{editing ? t('Done') : t('Edit gyms')}</Button>
    </div>}

    {!manage && allowNone && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => choose(null)}>{required ? t('Start without a gym') : t('No gym')}</Button>
    </>}
  </>
}

/**
 * Opens the picker. `onPick(id | null)` runs once a gym (or "no gym") is chosen. `manage` is the
 * Settings version: the list is edited and nothing is picked. `required` is the start-of-workout
 * one, locked like the weigh-in so a stray tap cannot dismiss it.
 */
export function gymSheet({ current = null, required = false, manage = false, allowNone = true, onPick } = {}) {
  return useUI.getState().openSheet(close => <GymSheet current={current} required={required} manage={manage} allowNone={allowNone} onPick={onPick} close={close} />, { locked: !!required })
}

export default GymSheet
