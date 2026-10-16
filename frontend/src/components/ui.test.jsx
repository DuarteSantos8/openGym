// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Slider, Stepper, NumberField, numWidthCh, SLIDER_GRAB_PX, Segmented, Button, Row, SelectRow, bindUI, selectSheet } from './ui.jsx'
import Icon from './Icon.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function pointer(target, type, { x = 0, y = 0, button = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, k, { configurable: true, value: v })
  }
  act(() => target.dispatchEvent(event))
  return event
}

describe('Slider', () => {
  // 300px track from x=100 to x=400 over 0..300 so 1px == 1 unit
  const mountSlider = (value, onChange) => {
    act(() => root.render(<Slider value={value} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    return el
  }

  it('drags relative to the grab point when the touch lands on the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)               // knob at x=180
    pointer(el, 'pointerdown', { x: 180 + SLIDER_GRAB_PX - 2 })
    expect(onChange).not.toHaveBeenCalled()             // grabbing must not jump
    pointer(window, 'pointermove', { x: 180 + SLIDER_GRAB_PX - 2 + 60 })
    expect(onChange).toHaveBeenLastCalledWith(140)      // moved by 60, not to the finger
    pointer(window, 'pointerup')
  })

  it('still jumps to the touched position away from the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)
    pointer(el, 'pointerdown', { x: 350 })
    expect(onChange).toHaveBeenLastCalledWith(250)
    pointer(window, 'pointermove', { x: 360 })
    expect(onChange).toHaveBeenLastCalledWith(260)
    pointer(window, 'pointerup')
  })
})

