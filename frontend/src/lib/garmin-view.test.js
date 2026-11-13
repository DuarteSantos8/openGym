// What Settings → Garmin says for each state of the phone's Garmin link (lib/garmin-view.js).
import { describe, expect, it } from 'vitest'
import { garminView, garminDeviceLine } from './garmin-view.js'

const dev = (extra = {}) => ({ id: '1', name: 'Forerunner 265', connected: true, ...extra })

describe('Settings → Garmin', () => {
  it('waits while asking, and while the SDK starts', () => {
    expect(garminView(null).key).toBe('checking')
    expect(garminView({ supported: true, state: 'starting', devices: [] }).key).toBe('checking')
  })

  it('says when this build has no Garmin link, and offers nothing', () => {
    const v = garminView({ supported: false, state: 'build', devices: [] })
    expect(v).toMatchObject({ key: 'build', pick: false, getApp: false })
  })

  it('names what is wrong with Garmin Connect', () => {
    expect(garminView({ supported: true, state: 'no-gcm' })).toMatchObject({ key: 'no-gcm', pick: false })
    // the iPhone can ask again once Garmin Connect is installed
    expect(garminView({ supported: true, state: 'no-gcm', picker: true })).toMatchObject({ key: 'no-gcm', pick: true })
    // after the update nobody tells the link: Look again starts it over
    expect(garminView({ supported: true, state: 'gcm-upgrade' })).toMatchObject({ key: 'gcm-upgrade', pick: true, getApp: false })
    expect(garminView({ supported: true, state: 'error' })).toMatchObject({ key: 'error', pick: true })
  })

  it('iPhone: nothing picked yet asks to pick; Android: no watch paired in Garmin Connect', () => {
    expect(garminView({ supported: true, state: 'idle', picker: true, devices: [] })).toMatchObject({ key: 'pick', pick: true })
    expect(garminView({ supported: true, state: 'ready', devices: [] })).toMatchObject({ key: 'no-watch', pick: true })
  })

  it('a watch without the app offers the app', () => {
    const v = garminView({ supported: true, state: 'ready', installed: false, devices: [dev({ installed: false })] })
    expect(v).toMatchObject({ key: 'get-app', getApp: true })
    expect(v.devices).toHaveLength(1)
  })

  it('a watch out of reach that never said whether it has the app: no guess, no "get the app"', () => {
    const v = garminView({ supported: true, state: 'ready', installed: false, reachable: false, devices: [dev({ connected: false })] })
    expect(v).toMatchObject({ key: 'away', pick: true, getApp: false })
    // the iPhone with Bluetooth off or the watch away, right after Choose watches
    expect(garminView({ supported: true, state: 'ready', picker: true, installed: false, devices: [dev({ connected: false })] }).key).toBe('away')
    // one that said no while it was there still needs the app, in reach or not
    expect(garminView({ supported: true, state: 'ready', installed: false, devices: [dev({ connected: false, installed: false })] })).toMatchObject({ key: 'get-app', getApp: true })
    // in reach and not heard from yet: offered the app (opening it on the watch settles it either way)
    expect(garminView({ supported: true, state: 'ready', installed: false, devices: [dev()] }).key).toBe('get-app')
  })

  it('every state has a line that says what to do next', () => {
    const states = [
      null, { supported: false, state: 'build' }, { supported: true, state: 'no-gcm' }, { supported: true, state: 'gcm-upgrade' },
      { supported: true, state: 'error' }, { supported: true, state: 'starting' }, { supported: true, state: 'idle', picker: true, devices: [] },
      { supported: true, state: 'ready', devices: [] }, { supported: true, state: 'ready', installed: true, reachable: true, devices: [dev()] },
      { supported: true, state: 'ready', installed: true, devices: [dev({ connected: false })] }, { supported: true, state: 'ready', devices: [dev({ connected: false })] },
      { supported: true, state: 'ready', devices: [dev({ installed: false })] }, { supported: true, state: 'something-new', devices: [] },
    ]
    const keys = states.map(st => garminView(st).key)
    expect(keys).toEqual(['checking', 'build', 'no-gcm', 'gcm-upgrade', 'error', 'checking', 'pick', 'no-watch', 'on-watch', 'on-watch-away', 'away', 'get-app', 'no-watch'])
    // a dead end is a state without a button that is not waiting for something by itself
    for (const st of states) {
      const v = garminView(st)
      if (!['checking', 'build', 'no-gcm'].includes(v.key)) expect(v.pick || v.getApp).toBe(true)
    }
  })

  it('a watch with the app: in reach or catching up later', () => {
    expect(garminView({ supported: true, state: 'ready', installed: true, reachable: true, devices: [dev()] }).key).toBe('on-watch')
    expect(garminView({ supported: true, state: 'ready', installed: true, reachable: false, devices: [dev({ connected: false })] }).key).toBe('on-watch-away')
  })

  it('drops devices without an id', () => {
    expect(garminView({ supported: true, state: 'ready', devices: [null, { name: 'x' }] }).devices).toEqual([])
  })

  it('each watch: connected, away, or without openGym', () => {
    expect(garminDeviceLine(dev())).toBe('connected')
    expect(garminDeviceLine(dev({ connected: false }))).toBe('away')
    expect(garminDeviceLine(dev({ installed: false }))).toBe('not-installed')
  })
})
