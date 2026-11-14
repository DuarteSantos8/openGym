// A routine's colour and icon on one sheet: twelve colours, then the glyph groups. The tile shows
// the pending choice; nothing is written until Done.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { ROUTINE_COLORS, colorOf, tileStyle } from '../lib/routine-colors.js'
import { glyphOf, GLYPH_GROUPS } from '../lib/glyphs.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

// Literal t() calls so the string checks see every name.
const colourName = c => ({
  blue: t('Blue'), indigo: t('Indigo'), purple: t('Purple'), pink: t('Pink'), red: t('Red'), orange: t('Orange'),
  yellow: t('Yellow'), green: t('Green'), mint: t('Mint'), teal: t('Teal'), brown: t('Brown'), grey: t('Grey'),
})[c]

function LookSheet({ id, close }) {
  const r = useStore(s => s.S.routines.find(x => x.id === id))
  const update = useStore(s => s.update)
  const [color, setColor] = useState(colorOf(r))
  const [glyph, setGlyph] = useState(glyphOf(r?.emoji))
  if (!r) return null
  const save = () => {
    update(s => {
      const x = s.routines.find(y => y.id === id)
      if (!x) return
      x.emoji = glyph
      if (color) x.color = color; else delete x.color
    })
    close()
  }
  return <>
    <div className="look-hd">
      <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
      <h3>{t('Colour and icon')}</h3>
      <Button variant="ghost" onClick={save}>{t('Done')}</Button>
    </div>
    <div className="look-prev">
      <span className="lrow-i look-tile" style={tileStyle({ color })}><Icon name={glyph} /></span>
      <div className="look-name">{r.name}</div>
    </div>
    <div className="look-sw">
      {ROUTINE_COLORS.map(c => (
        <button key={c} type="button" data-swatch className={'look-s' + (c === color ? ' on' : '')} aria-label={colourName(c)} aria-pressed={c === color} onClick={() => setColor(c)}>
          <span style={{ background: `var(--${c})`, color: `var(--on-${c})` }}>{c === color && <Icon name="check" />}</span>
        </button>
      ))}
    </div>
    <div className="look-cn" data-colour-name>{color ? colourName(color) : ''}</div>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} type="button" className={'glyph-cell' + (n === glyph ? ' on' : '')} aria-label={n} aria-pressed={n === glyph}
              style={n === glyph && color ? { background: `var(--${color})`, color: `var(--on-${color})` } : undefined}
              onClick={() => setGlyph(n)}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
  </>
}

export const routineLookSheet = id => useUI.getState().openSheet(close => <LookSheet id={id} close={close} />)
