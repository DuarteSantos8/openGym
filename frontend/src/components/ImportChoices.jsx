// The import summary's "Check and choose" part (#931, #849): every exercise name in the file with
// what it becomes, a tick to leave one out, the dates to bring, and whether the notes and effort
// ratings come along. Nothing here writes to the store; the summary reads the file again with the
// choices (lib/import-choices.js) and Import does the rest.
import { useState } from 'react'
import { EXIDX } from '../lib/exercises.js'
import { t, tn, exerciseNameFor } from '../lib/i18n.js'
import { Check, Switch } from './ui.jsx'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'

/** The state the choices start from: everything in, nothing picked. */
export const freshChoices = () => ({ picks: new Map(), skip: new Set(), from: '', to: '', notes: true, effort: true })
export const choicesChanged = c => !!(c.picks.size || c.skip.size || c.from || c.to || c.notes === false || c.effort === false)

// What a name becomes, in words: the library exercise, one of yours, or a new one of your own.
function matchLabel(id) {
  const ex = id && EXIDX[id]
  if (!ex) return { text: t('a new exercise of your own') }
  return { text: ex.custom ? t('your own “{0}”', exerciseNameFor(ex)) : exerciseNameFor(ex) }
}

/**
 * names: lib/import-choices.js combineNames. remembered: Set of name keys a remembered pick
 * (another name you gave an exercise) steers. bounds: the whole file's { from, to }.
 * onMenu(opts) opens a menu sheet, onLibrary(cb) the exercise picker; both from sheets.jsx, so this
 * file does not import the sheets it sits in.
 */
export default function ImportChoices({ names, choices, setChoices, remembered, bounds, notesSeen, effortSeen, onMenu, onLibrary }) {
  const [open, setOpen] = useState(false)
  const set = patch => setChoices(c => ({ ...c, ...patch }))
  const withSets = names.filter(n => n.sets > 0)
  const kept = withSets.filter(n => !choices.skip.has(n.key)).length
  const picked = names.filter(n => choices.picks.has(n.key) || remembered.has(n.key)).length

  const pick = (n, id) => {
    const picks = new Map(choices.picks)
    picks.set(n.key, { name: n.name, id })
    set({ picks })
  }
  const menu = n => onMenu({
    title: n.name, titleClass: 'capitalize',
    items: [
      { icon: 'magnifier', label: t('Pick from the library'), onClick: () => onLibrary(ex => pick(n, ex.id)) },
      { icon: 'person', label: t('Keep it as your own exercise'), onClick: () => pick(n, null) },
      (choices.picks.has(n.key) || remembered.has(n.key)) && { icon: 'undo', label: t('Use the automatic match'), onClick: () => pick(n, 'auto') },
    ],
  })
  const toggle = (n, on) => {
    const skip = new Set(choices.skip)
    if (on) skip.delete(n.key); else skip.add(n.key)
    set({ skip })
  }
  const all = kept < withSets.length

  const summary = [
    tn('{0} exercise', '{0} exercises', names.length),
    withSets.length - kept > 0 ? t('Left out: {0}', withSets.length - kept) : '',
    picked ? t('Picked by you: {0}', picked) : '',
  ].filter(Boolean).join(', ')

  return <div className="imp-choices">
    <button type="button" className="item imp-choices-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="lrow-i"><Icon name="list" /></span>
      <span className="grow"><span className="tt">{t('Check and choose')}</span><span className="ss">{summary}</span></span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="menu-chev" />
    </button>
    {open && <div className="imp-choices-b">
      {bounds.from && bounds.to && bounds.from !== bounds.to && <>
        <div className="row between plan-sec-h">
          <h4 className="sec">{t('Dates')}</h4>
          {(choices.from || choices.to) && <button type="button" className="plan-textbtn" onClick={() => set({ from: '', to: '' })}>{t('All dates')}</button>}
        </div>
        <div className="row imp-dates">
          <DateField compact label={t('From')} value={choices.from || bounds.from} min={bounds.from} max={choices.to || bounds.to}
            onChange={d => set({ from: d === bounds.from ? '' : d })} />
          <span className="dim" aria-hidden="true">–</span>
          <DateField compact label={t('To')} value={choices.to || bounds.to} min={choices.from || bounds.from} max={bounds.to}
            onChange={d => set({ to: d === bounds.to ? '' : d })} />
        </div>
      </>}
      {(notesSeen > 0 || effortSeen > 0) && <div className="imp-switches">
        {notesSeen > 0 && <div className="row between imp-switch">
          <span>{t('Bring the notes')}</span>
          <Switch checked={choices.notes !== false} onChange={v => set({ notes: v })} aria-label={t('Bring the notes')} />
        </div>}
        {effortSeen > 0 && <div className="row between imp-switch">
          <span>{t('Bring the RPE and RIR ratings')}</span>
          <Switch checked={choices.effort !== false} onChange={v => set({ effort: v })} aria-label={t('Bring the RPE and RIR ratings')} />
        </div>}
      </div>}
      <div className="row between plan-sec-h">
        <h4 className="sec">{t('Exercises in the file')}</h4>
        {withSets.length > 1 && <button type="button" className="plan-textbtn"
          onClick={() => set({ skip: all ? new Set() : new Set(withSets.map(n => n.key)) })}>{all ? t('Select all') : t('Select none')}</button>}
      </div>
      <div className="list imp-names">
        {names.map(n => {
          const m = matchLabel(n.id)
          const mine = choices.picks.has(n.key) ? choices.picks.get(n.key).id !== 'auto' : remembered.has(n.key)
          const off = choices.skip.has(n.key)
          return <div key={n.key} className={'item tap-host imp-name' + (off ? ' is-off' : '')}>
            {n.sets > 0 && <Check checked={!off} onChange={on => toggle(n, on)} label={t('Import {0}', n.name)} />}
            <button type="button" className="grow item-open tap-main" onClick={() => menu(n)}
              aria-label={t('{0}: change what it becomes', n.name)}>
              <span className="tt capitalize">{n.name}</span>
              <span className="ss">
                {t('Becomes {0}', m.text)}
                {mine && <span className="tag imp-pick">{t('your pick')}</span>}
              </span>
            </button>
            {n.sets > 0 && <span className="small dim imp-sets">{tn('{0} set', '{0} sets', n.sets)}</span>}
            <Icon name="chevronRight" className="menu-chev" />
          </div>
        })}
      </div>
      <p className="sect-f">{t('A pick is remembered as another name of that exercise, so the next import finds it too.')}</p>
    </div>}
  </div>
}
