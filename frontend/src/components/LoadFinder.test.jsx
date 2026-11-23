// @vitest-environment happy-dom
// The first-session load finder (EP22-T04): a test set, how it felt, the next weight to try.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoadFinder } from './LoadFinder.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })
function mount(node) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(node))
}
const tap = sel => act(() => { container.querySelector(sel).click() })
const ex = { id: '0025', n: 'barbell bench press', eq: 'barbell' }

describe('LoadFinder', () => {
  it('opens on the empty bar with the planned reps and three answers', () => {
    mount(<LoadFinder ex={ex} unit="kg" step={2.5} reps={8} onUse={() => {}} close={() => {}} />)
    expect(container.querySelector('.iv-lf-try').textContent).toContain('8')
    expect(container.querySelector('.iv-lf').dataset.weight).toBe('20')
    expect([...container.querySelectorAll('[data-feel]')].map(b => b.dataset.feel)).toEqual(['easy', 'right', 'hard'])
    expect(container.querySelector('[data-use]')).toBeNull()
  })

  it('easy moves the weight up and counts the test set', () => {
    mount(<LoadFinder ex={ex} unit="kg" step={2.5} reps={8} onUse={() => {}} close={() => {}} />)
    tap('[data-feel="easy"]')
    expect(container.querySelector('.iv-lf').dataset.weight).toBe('25')
    expect(container.querySelector('.iv-lf').dataset.tries).toBe('1')
    expect(container.querySelector('.iv-lf-rest')).not.toBeNull()
  })

  it('about right ends it: the weight is offered, used and the sheet closes', () => {
    const onUse = vi.fn(); const close = vi.fn()
    mount(<LoadFinder ex={ex} unit="kg" step={2.5} reps={8} onUse={onUse} close={close} />)
    tap('[data-feel="easy"]')
    tap('[data-feel="right"]')
    expect(container.querySelector('[data-feel]')).toBeNull()
    expect(container.querySelector('.iv-lf-found').textContent).toContain('25 kg')
    tap('[data-use]')
    expect(onUse).toHaveBeenCalledWith(25)
    expect(close).toHaveBeenCalled()
  })

  it('easy then too hard settles on the weight that was easy', () => {
    const onUse = vi.fn()
    mount(<LoadFinder ex={ex} unit="kg" step={2.5} reps={8} onUse={onUse} close={() => {}} />)
    tap('[data-feel="easy"]')
    tap('[data-feel="hard"]')
    tap('[data-use]')
    expect(onUse).toHaveBeenCalledWith(20)
  })

  it('speaks pounds for a pounds profile and never writes anything on its own', () => {
    const onUse = vi.fn()
    mount(<LoadFinder ex={{ eq: 'dumbbell', n: 'dumbbell curl' }} unit="lb" step={5} reps={10} onUse={onUse} close={() => {}} />)
    expect(container.querySelector('.iv-lf').dataset.weight).toBe('10')
    tap('[data-feel="hard"]')
    expect(container.querySelector('.iv-lf').dataset.weight).toBe('5')
    expect(onUse).not.toHaveBeenCalled()
  })

  it('says the test sets are not logged and that pain means stop', () => {
    mount(<LoadFinder ex={ex} unit="kg" step={2.5} reps={8} onUse={() => {}} close={() => {}} />)
    expect(container.querySelector('.iv-lf-foot').textContent).toMatch(/not logged/i)
    expect(container.querySelector('.iv-lf-foot').textContent).toMatch(/hurts/i)
  })
})
