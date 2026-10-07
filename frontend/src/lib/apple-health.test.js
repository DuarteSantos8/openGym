// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ available: vi.fn(), authorize: vi.fn(), readWeights: vi.fn(), writeWeights: vi.fn(), writeWorkouts: vi.fn(), deleteWorkout: vi.fn() }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios' },
  // Returning this proxy directly from an async helper would await its fake `then`.
  registerPlugin: () => new Proxy(native, { get: (target, key) => key in target ? target[key] : vi.fn() }),
}))
import { appleHealthAvailable, appleHealthEnabled, enableAppleHealth, disableAppleHealth, syncAppleHealth, latestHealthWeights, healthWeightPayload, queueAppleHealthWorkoutDeletion } from './apple-health.js'
const date = '2026-10-07', time = Date.parse(`${date}T12:00:00`)
function makeStore(unit = 'kg') {
  const state = { user: { id: 'a' }, sync: { server: 'https://one.example' }, S: { unit, bodyweight: [], workouts: [] } }
  state.update = mutate => { mutate(state.S) }
  return { getState: () => state }
}
beforeEach(() => {
  localStorage.clear(); disableAppleHealth(); vi.clearAllMocks()
  native.available.mockResolvedValue({ available: true }); native.authorize.mockResolvedValue({})
  native.deleteWorkout.mockResolvedValue({ deleted: 1, confirmed: true })
  native.readWeights.mockResolvedValue({ weights: [] })
  native.writeWeights.mockImplementation(async ({ weights }) => ({ written: weights.length }))
  native.writeWorkouts.mockImplementation(async ({ workouts }) => ({ written: workouts.length }))
})
describe('Apple Health', () => {
  it('unwraps the Capacitor proxy without waiting on its then method', async () => {
    const store = makeStore()
    expect(await appleHealthAvailable()).toBe(true)
    await enableAppleHealth(store)
    expect(native.authorize).toHaveBeenCalledOnce()
    expect(appleHealthEnabled(store)).toBe(true)
  })
  it('does nothing before opting in', async () => {
    expect(await syncAppleHealth(makeStore())).toEqual({ imported: 0, weights: 0, workouts: 0 })
    expect(native.readWeights).not.toHaveBeenCalled()
  })
  it('keeps failed authorization disabled', async () => {
    const store = makeStore(); native.authorize.mockRejectedValueOnce(new Error('permission failed'))
    await expect(enableAppleHealth(store)).rejects.toThrow('permission failed')
    expect(appleHealthEnabled(store)).toBe(false)
  })
  it('checks Health availability before requesting permission', async () => {
    native.available.mockResolvedValueOnce({ available: false })
    await expect(enableAppleHealth(makeStore())).rejects.toThrow('unavailable')
    expect(native.authorize).not.toHaveBeenCalled()
  })
  it('selects newest external readings regardless of order, ignoring own and invalid data', () => {
    const rows = [{ date, kg: 80, timestamp: time }, { date, kg: 81, timestamp: time + 1000 }, { date, kg: 85, timestamp: time + 2000, own: true }, { date, kg: -1, timestamp: time + 3000 }, { date: 'oops', kg: 80, timestamp: time }]
    expect([...latestHealthWeights(rows).values()]).toEqual([rows[1]])
  })
  it('imports pounds without echoing the external reading back to Health', async () => {
    const store = makeStore('lb'); await enableAppleHealth(store)
    native.readWeights.mockResolvedValueOnce({ weights: [{ date, kg: 80, timestamp: time }] })
    expect((await syncAppleHealth(store)).imported).toBe(1)
    expect(store.getState().S.bodyweight).toEqual([{ d: date, w: 176.4, t: time }])
    expect(native.writeWeights).not.toHaveBeenCalled()
  })
  it('preserves newer local edits, exports pounds as kg and skips repeat writes', async () => {
    const store = makeStore('lb'); store.getState().S.bodyweight = [{ d: date, w: 176.4, t: time + 1000 }]
    native.readWeights.mockResolvedValue({ weights: [{ date, kg: 79, timestamp: time }] })
    await enableAppleHealth(store); await syncAppleHealth(store); await syncAppleHealth(store)
    expect(native.writeWeights).toHaveBeenCalledOnce()
    expect(native.writeWeights.mock.calls[0][0].weights[0].kg).toBeCloseTo(80, 1)
    expect(store.getState().S.bodyweight[0].w).toBe(176.4)
  })
  it('exports only completed workouts and retries failed saves', async () => {
    const store = makeStore(); store.getState().S.workouts = [{ id: 'done', start: time, end: time + 60000 }, { id: 'active', start: time }, { id: 'bad', start: time, end: time - 1 }]
    await enableAppleHealth(store); native.writeWorkouts.mockRejectedValueOnce(new Error('denied'))
    await expect(syncAppleHealth(store)).rejects.toThrow('denied')
    await syncAppleHealth(store); await syncAppleHealth(store)
    expect(native.writeWorkouts).toHaveBeenCalledTimes(2)
    expect(native.writeWorkouts.mock.calls[1][0].workouts).toEqual([{ id: 'done', name: 'openGym', start: time, end: time + 60000 }])
  })
  it('scopes opt-in to both server and account', async () => {
    const store = makeStore(); await enableAppleHealth(store)
    store.getState().sync.server = 'https://two.example'; expect(appleHealthEnabled(store)).toBe(false)
    store.getState().sync.server = 'https://one.example'; store.getState().user.id = 'b'; expect(appleHealthEnabled(store)).toBe(false)
  })
  it.each(['account', 'disable'])('abandons a pending read after %s changes', async change => {
    const store = makeStore(); await enableAppleHealth(store)
    let resolveRead; native.readWeights.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    const pending = syncAppleHealth(store)
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))
    if (change === 'account') store.getState().user.id = 'b'
    else disableAppleHealth()
    resolveRead({ weights: [{ date, kg: 80, timestamp: time }] }); await pending
    expect(store.getState().S.bodyweight).toEqual([])
    expect(native.writeWeights).not.toHaveBeenCalled()
  })
  it('does not opt a different account in after the permission dialog', async () => {
    const store = makeStore(); let finish
    native.authorize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = enableAppleHealth(store)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    store.getState().user.id = 'b'; finish({})
    await expect(pending).rejects.toThrow('account changed')
    expect(appleHealthEnabled(store)).toBe(false)
  })
  it('rejects impossible calendar days and timestamps', () => {
    expect(latestHealthWeights([{ date: '2026-02-31', kg: 80, timestamp: time }, { date, kg: 80, timestamp: Infinity }, null]).size).toBe(0)
  })
  it('recovers from a damaged duplicate ledger', async () => {
    const store = makeStore(); store.getState().S.bodyweight = [{ d: date, w: 80 }]
    await enableAppleHealth(store)
    localStorage.setItem('opengym_apple_health_written', '{bad json')
    expect((await syncAppleHealth(store)).weights).toBe(1)
    expect(native.writeWeights.mock.calls[0][0].weights[0].timestamp).toBe(time)
  })

  it('exports a historical weigh-in on its selected day with a separate edit version', () => {
    const payload = healthWeightPayload({ d: '2026-10-01', w: 80, t: time }, 'kg')
    expect(payload.timestamp).toBe(Date.parse('2026-10-01T12:00:00'))
    expect(payload.version).toBe(time)
  })

  const session = id => ({ id, start: time, end: time + 60000 })
  async function exportedPair() {
    const store = makeStore(); store.getState().S.workouts = [session('one'), session('two')]
    await enableAppleHealth(store); await syncAppleHealth(store)
    return store
  }
  function remove(store, id) {
    const record = store.getState().S.workouts.find(w => w.id === id)
    queueAppleHealthWorkoutDeletion(store, record)
    store.getState().S.workouts = store.getState().S.workouts.filter(w => w.id !== id)
  }
  it('deletes exactly the selected exported workout, preserving other sessions', async () => {
    const store = await exportedPair(); remove(store, 'one')
    await syncAppleHealth(store); await syncAppleHealth(store)
    expect(native.deleteWorkout).toHaveBeenCalledOnce()
    expect(native.deleteWorkout).toHaveBeenCalledWith({ workout: session('one') })
    expect(store.getState().S.workouts).toEqual([session('two')])
  })
  it('never infers deletions from logout, reset or missing history', async () => {
    const store = await exportedPair(); store.getState().S.workouts = []
    await syncAppleHealth(store)
    expect(native.deleteWorkout).not.toHaveBeenCalled()
  })
  it('retries only the explicitly deleted session after a native failure', async () => {
    const store = await exportedPair(); remove(store, 'one')
    native.deleteWorkout.mockRejectedValueOnce(new Error('denied'))
    await expect(syncAppleHealth(store)).rejects.toThrow('denied')
    await syncAppleHealth(store)
    expect(native.deleteWorkout.mock.calls.map(args => args[0].workout.id)).toEqual(['one', 'one'])
  })
  it('keeps an unconfirmed deletion pending', async () => {
    const store = await exportedPair(); remove(store, 'one')
    native.deleteWorkout.mockResolvedValueOnce({ deleted: 0, confirmed: false })
    await expect(syncAppleHealth(store)).rejects.toThrow('could not be confirmed')
    await syncAppleHealth(store)
    expect(native.deleteWorkout).toHaveBeenCalledTimes(2)
  })
  it('keeps deletions on their original server and account', async () => {
    const store = await exportedPair(); remove(store, 'one')
    store.getState().sync.server = 'https://two.example'
    await enableAppleHealth(store); await syncAppleHealth(store)
    expect(native.deleteWorkout).not.toHaveBeenCalled()
    store.getState().sync.server = 'https://one.example'
    await enableAppleHealth(store); await syncAppleHealth(store)
    expect(native.deleteWorkout).toHaveBeenCalledOnce()
  })
  it('cancels a pending deletion if the workout is restored before retry', async () => {
    const store = await exportedPair(); remove(store, 'one')
    store.getState().S.workouts.push(session('one'))
    await syncAppleHealth(store)
    store.getState().S.workouts = []
    await syncAppleHealth(store)
    expect(native.deleteWorkout).not.toHaveBeenCalled()
  })
  it('does not queue or execute native deletions when sync is disabled', async () => {
    const store = await exportedPair(); disableAppleHealth()
    expect(queueAppleHealthWorkoutDeletion(store, session('one'))).toBe(false)
    remove(store, 'one'); await syncAppleHealth(store)
    expect(native.deleteWorkout).not.toHaveBeenCalled()
  })
  it('finishes an in-flight export before deleting that same session', async () => {
    const store = makeStore(); store.getState().S.workouts = [session('one')]
    await enableAppleHealth(store)
    let finish; native.writeWorkouts.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const syncing = syncAppleHealth(store)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    remove(store, 'one'); finish({ written: 1 }); await syncing
    expect(native.deleteWorkout).toHaveBeenCalledWith({ workout: session('one') })
  })

  it('persists each successful deletion even if the next pending deletion fails', async () => {
    const store = await exportedPair(); remove(store, 'one'); remove(store, 'two')
    native.deleteWorkout.mockResolvedValueOnce({ deleted: 1, confirmed: true }).mockRejectedValueOnce(new Error('denied'))
    await expect(syncAppleHealth(store)).rejects.toThrow('denied')
    expect(JSON.parse(localStorage.getItem('opengym_apple_health_written')).workouts).toEqual(['two'])
    store.getState().S.workouts.push(session('one'))
    await syncAppleHealth(store)
    expect(native.deleteWorkout.mock.calls.map(args => args[0].workout.id)).toEqual(['one', 'two', 'two'])
    expect(native.writeWorkouts.mock.calls.at(-1)[0].workouts[0].id).toBe('one')
  })

})
