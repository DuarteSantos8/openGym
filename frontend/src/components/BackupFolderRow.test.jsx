// @vitest-environment happy-dom
// Settings → the auto-backup folder on Android (#161): the folder in use, a way to choose
// another, the way back to the default, and a warning when the chosen one stopped taking copies.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ folder: {}, listeners: new Set(), picked: null, toast: vi.fn(), pickFails: false }))
vi.mock('../lib/mobile.js', () => ({
  backupFolder: async () => m.folder,
  chooseBackupFolder: async () => { if (m.pickFails) throw new Error('nope'); if (!m.picked) return null; m.folder = m.picked; return m.folder },
  resetBackupFolder: async () => { m.folder = {}; return m.folder },
  onBackupFolderChange: fn => { m.listeners.add(fn); return () => m.listeners.delete(fn) },
}))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: m.toast }) } }))

const { default: BackupFolderRow } = await import('./BackupFolderRow.jsx')

let host, root
beforeEach(() => {
  Object.assign(m, { folder: {}, picked: null, pickFails: false })
  m.listeners.clear(); m.toast.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async () => { await act(async () => { root.render(<BackupFolderRow />) }) }
const rows = () => [...host.querySelectorAll('.lrow')]
const rowWith = text => rows().find(r => r.textContent.includes(text))
const tap = async el => { await act(async () => { el.click() }) }

describe('BackupFolderRow', () => {
  it('shows the default folder, and nothing to go back to', async () => {
    await mount()
    expect(rowWith('Backup folder').textContent).toContain('Documents/openGym')
    expect(rowWith('Use default folder')).toBeUndefined()
  })

  it('choosing a folder shows its name; the default is one tap back', async () => {
    await mount()
    m.picked = { uri: 'content://tree/Sync', label: 'Sync' }
    await tap(rowWith('Backup folder'))
    expect(rowWith('Backup folder').textContent).toContain('Sync')
    await tap(rowWith('Use default folder'))
    expect(rowWith('Backup folder').textContent).toContain('Documents/openGym')
    expect(rowWith('Use default folder')).toBeUndefined()
  })

  it('a folder the picker hands back that cannot be kept says so', async () => {
    await mount()
    m.pickFails = true
    await tap(rowWith('Backup folder'))
    expect(m.toast).toHaveBeenCalledWith('This folder can’t be used for backups.')
  })

  it('a folder that stopped taking copies is named in a warning, also when it happens while open', async () => {
    m.folder = { uri: 'content://tree/Sync', label: 'Sync' }
    await mount()
    expect(host.querySelector('.backup-lost')).toBeNull()
    await act(async () => { m.listeners.forEach(fn => fn({ lost: true, lostLabel: 'Sync' })) })
    expect(host.querySelector('.backup-lost').textContent).toContain('openGym can no longer write to “Sync”')
    expect(rowWith('Backup folder').textContent).toContain('Documents/openGym')
    await tap(rowWith('Use default folder'))
    expect(host.querySelector('.backup-lost')).toBeNull()
  })
})

// Android QA: after another folder was chosen, the Auto-backup row still said Documents/openGym.
describe('the Auto-backup subtitle', () => {
  it('names the chosen folder, or the default', async () => {
    const { autoBackupSubtitle } = await import('./BackupFolderRow.jsx')
    expect(autoBackupSubtitle({ uri: 'content://tree/Sync', label: 'SyncFolder' }, 14))
      .toBe('Saves a dated copy to “SyncFolder” after finishing a workout or editing a routine, and keeps the newest 14.')
    expect(autoBackupSubtitle({ uri: 'content://tree/x' }, 14))
      .toBe('Saves a dated copy to the folder you chose after finishing a workout or editing a routine, and keeps the newest 14.')
    for (const f of [{}, null, { lost: true, lostLabel: 'SyncFolder' }]) expect(autoBackupSubtitle(f, 14)).toContain('Documents/openGym')
  })

  it('the lost-folder warning is a warning row, not a big title', async () => {
    m.folder = { lost: true, lostLabel: 'SyncFolder' }
    await mount()
    const warn = host.querySelector('.lrow.backup-lost')
    expect(warn.textContent).toContain('SyncFolder')
    const css = (await import('node:fs')).readFileSync(process.cwd() + '/src/index.css', 'utf8')
    expect(css).toMatch(/\.lrow\.backup-lost \.lrow-t\{font-size:13px/)
  })
})
