import { beforeEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn(), blob: vi.fn(), synced: vi.fn(), fetch: vi.fn() }))
vi.mock('./api.js', () => ({ api: calls.api, apiUpload: calls.upload }))
vi.mock('./media-store.js', () => ({ mediaStore: { get: calls.blob, markSynced: calls.synced } }))
vi.mock('./media-sync.js', () => ({ fetchToStore: calls.fetch }))
vi.mock('./mobile.js', () => ({ MOBILE: false }))
import { canEditExercise, exerciseAccountGuard, privateExercise, mergeServerExercises,
  refreshServerExercises, publishServerExercise, unpublishServerExercise } from './server-exercises.js'
const exercise = (over = {}) => ({ id: 'cexercise', n: 'Row', custom: true, serverShared: true, serverRevision: 1, ...over })
const store = (customEx = []) => {
  const state = { user: { id: 'a', admin: true }, ready: true, sync: { server: 'one' },
    S: { customEx, routines: [], workouts: [], favEx: [] } }
  state.update = fn => fn(state.S)
  return { getState: () => state }
}
beforeEach(() => vi.resetAllMocks())
describe('shared exercise cache', () => {
  it('only admins edit shared exercises, while private customs stay editable', () => {
    expect(canEditExercise(exercise(), { admin: true })).toBe(true)
    expect(canEditExercise(exercise(), { admin: false })).toBe(false)
    expect(canEditExercise(exercise(), null)).toBe(false)
    expect(canEditExercise(exercise({ serverShared: false }), null)).toBe(true)
    expect(canEditExercise({ custom: false }, { admin: true })).toBe(false)
  })
  it('drops server metadata when retaining a private copy', () => {
    expect(privateExercise(exercise({ publisherId: 'a', serverRetired: true })))
      .toEqual({ id: 'cexercise', n: 'Row', custom: true })
  })
  it('refreshes shared metadata while preserving private entries and timestamps', () => {
    const old = exercise({ _ts: 42 }), personal = exercise({ id: 'cprivate', serverShared: false })
    const next = mergeServerExercises({ customEx: [old, personal] }, [exercise({ n: 'Renamed', serverRevision: 2 })])
    expect(next[0]).toMatchObject({ n: 'Renamed', serverRevision: 2, _ts: 42 })
    expect(next[1]).toEqual(personal); expect(old.n).toBe('Row')
  })
  for (const [kind, state] of Object.entries({
    routine: { routines: [{ ex: [{ id: 'cexercise' }] }] },
    history: { workouts: [{ entries: [{ id: 'cexercise' }] }] },
    active: { active: { entries: [{ id: 'cexercise' }] } }, favorite: { favEx: ['cexercise'] },
  })) it(`retains withdrawn definitions referenced by ${kind}`, () => {
    expect(mergeServerExercises({ customEx: [exercise()], ...state }, [])).toEqual([exercise({ serverRetired: true })])
  })
  it('drops unused retired entries and restores republished entries', () => {
    expect(mergeServerExercises({ customEx: [exercise()] }, [])).toEqual([])
    expect(mergeServerExercises({ customEx: [exercise({ serverRetired: true })] }, [exercise()])[0].serverRetired).toBeUndefined()
  })
})
describe('account and server isolation', () => {
  for (const field of ['account', 'server']) it(`cancels edits after a ${field} change`, () => {
    const st = store(), guard = exerciseAccountGuard(st); guard()
    if (field === 'account') st.getState().user = { id: 'other' }; else st.getState().sync.server = 'other'
    expect(guard).toThrow('Account changed')
  })
  for (const field of ['logout', 'server']) it(`ignores a late response after ${field}`, async () => {
    const st = store(); let resolve
    calls.api.mockReturnValue(new Promise(r => { resolve = r }))
    const pending = refreshServerExercises(st)
    if (field === 'logout') st.getState().user = null; else st.getState().sync.server = 'other'
    resolve({ exercises: [exercise()] }); await pending
    expect(st.getState().S.customEx).toEqual([])
  })
  it('lets the newer refresh win', async () => {
    const st = store(); let resolve
    calls.api.mockReturnValueOnce(new Promise(r => { resolve = r })).mockResolvedValueOnce({ exercises: [exercise({ n: 'New' })] })
    const pending = refreshServerExercises(st); await refreshServerExercises(st)
    resolve({ exercises: [exercise({ n: 'Old' })] }); await pending
    expect(st.getState().S.customEx[0].n).toBe('New')
  })
  it('retains its cache with older servers and malformed responses', async () => {
    const st = store([exercise()]); calls.api.mockRejectedValueOnce({ status: 404 })
    await refreshServerExercises(st)
    calls.api.mockResolvedValueOnce({ exercises: 'bad' }); await refreshServerExercises(st)
    expect(st.getState().S.customEx).toEqual([exercise()])
  })
  it('does not refresh while signed out or initializing', async () => {
    const st = store(); st.getState().user = null; await refreshServerExercises(st)
    st.getState().user = { id: 'a' }; st.getState().ready = false; await refreshServerExercises(st)
    expect(calls.api).not.toHaveBeenCalled()
  })
})
describe('publication and withdrawal', () => {
  it('uses the current revision when publishing', async () => {
    calls.api.mockResolvedValue({ exercise: exercise() }); await publishServerExercise(exercise())
    expect(JSON.parse(calls.api.mock.calls[0][1].body).baseRevision).toBe(1)
  })
  it('republishes retired entries without reusing stale revisions', async () => {
    calls.api.mockResolvedValue({ exercise: exercise() }); await publishServerExercise(exercise({ serverRetired: true }))
    expect(JSON.parse(calls.api.mock.calls[0][1].body).baseRevision).toBeUndefined()
  })
  it('withdraws metadata without deleting local media', async () => {
    calls.api.mockResolvedValue({ ok: true }); await unpublishServerExercise(exercise())
    expect(calls.api.mock.calls[0][1].method).toBe('DELETE'); expect(calls.synced).not.toHaveBeenCalled()
  })
  it('preserves a private media copy before withdrawal', async () => {
    const media = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 1, width: 1, height: 1 }
    calls.api.mockResolvedValueOnce({ missing: [media.hash] }).mockResolvedValueOnce({ ok: true })
    calls.blob.mockResolvedValue({ blob: new Blob(['image']) }); calls.upload.mockResolvedValue({})
    await unpublishServerExercise(exercise({ media }))
    expect(JSON.parse(calls.api.mock.calls[0][1].body).privateOnly).toBe(true)
    expect(calls.upload).toHaveBeenCalledOnce(); expect(calls.api.mock.calls.at(-1)[1].method).toBe('DELETE')
  })
  it('does not publish into a new account if it changes while checking media', async () => {
    const st = store(), guard = exerciseAccountGuard(st)
    calls.api.mockImplementation(async () => { st.getState().user = { id: 'other' }; return { missing: [] } })
    const media = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 1, width: 1, height: 1 }
    await expect(publishServerExercise(exercise({ media }), guard)).rejects.toThrow('Account changed')
    expect(calls.api).toHaveBeenCalledTimes(1)
  })
})