describe('Slider under dir=rtl', () => {
  // The Slider scales from inline-start: min sits on the left in LTR and on the right in
  // RTL. These cases pin the RTL behaviour — the pointer math, the grab point and the
  // arrow keys — the parts that would silently break if the direction handling were
  // dropped.
  beforeEach(() => {
    document.documentElement.dir = 'rtl'
  })
  afterEach(() => {
    document.documentElement.dir = 'ltr'
  })

  const mountSlider = (value, onChange) => {
    act(() => root.render(<Slider value={value} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    return el
  }

  it('reads the pointer from the physical right: the left end is near max, the right end near min', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)
    pointer(el, 'pointerdown', { x: 110 })              // f = .033 → mirrored .967 → 290
    expect(onChange).toHaveBeenLastCalledWith(290)
    pointer(el, 'pointerdown', { x: 390 })              // f = .967 → mirrored .033 → 10
    expect(onChange).toHaveBeenLastCalledWith(10)
  })

  it('grabs the knob from the right end and drags relative to the finger', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)               // RTL knob sits at x=400-80=320
    pointer(el, 'pointerdown', { x: 320 + SLIDER_GRAB_PX - 2 })
    expect(onChange).not.toHaveBeenCalled()             // grabbing must not jump
    pointer(window, 'pointermove', { x: 320 + SLIDER_GRAB_PX - 2 + 60 })
    expect(onChange).toHaveBeenLastCalledWith(20)       // moved toward min by 60, not to the finger
    pointer(window, 'pointerup')
  })

  it('swaps the horizontal arrows in RTL and keeps the vertical arrows as they are', () => {
    const onChange = vi.fn()
    const el = mountSlider(50, onChange)
    // The arrow toward the inline-end (max) still increases — that is Left in RTL.
    const key = k => act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
    key('ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(51)
    key('ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(49)
    key('ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith(51)
    key('ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith(49)
  })
})

describe('Stepper', () => {
  // controlled like every real caller: the parent re-renders with the new value
  function Host({ initial, onChange, step, ...props }) {
    const [v, setV] = React.useState(initial)
    return <Stepper value={v} step={step} onChange={n => { setV(n); onChange(n) }} {...props} />
  }
  const mountStepper = (value, onChange, step = 1) => {
    act(() => root.render(<Host initial={value} step={step} onChange={onChange} />))
    return host.querySelector('button[aria-label="Increase"]')
  }

  it('steps once for a short tap (pointerdown, pointerup, click)', () => {
    const onChange = vi.fn()
    const plus = mountStepper(10, onChange)
    pointer(plus, 'pointerdown'); pointer(plus, 'pointerup')
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(11)
  })

  it('repeats while held and swallows the trailing click', () => {
    let value = 10
    const onChange = vi.fn(v => { value = v })
    const plus = mountStepper(value, onChange)
    pointer(plus, 'pointerdown')
    act(() => vi.advanceTimersByTime(399))
    expect(onChange).not.toHaveBeenCalled()
    // one act per tick: in the browser every interval callback is its own task
    act(() => vi.advanceTimersByTime(1 + 80))
    act(() => vi.advanceTimersByTime(80))
    act(() => vi.advanceTimersByTime(80))
    expect(onChange).toHaveBeenCalledTimes(3)
    // each repeat builds on the latest value, not the one the hold started with
    expect(onChange).toHaveBeenLastCalledWith(13)
    pointer(plus, 'pointerup')
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledTimes(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(onChange).toHaveBeenCalledTimes(3)           // nothing keeps ticking after release
  })

  // A minimum holds for the buttons at once but for typing only once the field is left, so a
  // field can be emptied to type a new number without the minimum landing in front of it.
  it('applies `min` to the buttons at once and to typing on leaving the field', () => {
    const onChange = vi.fn()
    function MinHost() {
      const [v, setV] = React.useState(5)
      return <Stepper value={v} step={5} min={1} decimal={false} onChange={n => { setV(n); onChange(n) }} />
    }
    act(() => root.render(<MinHost />))
    const minus = host.querySelector('button[aria-label="Decrease"]')
    const field = host.querySelector('input.num')
    act(() => minus.click())
    expect(onChange).toHaveBeenLastCalledWith(1)
    const type = value => {
      Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    act(() => type(''))
    expect(field.value).toBe('')
    act(() => type('7'))
    expect(field.value).toBe('7')
    act(() => type(''))
    act(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(field.value).toBe('1')
  })

  it('keeps working from the keyboard (click without a pointer)', () => {
    const onChange = vi.fn()
    const plus = mountStepper(10, onChange)
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledWith(11)
  })

  it('names controls for their field when requested', () => {
    const onChange = vi.fn()
    act(() => root.render(<Host initial={10} step={1} onChange={onChange} ariaLabel="load" />))
    expect(host.querySelector('button[aria-label="Decrease load"]')).toBeTruthy()
    expect(host.querySelector('button[aria-label="Increase load"]')).toBeTruthy()
  })

  it('uses the caller step rule', () => {
    const onChange = vi.fn()
    act(() => root.render(<Host initial={61.3} step={2.5} onChange={onChange}
      onStep={(value, increment, direction) => value + increment * 10 + direction} />))
    act(() => host.querySelector('button[aria-label="Increase"]').click())
    expect(onChange).toHaveBeenCalledWith(87.3)
  })

  it('disables all editing controls', () => {
    const onChange = vi.fn()
    act(() => root.render(<Host initial={61.3} step={2.5} onChange={onChange} disabled />))
    const [minus, plus] = host.querySelectorAll('button')
    expect(minus.disabled).toBe(true)
    expect(plus.disabled).toBe(true)
    expect(host.querySelector('input').disabled).toBe(true)
    act(() => plus.click())
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('NumberField fit', () => {
  // A field that hugs its digits, for the big weight read-out where the unit sits right beside
  // the number. Digits are one ch each under tabular numerals; a decimal point is narrower.
  it('measures digits as one ch and a decimal point as half', () => {
    expect(numWidthCh('82')).toBe(2)
    expect(numWidthCh('82.5')).toBe(3.5)
    expect(numWidthCh('')).toBe(1)
  })

  // The width follows what is on screen while typing (the draft), not the last committed
  // number — otherwise clearing the field would leave a 2ch-wide box around a lone caret and
  // the digits typed next would be clipped until the parent caught up.
  it('tracks the draft on screen while typing, and stays unsized without fit', () => {
    const type = (el, value) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    function Harness({ fit }) {
      const [v, setV] = useState(70)
      return <NumberField fit={fit} value={v} onChange={setV} />
    }
    act(() => root.render(<Harness fit />))
    const input = host.querySelector('input')
    expect(input.style.width).toBe('2ch')

    act(() => type(input, ''))
    expect(input.value).toBe('')
    expect(input.style.width).toBe('1ch')

    act(() => type(input, '82,5'))
    expect(input.value).toBe('82.5')
    expect(input.style.width).toBe('3.5ch')

    act(() => root.render(<Harness fit={false} />))
    expect(host.querySelector('input').style.width).toBe('')
  })
})

describe('NumberField whole numbers', () => {
  // Typed one key at a time, "8.5" in a reps field used to lose the "." on the second key and
  // then read the 5 as a second digit: 85 reps.
  it('takes 8.5 typed key by key as 8, not 85, and shows the whole number after blur', () => {
    const changes = []
    function Harness() {
      const [v, setV] = useState(10)
      return <NumberField decimal={false} value={v} onChange={n => { changes.push(n); setV(n) }} />
    }
    act(() => root.render(<Harness />))
    const input = host.querySelector('input')
    const type = value => act(() => {
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('8'); type(input.value + '.'); type(input.value + '5')
    expect(changes).toEqual([8, 8, 8])
    expect(input.value).toBe('8.5')
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(input.value).toBe('8')
    type('8,5')
    expect(changes.at(-1)).toBe(8)
  })
})

describe('NumberField select on tap', () => {
  // In WebKit the release of the tap that focused the field moves the caret and drops the
  // focus-time selection, so typing 65 over 62.5 read 6265.5. happy-dom cannot move a caret;
  // what it can show is that the release of that first tap is kept from doing so.
  const mouseup = el => {
    const e = new MouseEvent('mouseup', { bubbles: true, cancelable: true })
    act(() => el.dispatchEvent(e))
    return e
  }
  const mount = () => {
    act(() => root.render(<NumberField value={62.5} onChange={() => {}} />))
    return host.querySelector('input')
  }

  it('keeps the selection through the release of the tap that focused it', () => {
    const input = mount()
    act(() => input.focus())
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(4)
    expect(mouseup(input).defaultPrevented).toBe(true)
  })

  it('lets a later tap on the focused field place the caret', () => {
    const input = mount()
    act(() => input.focus())
    mouseup(input)
    expect(mouseup(input).defaultPrevented).toBe(false)
  })

  it('forgets the focus once the field is left', () => {
    const input = mount()
    act(() => input.focus())
    act(() => input.blur())
    expect(mouseup(input).defaultPrevented).toBe(false)
  })
})

// The redesign's additive props: each existing usage renders exactly what it did before them.
describe('the redesign\'s additions to Segmented, Button and Row', () => {
  const html = el => renderToStaticMarkup(el)
  const OPTS = [{ value: 30, label: '1M' }, { value: 90, label: '3M' }]
  const go = () => {}

  it('Segmented keeps its markup, and takes tone="strong" and size="lg" as classes', () => {
    const seg = '<span class="seg-sel" aria-hidden="true"></span><button class="" aria-pressed="false">'
      + '<span>1M</span></button><button class="on" aria-pressed="true"><span>3M</span></button></div>'
    expect(html(<Segmented options={OPTS} value={90} onChange={go} />)).toBe('<div class="seg " style="--n:2;--i:1">' + seg)
    expect(html(<Segmented options={OPTS} value={90} onChange={go} className="seg-range" />)).toBe('<div class="seg seg-range" style="--n:2;--i:1">' + seg)
    expect(html(<Segmented options={OPTS} value={90} onChange={go} tone="strong" size="lg" className="seg-range" />))
      .toBe('<div class="seg seg-strong seg-lg seg-range" style="--n:2;--i:1">' + seg)
    expect(() => html(<Segmented options={OPTS} value={90} onChange={go} tone="loud" />)).toThrow(/Segmented: tone="loud"/)
  })

  it('Button keeps its markup and takes shape="pill"', () => {
    expect(html(<Button variant="primary" icon="plus">Log</Button>))
      .toBe(html(<button className="btn primary "><Icon name="plus" /><span>Log</span></button>))
    expect(html(<Button variant="primary" shape="pill">Log</Button>)).toBe('<button class="btn primary btn-pill "><span>Log</span></button>')
    expect(() => html(<Button shape="round">x</Button>)).toThrow(/Button: shape="round"/)
  })

  it('Row keeps its markup, and leads with a bare glyph', () => {
    expect(html(<Row icon="gear" title="Settings" accessory="chevron" onClick={go} />)).toBe(html(
      <button className="lrow tap " onClick={go}><span className="lrow-i"><Icon name="gear" /></span>
        <span className="lrow-m"><span className="lrow-t">Settings</span></span><Icon name="chevronRight" className="lrow-c" /></button>))
    expect(html(<Row glyph="apple" title="Foods" subtitle="12 foods" accessory="chevron" onClick={go} />)).toBe(html(
      <button className="lrow tap " onClick={go}><span className="lrow-g"><Icon name="apple" /></span>
        <span className="lrow-m"><span className="lrow-t">Foods</span><span className="lrow-s">12 foods</span></span>
        <Icon name="chevronRight" className="lrow-c" /></button>))
  })

  it('Row accessory="add" is no button itself: its text opens it and the + adds, each reachable', () => {
    const onOpen = vi.fn(), onAdd = vi.fn()
    act(() => root.render(<Row glyph="ruler" title="Waist" subtitle="82 cm" accessory="add" onOpen={onOpen} onAdd={onAdd} />))
    const row = host.querySelector('.lrow')
    expect(row.tagName).toBe('DIV')
    expect(row.classList.contains('lrow-add')).toBe(true)
    const [open, plus] = row.querySelectorAll('button')
    expect(open.className).toBe('lrow-m lrow-open')
    expect(plus.getAttribute('aria-label')).toBe('Add to Waist')
    act(() => open.click())
    act(() => plus.click())
    expect([onOpen.mock.calls.length, onAdd.mock.calls.length]).toEqual([1, 1])
    act(() => root.render(<Row title={<b>Hips</b>} accessory="add" onAdd={onAdd} addLabel="Log hips" />))
    expect(host.querySelector('.lrow-plus').getAttribute('aria-label')).toBe('Log hips')
    expect(host.querySelector('.lrow-open')).toBeNull()
    expect(() => html(<Row title="x" accessory="add" onClick={go} />)).toThrow(/not onClick/)
    expect(() => html(<Row title="x" accessory="arrow" />)).toThrow(/Row: accessory="arrow"/)
  })
})

describe('selectSheet', () => {
  const OPTIONS = [
    { value: 'bench', label: 'Bench press', subtitle: 'Chest' },
    { value: 'squat', label: 'Squat' },
    { value: 'row', label: 'Row' },
  ]
  const SEARCH = { placeholder: 'Search exercises', label: 'Search', emptyLabel: 'No match', match: (o, q) => o.label.toLowerCase().includes(q.trim().toLowerCase()) }
  let sheet, sheetRoot

  // Opens the sheet through the UI store and renders what it holds, as the shell does.
  const open = args => {
    bindUI(useUI)
    useUI.getState().closeAll()
    selectSheet(args)
    const entry = useUI.getState().sheets.at(-1)
    sheet = document.createElement('div')
    document.body.appendChild(sheet)
    sheetRoot = createRoot(sheet)
    act(() => sheetRoot.render(entry.render(() => useUI.getState().closeSheet(entry.id))))
    return entry
  }
  afterEach(() => {
    if (sheetRoot) act(() => sheetRoot.unmount())
    sheet?.remove()
    sheetRoot = sheet = null
    useUI.getState().closeAll()
  })
  const rows = () => [...sheet.querySelectorAll('.lrow')]

  it('lists the options under the title, with a check on the current value and subtitles', () => {
    open({ title: 'Choose exercise', value: 'squat', options: OPTIONS, onChange: vi.fn() })
    expect(sheet.querySelector('h3').textContent).toBe('Choose exercise')
    expect(rows().map(r => r.querySelector('.lrow-t').textContent)).toEqual(['Bench press', 'Squat', 'Row'])
    expect(rows()[0].querySelector('.lrow-s').textContent).toBe('Chest')
    expect(rows().map(r => !!r.querySelector('.lrow-k'))).toEqual([false, true, false])
    expect(sheet.querySelector('.picker-search')).toBeNull()
  })

  it('picks an option: closes the sheet and reports the value', () => {
    const onChange = vi.fn()
    open({ title: 'Choose exercise', value: 'squat', options: OPTIONS, onChange })
    act(() => rows()[2].click())
    expect(onChange).toHaveBeenCalledWith('row')
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('filters with the search it is given, and says when nothing matches', () => {
    open({ title: 'Choose exercise', value: 'squat', options: OPTIONS, onChange: vi.fn(), search: SEARCH })
    const input = sheet.querySelector('.picker-search input')
    expect(input.getAttribute('placeholder')).toBe('Search exercises')
    const type = value => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('sq')
    expect(rows().map(r => r.querySelector('.lrow-t').textContent)).toEqual(['Squat'])
    type('zzz')
    expect(rows()).toHaveLength(0)
    expect(sheet.querySelector('.empty').textContent).toContain('No match')
  })

  it('opens from a SelectRow with the row\'s title, or its sheetTitle, and shows the current label', () => {
    bindUI(useUI)
    const onChange = vi.fn()
    act(() => root.render(<SelectRow title="Measurement" sheetTitle="Choose measurement" value="b" onChange={onChange}
      options={[{ value: 'a', label: 'Waist' }, { value: 'b', label: 'Chest' }]} />))
    const row = host.querySelector('.lrow')
    expect(row.querySelector('.lrow-v').textContent).toBe('Chest')
    act(() => row.click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('has no stacked-value layout on SelectRow any more', () => {
    bindUI(useUI)
    act(() => root.render(<SelectRow title="Measurement" value="a" stackedValue onChange={vi.fn()} options={[{ value: 'a', label: 'Waist' }]} />))
    expect(host.querySelector('.lrow-stack-value')).toBeNull()
  })
})
