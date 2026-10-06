// @vitest-environment happy-dom
// Edit and Delete on a custom exercise (issues #378, #358). The buttons follow the row in
// customEx, even when that row never got `custom: true`, and they sit under the title so a
// sheet that does not scroll still shows them.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseDetailSheet } from './sheets.jsx'

const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

const buttonText = host => [...host.querySelectorAll('button')].map(b => b.textContent)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('custom exercise detail', () => {
  const mine = { id: 'c-landmine', n: 'Landmine row', bp: 'back', eq: 'barbell', desc: 'Bar in the corner' }

  it('offers Edit and Delete under the title when the stored row has no custom flag', () => {
    useStore.setState(s => ({ S: { ...s.S, customEx: [mine] } }))
    exerciseDetailSheet(mine)
    const host = renderTop()
    const labels = buttonText(host)
    expect(labels).toContain('Edit')
    expect(labels).toContain('Delete')
    const edit = [...host.querySelectorAll('button')].find(b => b.textContent === 'Edit')
    const add = [...host.querySelectorAll('button')].find(b => b.textContent === 'Add to my plan')
    expect(edit.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('h3').textContent).toBe('Landmine row')
  })

  it('does not offer Edit or Delete for a catalogue exercise', () => {
    exerciseDetailSheet(EXDB[0])
    const labels = buttonText(renderTop())
    expect(labels).not.toContain('Edit')
    expect(labels).not.toContain('Delete')
  })
})
