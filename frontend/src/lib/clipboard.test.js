// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextLater } from './clipboard.js'

// WebKit writes to the clipboard only during the tap: the write starts then, the text comes later.
describe('copyTextLater', () => {
  const was = { ClipboardItem: globalThis.ClipboardItem, clipboard: navigator.clipboard }
  afterEach(() => {
    globalThis.ClipboardItem = was.ClipboardItem
    Object.defineProperty(navigator, 'clipboard', { value: was.clipboard, configurable: true })
  })

  it('starts the write at once with the text to come', async () => {
    const items = []
    globalThis.ClipboardItem = class { constructor (data) { this.data = data; items.push(this) } }
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true })
    let give
    const text = new Promise(r => { give = r })
    const done = copyTextLater(text)
    // the write went out before the text was there
    expect(write).toHaveBeenCalledTimes(1)
    give('Push day')
    expect(await done).toBe(true)
    const blob = await items[0].data['text/plain']
    expect(await blob.text()).toBe('Push day')
  })

  it('copies the plain way once the text is there where there is no ClipboardItem', async () => {
    globalThis.ClipboardItem = undefined
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await copyTextLater(Promise.resolve('Pull day'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Pull day')
  })

  it('says it failed when the text could not be put together', async () => {
    globalThis.ClipboardItem = undefined
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true })
    expect(await copyTextLater(Promise.reject(new Error('no')))).toBe(false)
  })
})
