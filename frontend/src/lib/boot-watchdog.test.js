// @vitest-environment happy-dom
// The boot watchdog, the inline script in index.html. 1.4.2 sat on its splash forever on iOS 15.5
// to 16.3: one chunk did not parse, nothing of the app ran, and nothing said why. The script is
// read off index.html itself and run against the boot screen it guards.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hideBoot } from './boot.js'

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8')
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
const bootMarkup = html.match(/<div id="boot"[\s\S]*?<\/svg>\s*<\/div>/)[0]

let added = []
const realAdd = window.addEventListener.bind(window)
beforeEach(() => {
  vi.useFakeTimers()
  added = []
  // Each test runs the script afresh; its listeners are taken off again afterwards.
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => { added.push([type, fn, opts]); realAdd(type, fn, opts) })
  document.body.innerHTML = bootMarkup + '<div id="root"></div>'
  for (const body of inline) new Function(body)()
})
afterEach(() => {
  for (const [type, fn, opts] of added) window.removeEventListener(type, fn, opts)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const boot = () => document.getElementById('boot')
const syntaxError = () => new ErrorEvent('error', {
  message: 'SyntaxError: Invalid regular expression: invalid group specifier name',
  filename: 'https://gym.test/demo/assets/media-refs-CaxawJNr.js', lineno: 1,
})

describe('boot watchdog', () => {
  it('replaces the logo with the reason and a Reload button when a chunk does not parse', () => {
    window.dispatchEvent(syntaxError())
    const b = boot()
    expect(b.className).toBe('fail')
    expect(b.querySelector('svg')).toBeNull()
    expect(b.getAttribute('role')).toBe('alert')
    expect(b.hasAttribute('aria-hidden')).toBe(false)
    expect(b.textContent).toContain('openGym could not start on this browser.')
    expect(b.querySelector('code').textContent).toContain('Invalid regular expression: invalid group specifier name at media-refs-CaxawJNr.js:1')
    const reload = b.querySelector('button')
    expect(reload.textContent).toBe('Reload')
    expect(b.textContent).not.toContain('—')
  })

  it('says which script could not be loaded', () => {
    const s = document.createElement('script')
    s.type = 'text/plain'   // happy-dom would try to fetch it otherwise; the event is the same
    s.src = 'https://gym.test/assets/index-B93PyrcZ.js'
    document.body.appendChild(s)
    s.dispatchEvent(new Event('error'))
    expect(boot().className).toBe('fail')
    expect(boot().querySelector('code').textContent).toContain('Could not load https://gym.test/assets/index-B93PyrcZ.js')
  })

  it('ignores an image that failed to load, and an ordinary error until the 10 s are up', () => {
    const img = document.createElement('img')
    document.body.appendChild(img)
    img.dispatchEvent(new Event('error'))
    window.dispatchEvent(new ErrorEvent('error', { message: "TypeError: undefined is not an object (evaluating 'a.b')", filename: 'https://gym.test/assets/x.js', lineno: 3 }))
    expect(boot().className).toBe('')
    vi.advanceTimersByTime(10000)
    expect(boot().textContent).toContain('openGym could not start on this browser.')
    expect(boot().querySelector('code').textContent).toContain("undefined is not an object (evaluating 'a.b') at x.js:3")
  })

  it('says it is taking too long when nothing failed but the app never came', () => {
    vi.advanceTimersByTime(9999)
    expect(boot().querySelector('svg')).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(boot().textContent).toContain('openGym is taking too long to start.')
  })

  it('waits for the boot screen when the failure comes before the page is there', () => {
    document.getElementById('boot').remove()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    window.dispatchEvent(syntaxError())
    document.body.insertAdjacentHTML('afterbegin', bootMarkup)
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(boot().className).toBe('fail')
  })

  it('stays quiet once the app has drawn', () => {
    hideBoot()
    vi.advanceTimersByTime(10000)
    window.dispatchEvent(syntaxError())
    expect(document.getElementById('boot')).toBeNull()
  })

  it('leaves the message to lib/boot.js, which takes it away once a slow start gets there', () => {
    vi.advanceTimersByTime(10000)
    expect(boot().className).toBe('fail')
    hideBoot()
    vi.advanceTimersByTime(1000)
    expect(document.getElementById('boot')).toBeNull()
  })
})
