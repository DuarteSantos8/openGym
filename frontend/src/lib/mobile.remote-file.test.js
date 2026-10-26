// The pairing file (opengym-remote.json) holds the phone's session token. On iOS it lives in
// Library/NoCloud, which the Filesystem plugin excludes from iCloud and computer backups, and an
// iPhone paired before that has its file moved there out of Documents once. Android keeps it in
// the app's files, excluded by name in its backup rules (android-backup.test.js).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ files: new Map(), platform: 'ios', stats: [] }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => h.platform } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', LibraryNoCloud: 'LIBRARY_NO_CLOUD' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => { h.files.set(directory + '/' + path, data) },
    deleteFile: async ({ path, directory }) => { h.files.delete(directory + '/' + path) },
    stat: async ({ path, directory }) => { h.stats.push(directory + '/' + path); return {} },
  },
}))

let M
beforeEach(async () => {
  h.files.clear(); h.stats.length = 0; h.platform = 'ios'
  vi.resetModules()
  vi.stubEnv('VITE_MOBILE', '1')
  M = await import('./mobile.js')
})

const PAIRED = { mode: 'remote', base: 'https://gym.example', token: 'tok', user: { id: 'u1' } }

describe('the pairing file', () => {
  it('on iOS is written to Library/NoCloud, never to Documents, and the folder is marked right away', async () => {
    expect(M.MOBILE).toBe(true)
    await M.saveRemoteFile(PAIRED)
    expect([...h.files.keys()]).toEqual(['LIBRARY_NO_CLOUD/opengym-remote.json'])
    expect(h.stats).toEqual(['LIBRARY_NO_CLOUD/opengym-remote.json'])
    expect(await M.loadRemoteFile()).toEqual(PAIRED)
  })

  it('on iOS moves a pairing made before out of Documents, once', async () => {
    h.files.set('DATA/opengym-remote.json', JSON.stringify(PAIRED))
    expect(await M.loadRemoteFile()).toEqual(PAIRED)
    expect([...h.files.keys()]).toEqual(['LIBRARY_NO_CLOUD/opengym-remote.json'])
    expect(await M.loadRemoteFile()).toEqual(PAIRED)
  })

  it('on iOS with nothing anywhere is still "never decided"', async () => {
    expect(await M.loadRemoteFile()).toBeNull()
  })

  it('on Android stays where its backup rules exclude it', async () => {
    h.platform = 'android'
    await M.saveRemoteFile(PAIRED)
    expect([...h.files.keys()]).toEqual(['DATA/opengym-remote.json'])
    expect(h.stats).toEqual([])
    expect(await M.loadRemoteFile()).toEqual(PAIRED)
  })
})
