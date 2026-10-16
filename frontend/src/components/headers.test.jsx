// @vitest-environment happy-dom
// The tab-root header (Owner decision 11: search pill · optional context button · avatar, no
// title), its search pill and avatar, and the sub-page header (back · centred title · ≤2 actions).
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { longFits, titleStep } from '../lib/text-fit.js'
import AvatarButton from './AvatarButton.jsx'
import RootHeader from './RootHeader.jsx'
import SearchPill from './SearchPill.jsx'
import SubHeader from './SubHeader.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const render = el => act(() => root.render(el))
const $ = s => host.querySelector(s)
const typeInto = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

// A field `width` px wide, and a canvas whose text is `perChar` px a character.
function measuredAt(width, perChar = 8) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: s => ({ width: s.length * perChar }) })
}

function Pill(props) {
  const [value, setValue] = useState(props.initial || '')
  return <SearchPill value={value} onChange={setValue} {...props} />
}

describe('SearchPill', () => {
  it('is the real input, with bearmenu\'s attributes, inside a search landmark', () => {
    render(<Pill scope="train" />)
    const input = $('[role="search"] input')
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('inputmode')).toBe('search')
    for (const [k, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'search']]) {
      expect(input.getAttribute(k), k).toBe(v)
    }
    // the long placeholder names the scope for a screen reader, whatever fits on screen
    expect(input.getAttribute('aria-label')).toBe('Exercises, routines, workouts')
  })

  it('takes the long placeholder where it fits and the short one where it does not', () => {
    measuredAt(300)
    render(<Pill scope="train" />)
    expect($('input').placeholder).toBe('Exercises, routines, workouts')
    act(() => root.unmount())
    root = createRoot(host)
    vi.restoreAllMocks()
    measuredAt(140)
    render(<Pill scope="train" />)
    expect($('input').placeholder).toBe('Search training')
  })

  it('falls back to the short placeholder where nothing can measure', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    render(<Pill scope="food" />)
    expect($('input').placeholder).toBe('Search food')
  })

  it('measures with the letter spacing', () => {
    expect(longFits('abcd', 32, s => s.length * 8)).toBe(true)
    expect(longFits('abcd', 31, s => s.length * 8)).toBe(false)
  })

  it('says each tab\'s scope', () => {
    for (const [scope, short] of [['home', 'Search Gains'], ['progress', 'Search progress']]) {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
      render(<Pill key={scope} scope={scope} />)
      expect($('input').placeholder).toBe(short)
    }
    expect(() => render(<Pill scope="me" />)).toThrow(/SearchPill: scope="me"/)
  })

  it('clears with its button and with Escape, keeping the focus', () => {
    render(<Pill />)
    expect($('.spill-clear')).toBeNull()
    typeInto($('input'), 'bench')
    const clear = $('button[aria-label="Clear search"]')
    expect(clear).not.toBeNull()
    act(() => clear.click())
    expect($('input').value).toBe('')
    expect(document.activeElement).toBe($('input'))
    typeInto($('input'), 'squat')
    act(() => $('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect($('input').value).toBe('')
  })

  it('asks the overlay to open on focus and points at its listbox while it is open', () => {
    const onOpen = vi.fn()
    render(<Pill onOpen={onOpen} expanded controls="search-list" />)
    act(() => $('input').focus())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect($('input').getAttribute('role')).toBe('combobox')
    expect($('input').getAttribute('aria-haspopup')).toBe('listbox')
    expect($('input').getAttribute('aria-expanded')).toBe('true')
    expect($('input').getAttribute('aria-controls')).toBe('search-list')
  })

  it('claims a combobox only with an overlay to open (onOpen)', () => {
    render(<Pill />)
    for (const a of ['role', 'aria-haspopup', 'aria-expanded', 'aria-controls']) expect($('input').hasAttribute(a), a).toBe(false)
    render(<Pill onOpen={() => {}} />)
    expect($('input').getAttribute('role')).toBe('combobox')
    expect($('input').getAttribute('aria-expanded')).toBe('false')
    expect($('input').hasAttribute('aria-controls')).toBe(false)
  })

  it('is one label around the glyph and the input, so a tap anywhere on the pill reaches the input', () => {
    render(<Pill />)
    const pill = $('[role="search"]')
    expect(pill.tagName).toBe('LABEL')
    expect(pill.contains($('.spill-g'))).toBe(true)
    expect(pill.contains($('input'))).toBe(true)
    // the browser focuses a label's control on a click; happy-dom forwards the click itself
    const onClick = vi.fn()
    $('input').addEventListener('click', onClick)
    act(() => { pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('AvatarButton', () => {
  it('opens Profile by default and closes the search in close mode, in the same spot', () => {
    const onClose = vi.fn()
    render(<MemoryRouter><AvatarButton /></MemoryRouter>)
    expect($('.avatar-btn').getAttribute('aria-label')).toBe('Profile')
    render(<MemoryRouter><AvatarButton mode="close" onClose={onClose} /></MemoryRouter>)
    const btn = $('.avatar-btn.close')
    expect(btn.getAttribute('aria-label')).toBe('Close search')
    expect(btn.querySelector('[data-icon="xmark"]')).not.toBeNull()
    act(() => btn.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(() => render(<MemoryRouter><AvatarButton mode="open" /></MemoryRouter>)).toThrow(/AvatarButton: mode="open"/)
  })
})

describe('RootHeader (the tab-root header)', () => {
  const at = (path, el) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)

  it('is the pill, the context button and the avatar, in that order, with a hidden h1 and no title', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    at('/train', <RootHeader title="Training" action={<button className="iconbtn" aria-label="Filter">f</button>} />)
    const row = $('.tab-hdr-row')
    // The context button sits in its slot, which steps aside while search is open.
    expect([...row.children].map(c => c.className)).toEqual(['spill', 'hdr-slot', 'avatar-btn'])
    expect($('.hdr-slot .iconbtn').getAttribute('aria-label')).toBe('Filter')
    expect($('h1').className).toBe('sr-only')
    expect($('h1').textContent).toBe('Training')
    expect($('input').placeholder).toBe('Search training')
  })

  it('reads the tab from the address, not from the page', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    at('/progress', <RootHeader title="Progress" />)
    expect($('input').placeholder).toBe('Search progress')
  })

  it('keeps what was typed in the pill while search is open', () => {
    vi.spyOn(history, 'back').mockImplementation(() => {})
    at('/home', <RootHeader title="Home" />)
    act(() => $('input').focus())
    typeInto($('input'), 'chicken')
    expect($('input').value).toBe('chicken')
    act(() => $('.avatar-btn').click())
    expect($('input').value).toBe('')
  })

  it('fades its hairline in once the page has scrolled more than 4px', () => {
    // a frame that runs at once (and so is never pending when the next scroll comes)
    vi.stubGlobal('requestAnimationFrame', cb => { cb(); return 0 })
    at('/home', <RootHeader title="Home" />)
    expect($('.tab-hdr').classList.contains('scrolled')).toBe(false)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 5 })
    act(() => window.dispatchEvent(new Event('scroll')))
    expect($('.tab-hdr').classList.contains('scrolled')).toBe(true)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    act(() => window.dispatchEvent(new Event('scroll')))
    expect($('.tab-hdr').classList.contains('scrolled')).toBe(false)
  })
})

describe('SubHeader (the sub-page header)', () => {
  it('is back, the title with its sub, and the actions, on three columns', () => {
    const onBack = vi.fn()
    render(<SubHeader title="Weigh-ins" sub="12 entries" onBack={onBack} action={<button className="iconbtn" aria-label="Add">+</button>} />)
    const hdr = $('.hdr.sub-hdr')
    expect([...hdr.children].map(c => c.className)).toEqual(['iconbtn hdr-btn', 'sub-hdr-t', 'hdr-actions'])
    expect($('h1').textContent).toBe('Weigh-ins')
    expect($('.sub').textContent).toBe('12 entries')
    act(() => $('button[aria-label="Back"]').click())
    expect(onBack).toHaveBeenCalled()
  })

  it('keeps the third column with no action, so the title stays centred', () => {
    render(<SubHeader title="History" />)
    expect($('.hdr-actions')).not.toBeNull()
    expect($('.hdr-actions').children).toHaveLength(0)
  })

  it('takes two actions and throws in development on a third', () => {
    const two = <><button>a</button><button>b</button></>
    render(<SubHeader title="Plan" action={two} />)
    expect($('.hdr-actions').children).toHaveLength(2)
    expect(() => render(<SubHeader title="Plan" action={<><button>a</button><button>b</button><button>c</button></>} />)).toThrow(/at most two actions/)
  })

  it('takes a field as its title, at full width', () => {
    render(<SubHeader><input aria-label="Routine name" /></SubHeader>)
    expect($('.hdr').classList.contains('sub-hdr-field')).toBe(true)
    expect($('.sub-hdr-t input')).not.toBeNull()
    expect($('h1')).toBeNull()
  })

  it('pins itself with `sticky`', () => {
    render(<SubHeader title="Strength" sticky />)
    expect($('.hdr').classList.contains('sticky')).toBe(true)
  })

  // Measured at 320px in Chrome: «Упражнения» (131px at 22px bold) beside «По мышцам» has 118px.
  it('steps the title down to the largest size that keeps every word whole in two lines', () => {
    const measure = (s, size) => s.length * size * 0.6   // 13.2px a letter at 22px
    expect(titleStep('Exercises', 192, measure)).toBe(0)
    expect(titleStep('Упражнения', 130, measure)).toBe(1)   // 132 at 22, 120 at 20
    expect(titleStep('Упражнения', 118, measure)).toBe(2)   // 102 at 17
    expect(titleStep('Fortschrittsfotos', 60, measure)).toBe(2)   // the smallest, hyphenated
    // short words, but more than two lines' worth at 22px
    expect(titleStep('Connected apps and health data', 120, measure)).toBe(2)
  })

  it('puts the step on the h1 from the room back and the actions leave', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '', measureText: function (s) { return { width: s.length * parseFloat(/(\d+)px/.exec(this.font)?.[1] || 22) * 0.6 } },
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(288)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return this.classList.contains('hdr-actions') ? 120 : 40 })
    render(<SubHeader title="Упражнения" action={<button className="btn sm">По мышцам</button>} />)
    // 288 − 40 − 120 = 128px of room: 132 at 22 does not fit, 120 at 20 does
    expect($('h1').className).toBe('fit-1')
    render(<SubHeader title="History" />)
    expect($('h1').hasAttribute('class')).toBe(false)
  })
})
