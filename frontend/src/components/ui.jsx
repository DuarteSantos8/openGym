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

import { useRef, useState, useEffect, useCallback, forwardRef } from 'react'
import Icon from './Icon.jsx'

/* ============================ text ============================ */

// Numeric input accepting "," as decimal separator — iOS decimal keypads in many
// locales only offer a comma, and type="number" reports "" for it (value snaps to
// 0). Keeps a local string draft while focused so partial input like "33," survives.
// `nullable` is for fields where "nothing entered" and 0 mean different things (RIR: a
// logged 0 is a set taken to failure). Those clear back to null instead of snapping to 0.
export function NumberField({ value, onChange, decimal = true, nullable = false, className = '', ...rest }) {
  const [draft, setDraft] = useState(null)
  const committed = useRef(null)
  // null and undefined are the same "empty" here — a nullable field's key is dropped once cleared.
  if (draft !== null && (committed.current ?? null) !== (value ?? null)) { setDraft(null); committed.current = null }
  const commit = raw => {
    let s = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
    const i = s.indexOf('.')
    if (i !== -1) s = decimal ? s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '') : s.slice(0, i)
    const n = s === '' || s === '.' ? (nullable ? null : 0) : Math.max(0, parseFloat(s))
    committed.current = n
    setDraft(s)
    onChange(n)
  }
  return (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      className={'num ' + className}
      value={draft ?? (value ?? '')}
      onFocus={e => e.target.select()}
      onChange={e => commit(e.target.value)}
      onBlur={() => { setDraft(null); committed.current = null }}
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
        <button className="clear" onClick={onClear} aria-label="Clear">
          <Icon name="xmark" />
        </button>
      )}
    </div>
  )
})

/* ============================ switch ============================ */

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      className={'sw' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  )
}

/* ============================ segmented ============================ */

// options: [{ value, label, icon? }]  — the selected pill slides between cells.
export function Segmented({ options, value, onChange, className = '' }) {
  const i = Math.max(0, options.findIndex(o => o.value === value))
  return (
    <div className={'seg ' + className} style={{ '--n': options.length, '--i': i }}>
      <span className="seg-sel" aria-hidden="true" />
      {options.map(o => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

/* ============================ stepper ============================ */

export function Stepper({ value, step = 1, onChange, decimal = true, className = '', label, unit, invalid = false }) {
  const set = v => onChange(Math.max(0, Math.round((v || 0) * 100) / 100))
  // Holding a button repeats the step; the latest value/step live in a ref so
  // the interval doesn't keep stepping from the value it was started with.
  const live = useRef({ value, step, set })
  live.current = { value, step, set }
  const hold = useRef({ delay: null, tick: null, count: 0, repeated: false })
  const bump = dir => { const { value, step, set } = live.current; set((+value || 0) + dir * step) }
  const stopHold = () => {
    const h = hold.current
    window.clearTimeout(h.delay); window.clearInterval(h.tick)
    h.delay = h.tick = null
  }
  const startHold = dir => {
    stopHold()
    const h = hold.current
    h.repeated = false; h.count = 0
    h.delay = window.setTimeout(() => {
      const run = () => {
        h.repeated = true; h.count++
        bump(dir)
        // modest acceleration after a bit of holding so a long hold covers ground
        if (h.count === 15) { window.clearInterval(h.tick); h.tick = window.setInterval(run, 40) }
      }
      h.tick = window.setInterval(run, 80)
    }, 400)
  }
  // The click that follows pointerup must not add a step once the hold repeated.
  const click = dir => {
    if (hold.current.repeated) { hold.current.repeated = false; return }
    bump(dir)
  }
  useEffect(() => stopHold, [])
  const holdProps = dir => ({
    onPointerDown: e => { if (e.button === 0 || e.button == null) startHold(dir) },
    onPointerUp: stopHold, onPointerCancel: stopHold, onPointerLeave: stopHold, onBlur: stopHold,
    onClick: () => click(dir),
  })
  const inner = (
    <div className={'stp ' + className}>
      <button {...holdProps(-1)} aria-label="Decrease"><Icon name="minus" /></button>
      <span className="val">
        <NumberField value={value} decimal={decimal} onChange={onChange} aria-invalid={invalid ? 'true' : undefined} />
        {unit && <i>{unit}</i>}
      </span>
      <button {...holdProps(1)} aria-label="Increase"><Icon name="plus" /></button>
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
export function Slider({ value, min = 0, max = 100, step = 1, onChange, className = '' }) {
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
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
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
    const up = () => setDrag(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, onChange, posToValue])

  const key = e => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0
    if (!d) return
    e.preventDefault()
    onChange(Math.min(max, Math.max(min, Math.round((value + d) * 1000) / 1000)))
  }

  return (
    <div
      ref={ref}
      className={'sld' + (drag ? ' dragging' : '') + ' ' + className}
      role="slider"
      tabIndex={0}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      data-nodrag                                  /* keeps the sheet from swipe-dismissing */
      onKeyDown={key}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const r = e.currentTarget.getBoundingClientRect()
        const knobX = r.left + (pct / 100) * r.width
        const d = e.clientX - knobX
        offset.current = Math.abs(d) <= SLIDER_GRAB_PX ? d : 0
        setDrag(true)
        if (!offset.current) onChange(posToValue(e.clientX))
      }}
    >
      <span className="sld-track"><span className="sld-fill" style={{ width: pct + '%' }} /></span>
      <span className="sld-knob" style={{ left: pct + '%' }} />
    </div>
  )
}

/* ============================ checkbox ============================ */

export function Check({ checked, onChange, className = '', size }) {
  return (
    <button
      role="checkbox"
      aria-checked={!!checked}
      className={'chk' + (checked ? ' on' : '') + ' ' + className}
      style={size ? { width: size, height: size } : null}
      onClick={() => onChange(!checked)}
    >
      <Icon name="check" />
    </button>
  )
}

/* ============================ grouped list ============================ */

// The inset-grouped list is the app's main structural primitive: a titled
// section holding rows separated by hairlines that stop short of the leading
// edge, so the icon column reads as a continuous rail.
export function Section({ title, footer, children, className = '' }) {
  return (
    <section className={'sect ' + className}>
      {title && <h2 className="sect-t">{title}</h2>}
      <div className="sect-b">{children}</div>
      {footer && <p className="sect-f">{footer}</p>}
    </section>
  )
}

export function Row({ icon, iconTint, title, subtitle, value, accessory = 'none', onClick, danger, children, className = '' }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={'lrow' + (onClick ? ' tap' : '') + (danger ? ' danger' : '') + ' ' + className} onClick={onClick}>
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

function SelectSheet({ title, value, options, onChange, search, close }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const firstVisibleRef = useRef(null)
  const syncPickerViewport = useCallback(() => {
    const input = inputRef.current
    const sheet = input?.closest('.sheet')
    const viewport = window.visualViewport
    if (!sheet || !viewport) return
    const visualHeight = Math.max(0, viewport.height || window.innerHeight)
    const visualBottom = (viewport.offsetTop || 0) + visualHeight
    const bottomInset = Math.max(0, window.innerHeight - visualBottom)
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
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
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
