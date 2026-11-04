// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { watchDigits } from './digit-display.js'

const BN = '০১২৩৪৫৬৭৮৯'
const flush = () => new Promise(r => setTimeout(r, 0))

let host, stop
afterEach(() => { stop?.(); stop = null; host?.remove() })
const mount = html => { host = document.createElement('div'); host.innerHTML = html; document.body.appendChild(host) }

describe('watchDigits', () => {
  it('rewrites what is on screen and what renders later', async () => {
    mount('<p>3 × 8 · 1:30</p><span>আনুমানিক 1RM</span>')
    stop = watchDigits(host, BN)
    expect(host.querySelector('p').textContent).toBe('৩ × ৮ · ১:৩০')
    expect(host.querySelector('span').textContent).toBe('আনুমানিক 1RM')
    const added = document.createElement('b'); added.textContent = '12 kg'
    host.appendChild(added)
    host.querySelector('p').firstChild.nodeValue = '4 × 10'
    await flush()
    expect(added.textContent).toBe('১২ kg')
    expect(host.querySelector('p').textContent).toBe('৪ × ১০')
  })

  it('keeps inputs, code and translate="no" as they are', () => {
    mount('<input value="62.5"><code>node recover.js 2</code><span translate="no">v1 2</span><textarea>5</textarea>')
    stop = watchDigits(host, BN)
    expect(host.querySelector('input').value).toBe('62.5')
    expect(host.querySelector('code').textContent).toBe('node recover.js 2')
    expect(host.querySelector('span').textContent).toBe('v1 2')
    expect(host.querySelector('textarea').value).toBe('5')
  })

  it('puts the ASCII text back when it stops, but not over a node rendered since', () => {
    mount('<p>5</p><i>6</i>')
    stop = watchDigits(host, BN)
    host.querySelector('i').firstChild.nodeValue = 'সাত'
    stop(); stop = null
    expect(host.querySelector('p').textContent).toBe('5')
    expect(host.querySelector('i').textContent).toBe('সাত')
  })
})
