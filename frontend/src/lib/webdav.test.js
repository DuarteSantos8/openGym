// @vitest-environment happy-dom
// Backup to WebDAV (#582): the folder address, the client against a pretend server (GET, PUT,
// DELETE, MKCOL only), the index with its fourteen days, the runs and what they keep.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { folderUrl, urlProblem, basicAuth, backupName, cleanIndex, nextIndex, davClient, backupTo, readBackup, isDue, loadConfig, saveConfig, errorText, ownership, INDEX_NAME, KEEP, DUE_MS, DAY_MS, CONFIG_KEY } from './webdav.js'

// A WebDAV folder in memory. `needsFolder`: PUT answers 409 until MKCOL made it.
function server({ user = 'me', pass = 'pw', needsFolder = false, down = false } = {}) {
  const files = new Map()
  let folder = !needsFolder
  const calls = []
  const fetchFn = async (url, { method, headers, body }) => {
    calls.push({ method, url })
    if (down) throw new TypeError('Failed to fetch')
    const res = (status, text = '') => ({ ok: status >= 200 && status < 300, status, text: async () => text })
    if (headers.Authorization !== basicAuth(user, pass)) return res(401)
    const name = decodeURIComponent(url.slice('https://dav.example.com/files/me/openGym/'.length))
    if (method === 'MKCOL') { folder = true; return res(201) }
    if (!folder) return res(method === 'GET' ? 404 : 409)
    if (method === 'PUT') { files.set(name, body); return res(201) }
    if (method === 'GET') return files.has(name) ? res(200, files.get(name)) : res(404)
    if (method === 'DELETE') { const had = files.delete(name); return res(had ? 204 : 404) }
    return res(405)
  }
  return { files, calls, fetchFn }
}
const URL_ = 'https://dav.example.com/files/me/openGym'
const S = { workouts: [{ id: 'w1', d: '2026-11-01', entries: [] }], routines: [], bodyweight: [] }

describe('the folder address', () => {
  it('is https by default, ends in a slash, and keeps no secrets', () => {
    expect(folderUrl('dav.example.com/files/me')).toBe('https://dav.example.com/files/me/')
    expect(folderUrl('http://nas.local:5005/backup?x=1#y')).toBe('http://nas.local:5005/backup/')
    expect(folderUrl('ftp://x')).toBeNull()
    expect(folderUrl('https://me:pw@dav.example.com/')).toBeNull()
    expect(urlProblem('')).toMatch(/Paste/)
    expect(urlProblem('https://me:pw@dav.example.com/')).toMatch(/own fields/)
    expect(urlProblem(URL_)).toBeNull()
  })
  it('the login is UTF-8 safe', () => {
    expect(basicAuth('jörg', 'pässwörd')).toBe('Basic ' + Buffer.from('jörg:pässwörd').toString('base64'))
  })
})

describe('the index', () => {
  it('keeps our files only, newest first, and drops past fourteen', () => {
    expect(cleanIndex({ backups: [{ name: '../../etc/passwd' }, { name: 'opengym-backup-2026-11-01.json', at: 1 }, { name: 'opengym-backup-2026-11-03.json', at: 3 }, { name: 'opengym-backup-2026-11-01.json' }] }).map(b => b.name))
      .toEqual(['opengym-backup-2026-11-03.json', 'opengym-backup-2026-11-01.json'])
    const list = Array.from({ length: KEEP }, (_, i) => ({ name: backupName(new Date(2026, 9, i + 1)), at: i }))
    const { list: next, drop } = nextIndex(cleanIndex({ backups: list }), { name: backupName(new Date(2026, 10, 1)), at: 99 })
    expect(next.length).toBe(KEEP)
    expect(next[0].name).toBe('opengym-backup-2026-11-01.json')
    expect(drop).toEqual(['opengym-backup-2026-10-01.json'])
  })
  it('a second backup on a day replaces that day’s', () => {
    const { list } = nextIndex([{ name: 'opengym-backup-2026-11-01.json', at: 1 }], { name: 'opengym-backup-2026-11-01.json', at: 2 })
    expect(list).toEqual([{ name: 'opengym-backup-2026-11-01.json', at: 2, size: 0 }])
  })
})

