// @vitest-environment happy-dom
// EP-02 primitives: role, accessible name, keyboard, empty and error state.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import MetricCard from './MetricCard.jsx'
import Skeleton from './Skeleton.jsx'
import ErrorState from './ErrorState.jsx'
import EmptyState from './EmptyState.jsx'
import { Row, Section } from './ui.jsx'

const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(el))
  return host
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => mounted.splice(0).forEach(([r, h]) => { r.unmount(); h.remove() })) })

describe('MetricCard', () => {
  it('is a labelled group whose name carries label, value and unit', () => {
    const h = render(<MetricCard label="Body weight" value="82.4" unit="kg" />)
    const g = h.querySelector('[role="group"]')
    expect(g).toBeTruthy()
    expect(g.getAttribute('aria-label')).toBe('Body weight: 82.4 kg')
  })
  it('states a change in words, not colour alone', () => {
    const h = render(<MetricCard label="Body weight" value="82.4" unit="kg" delta={-0.6} deltaText="−0.6" />)
    expect(h.textContent).toContain('−0.6')
    expect(h.querySelector('[role="group"]').getAttribute('aria-label')).toContain('−0.6')
  })
  it('shows a dash for a missing value (empty state)', () => {
    const h = render(<MetricCard label="Body weight" value={null} />)
    expect(h.querySelector('.metric-v').textContent).toBe('–')
  })
  it('is a button, reachable by keyboard, when it has an action', () => {
    const on = vi.fn()
    const h = render(<MetricCard label="Body weight" value="82" onClick={on} />)
    const b = h.querySelector('button')
    expect(b).toBeTruthy()
    expect(b.tabIndex).toBe(0)
    expect(b.getAttribute('aria-label')).toBe('Body weight: 82')
    act(() => b.click())
    expect(on).toHaveBeenCalledTimes(1)
  })
})

describe('MetricCard button name', () => {
  it('names label, value, unit and signed change', () => {
    const h = render(<MetricCard label="Body weight" value="82.4" unit="kg" delta={-0.6} deltaText={'\u22120.6'} onClick={() => {}} />)
    expect(h.querySelector('button').getAttribute('aria-label')).toBe('Body weight: 82.4 kg \u22120.6')
  })
})

describe('Skeleton', () => {
  it('announces its translated label once and hides the decorative bars', () => {
    const h = render(<Skeleton lines={3} label="Loading" />)
    const s = h.querySelector('[role="status"]')
    expect(s.hasAttribute('aria-busy')).toBe(false)
    expect(s.querySelector('.vh').textContent).toBe('Loading')
    expect(s.querySelectorAll('.skel-line').length).toBe(3)
    expect(s.querySelector('.skel-line').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ErrorState', () => {
  it('is an alert with a retry button that fires once', () => {
    const retry = vi.fn()
    const h = render(<ErrorState title="Could not load" text="Check your connection." retryLabel="Try again" onRetry={retry} />)
    expect(h.querySelector('[role="alert"]').textContent).toContain('Could not load')
    const b = [...h.querySelectorAll('button')].find(x => x.textContent.includes('Try again'))
    expect(b).toBeTruthy()
    act(() => b.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('has no button when there is nothing to retry', () => {
    const h = render(<ErrorState title="Could not load" />)
    expect(h.querySelector('button')).toBeNull()
  })
})

describe('EmptyState (existing)', () => {
  it('shows title, text and the first action', () => {
    const on = vi.fn()
    const h = render(<EmptyState title="Nothing yet" text="Log one." ><button onClick={on}>Log</button></EmptyState>)
    expect(h.textContent).toContain('Nothing yet')
    act(() => h.querySelector('button').click())
    expect(on).toHaveBeenCalled()
  })
})

describe('Row and Section (existing)', () => {
  it('a Row with onClick is a real button named by its title', () => {
    const on = vi.fn()
    const h = render(<Section title="Body"><Row title="Weight" subtitle="Last week" value="82" onClick={on} accessory="chevron" /></Section>)
    expect(h.querySelector('h2').textContent).toBe('Body')
    const b = h.querySelector('button.lrow')
    expect(b.textContent).toContain('Weight')
    act(() => b.click())
    expect(on).toHaveBeenCalledTimes(1)
  })
  it('a Row without onClick is not focusable', () => {
    const h = render(<Row title="Plain" />)
    expect(h.querySelector('button')).toBeNull()
  })
})
