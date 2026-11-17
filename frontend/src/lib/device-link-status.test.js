import { describe, expect, it } from 'vitest'
import { DELAYED_MS, FAST_MS, deviceRows, signFace } from './device-link-status.js'

const NOW = 1_000_000_000
const base = {
  platform: 'ios', watchOn: true,
  watch: { supported: true, paired: true, installed: true, reachable: true },
  seen: true, heard: null, ping: null, activeId: 'w1', startedAt: NOW - 60_000,
  server: null, relay: null, hr: null,
}
const run = over => deviceRows({ ...base, ...over }, NOW)
const watchOf = over => run(over).rows.find(r => r.id === 'watch')
const away = { supported: true, paired: true, installed: true, reachable: false }

describe('deviceRows: watch', () => {
  it('is live with a fast speed', () => {
    expect(watchOf({ ping: { ok: true, ms: 180, at: NOW } })).toMatchObject({ kind: 'apple', state: 'live', speed: 'fast', lastHeard: null, warn: false })
    expect(FAST_MS).toBe(1000)
  })
  it('is slow over the threshold', () => {
    expect(watchOf({ ping: { ok: true, ms: 1400, at: NOW } }).speed).toBe('slow')
  })
  it('is live without a speed when the ping fails', () => {
    expect(watchOf({ ping: { ok: false, at: NOW } })).toMatchObject({ state: 'live', speed: null })
  })
  it('is not found, not delayed, when the app is gone even though it was heard a moment ago', () => {
    expect(watchOf({ watch: { ...away, installed: false }, heard: { at: NOW - 30_000, wid: 'w1' } })).toMatchObject({ state: 'notFound', reason: 'notInstalled', warn: true })
  })
  it('is still checking while the link starts, not "not found"', () => {
    const r = run({ watch: { supported: true, paired: false, installed: false, activated: false, reachable: false } })
    expect(r).toMatchObject({ rows: [], overall: 'checking', checking: true })
  })
  it('uses the wear kind on android', () => {
    expect(watchOf({ platform: 'android' }).kind).toBe('wear')
  })
  it('is delayed when it answered a moment ago in this workout', () => {
    expect(watchOf({ watch: away, heard: { at: NOW - 30_000, wid: 'w1' } })).toMatchObject({ state: 'delayed', warn: false, lastHeard: null })
  })
  it('is offline after DELAYED_MS, with when it was last heard', () => {
    const at = NOW - 6 * 60_000
    expect(DELAYED_MS).toBe(5 * 60_000)
    expect(watchOf({ watch: away, heard: { at, wid: 'w1' } })).toMatchObject({ state: 'offline', warn: true, lastHeard: at })
  })
  it('is offline at once on android when there is no node', () => {
    const watch = { supported: true, paired: false, installed: true, reachable: false }
    expect(watchOf({ platform: 'android', watch, heard: { at: NOW - 5_000, wid: 'w1' } }).state).toBe('offline')
  })
  it('is not answering when never heard in this workout', () => {
    expect(watchOf({ watch: away })).toMatchObject({ state: 'notAnswering', warn: true, fix: 'watchSettings' })
  })
  it('is only checking during the grace window', () => {
    const r = run({ watch: away, startedAt: NOW - 5_000 })
    expect(r.rows.find(x => x.id === 'watch')).toBeUndefined()
    expect(r.overall).toBe('checking')
  })
  it('is checking, not empty, while the first look is out', () => {
    expect(run({ watch: null, looking: true })).toMatchObject({ rows: [], overall: 'checking' })
    expect(run({ watch: null, looking: false }).overall).toBe('none')
  })
  it('is not found when unpaired or not installed', () => {
    expect(watchOf({ watch: { ...away, paired: false } })).toMatchObject({ state: 'notFound', reason: 'unpaired', warn: true })
    expect(watchOf({ watch: { ...away, installed: false } })).toMatchObject({ state: 'notFound', reason: 'notInstalled', warn: true })
  })
  it('has no row for a phone that never had a watch', () => {
    expect(watchOf({ seen: false, watch: { supported: true, paired: false, installed: false, reachable: false } })).toBeUndefined()
  })
  it('has no row when the watch is switched off', () => {
    expect(watchOf({ watchOn: false })).toBeUndefined()
  })
  it('ignores what was heard for another workout', () => {
    expect(watchOf({ watch: away, heard: { at: NOW - 30_000, wid: 'old' } }).state).toBe('notAnswering')
  })
})