describe('a backup and a restore', () => {
  it('writes the day’s file and the index, makes a missing folder, and reads it back', async () => {
    const srv = server({ needsFolder: true })
    const c = davClient({ url: URL_, user: 'me', password: 'pw', fetchFn: srv.fetchFn })
    const out = await backupTo(c, S, { now: new Date(2026, 10, 6, 8).getTime() })
    expect(out.name).toBe('opengym-backup-2026-11-06.json')
    expect(srv.calls.some(x => x.method === 'MKCOL')).toBe(true)
    expect(JSON.parse(srv.files.get(INDEX_NAME)).backups[0]).toMatchObject({ name: out.name, workouts: 1 })
    expect(JSON.parse(await readBackup(c, out.name))).toEqual(S)
    expect((await c.index()).map(b => b.name)).toEqual([out.name])
  })
  it('deletes the oldest past fourteen', async () => {
    const srv = server()
    const c = davClient({ url: URL_, user: 'me', password: 'pw', fetchFn: srv.fetchFn })
    for (let d = 1; d <= KEEP + 2; d++) await backupTo(c, S, { now: new Date(2026, 9, d, 8).getTime() })
    const names = [...srv.files.keys()].filter(n => n !== INDEX_NAME).sort()
    expect(names.length).toBe(KEEP)
    expect(names[0]).toBe('opengym-backup-2026-10-03.json')
  })
  it('says what went wrong in words', async () => {
    const bad = davClient({ url: URL_, user: 'me', password: 'nope', fetchFn: server().fetchFn })
    await expect(backupTo(bad, S)).rejects.toMatchObject({ code: 'auth' })
    const down = davClient({ url: URL_, user: 'me', password: 'pw', fetchFn: server({ down: true }).fetchFn })
    await expect(down.index()).rejects.toMatchObject({ code: 'network' })
    expect(errorText({ code: 'network' })).toMatch(/CORS/)
    const c = davClient({ url: URL_, user: 'me', password: 'pw', fetchFn: server().fetchFn })
    await expect(readBackup(c, '../secret.json')).rejects.toMatchObject({ code: 'not-backup' })
  })
})

describe('this device’s settings', () => {
  beforeEach(() => localStorage.clear())
  it('are kept without a password, and a day decides when the next is due', () => {
    saveConfig({ url: URL_, user: 'me', password: 'pw', daily: true })
    const raw = localStorage.getItem(CONFIG_KEY)
    expect(raw).not.toContain('pw"')
    expect(loadConfig()).toMatchObject({ url: URL_ + '/', user: 'me', daily: true, lastOk: 0 })
    expect(isDue(loadConfig(), 1000)).toBe(true)
    expect(isDue({ ...loadConfig(), lastOk: 1000 }, 1000 + DUE_MS - 1)).toBe(false)
    expect(isDue({ ...loadConfig(), lastOk: 1000 }, 1000 + DUE_MS)).toBe(true)
    expect(isDue({ ...loadConfig(), daily: false }, 0)).toBe(false)
    saveConfig(null)
    expect(loadConfig()).toBeNull()
  })
})

