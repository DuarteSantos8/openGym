import { afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ loadHealth: null, readJsonFile: null }))
vi.mock('./health-sync.js', () => ({ HEALTH_FILE: 'opengym-health.json', onHealthChange: () => () => {}, loadHealth: (...a) => m.loadHealth(...a) }))
vi.mock('./mobile.js', () => ({ readJsonFile: (...a) => m.readJsonFile(...a) }))
import { initWeighInSource, weighInsFromHealth, weighInBlocked, weighInSourceLine } from './weigh-in-source.js'

// #1088: while the read of weigh-ins is on, no weigh-in is typed in.
let tell
const start = h => initWeighInSource(async () => h, cb => { tell = cb })
afterEach(() => tell?.({ readWeight: false }))

describe('weigh-ins from the health store only', () => {
  it('follows the read switch, and lets the sheet open while it is off', async () => {
    await start({ readWeight: false })
    expect(weighInsFromHealth({})).toBe(false)
    expect(weighInBlocked({}, {})).toBe(false)
    tell({ readWeight: true })
    expect(weighInsFromHealth({})).toBe(true)
    tell({ readWeight: false })
    expect(weighInBlocked({}, {})).toBe(false)
  })

  // loadHealth would fill health-sync's cache, and a save in the first seconds would sync early.
  it('reads the file itself at launch, leaving health-sync to load it on its own', async () => {
    m.loadHealth = vi.fn(async () => ({}))
    m.readJsonFile = vi.fn(async () => ({ readWeight: true }))
    await initWeighInSource(undefined, cb => { tell = cb })
    expect(m.readJsonFile).toHaveBeenCalledWith('opengym-health.json')
    expect(m.loadHealth).not.toHaveBeenCalled()
    expect(weighInsFromHealth({})).toBe(true)
  })

  it('blocks a plain Log with the line, and the check-in goes on without a weight', async () => {
    await start({ readWeight: true })
    const say = vi.fn()
    expect(weighInBlocked({}, {}, say)).toBe(true)
    expect(say).toHaveBeenCalledOnce()
    const onDone = vi.fn()
    expect(weighInBlocked({}, { required: true, onDone }, say)).toBe(true)
    expect(onDone).toHaveBeenCalledWith(null)
    expect(say).toHaveBeenCalledOnce()
  })

  it('still opens an existing weigh-in to change it', async () => {
    await start({ readWeight: true })
    expect(weighInBlocked({}, { edit: { d: '2026-09-09', id: 'am' } })).toBe(false)
  })

  it('is off while the Health module is paused, since nothing is read then', async () => {
    await start({ readWeight: true })
    const paused = { modules: { health: false } }
    expect(weighInsFromHealth(paused)).toBe(false)
    expect(weighInBlocked(paused, {})).toBe(false)
  })

  it('names the store of the phone', () => {
    expect(weighInSourceLine(false)).toBe('Weigh-ins come from Health Connect only.')
    expect(weighInSourceLine(true)).toBe('Weigh-ins come from Apple Health only.')
  })
})
