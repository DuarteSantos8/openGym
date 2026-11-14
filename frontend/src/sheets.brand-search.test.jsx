// @vitest-environment happy-dom
// Issue #1082: typing a machine brand in the exercise picker's search lists the exercises
// labelled with it first, the brand under the name, inside the muscle group already picked.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { CATALOGUE } from './lib/exercises.js'
import { exerciseNameFor } from './lib/i18n-core.js'
import { exercisePicker } from './sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const rows = host => [...host.querySelectorAll('.list .item:not(.ex-new)')]
const nameOf = row => row.querySelector('.tt').textContent.trim()
const chip = (host, text) => [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)

const PRESS = CATALOGUE.find(e => /^sled 45° leg press$/i.test(e.n))
const CURL = CATALOGUE.find(e => /^lever lying leg curl$/i.test(e.n))

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), exGym: {
    [PRESS.id]: { split: true, brands: { g1: 'Life Fitness' }, _ts: 1 },
    [CURL.id]: { split: true, brands: { g1: 'Life Fitness' }, _ts: 1 },
  } }, user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise picker: search by machine brand', () => {
  it('lists the brand\'s exercises first with the brand under the name', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => type(host.querySelector('.search input'), 'lifefitness'))
    const first = rows(host).slice(0, 2)
    expect(first.map(nameOf).sort()).toEqual([exerciseNameFor(PRESS), exerciseNameFor(CURL)].sort())
    for (const r of first) expect([...r.querySelectorAll('.ss')].map(s => s.textContent)).toContain('Life Fitness')
  })

  it('narrows by name with the other words, the plain results after', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => type(host.querySelector('.search input'), 'life fitness press'))
    expect(nameOf(rows(host)[0])).toBe(exerciseNameFor(PRESS))
    expect(rows(host).map(nameOf)).not.toContain(exerciseNameFor(CURL))
  })

  it('keeps the muscle group already picked', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => chip(host, 'back').click())
    act(() => type(host.querySelector('.search input'), 'life fitness'))
    const names = rows(host).map(nameOf)
    expect(names).not.toContain(exerciseNameFor(PRESS))
    expect(names).not.toContain(exerciseNameFor(CURL))
  })
})
