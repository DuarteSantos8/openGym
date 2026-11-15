// @vitest-environment happy-dom
// Settings → Modules (#1087): the Streak and Body weight parts also reach the recap sheet, the
// watch and the home-screen widget.
import React, { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { RecapHomeCard } from './Recap.jsx'
import { watchExtras } from '../lib/watch-sync.js'
import { buildWidgetSnapshot } from '../lib/widgets.js'

const BENCH = '0025'
const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const wk = d => ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), end: new Date(d + 'T11:00:00').getTime(), prs: [BENCH], entries: [{ id: BENCH, target: { mode: 'reps' }, sets: [{ w: 100, r: 5, done: true }] }] })
const profile = modules => ({ ...structuredClone(DEF), weekStart: 1, workouts: [wk('2026-10-20'), wk('2026-10-22')], modules })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T09:00:00'))   // a Monday
  useUI.setState({ sheets: [] })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); vi.useRealTimers() })

const recapTiles = modules => {
  useStore.setState({ S: profile(modules), user: null })
  const host = render(<RecapHomeCard S={useStore.getState().S} />)
  act(() => host.querySelector('.recap-card .tap-main').click())
  const sh = render(useUI.getState().sheets.at(-1).render(() => {}))
  return [...sh.querySelectorAll('.recap-tile .small')].map(e => e.textContent)
}

it('the recap leaves out its streak tile with the Streak part off', () => {
  expect(recapTiles({})).toContain('week in a row')
  expect(recapTiles({ 'motivation.streak': false })).not.toContain('week in a row')
})

it('the watch asks for no weigh-in with Body weight off', () => {
  expect(watchExtras({ weighIn: true }).weighIn).toBe(true)
  expect(watchExtras({ weighIn: true, modules: { 'body.weight': false } }).weighIn).toBe(false)
  expect(watchExtras({ weighIn: true, modules: { body: false } }).weighIn).toBe(false)
})

it('the widget sends no streak with the Streak part off', () => {
  const on = buildWidgetSnapshot(profile({}), { today: '2026-10-26' })
  expect(on.streakInfo).not.toBeNull()
  const off = buildWidgetSnapshot(profile({ 'motivation.streak': false }), { today: '2026-10-26' })
  expect(off).toMatchObject({ streak: 0, streakInfo: null })
})
