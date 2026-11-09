// @vitest-environment happy-dom
// Settings → Integrations → Calendar feed: off it offers the link, on it shows and copies it,
// changes what it shows without a new address, and a new link or Turn off asks first.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ feed: { on: false }, calls: [], confirm: null, copied: null }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (p, o) => {
    mocks.calls.push([p, o?.body ? JSON.parse(o.body) : null])
    if (p === '/api/calendar' && o?.method === 'POST') {
      const b = JSON.parse(o.body)
      mocks.feed = { on: true, done: b.done, url: b.renew || !mocks.feed.url ? 'https://gym.example.com/api/calendar/ogt_' + (b.renew ? 'B' : 'A').repeat(43) + '.ics' : mocks.feed.url }
    }
    if (p === '/api/calendar/revoke') mocks.feed = { on: false }
    return mocks.feed
  }),
  appBase: () => '/', remoteAuth: () => null,
}))
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => { mocks.confirm = o } }))
vi.mock('../lib/clipboard.js', () => ({ copyText: async v => { mocks.copied = v; return true } }))

const { CalendarSheet } = await import('./CalendarFeed.jsx')
let root, host
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => {
  mocks.feed = { on: false }; mocks.calls = []; mocks.confirm = null; mocks.copied = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the calendar feed sheet', () => {
  it('makes the link, shows it, copies it', async () => {
    act(() => root.render(<CalendarSheet close={() => {}} />))
    await flush()
    act(() => host.querySelector('[role="switch"]').click())
    act(() => btn('Make my calendar link').click())
    await flush()
    expect(mocks.calls.at(-1)).toEqual(['/api/calendar', { done: true }])
    expect(host.querySelector('.cal-url').textContent).toMatch(/ogt_A+\.ics$/)
    act(() => btn('Copy link').click())
    await flush()
    expect(mocks.copied).toMatch(/^https:\/\/gym\.example\.com\/api\/calendar\//)
  })
  it('the workouts switch keeps the address; a new link and Turn off ask first', async () => {
    mocks.feed = { on: true, done: false, url: 'https://gym.example.com/api/calendar/ogt_' + 'A'.repeat(43) + '.ics' }
    act(() => root.render(<CalendarSheet close={() => {}} />))
    await flush()
    act(() => host.querySelector('[role="switch"]').click())
    await flush()
    expect(mocks.calls.at(-1)).toEqual(['/api/calendar', { done: true }])
    expect(host.querySelector('.cal-url').textContent).toMatch(/ogt_A+/)
    act(() => btn('Make a new link').click())
    expect(mocks.confirm.title).toBe('Make a new link?')
    await act(async () => { mocks.confirm.onConfirm() })
    await flush()
    expect(host.querySelector('.cal-url').textContent).toMatch(/ogt_B+/)
    act(() => btn('Turn off').click())
    await act(async () => { mocks.confirm.onConfirm() })
    await flush()
    expect(btn('Make my calendar link')).toBeTruthy()
  })
})
