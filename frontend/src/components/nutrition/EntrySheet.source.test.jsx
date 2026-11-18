// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
vi.mock('../../lib/api.js', () => ({ api: vi.fn() }))
import EntrySheet from './EntrySheet.jsx'
import { DEF, useStore } from '../../store/useStore.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
test('manual creation blocks repeated synchronous submits while the sheet closes', async () => {
  useStore.setState({ S: { ...structuredClone(DEF), modules: { nutrition: true } }, user: null, ready: true })
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<EntrySheet day="2026-11-14" owner={null} close={() => {}} prefill={{ label: 'Manual food', source: 'manual' }} />))
    await act(async () => { const f = host.querySelector('form'); f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(useStore.getState().S.nutritionEntries).toHaveLength(1)
  } finally { act(() => root.unmount()); useStore.setState({ ready: false }) }
})
