// @vitest-environment happy-dom
/* Every sheet opened through useUI.openSheet (Modals.jsx) is a modal dialog, as the + sheet already
 * was: role=dialog and aria-modal, named by its header, focus moved in on open and kept inside, the
 * page behind inert, Escape closing it where the sheet allows, and focus back on what opened it.
 * Stacked sheets work in either closing order: the sheet under a newer one is inert and gets the
 * focus back, the page stays inert until the last one is gone.
 *
 * The real Modals on the real store, in a page that has the #app, #tabbar and #timer the dialog
 * focus puts out of reach. (The + sheet's own dialog is checked in App.tab-shell.test.jsx.) */
import React, { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Modals from './Modals.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
const q = s => document.querySelector(s)
const inert = id => document.getElementById(id).hasAttribute('inert')
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const key = (target, k, init = {}) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })) })
const open = (render, opts) => { let handle; act(() => { handle = useUI.getState().openSheet(render, opts) }); return handle }
const closeSheet = id => act(() => { useUI.getState().closeSheet(id) })
const nameOf = el => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent

// A sheet the way sheets are written: a heading, a control or two, a button that closes it.
const Plain = ({ title = 'Weigh in', close, children }) => <>
  <h3>{title}</h3>
  <input aria-label="weight" />
  {children}
  <button onClick={close}>Done</button>
</>

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"><button id="opener">Open</button></div><nav id="tabbar"><button>Home</button></nav><div id="timer"></div><div id="root"></div>'
  host = document.getElementById('root')
  useUI.setState({ sheets: [] })
  root = createRoot(host)
  await act(async () => { root.render(<Modals />) })
  document.getElementById('opener').focus()
})
afterEach(async () => {
  await act(async () => { useUI.getState().closeAll?.(); root.unmount() })
  await settle()
  document.body.innerHTML = ''
})

