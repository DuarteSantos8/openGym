// openGym control set.
//
// Every input in the app is built here rather than styled on top of a native
// widget. Native controls are the single loudest "unfinished" tell: a checkbox
// renders blue on iOS and grey on Android, a range slider paints its own white
// track that no theme reaches, and a <select> opens a system list that ignores
// dark mode entirely. Rebuilding them means one visual language and one focus
// treatment across every platform.
//
// Shared rules:
//   · every control is driven by (value, onChange) — no internal source of truth
//   · hit targets are ≥44px even when the painted control is smaller
//   · :active gives a scale/tint response so touch feels acknowledged
//   · focus-visible draws a ring; pointer interaction never does

import { useRef, useState, useEffect, useLayoutEffect, useCallback, forwardRef } from 'react'
import Icon from './Icon.jsx'
import { sheetKeyboardInsets } from '../lib/use-sheet-keyboard.js'
import { NATIVE_KEYBOARD_EVENT } from '../lib/native-keyboard.js'
import { t } from '../lib/i18n.js'
import { cleanNum } from '../lib/format.js'
import { isIOS } from '../lib/platform-now.js'
import { holdProps, newHold, stopHold, stepOnce, rollField, tickFeel, tap } from '../lib/feel.js'

/* ============================ text ============================ */

// Width of a numeric string in `ch`, for a field sized to its own digits (NumberField's
// `fit`): with tabular numerals every digit is exactly one ch, a decimal point roughly half.
export const numWidthCh = s => Math.max(1, [...s].reduce((n, c) => n + (c === '.' ? 0.5 : 1), 0))

// Numeric input accepting "," as decimal separator — iOS decimal keypads in many
// locales only offer a comma, and type="number" reports "" for it (value snaps to
// 0). Keeps a local string draft while focused so partial input like "33," survives.
// `nullable` is for fields where "nothing entered" and 0 mean different things (RIR: a
// logged 0 is a set taken to failure). Those clear back to null instead of snapping to 0.
// `fit` sizes the field to the digits on screen instead of filling its cell — for the big
// weight read-out, where the unit sits right beside the number.
// `adjust(dir)`, from a stepper's - / +: on the iPhone the field is then a spinbutton that
// VoiceOver can swipe up and down (the arrow keys it sends step), and its number rolls when a
// step moves it, never when it is typed into (lib/feel.js).
export function NumberField({ value, onChange, decimal = true, nullable = false, fit = false, step, className = '', adjust, unit, ...rest }) {
  const [draft, setDraft] = useState(null)
  const committed = useRef(null)
  // Focus selects the number so typing replaces it. In WebKit (Safari, the iOS app) the release
  // of the tap that focused the field then moves the caret to the finger and drops that
  // selection: 65 typed over 62.5 read 6265.5. The first mouseup after focus keeps its default
  // off; a later tap on the focused field still places the caret to edit one digit.
  const justFocused = useRef(false)
  // null and undefined are the same "empty" here — a nullable field's key is dropped once cleared.
  if (draft !== null && (committed.current ?? null) !== (value ?? null)) { setDraft(null); committed.current = null }
  const commit = raw => {
    let s = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
    const i = s.indexOf('.')
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
    // A whole-number field keeps what was typed after a separator on screen until blur and
    // counts only the part before it: cutting the separator off at each keystroke read 8.5 as 85.
    const whole = !decimal && i !== -1 ? s.slice(0, i) : s
    const n = whole === '' || whole === '.' ? (nullable ? null : 0) : Math.max(0, parseFloat(whole))
    committed.current = n
    setDraft(s)
    onChange(n)
  }
  // Shown clean (lib/format.js cleanNum), so a stored 20.4117 never fills the field; typing replaces it.
  const shown = draft ?? (typeof value === 'number' ? cleanNum(value, step) : (value ?? ''))
  const inp = useRef(null)
  const prev = useRef(shown)
  useLayoutEffect(() => {
    if (prev.current !== shown && draft === null) rollField(inp.current, String(prev.current), String(shown))
    prev.current = shown
  })
  const spin = adjust && isIOS() ? {
    role: 'spinbutton',
    'aria-valuenow': typeof value === 'number' && Number.isFinite(value) ? value : undefined,
    'aria-valuetext': String(shown) + (unit ? ' ' + unit : ''),
    onKeyDown: e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepOnce(adjust, e.key === 'ArrowUp' ? 1 : -1) } },
  } : null
  return (
    <input
      ref={inp}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      className={'num ' + className}
      value={shown}
      // `fit` hugs the digits on screen — a big read-out with its unit sitting right beside
      // it — where the default fills whatever cell the field is in.
      style={fit ? { width: numWidthCh(String(shown)) + 'ch' } : undefined}
      onFocus={e => { justFocused.current = true; e.target.select() }}
      onMouseUp={e => { if (justFocused.current) { justFocused.current = false; e.preventDefault() } }}
      onChange={e => commit(e.target.value)}
      onBlur={() => { setDraft(null); committed.current = null; justFocused.current = false }}
      {...spin}
      {...rest}
    />
  )
}

