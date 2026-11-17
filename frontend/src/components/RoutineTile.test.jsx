// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import RoutineTile from './RoutineTile.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const tile = r => {
  const host = document.createElement('div')
  act(() => createRoot(host).render(<RoutineTile r={r} />))
  return host.querySelector('.lrow-i')
}

describe('RoutineTile', () => {
  it('takes the routine colour', () => {
    expect(tile({ color: 'red', emoji: 'arm' }).getAttribute('style')).toContain('--tint: var(--red)')
  })
  it('is the plain accent tile without a colour', () => {
    expect(tile({ emoji: 'arm' }).getAttribute('style')).toContain('--tint: var(--acc)')
  })
})
