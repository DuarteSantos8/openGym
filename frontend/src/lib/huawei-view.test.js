// What Settings → Huawei watch says for each state of the phone's Huawei link (lib/huawei-view.js).
import { describe, expect, it } from 'vitest'
import { huaweiView, huaweiDeviceLine, HUAWEI_DOCS } from './huawei-view.js'

const dev = (extra = {}) => ({ id: '1', name: 'Watch GT 5', connected: true, ...extra })

describe('Settings → Huawei watch', () => {
  it('waits while asking, and while the link starts', () => {
    expect(huaweiView(null).key).toBe('checking')
    expect(huaweiView({ supported: true, state: 'starting', devices: [] }).key).toBe('starting')
    // never asked for yet: opening the page asks for it, so it is about to start
    expect(huaweiView({ supported: true, state: 'off', devices: [] }).key).toBe('starting')
    expect(huaweiView({ supported: true, state: 'starting' }).button).toBe(null)
  })

  it('says when this build has no Huawei link, and offers nothing', () => {
    expect(huaweiView({ supported: false, state: 'build', devices: [] })).toMatchObject({ key: 'build', button: null, getApp: false })
  })

  it('Huawei Health missing: install it and come back, no button', () => {
    expect(huaweiView({ supported: true, state: 'no-health', devices: [] })).toMatchObject({ key: 'no-health', button: null })
  })

  it('no permission yet: the button asks in Huawei Health', () => {
    expect(huaweiView({ supported: true, state: 'no-permission', devices: [] })).toMatchObject({ key: 'no-permission', button: 'allow' })
  })

  it('an error: the button tries again', () => {
    expect(huaweiView({ supported: true, state: 'error', devices: [] })).toMatchObject({ key: 'error', button: 'again' })
  })

  it('ready with no watch known: pair it in Huawei Health, then look again', () => {
    expect(huaweiView({ supported: true, state: 'ready', devices: [] })).toMatchObject({ key: 'no-watch', button: 'again', getApp: false })
  })

  it('ready with watches: the list, how it works, look again', () => {
    const v = huaweiView({ supported: true, state: 'ready', installed: true, reachable: true, devices: [dev({ installed: true })] })
    expect(v).toMatchObject({ key: 'ready', button: 'again', getApp: false })
    expect(v.devices).toHaveLength(1)
  })

  it('points at the guide while a watch has no openGym, or has not said yet', () => {
    expect(huaweiView({ supported: true, state: 'ready', devices: [dev({ installed: false })] }).getApp).toBe(true)
    expect(huaweiView({ supported: true, state: 'ready', devices: [dev({ connected: false })] }).getApp).toBe(true)
    expect(HUAWEI_DOCS).toBe('https://github.com/DuarteSantos8/openGym/blob/main/docs/HUAWEI_WATCH.md')
  })

  it('every state has a line, and every state but the waiting ones has a way on', () => {
    const states = [
      null, { supported: false, state: 'build' }, { supported: true, state: 'off' }, { supported: true, state: 'starting' },
      { supported: true, state: 'no-health' }, { supported: true, state: 'no-permission' }, { supported: true, state: 'error' },
      { supported: true, state: 'ready', devices: [] }, { supported: true, state: 'ready', devices: [dev({ installed: true })] },
      { supported: true, state: 'something-new', devices: [] },
    ]
    expect(states.map(st => huaweiView(st).key)).toEqual(['checking', 'build', 'starting', 'starting', 'no-health', 'no-permission', 'error', 'no-watch', 'ready', 'starting'])
  })

  it('drops devices without an id', () => {
    expect(huaweiView({ supported: true, state: 'ready', devices: [null, { name: 'x' }] }).devices).toEqual([])
  })

  it('each watch: connected, away, or without openGym', () => {
    expect(huaweiDeviceLine(dev())).toBe('connected')
    expect(huaweiDeviceLine(dev({ connected: false }))).toBe('away')
    expect(huaweiDeviceLine(dev({ installed: false }))).toBe('not-installed')
  })
})
