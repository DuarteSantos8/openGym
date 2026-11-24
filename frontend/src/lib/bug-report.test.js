import { describe, expect, it } from 'vitest'
import { osOf, browserOf, environmentOf, bugReportUrl } from './bug-report.js'

const PIXEL = 'Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const WIN_FF = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
const MAC_EDGE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'

describe('Report a problem (#1482)', () => {
  it('reads the OS and the browser', () => {
    expect([osOf(PIXEL), browserOf(PIXEL)]).toEqual(['Android 16', 'Chrome 141'])
    expect([osOf(IPHONE), browserOf(IPHONE)]).toEqual(['iOS 26.1', 'Safari 26.1'])
    expect([osOf(WIN_FF), browserOf(WIN_FF)]).toEqual(['Windows', 'Firefox 133'])
    expect([osOf(MAC_EDGE), browserOf(MAC_EDGE)]).toEqual(['macOS', 'Edge 141'])
    expect([osOf(''), browserOf(undefined)]).toEqual(['', ''])
  })
  it('says app or browser in the environment line', () => {
    expect(environmentOf(PIXEL, { app: true })).toBe('openGym app on Android 16')
    expect(environmentOf(WIN_FF)).toBe('Firefox 133 on Windows')
  })
  it('opens the bug form with the two fields filled in and nothing else', () => {
    const u = new URL(bugReportUrl({ version: '1.4.6 (Google Play)', environment: 'openGym app on Android 16', repo: 'DuarteSantos8/openGym' }))
    expect(u.origin + u.pathname).toBe('https://github.com/DuarteSantos8/openGym/issues/new')
    expect(Object.fromEntries(u.searchParams)).toEqual({ template: 'bug_report.yml', version: '1.4.6 (Google Play)', environment: 'openGym app on Android 16' })
  })
})
