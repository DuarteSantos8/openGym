import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

/**
 * A strip of group chips (lib/equipment-groups.js): a tap on a group filters by all of it, the
 * chevron at its right edge opens a second strip of its kinds, each filtering by itself. A group
 * of one kind is a plain chip of that kind. `value` is '' (any), a kind or a group's value
 * (`gv(id)`, read back by `gidOf`); `kindGroup(k)` is a kind's group. A tap on the chosen chip
 * goes back a step: a kind to its group, a group to any.
 */
export function GroupStrip({ groups, value, onChange, anyLabel, gv, gidOf, kindGroup, kindLabel = k => t(k), style }) {
  // A chosen kind's group is open, so the chosen chip is in sight: at first, and whenever the
  // kind lands in a group of several (another body part's list), until the chevron shuts it.
  const kindIn = value && !gidOf(value) ? kindGroup(value) : null
  const hidden = !!kindIn && groups.some(g => g.id === kindIn && g.kinds.length > 1)
  const [open, setOpen] = useState(kindIn)
  useEffect(() => { if (hidden) setOpen(kindIn) }, [value, hidden]) // eslint-disable-line react-hooks/exhaustive-deps
  const sub = groups.find(g => g.id === open && g.kinds.length > 1)
  // The group a chosen kind belongs to is outlined, so the choice shows with its strip shut too.
  const holds = id => !!value && !gidOf(value) && kindGroup(value) === id
  return <>
    <div className="chips" style={{ ...style, marginBottom: sub ? 6 : style?.marginBottom }}>
      <button className={'chip nocap' + (!value ? ' on' : '')} onClick={() => onChange('')}>{anyLabel}</button>
      {groups.map(g => {
        if (g.kinds.length === 1) {
          const k = g.kinds[0]
          return <button key={g.id} className={'chip' + (value === k ? ' on' : '')} aria-pressed={value === k}
            onClick={() => onChange(value === k ? '' : k)}>{kindLabel(k)}</button>
        }
        const v = gv(g.id)
        const label = t(g.label)
        const shown = sub?.id === g.id
        return <span key={g.id} className={'chip gchip' + (value === v ? ' on' : holds(g.id) ? ' some' : '')}>
          <button type="button" className="gchip-t" aria-pressed={value === v} onClick={() => onChange(value === v ? '' : v)}>{label}</button>
          <button type="button" className="gchip-x" aria-expanded={shown}
            aria-label={shown ? t('Hide {0}', label) : t('Show {0}', label)}
            onClick={() => setOpen(o => (o === g.id ? null : g.id))}><Icon name={shown ? 'chevronUp' : 'chevronDown'} /></button>
        </span>
      })}
    </div>
    {sub && <div className="chips gchip-strip" style={{ marginBottom: style?.marginBottom }}>
      {sub.kinds.map(k => <button key={k} className={'chip' + (value === k ? ' on' : '')} aria-pressed={value === k}
        onClick={() => onChange(value === k ? gv(sub.id) : k)}>{kindLabel(k)}</button>)}
    </div>}
  </>
}
