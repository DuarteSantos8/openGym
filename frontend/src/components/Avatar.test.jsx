// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarFace, AvatarSection } from './Avatar.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: {}, user: null, config: null }
  state.snapshot = () => ({
    S: state.S, user: state.user, config: state.config,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

const HASH = 'c'.repeat(64)
const photo = { avatar: { m: { kind: 'image', hash: HASH, mime: 'image/webp', size: 9000, width: 256, height: 256, at: 1 } } }
let host, root, media
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const mount = async el => { act(() => root.render(el)); await settle() }
const face = () => host.querySelector('[data-avatar]')

describe('the profile picture', () => {
  beforeEach(() => {
    mocks.S = {}; mocks.user = null; mocks.config = null
    media = createMediaStore(memoryBackend(), { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL: () => {} } })
    _setMediaStore(media)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); _setMediaStore(null) })

  it('shows the first letter without a picture, the icon without a name', async () => {
    await mount(<AvatarFace name="ana" />)
    expect(face().dataset.avatar).toBe('letter')
    expect(face().textContent).toBe('A')
    await mount(<AvatarFace name={null} />)
    expect(face().dataset.avatar).toBe('none')
    expect(face().querySelector('svg')).toBeTruthy()
  })

  it('shows the photo from the local store, and the letter when its file is not here', async () => {
    mocks.S = photo
    await mount(<AvatarFace name="Ana" />)
    expect(face().dataset.avatar).toBe('letter')          // not in the store, nobody to fetch it from
    await media.put(HASH, new Blob(['x'], { type: 'image/webp' }), { mime: 'image/webp' })
    await mount(<AvatarFace name="Bo" key="again" />)
    expect(face().dataset.avatar).toBe('photo')
    expect(face().querySelector('img').getAttribute('src')).toBe('blob:t/1')
  })

  it('falls back to the letter when the picture fails to load', async () => {
    mocks.S = photo
    await media.put(HASH, new Blob(['x'], { type: 'image/webp' }), { mime: 'image/webp' })
    await mount(<AvatarFace name="Ana" />)
    act(() => { face().querySelector('img').dispatchEvent(new Event('error')) })
    expect(face().dataset.avatar).toBe('letter')
    expect(face().textContent).toBe('A')
  })

  it('a built-in picture shows on the tint, and the editor offers to remove it', async () => {
    mocks.S = { avatar: { preset: 'flame' } }
    await mount(<AvatarSection name="Ana" signedIn={false} />)
    expect(face().dataset.avatar).toBe('preset')
    expect(host.textContent).toContain('Remove picture')
    expect(host.textContent).toContain('stays on this device')
    expect(host.querySelector('input[type=file]').getAttribute('accept')).toBe('image/*')
    const remove = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Remove picture'))
    act(() => remove.click())
    expect(mocks.S.avatar).toBeUndefined()
  })

  it('says it syncs only where the server keeps it', async () => {
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.config = { media: { imageMB: 2 } }
    await mount(<AvatarSection name="Ana" signedIn />)
    expect(host.textContent).toContain('stays on this device')
    mocks.config = { media: { imageMB: 2, avatar: true } }
    await mount(<AvatarSection name="Ana" signedIn key="b" />)
    expect(host.textContent).toContain('Not even an admin can.')
  })
})
