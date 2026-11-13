// "Which machines does your gym have?" (#923): the machine cards of an equipment profile, and the
// one-tap "Not at my gym" that builds the same list while you use the app. The rules live in
// lib/machine-kinds.js; this is only how they are shown.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { nameIn } from '../lib/a11y-name.js'
import { exerciseNameText } from '../lib/format.js'
import {
  MACHINE_GROUPS, MACHINE_KINDS, KIND_IDS, KIND_BY_ID, KIND_COUNT, searchKinds, withoutKind, removableKind,
} from '../lib/machine-kinds.js'
import Icon from './Icon.jsx'
import { Button, SearchField } from './ui.jsx'

function MachinePicker({ gymName, initial, onDone, close }) {
  const [on, setOn] = useState(() => new Set(initial))
  const [q, setQ] = useState('')
  const shown = new Set(searchKinds(q).map(k => k.id))
  const toggle = id => setOn(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const setGroup = (ids, v) => setOn(s => { const n = new Set(s); ids.forEach(id => (v ? n.add(id) : n.delete(id))); return n })
  const everything = on.size === KIND_IDS.length
  const save = () => { onDone(KIND_IDS.filter(id => on.has(id))); close() }
  return <>
    <h3>{gymName ? t('Which machines does {0} have?', gymName) : t('Which machines does your gym have?')}</h3>
    <p className="small dim" style={{ margin: '0 0 12px' }}>
      {t('Tap the ones that are there. The rest stop turning up in the picker, swaps, plans and the Coach.')}
    </p>
    <div className="picker-search mk-search">
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')}
        placeholder={t('Search machines, like leg press or LP')} aria-label={t('Search machines')} />
    </div>
    <div className="row" style={{ gap: 8, margin: '10px 0 2px' }}>
      <span className="small dim" role="status" style={{ flex: 1 }}>{t('{0} of {1} picked', on.size, KIND_IDS.length)}</span>
      <Button size="sm" variant="ghost" onClick={() => setOn(new Set(everything ? [] : KIND_IDS))}>
        {everything ? t('Clear all') : t('Pick all')}
      </Button>
    </div>
    {MACHINE_GROUPS.map(g => {
      const kinds = MACHINE_KINDS.filter(k => k.group === g.id && shown.has(k.id))
      if (!kinds.length) return null
      const ids = kinds.map(k => k.id)
      const all = ids.every(id => on.has(id)), none = !ids.some(id => on.has(id))
      return <section key={g.id} aria-label={g.label()}>
        <div className="mk-gh">
          <h4 className="sec">{g.label()}</h4>
          <button type="button" className="mk-gb" disabled={all} onClick={() => setGroup(ids, true)}
            aria-label={t('All of {0}', g.label())}>{t('All')}</button>
          <button type="button" className="mk-gb" disabled={none} onClick={() => setGroup(ids, false)}
            aria-label={t('None of {0}', g.label())}>{t('None')}</button>
        </div>
        <div className="mk-grid">
          {kinds.map(k => {
            const isOn = on.has(k.id)
            return <button key={k.id} type="button" className={'mk-card' + (isOn ? ' on' : '')} aria-pressed={isOn} onClick={() => toggle(k.id)}>
              <span className="mk-ic" aria-hidden="true"><Icon name={k.icon} /></span>
              <span className="mk-tx">
                <span className="mk-n">{k.label()}</span>
                <span className="mk-c">{tn('{0} exercise', '{0} exercises', KIND_COUNT[k.id] || 0)}</span>
              </span>
              <span className="mk-ck" aria-hidden="true">{isOn && <Icon name="check" />}</span>
            </button>
          })}
        </div>
      </section>
    })}
    {!shown.size && <div className="empty">{t('No machine by that name. “All other machines” has the odd ones.')}</div>}
    <div className="mk-foot">
      <Button variant="primary" onClick={save}>{t('Save')}</Button>
    </div>
  </>
}

/** Opens the machine cards. `onDone(kinds)` gets the ticked kind ids (none ticked = no machines). */
export const machinePickerSheet = ({ gymName, initial, onDone }) =>
  useUI.getState().openSheet(close => <MachinePicker gymName={gymName} initial={initial} onDone={onDone} close={close} />)

/**
 * "Not at my gym": takes the exercise's machine out of profile `profileId`, with Undo. The undo
 * puts back exactly the two fields it changed (the machine list and the machine equipment values).
 */
export function notAtMyGym(profileId, ex) {
  const st = useStore.getState()
  const p = (st.S.equipProfiles || []).find(x => x && x.id === profileId)
  const kind = removableKind(p, ex)
  const next = kind && withoutKind(p, kind)
  if (!next) return false
  const before = { equipment: p.equipment, had: 'machines' in p, machines: p.machines }
  st.update(s => {
    const q = (s.equipProfiles || []).find(x => x && x.id === profileId)
    if (q) { q.equipment = next.equipment; q.machines = next.machines }
  })
  const name = KIND_BY_ID[kind].label()
  useUI.getState().toast(t('{0}: not at {1}. Got it.', name, p.name || t('My gym')), {
    action: t('Undo'),
    onAction: () => useStore.getState().update(s => {
      const q = (s.equipProfiles || []).find(x => x && x.id === profileId)
      if (!q) return
      q.equipment = before.equipment
      if (before.had) q.machines = before.machines; else delete q.machines
    }),
  })
  return true
}

/** The small "Not at my gym" button beside a machine exercise, when there is one to take out. */
export function NotHereButton({ profile, ex, onDone }) {
  const kind = removableKind(profile, ex)
  if (!kind) return null
  const label = t('Not at my gym: {0}', KIND_BY_ID[kind].label())
  // One per row of a list, so a screen reader hears the exercise first (P4).
  return <button type="button" className="iconbtn mk-not" aria-label={nameIn(exerciseNameText(ex), label)} title={label}
    onClick={ev => { ev.stopPropagation(); if (notAtMyGym(profile.id, ex)) onDone?.() }}>
    <Icon name="machineOff" />
  </button>
}
