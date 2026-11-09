// Resistance bands (lib/bands.js, Reddit): the chips under a set that say which bands it was done
// with, the same chips for a plan slot's starting bands, and the editor for your own bands
// (Settings → Equipment → Resistance bands).
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { bandsOf, cleanBands, starterBands, newBandId, setBandsOf, bandLabel, BAND_COLORS, BAND_NAME_MAX, BAND_LEVEL_MAX, MAX_BANDS } from '../lib/bands.js'
import { Button, TextField, NumberField } from './ui.jsx'
import Icon from './Icon.jsx'

const KG_PER_LB = 0.45359237
const update = (...a) => useStore.getState().update(...a)

/**
 * One chip per band; a tap picks or unpicks it. `value` is the picked ids, `onToggle(id)` the
 * tap. Without any bands yet, one chip that opens the editor instead.
 */
export function BandChips({ value, onToggle, className = '', label }) {
  const list = useStore(s => s.S.bands)
  const bands = bandsOf({ bands: list })
  const picked = new Set(value || [])
  if (!bands.length) {
    return <div className={'bandchips ' + className}>
      <button type="button" className="chip add" onClick={() => bandsSheet()}><Icon name="plus" />{t('Add your bands')}</button>
    </div>
  }
  return <div className={'bandchips ' + className} role="group" aria-label={label || t('Bands')}>
    {bands.map(b => (
      <button key={b.id} type="button" className={'chip band nocap' + (picked.has(b.id) ? ' on-band' : '')}
        style={{ '--band': b.color }} aria-pressed={picked.has(b.id)} onClick={() => onToggle(b.id)}>
        <span className="banddot" aria-hidden="true" />{b.name}{b.level && <span className="band-lvl">{b.level}</span>}
      </button>
    ))}
  </div>
}

/**
 * A text field that keeps what is typed while typing. Every keystroke saves, and saving trims
 * (cleanBand), so a space vanished the moment it was typed ("Level 3" came out "Level3") and an
 * emptied name snapped back to the old one (night QA 146). The draft shows until the field is left.
 */
function DraftField({ value, onSave, ...rest }) {
  const [draft, setDraft] = useState(null)
  return <TextField className="input" {...rest} value={draft ?? value}
    onChange={e => { setDraft(e.target.value); onSave(e.target.value) }} onBlur={() => setDraft(null)} />
}

/** The editor: your bands, lightest first. Order is what "a heavier band" means to progression. */
function BandsSheet({ close }) {
  const S = useStore(s => s.S)
  const lb = S.unit === 'lb'
  const bands = bandsOf(S)
  const [editing, setEditing] = useState(null)
  const save = list => update(s => { s.bands = cleanBands(list) })
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= bands.length) return
    const next = bands.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  const patch = (id, p) => save(bands.map(b => (b.id === id ? { ...b, ...p } : b)))
  const add = () => {
    const id = newBandId(bands)
    save([...bands, { id, name: t('Band {0}', bands.length + 1), color: BAND_COLORS[bands.length % BAND_COLORS.length] }])
    setEditing(id)
  }
  // Resistance is stored in kg like every weight; shown and typed in the profile's unit.
  const shown = kg => (kg > 0 ? Math.round((lb ? kg / KG_PER_LB : kg) * 10) / 10 : null)
  const stored = v => (Number(v) > 0 ? (lb ? Number(v) * KG_PER_LB : Number(v)) : undefined)
  return <>
    <h3>{t('Resistance bands')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Lightest at the top. Tap a band under a set to say you used it, two at once if you doubled up. When every set hits the top of its reps, the next session hands you the next band.')}
    </div>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('No colours on yours? Name them by level instead, like “Level 3”, and keep the grey.')}</div>
    {bands.length > 0 && <div className="list menu-list bandlist" style={{ marginBottom: 12 }}>
      {bands.map((b, i) => <div key={b.id} className="bandrow">
        <button type="button" className="bandrow-main" aria-expanded={editing === b.id} onClick={() => setEditing(editing === b.id ? null : b.id)}>
          <span className="banddot big" style={{ '--band': b.color }} aria-hidden="true" />
          <span className="bandrow-name">{bandLabel(b)}</span>
          <span className="dim small">{b.kg > 0 ? `${fmtNum(shown(b.kg))} ${S.unit}` : ''}</span>
        </button>
        <button type="button" className="iconbtn" aria-label={t('Move {0} up', b.name)} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
        <button type="button" className="iconbtn" aria-label={t('Move {0} down', b.name)} disabled={i === bands.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
        {editing === b.id && <div className="bandedit">
          <DraftField value={b.name} maxLength={BAND_NAME_MAX} aria-label={t('Name')}
            onSave={v => { if (v.trim()) patch(b.id, { name: v }) }} />
          <DraftField value={b.level || ''} maxLength={BAND_LEVEL_MAX} aria-label={t('Level or strength (optional)')}
            placeholder={t('Level or strength (optional), like “Heavy”')} onSave={v => patch(b.id, { level: v })} />
          <div className="bandswatches" role="radiogroup" aria-label={t('Colour')}>
            {BAND_COLORS.map(c => <button key={c} type="button" role="radio" aria-checked={b.color === c} aria-label={c}
              className={'bandswatch' + (b.color === c ? ' on' : '')} style={{ '--band': c }} onClick={() => patch(b.id, { color: c })} />)}
          </div>
          <NumberField className="input" decimal value={shown(b.kg) ?? ''} placeholder={t('Resistance ({0}, optional)', S.unit)}
            aria-label={t('Resistance ({0}, optional)', S.unit)} onChange={v => patch(b.id, { kg: stored(v) })} />
          <Button variant="danger" size="sm" icon="trash" onClick={() => { save(bands.filter(x => x.id !== b.id)); setEditing(null) }}>{t('Remove {0}', b.name)}</Button>
        </div>}
      </div>)}
    </div>}
    {!bands.length && <Button onClick={() => save(starterBands())} style={{ marginBottom: 8 }}>{t('Start with the usual five')}</Button>}
    {bands.length < MAX_BANDS && <Button icon="plus" onClick={add} style={{ marginBottom: 8 }}>{t('Add a band')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const bandsSheet = () => useUI.getState().openSheet(close => <BandsSheet close={close} />)

/** "Red + Yellow" as dots, for a plan line or a summary. */
export function BandDots({ ids }) {
  const list = useStore(s => s.S.bands)
  const m = new Map(bandsOf({ bands: list }).map(b => [b.id, b]))
  const picked = setBandsOf({ bands: ids })
  if (!picked.length) return null
  return <span className="banddots" aria-hidden="true">{picked.map(id => <span key={id} className="banddot" style={{ '--band': m.get(id)?.color || '#8d8d8d' }} />)}</span>
}
