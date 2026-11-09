// @vitest-environment happy-dom
// Settings → Integrations → WebDAV backup (#582): connecting tries the folder before keeping
// anything, keeps the password out of the settings, and the connected sheet backs up and restores.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), sheets: [] }))
vi.mock('./backup-restore.js', () => ({ confirmBackupImport: (...a) => mocks.confirm(...a) }))

const { WebDavSheet } = await import('./WebDavBackup.jsx')
const { useUI } = await import('../store/useUI.js')
const { useStore } = await import('../store/useStore.js')
const { loadConfig, saveConfig, basicAuth, CONFIG_KEY } = await import('../lib/webdav.js')
const { setPassword } = await import('../lib/webdav-run.js')

let root, host, files
const typeInto = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const btn = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  localStorage.clear()
  files = new Map()
  globalThis.fetch = vi.fn(async (url, { method, headers, body }) => {
    const ok = headers.Authorization === basicAuth('me', 'app-pw')
    const res = (status, text = '') => ({ ok: status < 300, status, text: async () => text })
    if (!ok) return res(401)
    const name = decodeURIComponent(url.split('/').pop())
    if (method === 'PUT') { files.set(name, body); return res(201) }
    if (method === 'GET') return files.has(name) ? res(200, files.get(name)) : res(404)
    return res(204)
  })
  useStore.setState({ ready: true, user: null, S: { ...useStore.getState().S, workouts: [{ id: 'w1', d: '2026-11-01', entries: [] }], routines: [] } })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('WebDAV backup sheet', () => {
  it('a wrong password is said and nothing is kept', async () => {
    act(() => root.render(<WebDavSheet close={() => {}} />))
    typeInto(host.querySelector('#dav-url'), 'dav.example.com/me/openGym')
    typeInto(host.querySelector('#dav-user'), 'me')
    typeInto(host.querySelector('#dav-pass'), 'nope')
    act(() => btn('Connect').click())
    // On a busy CI runner the refusal can land after one flush, so wait for it.
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/did not take that name and password/), { timeout: 3000 })
    expect(loadConfig()).toBeNull()
  })
  it('connects, backs up at once, and keeps the password out of the settings', async () => {
    act(() => root.render(<WebDavSheet close={() => {}} />))
    typeInto(host.querySelector('#dav-url'), 'dav.example.com/me/openGym')
    typeInto(host.querySelector('#dav-user'), 'me')
    typeInto(host.querySelector('#dav-pass'), 'app-pw')
    act(() => btn('Connect').click())
    await vi.waitFor(() => expect(loadConfig()).toBeTruthy(), { timeout: 3000 })
    await vi.waitFor(() => expect(files.size).toBeGreaterThan(1), { timeout: 3000 })
    await flush()
    expect(loadConfig()).toMatchObject({ url: 'https://dav.example.com/me/openGym/', user: 'me', daily: true })
    expect(localStorage.getItem(CONFIG_KEY)).not.toContain('app-pw')
    expect([...files.keys()].some(n => /^opengym-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true)
    expect(host.textContent).toContain('Back up now')
  })
  it('restore lists the folder’s backups and hands the chosen one to the import', async () => {
    saveConfig({ url: 'https://dav.example.com/me/openGym/', user: 'me', daily: true, lastOk: Date.now() })
    await setPassword('app-pw')
    files.set('opengym-backups.json', JSON.stringify({ backups: [{ name: 'opengym-backup-2026-11-05.json', at: 1, workouts: 3 }] }))
    files.set('opengym-backup-2026-11-05.json', JSON.stringify({ workouts: [], routines: [], unit: 'kg' }))
    act(() => root.render(<WebDavSheet close={() => {}} />))
    act(() => btn('Restore from a backup').click())
    await vi.waitFor(() => expect(useUI.getState().sheets.length).toBe(1), { timeout: 3000 })
    const sheet = useUI.getState().sheets.at(-1)
    const h2 = document.createElement('div'); document.body.appendChild(h2)
    const r2 = createRoot(h2)
    act(() => r2.render(sheet.render(() => {})))
    expect(h2.textContent).toContain('2026-11-05')
    expect(h2.textContent).toContain('3 workouts')
    act(() => h2.querySelector('.lrow.tap').click())
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled(), { timeout: 3000 })
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.confirm.mock.calls[0][0].state).toMatchObject({ unit: 'kg' })
    act(() => r2.unmount()); h2.remove()
  })
  it('connecting binds the folder to the account that set it up', async () => {
    useStore.setState({ user: { id: 'olga' } })
    act(() => root.render(<WebDavSheet close={() => {}} />))
    typeInto(host.querySelector('#dav-url'), 'dav.example.com/me/openGym')
    typeInto(host.querySelector('#dav-user'), 'me')
    typeInto(host.querySelector('#dav-pass'), 'app-pw')
    act(() => btn('Connect').click())
    await vi.waitFor(() => expect(loadConfig()).toMatchObject({ owner: 'u:olga' }), { timeout: 3000 })
    await flush()
    useStore.setState({ user: null })
  })
  it('another account on this device: paused, nothing shown or uploaded, only Disconnect', async () => {
    saveConfig({ url: 'https://dav.example.com/olga/openGym/', user: 'olga', daily: true, lastOk: 1, owner: 'u:olga' })
    await setPassword('app-pw')
    useStore.setState({ user: { id: 'boris' } })
    act(() => root.render(<WebDavSheet close={() => {}} />))
    await flush()
    expect(host.textContent).toContain('This backup belongs to another account')
    expect(host.textContent).not.toContain('Back up now')
    expect(host.textContent).not.toContain('Restore from a backup')
    expect(host.textContent).not.toContain('dav.example.com')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    act(() => btn('Disconnect').click())
    const confirm = useUI.getState().sheets.at(-1)
    expect(confirm).toBeTruthy()
    useStore.setState({ user: null })
  })
})
