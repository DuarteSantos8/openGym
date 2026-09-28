// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

// BodyMap fetches its ~90 KB of geometry with a dynamic import on first render, and the
// waitFor below allows one second for it. That is ample once the module is in the ESM
// registry and not always ample when it is not: on a loaded CI runner the first map render
// in this file paid the cold import and timed out, while every later test passed on the
// component's warm CACHE. Import it here so the wait covers rendering, not module loading,
// and the file stops depending on how fast the machine is.
beforeAll(() => import('../lib/body-paths.js'))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderMap(props = {}) {
  await act(async () => {
    root.render(<BodyMap load={{ chest: 2 }} {...props} />)
  })
  await vi.waitFor(() => expect(container.querySelectorAll('.bm-v')).toHaveLength(2))
  return container.querySelector('.bm-m[aria-label="Chest"]')
}

describe('BodyMap interaction semantics', () => {
  it('keeps noninteractive maps as images without focusable muscle controls', async () => {
    await renderMap()
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2)
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('exposes interactive muscles as translated pressed buttons inside groups', async () => {
    const path = await renderMap({ selected: 'chest', onMuscle: vi.fn() })
    expect(container.querySelectorAll('svg[role="group"]')).toHaveLength(2)
    expect(path).toBeTruthy()
    expect(path.tabIndex).toBe(0)
    expect(path.getAttribute('aria-pressed')).toBe('true')
  })

  it.each(['Enter', ' '])('activates a muscle once with %s', async key => {
    const onMuscle = vi.fn()
    const path = await renderMap({ onMuscle })
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })

    act(() => path.dispatchEvent(event))

    expect(onMuscle).toHaveBeenCalledTimes(1)
    expect(onMuscle).toHaveBeenCalledWith('chest')
    expect(event.defaultPrevented).toBe(key === ' ')
  })

  it('labels the existing legend direction for assistive technology', () => {
    act(() => root.render(<BodyMapLegend />))
    expect(container.querySelector('.hm-legend').getAttribute('aria-label')).toBe('Less More')
  })
})
