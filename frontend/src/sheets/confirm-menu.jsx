import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { ui } from './shared.js'

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, onCancel, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); onCancel && onCancel() }}>{cancelText || t('Cancel')}</Button>
  </div>
}
// "1 workouts and 1 weigh-ins" read wrong: a count of one takes the singular, per noun. Four
// whole sentences rather than two spliced counts, so every language keeps its own word order.
export function addDeviceDataMessage(workouts, weighIns) {
  const one = n => Number(n) === 1
  return one(workouts)
    ? one(weighIns)
      ? t('{0} workout and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workout and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
    : one(weighIns)
      ? t('{0} workouts and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workouts and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
}
// Sign-in found workouts on this device that the profile does not have (logged while signed
// out). The profile is the truth — settings and plan come from the server either way — the
// question is only whether these entries are added to it or dropped. Resolves true to add.
// Routines and the rest of a plan made here while signed out: asked about as well (they come along
// with "Add them"), in their own words when there is nothing else.
export function addDeviceSetupMessage(routines) {
  const n = Number(routines) || 0
  return n === 0
    ? t('Your plan, notes or gym cards on this device were set up while signed out. Add them to your profile, or keep the profile exactly as it is on the server.')
    : n === 1
      ? t('{0} routine was made on this device while signed out. Add it to your profile, or keep the profile exactly as it is on the server.', n)
      : t('{0} routines were made on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', n)
}
export function askAddDeviceData(extras) {
  const logged = extras.workouts || extras.bodyweight || extras.customEx
  return new Promise(resolve => confirmSheet({
    title: logged ? t('Add this device\'s workouts to your profile?') : t('Add this device\'s plan to your profile?'),
    message: logged ? addDeviceDataMessage(extras.workouts, extras.bodyweight) : addDeviceSetupMessage(extras.routines),
    confirmText: t('Add them'), cancelText: t('Keep profile as is'),
    onConfirm: () => resolve(true), onCancel: () => resolve(false), locked: true
  }))
}
/* ============================ menu sheet ============================ */
// A list of actions, one per row, closing on tap. This is where the workout screen parks
// everything that is not a set you are about to log: the point of a single "more" button is
// that the ten things you do once a session stop competing with the two you do every set.
// items: [{ icon, label, sub, onClick, danger, disabled, on }] — `on` draws a check for toggles.
// sections: [{ title, items }] instead of `items` splits a longer menu into groups, each with an
// optional small header; a group whose items are all falsy is left out, header and all.
// `accent` tints a row's icon, for the one entry a menu leads with.
// A title is shown as written: most are sentences ("Convert to lb?", "Set 2"), which a default
// title-casing turned into "Convert To Lb?". An exercise name passes exerciseNameClass as
// titleClass, which title-cases the lower-case packs and leaves a cased one alone.
function MenuSheet({ title, titleClass = '', subtitle, items, sections, close }) {
  const groups = (sections || [{ items }])
    .map(g => ({ title: g.title, items: (g.items || []).filter(Boolean) }))
    .filter(g => g.items.length)
  return <>
    {title && <h3 className={titleClass || undefined} style={{ marginBottom: subtitle ? 2 : 10 }}>{title}</h3>}
    {subtitle && <div className="muted small" style={{ marginBottom: 10 }}>{subtitle}</div>}
    {groups.map((g, gi) => <div key={gi} className={'menu-group' + (sections ? ' grouped' : '')}>
      {g.title && <div className="menu-sec">{g.title}</div>}
      <div className="list menu-list">
        {g.items.map((it, i) => <div key={i}
          className={'item menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '') + (it.accent ? ' accent' : '')}
          aria-disabled={it.disabled || undefined}
          {...tappable(it.disabled ? null : () => { close(); it.onClick && it.onClick() })}>
          {it.icon && <span className="lrow-i"><Icon name={it.icon} /></span>}
          <div className="grow"><div className="tt">{it.label}</div>{it.sub && <div className="ss">{it.sub}</div>}</div>
          {it.on != null && <span className={'menu-on' + (it.on ? ' is-on' : '')}><Icon name="check" /></span>}
          {it.chevron && <Icon name="chevronRight" className="menu-chev" />}
        </div>)}
      </div>
    </div>)}
  </>
}
export function menuSheet(opts) {
  ui().openSheet(close => <MenuSheet {...opts} close={close} />)
}

// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center', ...(opts.locked ? { locked: true } : {}) })
}
