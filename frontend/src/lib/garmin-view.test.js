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
    expect(garminView({ supported: true, state: 'no-gcm' }).key).toBe('no-gcm')
    expect(garminView({ supported: true, state: 'gcm-upgrade' }).key).toBe('gcm-upgrade')
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
