// Tests for mcp/src/state.js — the uid/config resolution and what a read failure looks like.
// state.js reads OPENGYM_DATA at module load and caches module-globally, so each case stubs the
// env and imports a fresh copy. Temp dirs only; nothing here touches a real profile.
import { describe, test, expect, afterEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DB = JSON.stringify({
  users: [{ id: 'alex', name: 'Alex', created: '2026-01-01' }],
  creds: [], subs: [], invites: []
})
const DB_MANY = JSON.stringify({
  users: [
    { id: 'alex', name: 'Alex', created: '2026-01-01' },
    { id: 'secret-partner-uid', name: 'Someone Else', created: '2026-02-02' },
    { id: 'third-account', name: 'Third', created: '2026-03-03' }
  ],
  creds: [], subs: [], invites: []
})

const dirs = []
function mk(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-state-'))
  dirs.push(d)
  for (const [f, body] of Object.entries(files)) {
    if (body === null) fs.mkdirSync(path.join(d, f))            // a directory where a file belongs
    else fs.writeFileSync(path.join(d, f), body)
  }
  return d
}

// A fresh state.js bound to `dir`.
async function load(dir, uid = 'alex') {
  vi.resetModules()
  vi.stubEnv('OPENGYM_DATA', dir)
  vi.stubEnv('OPENGYM_UID', uid)
  return import('../src/state.js')
}

afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => { dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })) })

describe('a read failure is not "you never signed in"', () => {
  test('no state file at all is still null — that account really has never synced', async () => {
    const { getState } = await load(mk({ 'db.json': DB }))
    expect(getState()).toBeNull()
  })

  test('a corrupt state file throws EIO naming the parse failure', async () => {
    const { getState } = await load(mk({ 'db.json': DB, 'state-alex.json': '{ not json' }))
    let err = null
    try { getState() } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.code).toBe('EIO')
    expect(err.message).toMatch(/state-alex\.json is not valid JSON/)
    expect(err.message).not.toMatch(/sign in/i)
  })

  test('a state file that cannot be read throws EIO naming the failure, not null', async () => {
    const { getState } = await load(mk({ 'db.json': DB, 'state-alex.json': null }))
    let err = null
    try { getState() } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.code).toBe('EIO')
    expect(err.message).toMatch(/cannot read state-alex\.json: EISDIR/)
  })

  // Root reads a mode-000 file anyway (the GitLab CI container runs as root), so the failure this
  // needs cannot be made there.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  test.skipIf(asRoot)('a permission failure names the file, not the server\'s path', async () => {
    const dir = mk({ 'db.json': DB, 'state-alex.json': '{}' })
    fs.chmodSync(path.join(dir, 'state-alex.json'), 0o000)
    const { getState } = await load(dir)
    let err = null
    try { getState() } catch (e) { err = e }
    fs.chmodSync(path.join(dir, 'state-alex.json'), 0o600)
    expect(err).toBeTruthy()
    expect(err.code).toBe('EIO')
    expect(err.message).toMatch(/cannot read state-alex\.json: EACCES/)
    expect(err.message).not.toContain(dir)
  })

  test('a good state file still loads, with the app defaults merged in', async () => {
    const { getState } = await load(mk({ 'db.json': DB, 'state-alex.json': JSON.stringify({ unit: 'lb', routines: [{ id: 'r1', name: 'R', ex: [] }] }) }))
    const S = getState()
    expect(S.unit).toBe('lb')
    expect(S.routines.length).toBe(1)
    expect(S.dayPlan).toEqual({})     // a default the snapshot did not carry
  })
})

describe('the "which profile?" error is a config message, not a roster', () => {
  const uids = ['alex', 'secret-partner-uid', 'third-account']

  // Several state files, and several users with no state file, resolve the uid the same way.
  for (const [label, files] of [
    ['several state files', Object.fromEntries([['db.json', DB_MANY], ...uids.map(u => [`state-${u}.json`, '{}'])])],
    ['several users, none synced yet', { 'db.json': DB_MANY }]
  ]) {
    test(`${label}: names no uid and no absolute path`, async () => {
      const logs = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')))
      const dir = mk(files)
      const { getState } = await load(dir, '')       // no OPENGYM_UID pinned
      let err = null
      try { getState() } catch (e) { err = e }
      spy.mockRestore()
      expect(err).toBeTruthy()
      expect(err.code).toBe('EINVAL')
      expect(err.message).toMatch(/holds 3 profiles/)
      expect(err.message).toMatch(/set OPENGYM_UID/)
      for (const u of uids) expect(err.message).not.toContain(u)
      expect(err.message).not.toContain(dir)
      expect(err.message).not.toContain('/')
      // the operator still gets the detail, on the server's own log
      expect(logs.join('\n')).toContain(dir)
      for (const u of uids) expect(logs.join('\n')).toContain(u)
    })
  }
})

describe('unsafe config details stay on stderr', () => {
  test('an invalid uid is sanitized in the thrown MCP-facing error', async () => {
    const uid = 'private/uid-value'
    vi.stubEnv('OPENGYM_LOCALE', 'it')
    const logs = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')))
    const { getState } = await load(mk({ 'db.json': DB }), uid)
    let err = null
    try { getState() } catch (e) { err = e }
    spy.mockRestore()
    expect(err.code).toBe('EINVAL')
    expect(err.message).toBe('OPENGYM_UID non valido. Controlla la configurazione del server.')
    expect(err.message).not.toContain(uid)
    expect(logs.join('\n')).toContain(uid)
  })

  test('English config errors remain English and do not expose server details', async () => {
    const uid = 'private/uid-value'
    vi.stubEnv('OPENGYM_LOCALE', 'en')
    const { getState } = await load(mk({ 'db.json': DB }), uid)
    let err = null
    try { getState() } catch (e) { err = e }
    expect(err.message).toBe('OPENGYM_UID is invalid. Check the server configuration.')
    expect(err.message).not.toContain(uid)
  })

  test('a missing data directory is sanitized in the thrown MCP-facing error', async () => {
    const dir = path.join(os.tmpdir(), 'private-openGym-data-path')
    vi.stubEnv('OPENGYM_LOCALE', 'it')
    const logs = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')))
    const { getState } = await load(dir)
    let err = null
    try { getState() } catch (e) { err = e }
    spy.mockRestore()
    expect(err.code).toBe('ENOENT')
    expect(err.message).toBe('La directory dei dati openGym non è disponibile. Controlla OPENGYM_DATA e la configurazione del server.')
    expect(err.message).not.toContain(dir)
    expect(logs.join('\n')).toContain(dir)
  })
})
