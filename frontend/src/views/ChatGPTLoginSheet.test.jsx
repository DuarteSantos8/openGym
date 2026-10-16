// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ChatGPTLoginSheet from './ChatGPTLoginSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api }))
let host, root, close, onDone
beforeEach(() => {
  vi.useFakeTimers(); api.mockReset()
  api.mockImplementation(path => Promise.resolve(path.endsWith('/cancel') ? { state: 'cancelled' } : { id: 'a', state: 'starting' }))
  close = vi.fn(); onDone = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<ChatGPTLoginSheet close={close} onDone={onDone} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const tap = async text => act(async () => { [...host.querySelectorAll('button')].find(b=>b.textContent===text).click(); await Promise.resolve() })

it('requires explicit start and displays device instructions without asking for credentials', async () => {
  expect(api).not.toHaveBeenCalled()
  api.mockResolvedValueOnce({ id:'a',state:'pending',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-EFGHI' })
  await tap('Start device sign-in')
  expect(api.mock.calls[0]).toEqual(['/api/admin/coach/auth/chatgpt/device',{method:'POST',body:'{}'}])
  expect(host.querySelector('a').href).toBe('https://auth.openai.com/codex/device')
  expect(host.textContent).toContain('ABCD-EFGHI')
  expect(host.querySelector('input')).toBeNull()
})
it('polls to completion, refreshes status and never starts a model request', async () => {
  await tap('Start device sign-in')
  api.mockResolvedValueOnce({id:'a',state:'connected'})
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(close).toHaveBeenCalledOnce(); expect(onDone).toHaveBeenCalledOnce()
  expect(api.mock.calls.some(([p])=>p.endsWith('/test'))).toBe(false)
})
it('cancels with the exact attempt id when the sheet closes', async () => {
  await tap('Start device sign-in'); await tap('Cancel sign-in')
  expect(api).toHaveBeenCalledWith('/api/admin/coach/auth/chatgpt/cancel',{method:'POST',body:'{"id":"a"}'})
  expect(close).toHaveBeenCalledOnce()
})
it('cancels an unfinished attempt on unmount', async () => {
  await tap('Start device sign-in')
  await act(async () => { root.unmount() })
  root = createRoot(host)
  expect(api).toHaveBeenCalledWith('/api/admin/coach/auth/chatgpt/cancel',{method:'POST',body:'{"id":"a"}'})
})
