import { describe, expect, it } from 'vitest'
import { menuItemsOf } from './menu-items.js'

describe('menuItemsOf', () => {
  it('flattens sections and the rows folded under More, in the order the sheet shows them', () => {
    const menu = { sections: [
      { items: [{ label: 'Note' }, null] },
      { more: [{ title: 'Exercise', items: [{ label: 'Settings' }, false] }, { items: [{ label: 'Move up' }] }] },
      { items: [{ label: 'Remove', danger: true }] },
    ] }
    expect(menuItemsOf(menu).map(it => it.label)).toEqual(['Note', 'Settings', 'Move up', 'Remove'])
  })
  it('takes a flat items list too', () => {
    expect(menuItemsOf({ items: [{ label: 'A' }, undefined, { label: 'B' }] }).map(it => it.label)).toEqual(['A', 'B'])
  })
})
