// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => ({ samples: [], next: null }))
vi.mock('../lib/health-sync.js', async importOriginal => ({ ...(await importOriginal()), workoutSamples: async () => read.next ? read.next : read.samples }))

import SessionHeart from './SessionHeart.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const w = { start: 1000, end: 5000 }
let host, root

const open = async () => { await act(async () => { root.render(<SessionHeart w={w} />) }) }

beforeEach(() => { host = document.createElement('div'); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()) })

describe('SessionHeart', () => {
  it('draws the session on the zones, with its average and maximum', async () => {
    read.samples = [[1000, 100], [3000, 140]]
    await open()
    expect(host.querySelector('.heart-graph polyline')).not.toBeNull()
    expect(host.querySelectorAll('.heart-graph rect')).toHaveLength(5)
    expect(host.textContent).toContain('Average 120 · Max 140 bpm')
  })

  it('shows nothing when the hub has nothing', async () => {
    read.samples = []
    await open()
    expect(host.textContent).toBe('')
  })

  it('draws no curve read for other bounds while the next read runs, or after it fails', async () => {
    read.samples = [[1000, 100], [3000, 140]]
    await open()
    expect(host.textContent).toContain('Max 140')
    let fail
    read.next = new Promise((_, no) => { fail = no })
    await act(async () => { root.render(<SessionHeart w={{ start: 1000, end: 9000 }} />) })
    expect(host.textContent).toBe('')
    await act(async () => { fail(new Error('no hub')) })
    expect(host.textContent).toBe('')
    read.next = null
  })
})
