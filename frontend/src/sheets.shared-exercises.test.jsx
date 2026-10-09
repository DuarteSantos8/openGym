// @vitest-environment happy-dom
// Exercise editor permissions, publication, withdrawal and account changes during saves.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const h = vi.hoisted(() => ({ ingest: null, publish: vi.fn(), unpublish: vi.fn(), refresh: vi.fn() }))
vi.mock('./lib/media-ingest.js', () => ({ ingestMediaFile: (...a) => h.ingest(...a) }))

vi.mock('./lib/server-exercises.js', async importOriginal => ({
  ...await importOriginal(), publishServerExercise: (...a) => h.publish(...a),
  unpublishServerExercise: (...a) => h.unpublish(...a), refreshServerExercises: (...a) => h.refresh(...a),
}))

import { registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from './lib/media-store.js'
import { customExSheet, deleteCustomEx } from './sheets.jsx'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S
const HASH = 'a'.repeat(64)
const POSTER = 'b'.repeat(64)
const REF = { kind: 'image', hash: HASH, mime: 'image/webp', size: 204800, width: 1600, height: 1200, poster: { hash: POSTER, mime: 'image/webp', size: 20480, width: 480, height: 360 }, at: 1727000000000 }

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const click = (host, sel, text) => {
  const el = [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() => el.click())
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const custom = (over = {}) => ({ id: 'cm1', n: 'Sandbag carry', bp: 'back', eq: 'barbell', custom: true, desc: '', tg: '', sm: [], primaries: [], secondaries: [], muscleGroups: [], ...over })
function seed(ex) {
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } }))
  registerCustom([ex])
}

let media
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  media = createMediaStore({ ...memoryBackend(), persistent: true, name: 'test' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
  _setMediaStore(media)
  h.ingest = vi.fn(async () => ({
    media: REF,
    blobs: [{ hash: HASH, blob: new Blob(['main']), mime: 'image/webp' }, { hash: POSTER, blob: new Blob(['poster']), mime: 'image/webp' }],
    warnings: []
  }))
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setMediaStore(null)
  registerCustom([])
})


beforeEach(() => {
  h.publish.mockReset().mockImplementation(async e => ({ ...e, serverShared: true, serverRevision: 1 }))
  h.unpublish.mockReset().mockResolvedValue({ ok: true })
  h.refresh.mockReset()
  useStore.setState({ config: { shared_exercises: true } })
})
const asAdmin = () => useStore.setState({ user: { id: 'admin', admin: true } })
const prepare = () => {
  customExSheet(null); const form = renderTop()
  act(() => type(form.querySelector('input.input'), 'Shared row'))
  click(form, '.chip', 'back'); click(form, '.chip', 'barbell')
  return form
}
const shareSwitch = form => form.querySelector('[aria-label="Share with the server"]')

describe('administrator exercise publication', () => {
  it('shows the switch to administrators on a supporting server', () => {
    asAdmin(); expect(shareSwitch(prepare())).not.toBeNull()
  })
  it('hides the switch from ordinary users and signed-out profiles', () => {
    useStore.setState({ user: { id: 'user', admin: false } })
    expect(shareSwitch(prepare())).toBeNull()
    useStore.setState({ user: null })
    expect(shareSwitch(prepare())).toBeNull()
  })
  it('keeps the editor compatible with older servers', () => {
    asAdmin(); useStore.setState({ config: {} })
    expect(shareSwitch(prepare())).toBeNull()
  })
  it('creates a private exercise when sharing is off', async () => {
    asAdmin(); const form = prepare(); click(form, 'button', 'Create exercise'); await settle()
    expect(h.publish).not.toHaveBeenCalled(); expect(S().customEx[0].serverShared).toBeUndefined()
  })
  it('publishes after enabling the switch and stores the returned definition', async () => {
    asAdmin(); const form = prepare(); act(() => shareSwitch(form).click())
    click(form, 'button', 'Create exercise'); await settle()
    expect(h.publish).toHaveBeenCalledOnce(); expect(S().customEx[0].serverRevision).toBe(1)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('keeps the form and unsaved values when the API refuses publication', async () => {
    asAdmin(); h.publish.mockRejectedValue({ data: { code: 'shared-exercise-conflict' } })
    const form = prepare(); act(() => shareSwitch(form).click())
    click(form, 'button', 'Create exercise'); await settle()
    expect(S().customEx).toHaveLength(0); expect(useUI.getState().sheets).toHaveLength(1)
    expect(form.querySelector('input.input').value).toBe('Shared row')
    expect(useUI.getState().toastMsg).toContain('Reopen')
  })
  it('withdraws a shared exercise while keeping an editable private copy', async () => {
    asAdmin(); const ex = custom({ serverShared: true, serverRevision: 1 }); seed(ex)
    customExSheet(ex); const form = renderTop(); act(() => shareSwitch(form).click())
    click(form, 'button', 'Save'); await settle()
    expect(h.unpublish).toHaveBeenCalledOnce(); expect(S().customEx[0].serverShared).toBeUndefined()
  })
  it('ordinary users cannot open the shared editor or delete its definition', () => {
    const ex = custom({ serverShared: true }); seed(ex)
    useStore.setState({ user: { id: 'ordinary', admin: false } })
    customExSheet(ex); deleteCustomEx(ex)
    expect(useUI.getState().sheets).toHaveLength(0); expect(S().customEx).toHaveLength(1)
  })
  it('does not save a returned definition into a different account', async () => {
    asAdmin(); let resolve; h.publish.mockReturnValue(new Promise(r => { resolve = r }))
    const form = prepare(); act(() => shareSwitch(form).click()); click(form, 'button', 'Create exercise')
    act(() => useStore.setState({ user: { id: 'other' }, S: { ...structuredClone(DEF) } }))
    await act(async () => resolve(custom({ serverShared: true }))); await settle()
    expect(S().customEx).toHaveLength(0)
  })
  it('ignores a deletion confirmation after the account changes', async () => {
    asAdmin(); const ex = custom({ serverShared: true }); seed(ex); deleteCustomEx(ex)
    const confirmation = renderTop()
    act(() => useStore.setState({ user: { id: 'other', admin: true } }))
    click(confirmation, 'button', 'Delete'); await settle()
    expect(h.unpublish).not.toHaveBeenCalled(); expect(S().customEx).toHaveLength(1)
  })
})
