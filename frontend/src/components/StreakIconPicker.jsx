import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { pickerChoices, keyFor, inkFor, iconChoice, pickValue, firstEmoji, EMOJI_IDEAS } from '../lib/streak-icons.js'
import { StreakFlame, Freezes, FreezeGlyph } from './Streak.jsx'
import Icon from './Icon.jsx'
import { Button, Row } from './ui.jsx'

/* Settings → Look & Home → Icons → Streak flame / Streak freeze: pick one of openGym's icons or
   any emoji. It applies at once (and syncs, S.flameIcon / S.freezeIcon), the preview on top
   shows it with the tints worked out from its colour (lib/streak-icons.js), Reset puts the
   default back. */

const NAMES = () => ({
  flame: t('Flame'), bolt: t('Bolt'), starFill: t('Star'), heart: t('Heart'), rocket: t('Rocket'), crown: t('Crown'),
  trophy: t('Trophy'), sun: t('Sun'), dumbbell: t('Dumbbell'), kettlebell: t('Kettlebell'), flameHat: t('Festive flame'),
  snowflake: t('Snowflake'), shield: t('Shield'), cloud: t('Cloud'), moon: t('Moon'), hourglass: t('Hourglass'), tree: t('Tree'), gift: t('Gift'),
})
const title = kind => (kind === 'freeze' ? t('Streak freeze') : t('Streak flame'))

/** The small preview of a choice, for the Settings row's value. */
export function StreakIconValue ({ kind }) {
  const own = iconChoice(useStore(s => s.S), kind)
  return <span className={'sip-val' + (own ? ' is-own' : '')}>
    {kind === 'freeze' ? <FreezeGlyph /> : <StreakFlame />}
  </span>
}

/** The two rows under Icons. */
export function StreakIconRows () {
  return <>
    {['flame', 'freeze'].map(kind => <Row key={kind} icon={kind === 'freeze' ? 'snowflake' : 'flame'} iconTint={kind === 'freeze' ? 'var(--teal)' : 'var(--orange)'}
      title={title(kind)} value={<StreakIconValue kind={kind} />} accessory="chevron"
      onClick={() => useUI.getState().openSheet(close => <StreakIconPicker kind={kind} close={close} />)} />)}
  </>
}

export function StreakIconPicker ({ kind }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const own = iconChoice(S, kind)
  const [typed, setTyped] = useState(own?.k === 'emoji' ? own.v : '')
  const [bad, setBad] = useState(false)
  const key = keyFor(kind)
  const set = pick => {
    const v = pickValue(kind, pick)
    update(s => { if (v) s[key] = v; else delete s[key] })
  }
  const onType = e => {
    const raw = e.target.value
    setTyped(raw)
    const em = firstEmoji(raw)
    setBad(!!raw.trim() && !em)
    if (em) set({ k: 'emoji', v: em })
  }
  const current = own ? own.k + ':' + own.v : 'def'
  const names = NAMES()
  return <div className="sip">
    <h3>{title(kind)}</h3>
    {/* The preview: the streak line and a frozen week, tinted from the pick, in this theme. */}
    <div className="sip-preview" aria-hidden="true">
      <div className="sip-p-line"><StreakFlame /><b>{t('{0} week streak', 12)}</b><Freezes n={2} /></div>
      <div className="sip-p-week">
        {Array.from({ length: 7 }, (_, i) => <span key={i} className="cal-d wk-frozen"><span>{i + 13}</span></span>)}
        <span className="cal-wk"><span className="wk-frz"><FreezeGlyph /></span></span>
      </div>
    </div>
    <div className="small muted sip-cap">{t('The colors around it follow your pick, in light and dark.')}</div>

    <div className="sip-h small muted">{t('openGym icons')}</div>
    <div className="glyph-grid sip-grid" role="radiogroup" aria-label={t('openGym icons')}>
      {pickerChoices(S, kind).map(ch => {
        const on = ch.def ? current === 'def' : current === 'icon:' + ch.v
        return <button key={ch.v} type="button" role="radio" aria-checked={on} aria-label={names[ch.v] || t('Default')}
          className={'glyph-cell sip-cell' + (on ? ' on' : '')} style={{ '--sip-c': ch.c, '--sip-cl': inkFor(ch.c, 'light') }}
          onClick={() => { setTyped(''); setBad(false); set(ch.def ? null : { k: 'icon', v: ch.v }) }}>
          {ch.def && kind === 'flame' ? <StreakFlame plain /> : <Icon name={ch.v} />}
        </button>
      })}
    </div>

    <div className="sip-h small muted">{t('Or any emoji')}</div>
    <div className="sip-emoji">
      {EMOJI_IDEAS[kind].map(e => <button key={e} type="button" className={'glyph-cell sip-cell sip-e' + (current === 'emoji:' + e ? ' on' : '')}
        aria-pressed={current === 'emoji:' + e} onClick={() => { setTyped(e); setBad(false); set({ k: 'emoji', v: e }) }}>{e}</button>)}
    </div>
    <input className="input sip-input" value={typed} onChange={onType} maxLength={24} inputMode="text" autoComplete="off"
      aria-label={t('Or any emoji')} placeholder={t('Type or paste an emoji')} aria-invalid={bad} aria-describedby={bad ? 'sip-bad' : undefined} />
    {bad && <div id="sip-bad" className="small sip-bad" role="status">{t('That one is not an emoji. Any emoji works, letters do not.')}</div>}

    <div style={{ height: 14 }} />
    <Button icon="reset" disabled={!own} onClick={() => { setTyped(''); setBad(false); set(null) }}>{t('Reset to default')}</Button>
  </div>
}
