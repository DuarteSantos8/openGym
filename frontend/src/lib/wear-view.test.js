// Settings → Wear OS watch: every state of the link has its own line, and each one says what to do.
import { describe, expect, it } from 'vitest'
import { wearView, wearWatchLine, WEAR_DOCS } from './wear-view.js'

const watch = (over = {}) => ({ id: 'n1', name: 'Galaxy Watch4 (ABCD)', connected: true, installed: false, reachable: false, ...over })

describe('the Wear OS link, as Settings says it', () => {
  it('is still asking', () => {
    expect(wearView(null, 'sideload')).toEqual({ key: 'checking', getApp: false, watches: [] })
  })

  it('no watch: nothing connected, nothing with the app (also a phone without Play services)', () => {
    expect(wearView({ supported: true, paired: false, installed: false, reachable: false, watches: [] }, 'sideload').key).toBe('no-watch')
    expect(wearView({ supported: false, paired: false, installed: false, reachable: false }, 'play').key).toBe('no-watch')
  })

  it('a watch without the app: the Play app says Play Store, the APK says the Wear OS APK and offers the guide', () => {
    const wear = { supported: true, paired: true, installed: false, reachable: false, watches: [watch()] }
    expect(wearView(wear, 'play')).toMatchObject({ key: 'get-app-play', getApp: false })
    expect(wearView(wear, 'sideload')).toMatchObject({ key: 'get-app-apk', getApp: true })
    expect(wearView(wear, 'sideload').watches).toHaveLength(1)
    expect(WEAR_DOCS).toMatch(/docs\/WEAR_OS\.md#installing$/)
  })

  it('the app on the watch, in reach or not', () => {
    const on = { supported: true, paired: true, installed: true, reachable: true, watches: [watch({ installed: true, reachable: true })] }
    expect(wearView(on, 'sideload')).toMatchObject({ key: 'on-watch', getApp: false })
    expect(wearView({ ...on, reachable: false }, 'play').key).toBe('on-watch-away')
    // known to have the app, not connected right now (the watch is off, or far away)
    expect(wearView({ supported: true, paired: false, installed: true, reachable: false, watches: [] }, 'play').key).toBe('on-watch-away')
  })

  it('F-Droid and openGym Offline have no Wear OS link at all, whatever the phone says', () => {
    const on = { supported: true, paired: true, installed: true, reachable: true, watches: [watch()] }
    expect(wearView(on, 'fdroid')).toEqual({ key: 'build', getApp: false, watches: [] })
    expect(wearView(on, 'offline').key).toBe('build')
  })

  it('a list that is not one, or rows that are not rows, are left out', () => {
    expect(wearView({ paired: true, watches: 'nope' }, 'play').watches).toEqual([])
    expect(wearView({ paired: true, watches: [null, watch()] }, 'play').watches).toHaveLength(1)
  })
})

describe('one watch\'s line', () => {
  it('says whether openGym is on it and whether it is in reach', () => {
    expect(wearWatchLine(watch())).toBe('not-installed')
    expect(wearWatchLine(watch({ installed: true, reachable: true }))).toBe('connected')
    expect(wearWatchLine(watch({ installed: true, connected: false }))).toBe('away')
    expect(wearWatchLine(null)).toBe('not-installed')
  })
})
