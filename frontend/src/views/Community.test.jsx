// @vitest-environment happy-dom
// Community (views/Community.jsx): the gate for guests and servers without a library, the cards
// with their byline (always who and when), taking a copy, and the consent before sharing.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, sheets: [], toasts: [], calls: [] }
  state.snapshot = () => ({ S: state.S, user: state.user, config: state.config, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { openSheet: render => { mocks.sheets.push(render); return { close: () => {} } }, toast: m => mocks.toasts.push(m) }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: () => {} }))
vi.mock('../lib/api.js', () => ({
  remoteAuth: () => null,
  apiBlob: vi.fn(() => Promise.reject(new Error('no'))),
  api: vi.fn((path, opts) => {
    mocks.calls.push([opts?.method || 'GET', path, opts?.body ? JSON.parse(opts.body) : null])
    if (path.startsWith('/api/shared?')) return Promise.resolve({ items: mocks.items, next: null })
    if (path.endsWith('/import')) return Promise.resolve({ type: 'sound', payload: mocks.items[0].payload, media: [], origin: { kind: 'library', id: mocks.items[0].id, by: 'Anna', at: 1 } })
    if (path === '/api/shared') return Promise.resolve({ id: 's_new', status: 'live' })
    return Promise.resolve({})
  }),
}))

import Community from './Community.jsx'

const H = 'a'.repeat(64)
const sound = { id: 's_aaaaaaaaaaaaaaaa', type: 'sound', title: 'Big gong', desc: '', lang: 'en', status: 'live', version: 1, rev: 1, at: new Date(2026, 10, 3, 12).getTime(), createdAt: 1,
  stats: { imports: 12 }, by: { id: 'u_anna', name: 'Anna', avatar: null }, payload: { name: 'Big gong', m: { kind: 'audio', hash: H, mime: 'audio/wav', size: 100, width: 1, height: 1, dur: 1.2 } } }
const CONFIG = { shared: { types: ['sound', 'exercise', 'tip', 'avatar'], review: false, consent: { kind: 'library', v: 1, hash: 'h' } } }

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', sounds: [{ id: 'mine', name: 'My clap', m: { ...sound.payload.m, hash: 'b'.repeat(64) } }] }
  mocks.user = { id: 'u_ben', name: 'Ben' }
  mocks.config = CONFIG
  mocks.items = [sound]
  mocks.sheets = []; mocks.toasts = []; mocks.calls = []
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const flush = () => act(() => new Promise(r => setTimeout(r, 20)))
const mount = async () => { await act(() => root.render(<MemoryRouter><Community /></MemoryRouter>)); await flush() }
const sheet = async () => { const h = document.createElement('div'); document.body.appendChild(h); const r = createRoot(h); await act(() => r.render(<MemoryRouter>{mocks.sheets.at(-1)(() => {})}</MemoryRouter>)); await flush(); return h }
const btn = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('Community', () => {
  it('a guest or a phone on its own gets a line, not a dead button', async () => {
    mocks.user = null
    await mount()
    expect(host.textContent).toContain('Sharing works once you are connected to a server.')
    expect(mocks.calls).toHaveLength(0)
  })
  it('a server without a library says so', async () => {
    mocks.config = {}
    await mount()
    expect(host.textContent).toContain('This server has no community library.')
  })
  it('every card says who shared it and when', async () => {
    await mount()
    expect(mocks.calls[0][1]).toMatch(/type=exercise.*sort=new/)
    const card = host.querySelector('.com-card')
    expect(card.textContent).toContain('Big gong')
    expect(card.querySelector('.com-by').textContent).toMatch(/by Anna · 3 Nov/)
    expect(card.textContent).toContain('12× taken')
  })
  it('Get copies it into the profile, with where it came from', async () => {
    await mount()
    await act(() => btn(host, 'Get').click())
    await flush()
    expect(mocks.calls.some(c => c[1] === `/api/shared/${sound.id}/import`)).toBe(true)
    expect(mocks.S.sounds.find(s => s.origin?.id === sound.id).origin.by).toBe('Anna')
    expect(mocks.toasts.at(-1)).toMatch(/Got it/)
  })
  it('a copy you already hold says so instead of Get', async () => {
    mocks.S.sounds.push({ id: 'x', name: 'Big gong', m: sound.payload.m, origin: { kind: 'library', id: sound.id, by: 'Anna', at: 1 } })
    await mount()
    expect(btn(host, 'Get')).toBeUndefined()
    expect(host.textContent).toContain('In yours')
  })
  it('sharing asks per item: public to the server, and the tick that it is yours', async () => {
    mocks.items = []
    await mount()
    expect(host.textContent).toContain('Nothing here yet. Be the first to share something.')
    await act(() => btn(host, 'Share yours').click())
    const list = await sheet()
    await act(() => [...list.querySelectorAll('.chip')].find(b => b.textContent === 'Sounds').click())
    await flush()
    await act(() => btn(list, 'Share').click())
    const consent = await sheet()
    expect(consent.textContent).toContain('This is public to everyone on this server')
    expect(consent.textContent).toContain('licensed and can never be shared')
    const go = btn(consent, 'Share it')
    expect(go.disabled).toBe(true)
    await act(() => consent.querySelector('[role="checkbox"]').click())
    expect(btn(consent, 'Share it').disabled).toBe(false)
    await act(() => btn(consent, 'Share it').click())
    await flush()
    const post = mocks.calls.find(c => c[0] === 'POST' && c[1] === '/api/shared')
    expect(post[2]).toMatchObject({ type: 'sound', src: 'sound:mine', title: 'My clap', consent: { v: 1, hash: 'h', own: true } })
    expect(mocks.toasts.at(-1)).toBe('Shared. Your gym thanks you.')
  })
})