describe('a sheet is a dialog', () => {
  it('has the role, is modal and is named by its header', async () => {
    open(close => <Plain close={close} />)
    const sheet = q('.sheet')
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(nameOf(sheet)).toBe('Weigh in')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  })

  it('takes the focus itself on open (not a field: a phone would raise its keyboard) and keeps it inside', async () => {
    open(close => <Plain close={close} />)
    const sheet = q('.sheet')
    expect(document.activeElement).toBe(sheet)
    const controls = [...sheet.querySelectorAll('input, button')]
    controls.at(-1).focus()
    await key(sheet, 'Tab')
    expect(document.activeElement).toBe(controls[0])
    controls[0].focus()
    await key(sheet, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(controls.at(-1))
    // From the sheet itself, Shift+Tab goes to the last control, not out of the sheet.
    sheet.focus()
    await key(sheet, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(controls.at(-1))
  })

  it('keeps a field the sheet focused for itself, and still hands the focus back to the opener', async () => {
    const Search = ({ close }) => {
      const input = useRef(null)
      useEffect(() => { input.current.focus() }, [])
      return <><h3>Find food</h3><input ref={input} aria-label="search" /><button onClick={close}>Close</button></>
    }
    const h = open(close => <Search close={close} />)
    expect(document.activeElement).toBe(q('input[aria-label="search"]'))
    closeSheet(h.id)
    await settle()
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })

  it('puts the page behind out of reach, and gives it back, and the focus, when it closes', async () => {
    const h = open(close => <Plain close={close} />)
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(true)
    closeSheet(h.id)
    await settle()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })

  it('closes on Escape, unless the sheet is locked', async () => {
    open(close => <Plain close={close} />)
    await key(window, 'Escape')
    await settle()
    expect(q('.sheet')).toBeNull()

    document.getElementById('opener').focus()
    open(close => <Plain close={close} />, { locked: true })
    await key(window, 'Escape')
    await settle()
    expect(q('.sheet')).not.toBeNull()
    expect(q('.sheet').getAttribute('role')).toBe('dialog')
  })

  it('names the sheet from the first heading, h3 or not, and follows a header that arrives late', async () => {
    open(close => <><h2>Choose</h2><button onClick={close}>x</button></>)
    expect(nameOf(q('.sheet'))).toBe('Choose')
    closeSheet(useUI.getState().sheets[0].id)
    await settle()

    const Late = ({ close }) => {
      const [title, setTitle] = React.useState(null)
      useEffect(() => { setTitle('Loaded') }, [])
      return <>{title && <h3>{title}</h3>}<button onClick={close}>x</button></>
    }
    open(close => <Late close={close} />)
    await settle()
    expect(nameOf(q('.sheet'))).toBe('Loaded')
  })

  it('applies to a centred dialog too', async () => {
    open(close => <Plain title="Delete it?" close={close} />, { kind: 'center' })
    const dialog = q('.center')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(nameOf(dialog)).toBe('Delete it?')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(inert('app')).toBe(true)
  })

  it('leaves content that opts out (the + sheet) entirely alone: one dialog, one trap', async () => {
    const Own = ({ close }) => (
      <div role="dialog" aria-modal="true" aria-labelledby="own-title" data-own-dialog-focus><h3 id="own-title">Own</h3><button onClick={close}>x</button></div>
    )
    open(close => <Own close={close} />)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(q('.sheet').hasAttribute('role')).toBe(false)
    expect(q('.sheet').hasAttribute('aria-modal')).toBe(false)
    expect(inert('app')).toBe(false)
  })
})

describe('a viewer sheet whose content is already a dialog', () => {
  const Viewer = ({ close }) => (
    <div className="mviewer" role="dialog" aria-modal="true" aria-label="Photo">
      <button id="v-close" onClick={close}>Close</button>
      <button id="v-next">Next</button>
    </div>
  )

  it('keeps its own role and name, and still gets focus in, a Tab trap and an inert page', async () => {
    open(close => <Viewer close={close} />, { kind: 'viewer' })
    const dialog = q('.mviewer')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog.getAttribute('aria-label')).toBe('Photo')
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(true)
    q('#v-next').focus()
    await key(q('#v-next'), 'Tab')
    expect(document.activeElement).toBe(q('#v-close'))
    await key(q('#v-close'), 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(q('#v-next'))
  })

  it('gives the page and the focus back on close', async () => {
    const h = open(close => <Viewer close={close} />, { kind: 'viewer' })
    closeSheet(h.id)
    await settle()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })
})

describe('a sheet that replaces another in the same tap', () => {
  it('hands focus back to what opened the first, not to body, when the second closes', async () => {
    let second
    const h = open(close => (
      <Plain title="First" close={close}>
        <button id="row" onClick={() => { close(); second = useUI.getState().openSheet(c => <Plain title="Second" close={c} />) }}>Next</button>
      </Plain>
    ))
    q('#row').focus()
    act(() => { q('#row').click() })
    await settle()
    expect(h).toBeTruthy()
    expect(document.querySelectorAll('.sheet')).toHaveLength(1)
    closeSheet(second.id)
    await settle()
    expect(document.activeElement).toBe(document.getElementById('opener'))
    expect(inert('app')).toBe(false)
  })

  it('holds through a chain of three', async () => {
    let third
    open(close => (
      <Plain title="A" close={close}>
        <button id="row-a" onClick={() => {
          close()
          useUI.getState().openSheet(c => (
            <Plain title="B" close={c}>
              <button id="row-b" onClick={() => { c(); third = useUI.getState().openSheet(d => <Plain title="C" close={d} />) }}>Next</button>
            </Plain>
          ))
        }}>Next</button>
      </Plain>
    ))
    q('#row-a').focus()
    act(() => { q('#row-a').click() })
    await settle()
    q('#row-b').focus()
    act(() => { q('#row-b').click() })
    await settle()
    closeSheet(third.id)
    await settle()
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })
})

describe('stacked sheets', () => {
  const stack = () => {
    let second
    const a = open(close => <Plain title="First" close={close}><button id="to-second" onClick={() => { second = useUI.getState().openSheet(c => <Plain title="Second" close={c} />) }}>More</button></Plain>)
    q('#to-second').focus()
    act(() => { q('#to-second').click() })
    return { a, get b() { return second } }
  }
  const dialogs = () => [...document.querySelectorAll('.sheet')]

  it('each is a dialog with its own name, and the one under the newer is out of reach', async () => {
    stack()
    const [first, second] = dialogs()
    expect(nameOf(first)).toBe('First')
    expect(nameOf(second)).toBe('Second')
    expect(first.parentElement.hasAttribute('inert')).toBe(true)
    expect(second.parentElement.hasAttribute('inert')).toBe(false)
    expect(second.contains(document.activeElement)).toBe(true)
    expect(inert('app')).toBe(true)
  })

  it('closing the top one gives the focus back to the control that opened it, and the first is live again', async () => {
    const s = stack()
    closeSheet(s.b.id)
    await settle()
    const [first] = dialogs()
    expect(first.parentElement.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(q('#to-second'))
    expect(inert('app')).toBe(true)
    closeSheet(s.a.id)
    await settle()
    expect(inert('app')).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })

  it('closing the first while the second stays up leaves the page out of reach until the second goes', async () => {
    const s = stack()
    closeSheet(s.a.id)
    await settle()
    expect(dialogs()).toHaveLength(1)
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(true)
    closeSheet(s.b.id)
    await settle()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(false)
  })

  it('Escape closes the top sheet only', async () => {
    const s = stack()
    await key(window, 'Escape')
    await settle()
    expect(dialogs()).toHaveLength(1)
    expect(nameOf(dialogs()[0])).toBe('First')
    expect(useUI.getState().sheets.map(x => x.id)).toEqual([s.a.id])
  })
})
