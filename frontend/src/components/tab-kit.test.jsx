// @vitest-environment happy-dom
// The tab roots' blocks (tab-kit.jsx): what each says and does in every state it has.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ActionButton, ActionRow, HeroStatus, MacroGauge, MacroGauges, MediaRow, SectionHeader, StatSection, StickyActionBar,
} from './tab-kit.jsx'

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
})

const render = el => act(() => root.render(el))
const $ = s => host.querySelector(s)
const $$ = s => [...host.querySelectorAll(s)]

describe('HeroStatus', () => {
  it('is a glyph, an eyebrow, a big value with its unit and a caption', () => {
    render(<HeroStatus glyph="flame" eyebrow="Left today" value="1,240" unit="kcal" caption="860 eaten · goal 2,100" />)
    expect($('.hero-g').getAttribute('data-icon')).toBe('flame')
    expect($('.hero-e').textContent).toBe('Left today')
    expect($('.hero-num').textContent).toBe('1,240')
    expect($('.hero-u').textContent).toBe('kcal')
    expect($('.hero-c').textContent).toBe('860 eaten · goal 2,100')
  })

  it('takes a title instead of a value, as the page\'s second-level heading', () => {
    render(<HeroStatus glyph="moon" title="Rest day" caption="Next: Push, Thursday" />)
    expect($('h2.hero-t').textContent).toBe('Rest day')
    expect($('.hero-v')).toBeNull()
  })

  it('splits two metrics with a hairline', () => {
    render(<HeroStatus metrics={[{ value: '1,240', unit: 'kcal', label: 'Left', sub: '860 eaten' }, { value: '1.2', unit: 'l', label: 'Water' }]} />)
    expect($$('.hero-mi')).toHaveLength(2)
    expect($$('.hero-ml').map(e => e.textContent)).toEqual(['Left', 'Water'])
    expect($('.hero-ms').textContent).toBe('860 eaten')
  })

  it('stands skeletons in while it loads, announced once', () => {
    render(<HeroStatus glyph="flame" eyebrow="x" value="1" caption="y" status="loading" />)
    expect($('.hero').getAttribute('role')).toBe('status')
    expect($('.hero').hasAttribute('aria-label')).toBe(false)
    // real text for a screen reader to read, visually hidden; the skeletons say nothing
    expect($('.hero .sr-only').textContent).toBe('Loading today')
    expect($('.hero').textContent).toBe('Loading today')
    expect($$('.skel')).toHaveLength(4)
    expect($$('.skel').every(s => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('says an error with a retry, an empty value as a dash, and over in orange ink', () => {
    const onRetry = vi.fn()
    render(<HeroStatus value="–" caption="Today's diary did not load." status="error" onRetry={onRetry} />)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Try again').click())
    expect(onRetry).toHaveBeenCalled()
    render(<HeroStatus value="1,240" unit="kcal" status="empty" />)
    expect($('.hero-num').textContent).toBe('–')
    expect($('.hero-u')).toBeNull()
    render(<HeroStatus eyebrow="Over" value="120" unit="kcal" caption="over your goal" tone="over" />)
    expect($('.hero-c').classList.contains('ink-orange')).toBe(true)
    expect($('.hero-num').classList.contains('ink-orange')).toBe(false)
    expect(() => render(<HeroStatus status="busy" />)).toThrow(/HeroStatus: status="busy"/)
  })
})

describe('ActionRow / ActionButton', () => {
  const b = label => <ActionButton key={label} icon="plus" label={label} onClick={() => {}} />

  it('lays two to four actions out in equal columns', () => {
    render(<ActionRow>{['Start', 'Log food', '+250 ml'].map(b)}</ActionRow>)
    expect($('.act-row').style.getPropertyValue('--n')).toBe('3')
    expect($$('.act-b')).toHaveLength(3)
    expect(() => render(<ActionRow>{['a', 'b', 'c', 'd', 'e'].map(b)}</ActionRow>)).toThrow(/2 to 4 actions, not 5/)
    expect(() => render(<ActionRow>{b('a')}</ActionRow>)).toThrow(/not 1/)
  })

  it('has no filled primary: every disc is the same (Owner decision 7)', () => {
    render(<ActionRow>{['Start', 'Log food'].map(b)}</ActionRow>)
    expect($$('.act-d').map(d => d.className)).toEqual(['act-d', 'act-d'])
    expect(host.innerHTML).not.toMatch(/primary/)
  })

  it('is a button with its label, busy with a spinner, disabled, and badged for a screen reader', () => {
    const onClick = vi.fn()
    render(<ActionButton icon="scanBarcode" label="Scan" onClick={onClick} />)
    act(() => $('.act-b').click())
    expect(onClick).toHaveBeenCalled()
    expect($('.act-l').textContent).toBe('Scan')
    expect($('.act-b').hasAttribute('aria-label')).toBe(false)
    render(<ActionButton icon="scanBarcode" label="Scan" busy />)
    expect($('.act-b').getAttribute('aria-busy')).toBe('true')
    expect($('.act-spin')).not.toBeNull()
    expect($('[data-icon]')).toBeNull()
    render(<ActionButton icon="qr" label="Check in" disabled badge="1 card due" />)
    expect($('.act-b').disabled).toBe(true)
    expect($('.act-b').getAttribute('aria-label')).toBe('Check in, 1 card due')
    expect($('.act-badge')).not.toBeNull()
  })
})

describe('MacroGauge', () => {
  it('is a meter in its macro\'s colour, with the value against the target', () => {
    render(<MacroGauges><MacroGauge macro="protein" value={96} target={150} /></MacroGauges>)
    const m = $('.mg')
    expect(m.parentElement.className).toBe('mg-row')
    expect(m.className).toBe('mg mg-protein')
    expect(m.getAttribute('role')).toBe('meter')
    expect(m.getAttribute('aria-label')).toBe('Protein')
    expect(m.getAttribute('aria-valuenow')).toBe('96')
    expect(m.getAttribute('aria-valuemax')).toBe('150')
    expect(m.getAttribute('aria-valuetext')).toBe('96 g of 150 g')
    expect($('.mg-arc').style.getPropertyValue('--mg')).toBe('0.64')
    expect($('.mg-of').textContent).toBe('of 150 g')
    // the start cap is always drawn, so the key reads at 0 g too
    render(<MacroGauge macro="fat" value={0} target={70} />)
    expect($('.mg-cap')).not.toBeNull()
    expect($('.mg-arc').style.getPropertyValue('--mg')).toBe('0')
  })

  it('fills the arc over target and says by how much, in orange ink', () => {
    render(<MacroGauge macro="carbs" value={262} target={250} />)
    expect($('.mg-arc').style.getPropertyValue('--mg')).toBe('1')
    expect($('.mg-of').textContent).toBe('+12 g')
    expect($('.mg-of').classList.contains('ink-orange')).toBe(true)
    // the meter never reads above its max, and says the overshoot in words
    const m = $('.mg')
    expect(m.getAttribute('aria-valuenow')).toBe('250')
    expect(m.getAttribute('aria-valuemax')).toBe('250')
    expect(m.getAttribute('aria-valuetext')).toBe('262 g of 250 g, over by 12 g')
  })

  it('is at most its max at the target, and is not "over" there', () => {
    render(<MacroGauge macro="carbs" value={250} target={250} />)
    expect($('.mg').getAttribute('aria-valuenow')).toBe('250')
    expect($('.mg').getAttribute('aria-valuetext')).toBe('250 g of 250 g')
  })

  it('shows the value alone with no target, and throws on a macro it has no colour for', () => {
    render(<MacroGauge macro="protein" value={40} />)
    expect($('.mg-of')).toBeNull()
    // no target: the amount is the whole scale, so now never exceeds max
    expect($('.mg').getAttribute('aria-valuenow')).toBe('40')
    expect($('.mg').getAttribute('aria-valuemax')).toBe('40')
    expect($('.mg').getAttribute('aria-valuetext')).toBe('40 g')
    render(<MacroGauge macro="protein" value={0} />)
    expect($('.mg').getAttribute('aria-valuemax')).toBe('1')
    expect($('.mg').getAttribute('aria-valuenow')).toBe('0')
    expect(() => render(<MacroGauge macro="fibre" value={3} />)).toThrow(/MacroGauge: macro="fibre"/)
  })
})

describe('SectionHeader', () => {
  it('is a heading with a text link at its end', () => {
    const onLink = vi.fn()
    render(<SectionHeader title="Routines" link="See all" onLink={onLink} />)
    expect($('h2.sec-h-t').textContent).toBe('Routines')
    act(() => $('.sec-h-l').click())
    expect(onLink).toHaveBeenCalled()
  })

  it('is one button with a chevron when the whole heading opens something', () => {
    const onOpen = vi.fn()
    render(<SectionHeader title="This week" onOpen={onOpen} />)
    const btn = $('h2.sec-h > button')
    expect(btn.querySelector('[data-icon="chevronRight"]')).not.toBeNull()
    act(() => btn.click())
    expect(onOpen).toHaveBeenCalled()
    expect($$('button')).toHaveLength(1)
  })
})

describe('StatSection', () => {
  it('is a card whose title is the one button, with one or two values', () => {
    const onOpen = vi.fn()
    render(<StatSection title="Strength" onOpen={onOpen} values={[{ value: 4, label: 'Personal records' }, { value: 12, label: 'Exercises' }]} />)
    expect($('section.card.stat-sec')).not.toBeNull()
    expect($$('button')).toHaveLength(1)
    act(() => $('.stat-sec-h button').click())
    expect(onOpen).toHaveBeenCalled()
    expect($$('.stat-sec-v')).toHaveLength(2)
    expect($('.lrow-i')).toBeNull()   // no icon tile
    expect(() => render(<StatSection title="x" values={[{ label: 'a' }, { label: 'b' }, { label: 'c' }]} />)).toThrow(/one or two values/)
  })

  it('loads, says it is empty with a dash and a sentence, and errs with a retry', () => {
    render(<StatSection title="Body" status="loading" values={[{ value: 80, unit: 'kg', label: 'Latest' }]} />)
    expect($('section').getAttribute('aria-busy')).toBe('true')
    expect($('.skel')).not.toBeNull()
    render(<StatSection title="Body" status="empty" note="No weigh-ins yet" values={[{ value: 80, unit: 'kg', label: 'Latest' }]} footer={<span className="f" />} />)
    expect($('.stat-sec-num').textContent).toBe('–')
    expect($('.stat-sec-n').textContent).toBe('No weigh-ins yet')
    expect($('.f')).toBeNull()
    const onRetry = vi.fn()
    render(<StatSection title="Nutrition trends" status="error" note="Nutrition did not load" onRetry={onRetry} values={[{ value: 1, label: 'x' }]} />)
    expect($('.stat-sec-v')).toBeNull()
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Try again').click())
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('MediaRow', () => {
  it('is one tappable row with no control of its own', () => {
    const onOpen = vi.fn()
    render(<MediaRow art={<svg className="art" />} title="Push day" subtitle="6 exercises" onOpen={onOpen} chevron />)
    const row = $('.item.item-lg')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.querySelector('.media-lead .art')).not.toBeNull()
    act(() => row.click())
    expect(onOpen).toHaveBeenCalled()
    expect($('.chev')).not.toBeNull()
  })

  it('opens from its title block when it carries a link line or a play disc', () => {
    const onOpen = vi.fn(), onLink = vi.fn(), onPlay = vi.fn()
    render(<MediaRow title="Push day" subtitle="Thursday" onOpen={onOpen} link={{ icon: 'clipboard', label: 'Edit plan', onClick: onLink }} onPlay={onPlay} playLabel="Start Push day" />)
    expect($('.item').hasAttribute('role')).toBe(false)
    act(() => $('.item-open').click())
    act(() => $('.media-link').click())
    act(() => $('button[aria-label="Start Push day"]').click())
    expect([onOpen, onLink, onPlay].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
    // no control nested in another
    expect($$('button button')).toHaveLength(0)
  })

  it('has an exercise variant with the smaller thumb', () => {
    render(<MediaRow variant="exercise" title="Bench press" />)
    expect($('.item').classList.contains('item-exercise')).toBe(true)
    expect(() => render(<MediaRow variant="photo" title="x" />)).toThrow(/MediaRow: variant="photo"/)
  })
})

describe('StickyActionBar', () => {
  it('holds the page\'s one main action', () => {
    render(<StickyActionBar><button className="btn primary btn-pill">Log weight</button></StickyActionBar>)
    expect($('.sticky-act > .btn-pill').textContent).toBe('Log weight')
  })
})
