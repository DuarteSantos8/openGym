// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromApp } from './sheets.jsx'

// Check exercise matches: the summary lists every name in the file and what it becomes, a tap
// changes it before anything is written, and Import keeps the pick for the next file.
const CSV = ['Date,Exercise,Weight,Reps', '2026-01-02,Bench Press,60,5', '2026-01-02,Grip Trainer Thing,20,10'].join('\n')
const DB_PRESS = '0289'
let root, host

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} className="test-sheet">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const top = () => [...host.querySelectorAll('.test-sheet')].at(-1)
const button = (el, text) => [...el.querySelectorAll('button, [role=button]')].find(b => b.textContent.includes(text))
const tile = label => [...host.querySelectorAll('.tile')].find(x => x.querySelector('.l')?.textContent === label)?.querySelector('.v').textContent

async function summaryFor(text) {
  importFromApp(new File([text], 'export.csv', { type: 'text/csv' }))
  for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Sheets />))
}

describe('Check exercise matches', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], customEx: [], exAliases: {} } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  it('keeps a matched name as your own exercise, and the summary counts it', async () => {
    await summaryFor(CSV)
    expect(tile('Added as your own')).toBe('1')
    act(() => button(top(), 'Check exercise matches').click())
    const row = button(top(), 'Bench Press')
    expect(row.textContent).toContain('→')
    act(() => row.click())
    act(() => button(top(), 'Keep as your own exercise').click())
    expect(button(top(), 'Bench Press').textContent).toContain('Your own exercise · your pick')
    act(() => button(top(), 'Done').click())
    expect(tile('Added as your own')).toBe('2')
    act(() => button(top(), 'Import').click())
    expect(useStore.getState().S.customEx.map(c => c.n)).toEqual(expect.arrayContaining(['bench press', 'grip trainer thing']))
  })

  it('shows a remembered pick as yours, and Use the automatic match drops it on Import', async () => {
    useStore.getState().update(s => { s.exAliases = { [DB_PRESS]: ['Bench Press'] } })
    await summaryFor(CSV)
    act(() => button(top(), 'Check exercise matches').click())
    expect(button(top(), 'Bench Press').textContent).toContain('your pick')
    act(() => button(top(), 'Bench Press').click())
    act(() => button(top(), 'Use the automatic match').click())
    expect(button(top(), 'Bench Press').textContent).not.toContain('your pick')
    act(() => button(top(), 'Done').click())
    act(() => button(top(), 'Import').click())
    expect(useStore.getState().S.exAliases[DB_PRESS]).toEqual([])
    expect(useStore.getState().S.workouts[0].entries.map(e => e.id)).not.toContain(DB_PRESS)
  })
})
