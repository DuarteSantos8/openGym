// The sheet a set's number opens, like Hevy's "Select set type": warm-up (W), normal set (its
// number), taken to failure (F) and remove. The current type carries a check. Anything else a
// set can do (its own rest, a drop, copy) sits behind "More options", so the four you use every
// session come first. The glyphs are the ones the row itself shows (Workout.jsx, .n.warm/.fail).
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

export default function SetTypeSheet({ title, num, current, canWarmup, canFailure, canRemove, onPick, onRemove, onMore, close }) {
  const pick = fn => () => { close(); fn() }
  const row = ({ key, glyph, glyphClass, label, sub, on, disabled, danger, onClick }) => (
    <div key={key}
      className={'item menu-item settype-item' + (danger ? ' danger' : '') + (disabled ? ' disabled' : '') + (on ? ' on' : '')}
      aria-disabled={disabled || undefined} aria-pressed={on != null ? !!on : undefined}
      {...tappable(disabled ? null : onClick)}>
      <span className={'settype-g ' + glyphClass} aria-hidden="true">{glyph}</span>
      <div className="grow"><div className="tt">{label}</div>{sub && <div className="ss">{sub}</div>}</div>
      {on != null && <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>}
    </div>
  )
  return <>
    <h3 style={{ marginBottom: 10, textAlign: 'center' }}>{t('Select the set type')}</h3>
    {title && <div className="muted small" style={{ marginTop: -6, marginBottom: 10, textAlign: 'center' }}>{title}</div>}
    <div className="list menu-list settype">
      {row({ key: 'w', glyph: t('W'), glyphClass: 'warm', label: t('Warm-up set'), sub: t('To build up to your working weight'),
        on: current === 'warmup', disabled: current !== 'warmup' && !canWarmup, onClick: pick(() => onPick('warmup')) })}
      {row({ key: 'n', glyph: current === 'normal' ? num : '1', glyphClass: 'norm', label: t('Normal set'),
        on: current === 'normal', onClick: pick(() => onPick('normal')) })}
      {canFailure && row({ key: 'f', glyph: t('F'), glyphClass: 'fail', label: t('Set to failure'), sub: t('Nothing left in the tank'),
        on: current === 'failure', onClick: pick(() => onPick('failure')) })}
      {row({ key: 'x', glyph: <Icon name="xmark" />, glyphClass: 'del', label: t('Remove the set'), danger: true,
        disabled: !canRemove, onClick: pick(onRemove) })}
    </div>
    {onMore && <div className="list menu-list" style={{ marginTop: 12 }}>
      <div className="item menu-item" {...tappable(pick(onMore))}>
        <span className="lrow-i"><Icon name="more" /></span>
        <div className="grow"><div className="tt">{t('More options')}</div><div className="ss">{t('Rest, copy and more')}</div></div>
        <Icon name="chevronRight" className="menu-chev" />
      </div>
    </div>}
  </>
}
