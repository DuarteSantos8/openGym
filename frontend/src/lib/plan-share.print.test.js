// @vitest-environment happy-dom
// Printing a page of printable HTML: through a hidden iframe in a browser tab, from the document
// itself in the app installed on the home screen, where iOS drops a print asked for from a frame.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { printHtmlInFrame, printHtmlInPage, PRINT_ROOT_ID } from './plan-share.js'

const PAGE = `<!doctype html><html><head><style>
  @page { size: A4; margin: 15mm; }
  html { print-color-adjust: exact; }
  body { color: #111; }
  h1 { font-size: 26px; }
</style></head><body><div class="doc"><h1>Bench</h1><img src="data:image/png;base64,UVI=" alt="QR"></div></body></html>`

const tick = (ms = 200) => new Promise(r => setTimeout(r, ms))

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root">app</div>'
  window.print = vi.fn()
})
afterEach(() => { vi.useRealTimers() })

describe('printHtmlInPage (the installed app)', () => {
  it('prints from the document itself: no frame, the page in a shadow root, the rest hidden for print', async () => {
    printHtmlInPage(PAGE)
    expect(document.querySelector('iframe')).toBeNull()
    const host = document.getElementById(PRINT_ROOT_ID)
    expect(host).toBeTruthy()
    expect(host.shadowRoot.querySelector('h1').textContent).toBe('Bench')
    const shadowCss = host.shadowRoot.querySelector('style').textContent
    expect(shadowCss).toContain(':host { print-color-adjust: exact; }')
    expect(shadowCss).toContain(':host { color: #111; }')
    expect(shadowCss).not.toContain('@page')
    const topCss = document.getElementById(PRINT_ROOT_ID + '-style').textContent
    expect(topCss).toContain('@page { size: A4; margin: 15mm; }')
    expect(topCss).toContain(`body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }`)
    expect(topCss).toContain(`@media screen { #${PRINT_ROOT_ID} { display: none !important; } }`)
    await tick()
    expect(window.print).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById(PRINT_ROOT_ID)).toBeNull()
    expect(document.getElementById(PRINT_ROOT_ID + '-style')).toBeNull()
    expect(document.getElementById('root')).toBeTruthy()
  })

  it('replaces a page still waiting from an earlier print', async () => {
    printHtmlInPage(PAGE)
    printHtmlInPage(PAGE)
    expect(document.querySelectorAll('#' + PRINT_ROOT_ID)).toHaveLength(1)
    expect(document.querySelectorAll('#' + PRINT_ROOT_ID + '-style')).toHaveLength(1)
  })
})

describe('printHtmlInFrame', () => {
  it('takes the in-page path in the installed app', () => {
    printHtmlInFrame(PAGE, { installed: true })
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.getElementById(PRINT_ROOT_ID)).toBeTruthy()
  })

  it('keeps the hidden iframe in a browser tab', () => {
    printHtmlInFrame(PAGE, { installed: false })
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeTruthy()
    expect(document.getElementById(PRINT_ROOT_ID)).toBeNull()
  })
})