describe('the runs (lib/webdav-run.js)', () => {
  beforeEach(() => localStorage.clear())
  it('backs up when due, keeps the outcome, and stays quiet otherwise', async () => {
    const { useStore } = await import('../store/useStore.js')
    const { runBackup, setPassword } = await import('./webdav-run.js')
    useStore.setState({ ready: true, user: null, S: { ...useStore.getState().S, ...S } })
    const srv = server()
    expect(await runBackup({ fetchFn: srv.fetchFn })).toMatchObject({ skipped: 'off' })
    saveConfig({ url: URL_, user: 'me', daily: true })
    await setPassword('pw')
    const now = new Date(2026, 10, 6, 9).getTime()
    expect(await runBackup({ now, fetchFn: srv.fetchFn })).toMatchObject({ ok: true, name: 'opengym-backup-2026-11-06.json' })
    expect(loadConfig()).toMatchObject({ lastOk: now, last: { ok: true } })
    expect(await runBackup({ now: now + 3600000, fetchFn: srv.fetchFn })).toMatchObject({ skipped: 'not-due' })
    await setPassword('wrong')
    const r = await runBackup({ manual: true, now: now + 7200000, fetchFn: srv.fetchFn })
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('auth')
    expect(loadConfig().last).toMatchObject({ ok: false, msg: 'auth' })
    // A failed run keeps the last good one's time: the daily one tries again next hour.
    expect(loadConfig().lastOk).toBe(now)
  })
})

describe('one person’s folder (shared devices)', () => {
  beforeEach(() => localStorage.clear())
  it('another account, or a guest, never backs up into it or reads it back', async () => {
    const { useStore } = await import('../store/useStore.js')
    const { runBackup, setPassword, listBackups, fetchBackup } = await import('./webdav-run.js')
    useStore.setState({ ready: true, user: { id: 'olga' }, S: { ...useStore.getState().S, ...S } })
    const srv = server()
    saveConfig({ url: URL_, user: 'me', daily: true, owner: 'u:olga' })
    await setPassword('pw')
    const now = new Date(2026, 10, 6, 9).getTime()
    expect(await runBackup({ now, fetchFn: srv.fetchFn })).toMatchObject({ ok: true })
    const calls = srv.calls.length
    for (const user of [{ id: 'boris' }, null]) {
      useStore.setState({ user })
      expect(await runBackup({ now: now + 2 * DAY_MS, fetchFn: srv.fetchFn })).toMatchObject({ ok: false, skipped: 'foreign' })
      const r = await runBackup({ manual: true, now: now + 2 * DAY_MS, fetchFn: srv.fetchFn })
      expect(r.error.code).toBe('foreign')
      await expect(listBackups({ fetchFn: srv.fetchFn })).rejects.toMatchObject({ code: 'foreign' })
      await expect(fetchBackup('opengym-backup-2026-11-06.json', { fetchFn: srv.fetchFn })).rejects.toMatchObject({ code: 'foreign' })
    }
    expect(srv.calls.length).toBe(calls)
    // Her settings are untouched: back on her account, the daily backup goes on.
    expect(loadConfig()).toMatchObject({ owner: 'u:olga', lastOk: now })
    useStore.setState({ user: { id: 'olga' } })
    expect(await runBackup({ now: now + 2 * DAY_MS, fetchFn: srv.fetchFn })).toMatchObject({ ok: true })
    useStore.setState({ user: null })
  })
  it('settings from before owners belong to whoever is active once the app knows', async () => {
    const { useStore } = await import('../store/useStore.js')
    const { claimWebdav, webdavView, runBackup, currentOwner } = await import('./webdav-run.js')
    saveConfig({ url: URL_, user: 'me', daily: true })
    useStore.setState({ ready: false, user: null })
    expect(currentOwner()).toBeNull()
    expect(await runBackup()).toMatchObject({ skipped: 'not-ready' })
    expect(loadConfig().owner).toBeUndefined()
    useStore.setState({ ready: true, user: { id: 'olga' } })
    expect(claimWebdav()).toMatchObject({ owner: 'u:olga' })
    expect(webdavView(loadConfig(), 'u:olga').foreign).toBeUndefined()
    expect(webdavView(loadConfig(), 'local').foreign).toBe(true)
    expect(ownership(null, 'local')).toBeNull()
    useStore.setState({ user: null })
  })
})
