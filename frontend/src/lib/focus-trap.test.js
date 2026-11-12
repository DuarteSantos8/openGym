// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { trapTab, canTakeFocusBack } from './focus-trap.js'

const all = () => true
function dialog(html) {
  document.body.innerHTML = `<button id="behind">Behind</button><div id="box" tabindex="-1">${html}</div>`
  return document.getElementById('box')
}

describe('trapTab', () => {
  it('pulls a Tab pressed on the page behind into the sheet: first stop, last with Shift', () => {
    const box = dialog('<button id="a">A</button><input id="b"><button id="c">C</button>')
    const behind = document.getElementById('behind')
    expect(trapTab(box, behind, false, all).id).toBe('a')
    expect(trapTab(box, behind, true, all).id).toBe('c')
  })

  it('starts at the first stop when the sheet itself holds the focus', () => {
    const box = dialog('<button id="a">A</button><button id="c">C</button>')
    expect(trapTab(box, box, false, all).id).toBe('a')
  })

  it('wraps from the last stop to the first and back', () => {
    const box = dialog('<button id="a">A</button><input id="b"><button id="c">C</button>')
    expect(trapTab(box, document.getElementById('c'), false, all).id).toBe('a')
    expect(trapTab(box, document.getElementById('a'), true, all).id).toBe('c')
  })

  it('leaves a Tab in the middle to the browser', () => {
    const box = dialog('<button id="a">A</button><input id="b"><button id="c">C</button>')
    expect(trapTab(box, document.getElementById('b'), false, all)).toBe(null)
    expect(trapTab(box, document.getElementById('b'), true, all)).toBe(null)
  })

  it('skips disabled, hidden and tabindex -1 controls', () => {
    const box = dialog('<button id="a" disabled>A</button><input type="hidden"><span tabindex="-1">x</span><button id="b">B</button><button id="gone">G</button>')
    const visible = el => el.id !== 'gone'
    expect(trapTab(box, null, false, visible).id).toBe('b')
    expect(trapTab(box, null, true, visible).id).toBe('b')
  })

  it('keeps the focus on a sheet with nothing to tab to', () => {
    const box = dialog('<p>Just words</p>')
    expect(trapTab(box, document.getElementById('behind'), false, all)).toBe(box)
  })
})

describe('canTakeFocusBack', () => {
  it('a button on the page does, a text field does not, and neither does one that is gone', () => {
    document.body.innerHTML = '<button id="b">Log</button><input id="i"><textarea id="t"></textarea>'
    expect(canTakeFocusBack(document.getElementById('b'))).toBe(true)
    expect(canTakeFocusBack(document.getElementById('i'))).toBe(false)
    expect(canTakeFocusBack(document.getElementById('t'))).toBe(false)
    const gone = document.getElementById('b'); gone.remove()
    expect(canTakeFocusBack(gone)).toBe(false)
    expect(canTakeFocusBack(document.body)).toBe(false)
    expect(canTakeFocusBack(null)).toBe(false)
  })
})
