// @vitest-environment happy-dom
// Reddit band colours: the chips under a set pick and unpick bands, and with no bands yet the one
// chip opens the editor, where the usual five can be added in one tap.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { BandChips } from './Bands.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
const mount = el => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(el)) }
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('BandChips', () => {
  it('shows each band and reports the tapped one, picked ones pressed', () => {
    useStore.setState(s => ({ S: { ...s.S, bands: [{ id: 'r', name: 'Red', color: '#eb5757' }, { id: 'y', name: 'Yellow', color: '#f2c94c' }] } }))
    const taps = []
    mount(<BandChips value={['y']} onToggle={id => taps.push(id)} />)
    const chips = [...host.querySelectorAll('button.chip.band')]
    expect(chips.map(b => b.textContent)).toEqual(['Red', 'Yellow'])
    expect(chips.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    act(() => chips[0].click())
    expect(taps).toEqual(['r'])
  })

  it('without bands offers to add them, opening the editor', () => {
    useStore.setState(s => ({ S: { ...s.S, bands: [] } }))
    const opened = []
    const was = useUI.getState().openSheet
    useUI.setState({ openSheet: fn => opened.push(fn) })
    try {
      mount(<BandChips value={[]} onToggle={() => {}} />)
      const add = host.querySelector('button.chip.add')
      expect(add.textContent).toMatch(/Add your bands/)
      act(() => add.click())
      expect(opened).toHaveLength(1)
    } finally { useUI.setState({ openSheet: was }) }
  })
})
