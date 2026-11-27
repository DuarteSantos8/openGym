// @vitest-environment happy-dom
// The movement demo on the exercise sheet (EP26-T01, E5a): the 3D rig when the device can show
// it, and a still key pose with words when it cannot, or when the person asked for no motion.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MannequinDemo from './MannequinDemo.jsx'
import { poseFor, stillTextFor } from './poses.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })

function mount(node) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(node))
  return container
}

/** Let the lazily loaded rig and its promise settle, until `ready` says so. */
async function settleUntil(ready) {
  for (let i = 0; i < 50; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    if (ready()) return
  }
  throw new Error('the rig did not start in time')
}

/** Pretend the device says it wants no motion. */
function withReducedMotion(on) {
  vi.stubGlobal('matchMedia', q => ({ matches: on && q.includes('reduced-motion'), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
}

/** Pretend the device can (or cannot) make a WebGL context. */
function withWebGL(on) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (type) {
    if (on && (type === 'webgl2' || type === 'webgl')) return { getContextAttributes: () => ({}) }
    return null
  })
}

const fakeScene = () => ({ play: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setPattern: vi.fn() })

describe('MannequinDemo', () => {
  beforeEach(() => {
    withReducedMotion(false)
    withWebGL(false)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('shows the key pose in words', () => {
    const c = mount(<MannequinDemo pattern="squat" />)
    expect(c.textContent).toContain(stillTextFor('squat'))
  })

  it('shows a still key pose and starts nothing when motion is off', () => {
    withReducedMotion(true)
    const createScene = vi.fn()
    const c = mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    expect(c.querySelector('[data-mm-still]')).toBeTruthy()
    expect(c.textContent).toContain(stillTextFor('squat'))
    expect(c.querySelector('canvas')).toBe(null)
    expect(createScene).not.toHaveBeenCalled()
  })

  it('shows the same still and says why when WebGL is unavailable', () => {
    const createScene = vi.fn()
    const c = mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    expect(c.querySelector('[data-mm-still]')).toBeTruthy()
    expect(c.textContent).toContain(stillTextFor('squat'))
    expect(c.querySelector('canvas')).toBe(null)
    expect(createScene).not.toHaveBeenCalled()
  })

  it('draws the key pose as a figure, not an empty box', () => {
    const c = mount(<MannequinDemo pattern="squat" />)
    const still = c.querySelector('[data-mm-still]')
    expect(still.tagName.toLowerCase()).toBe('svg')
    expect(still.querySelectorAll('path,line,circle,polyline').length).toBeGreaterThanOrEqual(8)
    expect(still.getAttribute('aria-label')).toBeTruthy()
  })

  it('draws the figure the right way up, head above the floor', () => {
    const c = mount(<MannequinDemo pattern="squat" />)
    const still = c.querySelector('[data-mm-still]')
    const head = Number(still.querySelector('.mm-still-head').getAttribute('cy'))
    const floor = Number(still.querySelector('.mm-still-floor').getAttribute('y1'))
    expect(head).toBeLessThan(floor)
  })

  it('runs the rig when the device can show it', async () => {
    withWebGL(true)
    const createScene = vi.fn(() => Promise.resolve(fakeScene()))
    mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    await settleUntil(() => createScene.mock.calls.length > 0)
    expect(createScene).toHaveBeenCalledTimes(1)
  })

  it('gives the motion control to the keyboard and starts the movement with it', async () => {
    withWebGL(true)
    const scene = fakeScene()
    const createScene = vi.fn(() => Promise.resolve(scene))
    const c = mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    await settleUntil(() => createScene.mock.calls.length > 0)
    const button = c.querySelector('button')
    expect(button).toBeTruthy()
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    act(() => button.click())
    expect(scene.play).toHaveBeenCalled()
  })

  it('frees the rig when the sheet closes', async () => {
    withWebGL(true)
    const scene = fakeScene()
    const createScene = vi.fn(() => Promise.resolve(scene))
    mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    await settleUntil(() => createScene.mock.calls.length > 0)
    act(() => root.unmount())
    root = null
    expect(scene.dispose).toHaveBeenCalled()
  })

  it('restores the key caption when WebGL is lost after the pose changes', async () => {
    withWebGL(true)
    const createScene = vi.fn(() => Promise.resolve(fakeScene()))
    const c = mount(<MannequinDemo pattern="squat" createScene={createScene} />)
    await settleUntil(() => createScene.mock.calls.length > 0)
    const { onFrame, onError } = createScene.mock.calls[0][1]
    act(() => onFrame(poseFor('squat')[0]))
    expect(c.textContent).toContain(poseFor('squat')[0].note)
    act(onError)
    expect(c.querySelector('[data-mm-still="squat"]')).toBeTruthy()
    expect(c.textContent).toContain(stillTextFor('squat'))
  })

  it('shows nothing for a pattern it has no pose for', () => {
    const c = mount(<MannequinDemo pattern="unsupported" />)
    expect(c.innerHTML).toBe('')
  })
})