// forwardRef so callers can focus it or read its value imperatively
export const TextField = forwardRef(function TextField({ className = '', ...rest }, ref) {
  return <input ref={ref} className={'field ' + className} {...rest} />
})

export function TextArea({ className = '', ...rest }) {
  return <textarea className={'field area ' + className} {...rest} />
}

export const SearchField = forwardRef(function SearchField({ value, onChange, onClear, ...rest }, ref) {
  return (
    <div className="searchf">
      <Icon name="magnifier" className="lead" />
      <input ref={ref} className="field" value={value} onChange={onChange} {...rest} />
      {!!value && (
        /* type="button": inside a form the first button is what Enter presses, and that must be
           the form's own Search, not this (the gym map's search cleared itself on Enter). */
        <button type="button" className="clear" onClick={onClear} aria-label={t('Clear')}>
          <Icon name="xmark" />
        </button>
      )}
    </div>
  )
})

/* ============================ switch ============================ */

export function Switch({ checked, onChange, disabled, ...accessibility }) {
  return (
    <button
      {...accessibility}
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      className={'sw' + (checked ? ' on' : '')}
      onClick={() => { tap('light'); onChange(!checked) }}
    >
      <span className="knob" />
    </button>
  )
}

/* ============================ segmented ============================ */

// options: [{ value, label, icon? }]  — the selected pill slides between cells.
// `tour`: the app tour's anchor for this control (data-tour, lib/tour.js); likewise below.
// `ariaLabelledby` names the choice for a screen reader by its visible label (a group of
// pressed buttons otherwise reads as three loose words).
export function Segmented({ options, value, onChange, className = '', tour, ariaLabelledby }) {
  const i = Math.max(0, options.findIndex(o => o.value === value))
  // On the iPhone a finger can also drag across the segments; the click that ends the drag is not a pick.
  const dragged = useRef(false)
  const pick = o => { if (o.value !== value) tap('selection'); onChange(o.value) }
  const drag = e => {
    if (!isIOS() || !e.buttons || className.includes('seg-scroll')) return
    const bs = [...e.currentTarget.querySelectorAll(':scope > button')]
    const o = options[bs.indexOf(document.elementFromPoint(e.clientX, e.clientY)?.closest('.seg > button'))]
    if (o && o.value !== value) { dragged.current = true; pick(o) }
  }
  return (
    <div className={'seg ' + className} style={{ '--n': options.length, '--i': i }} data-tour={tour}
      onPointerDown={() => { dragged.current = false }} onPointerMove={drag}
      role={ariaLabelledby ? 'group' : undefined} aria-labelledby={ariaLabelledby}>
      <span className="seg-sel" aria-hidden="true" />
      {options.map(o => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          onClick={() => { if (dragged.current) dragged.current = false; else pick(o) }}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

/* ============================ stepper ============================ */

// `min` and `max` hold for the buttons at once, but for typing only once the field is left:
// clamped on every keystroke, a field emptied to type a new number snapped to the minimum, and
// the digits typed next landed after it (a 48 retyped as 75 saved 175).
export function Stepper({ value, step = 1, min = 0, max = Infinity, onChange, decimal = true, className = '', label, unit, invalid = false, disabled = false, onStep, ariaLabel, display }) {
  const clamp = v => Math.min(max, Math.max(min, v))
  // false when the value is already at its limit (lib/feel.js: one light haptic, the hold stops)
  const set = v => { const n = clamp(Math.round((v || 0) * 100) / 100); onChange(n); return n !== (+live.current.value || 0) }
  // Holding a button repeats the step; the latest value/step live in a ref so
  // the interval doesn't keep stepping from the value it was started with.
  const live = useRef({ value, step, set })
  live.current = { value, step, set }
  // From the number on screen (cleanNum), not a stored 44.996 behind it.
  const bump = dir => { const { value, step, set } = live.current; const v = cleanNum(+value || 0, step); return set(onStep ? onStep(v, step, dir) : v + dir * step) }
  const hold = useRef(newHold())
  useEffect(() => () => stopHold(hold.current), [])
  const inner = (
    <div className={'stp ' + className}>
      <button {...holdProps(bump, -1, true, hold.current)} aria-label={ariaLabel ? `${t('Decrease')} ${ariaLabel}` : t('Decrease')} disabled={disabled}><Icon name="minus" /></button>
      <span className="val" onBlur={() => { const v = +value || 0; if (clamp(v) !== v) onChange(clamp(v)) }}>
        {/* `display`: a word instead of the number at a special value ("Bar" for an empty bar), the
            +/- still step from `value`. */}
        {display != null ? <span className="stp-word">{display}</span>
          : <NumberField value={value} decimal={decimal} step={step} onChange={onChange} disabled={disabled} aria-invalid={invalid ? 'true' : undefined}
            adjust={bump} unit={unit} aria-label={isIOS() ? ariaLabel : undefined} />}
        {display == null && unit && <i>{unit}</i>}
      </span>
      <button {...holdProps(bump, 1, true, hold.current)} aria-label={ariaLabel ? `${t('Increase')} ${ariaLabel}` : t('Increase')} disabled={disabled}><Icon name="plus" /></button>
    </div>
  )
  if (!label) return inner
  return <div className="stp-w"><span className="stp-l">{label}</span>{inner}</div>
}

/* ============================ slider ============================ */

// Pointer-driven so the fill, track and thumb are all ours — no ::-webkit-*
// pseudo-elements, which is the only way the control looks identical on every
// platform and can pick up the accent colour.
export const SLIDER_GRAB_PX = 22
export function Slider({ value, min = 0, max = 100, step = 1, onChange, onEnd, className = '', disabled = false, ariaLabel, ariaValueText }) {
  const ref = useRef(null)
  const [drag, setDrag] = useState(false)
  // Grabbing the knob drags it relative to where the finger landed; a finger
  // is ~22px wide, so a touch that far off still means "the knob", not "jump".
  const offset = useRef(0)
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))

  const posToValue = useCallback(clientX => {
    const el = ref.current
    if (!el) return value
    const r = el.getBoundingClientRect()
    // The fraction is read from the physical left edge, then mirrored in RTL where the
    // minimum sits at the inline-start (right) end of the track.
    let f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    if (document.documentElement.dir === 'rtl') f = 1 - f
    const raw = min + f * (max - min)
    const snapped = Math.round(raw / step) * step
    // step can be fractional (0.1) — round away binary noise
    return Math.min(max, Math.max(min, Math.round(snapped * 1000) / 1000))
  }, [min, max, step, value])

  useEffect(() => {
    if (!drag) return
    const move = e => {
      e.preventDefault()
      onChange(posToValue((e.touches ? e.touches[0].clientX : e.clientX) - offset.current))
    }
    const up = () => { setDrag(false); onEnd?.() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, onChange, onEnd, posToValue])

  const key = e => {
    if (disabled) return
    // The arrow pointing at the inline-end (max) end still increases; in RTL that is Left.
    const inc = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const dec = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    const d = e.key === inc || e.key === 'ArrowUp' ? step
      : e.key === dec || e.key === 'ArrowDown' ? -step : 0
    if (!d) return
    e.preventDefault()
    onChange(Math.min(max, Math.max(min, Math.round((value + d) * 1000) / 1000)))
    onEnd?.()
  }

  return (
    <div
      ref={ref}
      className={'sld' + (drag ? ' dragging' : '') + ' ' + className}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      aria-label={ariaLabel} aria-valuetext={ariaValueText}
      aria-disabled={disabled}
      data-nodrag                                  /* keeps the sheet from swipe-dismissing */
      onKeyDown={key}
      onPointerDown={e => {
        if (disabled) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const r = e.currentTarget.getBoundingClientRect()
        // The knob is measured from inline-start: left in LTR, right in RTL.
        const knobX = document.documentElement.dir === 'rtl'
          ? r.right - (pct / 100) * r.width
          : r.left + (pct / 100) * r.width
        const d = e.clientX - knobX
        offset.current = Math.abs(d) <= SLIDER_GRAB_PX ? d : 0
        setDrag(true)
        if (!offset.current) onChange(posToValue(e.clientX))
      }}
    >
      <span className="sld-track"><span className="sld-fill" style={{ width: pct + '%' }} /></span>
      <span className="sld-knob" style={{ insetInlineStart: pct + '%' }} />
    </div>
  )
}

/* ============================ checkbox ============================ */

// `pop`: a set's tick. The user's own tap makes it pop; `pop="last"` (the exercise's last set) also throws
// a ring of dots and lifts the row (iPhone, lib/feel.js); a set ticked by sync or the watch changes `checked` with no tap, so it does not.
export function Check({ checked, onChange, className = '', size, label, tour, pop = false }) {
  return (
    <button
      data-tour={tour}
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      className={'chk' + (checked ? ' on' : '') + ' ' + className}
      style={size ? { width: size, height: size } : null}
      onClick={e => { if (pop && !checked) tickFeel(e.currentTarget, pop === 'last'); onChange(!checked) }}
    >
      <Icon name="check" />
    </button>
  )
}

/* ============================ grouped list ============================ */

// The inset-grouped list is the app's main structural primitive: a titled
// section holding rows separated by hairlines that stop short of the leading
// edge, so the icon column reads as a continuous rail.
export function Section({ title, footer, children, className = '', tour }) {
  return (
    <section className={'sect ' + className} data-tour={tour}>
      {title && <h2 className="sect-t">{title}</h2>}
      <div className="sect-b">{children}</div>
      {footer && <p className="sect-f">{footer}</p>}
    </section>
  )
}

/** How long a value may be and still sit beside a row's title and subtitle on a phone. */
export const VALUE_BESIDE_MAX = 14

export function Row({ icon, iconTint, title, subtitle, value, accessory = 'none', onClick, danger, children, className = '', tour }) {
  const Tag = onClick ? 'button' : 'div'
  // A worded value on a row that also has a subtitle ("Wie die Arbeitssätze" beside "Pause vor der
  // nächsten Übung") leaves the title a column a word wide on a phone: it goes under the text
  // there instead (index.css .lrow-vlong). Numbers and short words stay beside the title.
  const vlong = icon && subtitle && !children && typeof value === 'string' && value.length > VALUE_BESIDE_MAX
  return (
    <Tag className={'lrow' + (onClick ? ' tap' : '') + (danger ? ' danger' : '') + (vlong ? ' lrow-vlong' : '') + ' ' + className} onClick={onClick} data-tour={tour}>
      {icon && <span className="lrow-i" style={iconTint ? { '--tint': iconTint } : null}><Icon name={icon} /></span>}
      <span className="lrow-m">
        <span className="lrow-t">{title}</span>
        {subtitle && <span className="lrow-s">{subtitle}</span>}
      </span>
      {children}
      {value != null && <span className="lrow-v">{value}</span>}
      {accessory === 'chevron' && <Icon name="chevronRight" className="lrow-c" />}
      {accessory === 'check' && <Icon name="check" className="lrow-k" />}
    </Tag>
  )
}

/* ============================ picker ============================ */

// Replaces <select>. A native select opens a system list that ignores the app's
// theme entirely — on dark mode it flashes a white sheet — and can't show more
// than a bare label per option. This opens our own sheet with a checkmark on the
// current value, which is also how iOS itself handles a long option list.
export function SelectRow({ icon, iconTint, title, value, options, onChange, sheetTitle, stackedValue = false, search }) {
  const cur = options.find(o => o.value === value)
  const open = () => {
    const { openSheet } = require_ui()
    const h = openSheet(close => <SelectSheet title={sheetTitle || title} value={value} options={options}
      onChange={onChange} search={search} close={close} />)
    return h
  }
  return (
    <Row icon={icon} iconTint={iconTint} title={title} value={cur ? cur.label : value} accessory="chevron" onClick={open}
      className={stackedValue ? 'lrow-stack-value' : ''} />
  )
}

/** The picker sheet of SelectRow on its own, for a control that is not a row (Stats' menu buttons). */
export function openSelectSheet({ title, value, options, onChange, search }) {
  const { openSheet } = require_ui()
  return openSheet(close => <SelectSheet title={title} value={value} options={options} onChange={onChange} search={search} close={close} />)
}

/**
 * A compact button that names the current choice and opens the picker sheet: for a choice that
 * would overflow a segmented control (Stats: the chart of an exercise, the muscles' period).
 * The accessible name says what is chosen for what ("Period: Week").
 */
export function MenuButton({ title, value, options, onChange, className = '' }) {
  const cur = options.find(o => o.value === value) || options[0]
  return <Button size="sm" trailingIcon="chevronDown" className={'menu-btn' + (className ? ' ' + className : '')}
    aria-haspopup="dialog" aria-label={title + ': ' + (cur?.label ?? '')}
    onClick={() => openSelectSheet({ title, value, options, onChange })}>{cur?.label}</Button>
}

function SelectSheet({ title, value, options, onChange, search, close }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const firstVisibleRef = useRef(null)
  const syncPickerViewport = useCallback(() => {
    const input = inputRef.current
    const sheet = input?.closest('.sheet')
    const viewport = window.visualViewport
    if (!sheet || !viewport) return
    // the visual viewport, or on Android 15 the keyboard the app passes (lib/native-keyboard.js)
    const { bottomInset, visualHeight } = sheetKeyboardInsets(window)
    sheet.style.setProperty('--picker-keyboard-bottom', `${bottomInset}px`)
    sheet.style.setProperty('--picker-visual-height', `${visualHeight}px`)
  }, [])
  const matcher = typeof search === 'function' ? search : search?.match
  const visible = matcher ? options.filter(o => matcher(o, query)) : options

  useEffect(() => {
    if (!search) return
    const viewport = window.visualViewport
    if (!viewport) return
    const sync = () => syncPickerViewport()
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    window.addEventListener(NATIVE_KEYBOARD_EVENT, sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      window.removeEventListener(NATIVE_KEYBOARD_EVENT, sync)
      const sheet = inputRef.current?.closest('.sheet')
      sheet?.style.removeProperty('--picker-keyboard-bottom')
      sheet?.style.removeProperty('--picker-visual-height')
    }
  }, [search, syncPickerViewport])

  // Filtering can leave the first result underneath the mobile keyboard. Keep the
  // correction local to the sheet instead of letting focus/scrollIntoView move the page.
  useEffect(() => {
    if (!query.trim() || !visible.length) return
    const input = inputRef.current
    if (!input || document.activeElement !== input) return
    const schedule = callback => window.requestAnimationFrame
      ? window.requestAnimationFrame(callback)
      : window.setTimeout(callback, 0)
    const cancel = frame => window.cancelAnimationFrame
      ? window.cancelAnimationFrame(frame)
      : window.clearTimeout(frame)
    const frame = schedule(() => {
      if (document.activeElement !== input) return
      const option = firstVisibleRef.current
      const sheet = option?.closest('.sheet')
      if (!option || !sheet) return
      const viewport = window.visualViewport
      const visualBottom = viewport ? (viewport.offsetTop || 0) + viewport.height : window.innerHeight
      const sheetBottom = sheet.getBoundingClientRect().bottom || visualBottom
      const hiddenBy = option.getBoundingClientRect().bottom - Math.min(visualBottom, sheetBottom) + 8
      if (hiddenBy <= 0) return
      const maxScroll = Math.max(0, sheet.scrollHeight - sheet.clientHeight)
      const nextScroll = Math.min(maxScroll, Math.max(0, sheet.scrollTop + hiddenBy))
      if (nextScroll !== sheet.scrollTop) sheet.scrollTop = nextScroll
    })
    return () => cancel(frame)
  }, [query, visible.length])

  return (
    <>
      <h3>{title}</h3>
      {search && <div className="picker-search">
        <SearchField value={query} onChange={e => setQuery(e.target.value)} onInput={e => setQuery(e.target.value)}
          onClear={() => setQuery('')} onFocus={syncPickerViewport} ref={inputRef} placeholder={search.placeholder} aria-label={search.label || search.placeholder} />
      </div>}
      <div className="sect-b">
        {visible.map((o, index) => (
          <button key={o.value} ref={index === 0 ? firstVisibleRef : undefined} className="lrow tap" onClick={() => { close(); onChange(o.value) }}>
            <span className="lrow-m"><span className="lrow-t">{o.label}</span>
              {o.subtitle && <span className="lrow-s">{o.subtitle}</span>}</span>
            {o.value === value && <Icon name="check" className="lrow-k" />}
          </button>
        ))}
        {!visible.length && search && <div className="empty">
          <div className="ico"><Icon name="magnifier" /></div>{search.emptyLabel}
        </div>}
      </div>
      <div style={{ height: 8 }} />
    </>
  )
}

/** Multi-select row for additive exercise metadata. The sheet mirrors selection locally so
 * each tap updates its checkmark immediately while the caller persists the value. */
export function MultiSelectRow({ icon, iconTint, title, values, options, onToggle, sheetTitle, noneLabel, doneLabel }) {
  const selected = options.filter(o => values.includes(o.value))
  const summary = selected.length ? selected.map(o => o.label).join(', ') : (noneLabel || '')
  const open = () => {
    const { openSheet } = require_ui()
    openSheet(close => <MultiSelectSheet values={values} options={options} onToggle={onToggle}
      title={sheetTitle || title} doneLabel={doneLabel} close={close} />)
  }
  return (
    <Row icon={icon} iconTint={iconTint} title={title} value={summary} accessory="chevron" onClick={open} />
  )
}

function MultiSelectSheet({ values, options, onToggle, title, doneLabel, close }) {
  const [sel, setSel] = useState(values)
  const toggle = value => {
    setSel(current => current.includes(value) ? current.filter(x => x !== value) : [...current, value])
    onToggle(value)
  }
  return (
    <>
      <h3>{title}</h3>
      <div className="sect-b">
        {options.map(o => {
          const on = sel.includes(o.value)
          return (
            <button key={o.value} className={'lrow tap' + (on ? ' on' : '')} onClick={() => toggle(o.value)}>
              <span className="lrow-m"><span className="lrow-t">{o.label}</span>
                {o.subtitle && <span className="lrow-s">{o.subtitle}</span>}</span>
              {on && <Icon name="check" className="lrow-k" />}
            </button>
          )
        })}
      </div>
      <div style={{ height: 8 }} />
      <Button variant="primary" onClick={close}>{doneLabel || 'Done'}</Button>
    </>
  )
}

// Late import keeps this module free of a cycle at load time (useUI pulls in the
// store, which pulls in helpers that import controls).
let _ui = null
export function bindUI(store) { _ui = store }
function require_ui() {
  if (!_ui) throw new Error('ui store not bound — call bindUI(useUI) once at boot')
  return _ui.getState()
}

/* ============================ buttons ============================ */

export function Button({ variant = 'plain', size, icon, trailingIcon, children, className = '', ...rest }) {
  return (
    <button className={`btn ${variant}${size ? ' ' + size : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  )
}