describe('deviceRows: other rows', () => {
  const noWatch = { watchOn: false }
  it('maps the server tones', () => {
    expect(run({ ...noWatch, server: { tone: 'ok' } }).rows[0]).toMatchObject({ id: 'server', state: 'ok', warn: false })
    expect(run({ ...noWatch, server: { tone: 'wait' } }).rows[0]).toMatchObject({ state: 'wait', warn: false })
    expect(run({ ...noWatch, server: { tone: 'wait', waited: true, action: 'retry' } }).rows[0]).toMatchObject({ state: 'wait', warn: true, fix: 'server', action: 'retry' })
    expect(run({ ...noWatch, server: { tone: 'off', action: 'retry', pending: true } }).rows[0].pending).toBe(true)
    for (const tone of ['off', 'bad']) expect(run({ ...noWatch, server: { tone, action: 'retry' } }).rows[0]).toMatchObject({ state: 'offline', warn: true, fix: 'server', action: 'retry' })
    expect(run({ ...noWatch, server: { tone: 'quiet' } }).rows).toEqual([])
    expect(run({ ...noWatch, server: null }).rows).toEqual([])
  })
  it('shows the zepp relay', () => {
    expect(run({ ...noWatch, relay: { linked: true, reachable: true, seen: 5 } }).rows[0]).toMatchObject({ id: 'zepp', state: 'live' })
    expect(run({ ...noWatch, relay: { linked: true, reachable: false, seen: 5 } }).rows[0]).toMatchObject({ state: 'offline', lastHeard: 5 })
    expect(run({ ...noWatch, relay: { linked: false, reachable: false, seen: 5 } }).rows).toEqual([])
  })
  it('shows a fresh heart rate and never warns on it', () => {
    expect(run({ ...noWatch, hr: { bpm: 128, at: NOW - 10_000 } }).rows[0]).toMatchObject({ id: 'hr', state: 'live', bpm: 128, warn: false })
    expect(run({ ...noWatch, hr: { bpm: 128, at: NOW - 61_000 } }).rows).toEqual([])
  })
  it('rolls up to none, ok or warn', () => {
    expect(run(noWatch).overall).toBe('none')
    expect(run({ ...noWatch, server: { tone: 'ok' } }).overall).toBe('ok')
    expect(run({ server: { tone: 'ok' }, watch: away }).overall).toBe('warn')
  })
  it('orders watch, zepp, heart rate, server', () => {
    const r = run({ server: { tone: 'ok' }, relay: { linked: true, reachable: true }, hr: { bpm: 90, at: NOW } })
    expect(r.rows.map(x => x.id)).toEqual(['watch', 'zepp', 'hr', 'server'])
  })
})

describe('signFace: the one symbol in the top bar', () => {
  const face = over => signFace(run(over))
  it('a live watch glows', () => {
    expect(face({})).toMatchObject({ device: 'watch', state: 'live', kind: 'apple' })
  })
  it('a quiet watch in a long rest is delayed, not trouble', () => {
    expect(face({ watch: away, heard: { wid: 'w1', at: NOW - 60_000 } })).toMatchObject({ device: 'watch', state: 'delayed' })
  })
  it('the first look and the grace show the watch checking', () => {
    expect(face({ watch: null, looking: true })).toMatchObject({ device: 'watch', state: 'checking' })
    expect(face({ watch: away, startedAt: NOW - 1000 })).toMatchObject({ device: 'watch', state: 'checking' })
    expect(face({ watch: null, looking: true, server: { tone: 'ok' } })).toMatchObject({ device: 'watch', state: 'checking' })
  })
  it('a watch still being looked for beats a server in trouble', () => {
    expect(face({ watch: null, looking: true, server: { tone: 'off' } })).toMatchObject({ device: 'watch', state: 'checking' })
  })
  it('a watch that does not answer is trouble on the watch', () => {
    expect(face({ watch: away })).toMatchObject({ device: 'watch', state: 'trouble', row: { state: 'notAnswering' } })
  })
  it('a syncing watch shows first, whatever else is linked or down', () => {
    expect(face({ server: { tone: 'off' } })).toMatchObject({ device: 'watch', state: 'live' })
    expect(face({ hr: { bpm: 90, at: NOW } })).toMatchObject({ device: 'watch', state: 'live' })
  })
  it('a watch that does not answer gives way to a device that syncs', () => {
    expect(face({ watch: away, hr: { bpm: 90, at: NOW, device: 'AirPods Pro' } })).toMatchObject({ device: 'earbuds', state: 'live' })
    expect(face({ watch: away, server: { tone: 'ok' } })).toMatchObject({ device: 'watch', state: 'trouble' })
  })
  it('no watch: a Bluetooth heart-rate source shows as Bluetooth, ahead of the cloud', () => {
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW } })).toMatchObject({ device: 'bluetooth', state: 'live', kind: 'hr' })
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW }, server: { tone: 'ok' } })).toMatchObject({ device: 'bluetooth', state: 'live' })
  })
  it('no watch: a syncing Bluetooth source shows over the server in trouble (it has its banner)', () => {
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW }, server: { tone: 'off' } })).toMatchObject({ device: 'bluetooth', state: 'live' })
    expect(face({ watchOn: false, server: { tone: 'off' } })).toMatchObject({ device: 'cloud', state: 'trouble' })
  })
  it('every watch has the one watch symbol: Wear OS and a Zepp relay too', () => {
    expect(face({ platform: 'android' })).toMatchObject({ device: 'watch', state: 'live', kind: 'wear' })
    expect(face({ watchOn: false, relay: { linked: true, reachable: true } })).toMatchObject({ device: 'watch', state: 'live', kind: 'zepp' })
  })
  it('a heart rate from earbuds shows the earbuds; an unnamed or other source stays Bluetooth', () => {
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW, device: 'AirPods Pro' } })).toMatchObject({ device: 'earbuds', state: 'live' })
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW, device: 'Powerbeats Pro 2' } })).toMatchObject({ device: 'earbuds' })
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW, device: 'Polar H10' } })).toMatchObject({ device: 'bluetooth' })
    expect(face({ watchOn: false, hr: { bpm: 90, at: NOW } })).toMatchObject({ device: 'bluetooth' })
  })
  it('no watch: the cloud, lit when synced and unlit while changes wait', () => {
    expect(face({ watchOn: false, server: { tone: 'ok' } })).toMatchObject({ device: 'cloud', state: 'live' })
    expect(face({ watchOn: false, server: { tone: 'wait' } })).toMatchObject({ device: 'cloud', state: 'delayed' })
  })
  it('nothing linked: a dim phone', () => {
    expect(face({ watchOn: false })).toMatchObject({ device: 'phone', state: 'none' })
  })
})
