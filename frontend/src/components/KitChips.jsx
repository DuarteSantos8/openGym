import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { cleanKit, cleanKitName, KIT_MAX, KIT_NAME_MAX } from '../lib/equipment.js'
import Icon from './Icon.jsx'

/* Your own kit (lib/equipment.js, #323): chips for every piece in use, ticked when this profile has
   it or this exercise needs it, and a field to name a new one. Used by the equipment profile sheet
   and the custom exercise form. */
export default function KitChips ({ value, onChange, known = [], label }) {
  const [draft, setDraft] = useState('')
  const on = new Set(value.map(v => v.toLowerCase()))
  const all = cleanKit([...known, ...value])
  const flip = n => onChange(on.has(n.toLowerCase()) ? value.filter(v => v.toLowerCase() !== n.toLowerCase()) : cleanKit([...value, n]))
  const add = () => {
    const n = cleanKitName(draft)
    if (!n) return
    onChange(cleanKit([...value, n]))
    setDraft('')
  }
  return <div className="kit" data-kit>
    {label && <div className="small dim" style={{ marginBottom: 6 }}>{label}</div>}
    {all.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>
      {all.map(n => <button key={n} type="button" className={'chip nocap' + (on.has(n.toLowerCase()) ? ' on' : '')} aria-pressed={on.has(n.toLowerCase())} onClick={() => flip(n)}>{n}</button>)}
    </div>}
    {value.length < KIT_MAX && <form className="kit-add" onSubmit={e => { e.preventDefault(); add() }}>
      <input className="input" value={draft} maxLength={KIT_NAME_MAX} placeholder={t('Name your own, like “Sandbag”')}
        aria-label={t('Add your own kit')} onChange={e => setDraft(e.target.value)} enterKeyHint="done" />
      <button type="submit" className="iconbtn" aria-label={t('Add your own kit')} disabled={!cleanKitName(draft)}><Icon name="plus" /></button>
    </form>}
  </div>
}
