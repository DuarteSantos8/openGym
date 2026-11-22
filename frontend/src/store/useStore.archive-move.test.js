// @vitest-environment happy-dom
// The old folder called Archive becomes the archive flag once, through update(), so the move is
// stamped and syncs (lib/routine-archive.js migrateArchiveFolder).
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const routine = (id, folder) => ({ id, name: id, _ts: 100, ex: [], ...(folder ? { folder } : {}) })

beforeEach(() => { localStorage.clear() })

describe('boot', () => {
  it('moves routines in the Archive folder to archived, stamped, once', async () => {
    useStore.setState({
      S: { ...clone(DEF), _ts: 100, routines: [routine('a', 'Archive'), routine('b', 'Push')] },
      user: null, ready: false,
    })
    await useStore.getState().boot()
    const S = useStore.getState().S
    expect(S.routines[0].archived).toBe(true)
    expect(S.routines[0].folder).toBeUndefined()
    expect(S.routines[0]._f.archived).toBeGreaterThan(100)
    expect(S.routines[1].folder).toBe('Push')
    expect(S.archiveMoved).toBe(true)
    expect(S.edited.archiveMoved).toBeGreaterThan(100)

    const stamp = S._ts
    await useStore.getState().boot()
    expect(useStore.getState().S._ts).toBe(stamp)
  })
})

describe('pull', () => {
  it('moves Archive-folder routines that an older copy brings in after boot', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 0, archiveMoved: true }, user: { id: 'u' }, ready: true })   // moved once already
    const theirs = { ...clone(DEF), _ts: 500, _wid: 'w', routines: [routine('a', 'Archive')] }
    api.mockResolvedValue({ state: theirs, rev: 3 })
    await useStore.getState().pullState()
    const S = useStore.getState().S
    expect(S.routines[0].archived).toBe(true)
    expect(S.routines[0].folder).toBeUndefined()
    expect(S.archiveMoved).toBe(true)
  })
})

describe('sign-in adoption', () => {
  it('moves Archive-folder routines of the account copy it just took', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 0 }, user: { id: 'u' }, ready: true })
    api.mockResolvedValue({ state: { ...clone(DEF), _ts: 500, _wid: 'w', routines: [routine('a', 'Archive')] }, rev: 3 })
    await useStore.getState().adoptProfile(() => false)
    const S = useStore.getState().S
    expect(S.routines[0].archived).toBe(true)
    expect(S.archiveMoved).toBe(true)
  })
})

describe('backup import', () => {
  it('moves Archive-folder routines of an older backup at once, not on the next launch', () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 100 }, user: null, ready: true })
    useStore.getState().importBackup({ ...clone(DEF), _ts: 50, routines: [routine('a', 'Archive')] })
    const S = useStore.getState().S
    expect(S.routines[0].archived).toBe(true)
    expect(S.routines[0].folder).toBeUndefined()
    expect(S.archiveMoved).toBe(true)
  })
})

describe('language', () => {
  it('moves a German "Archiv" folder once the German words have loaded, not only on a later pull', async () => {
    const { setLang } = await import('../lib/i18n.js')
    useStore.setState({ S: { ...clone(DEF), _ts: 100, routines: [routine('a', 'Archiv')] }, user: null, ready: true })
    try {
      await setLang('de')
      expect(useStore.getState().S.routines[0].archived).toBe(true)
    } finally { await setLang('en') }
  })
})
