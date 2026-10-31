// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareImage } from './share-image.js'
import { useUI } from '../store/useUI.js'

/* One PNG out to the person, shared by the workout card and the photo comparison: the browser's
   own share sheet where it can share files, else a download and a toast. (The phone apps go
   through lib/mobile.js shareExportBlob, which needs the native plugins.) */
const blob = new Blob(['png'], { type: 'image/png' })

describe('shareImage in a browser', () => {
  let toast, click
  beforeEach(() => {
    toast = vi.spyOn(useUI.getState(), 'toast').mockImplementation(() => {})
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete navigator.canShare
    delete navigator.share
  })

  it('opens the share sheet with the file when the browser can share files', async () => {
    navigator.canShare = vi.fn(() => true)
    navigator.share = vi.fn(async () => {})
    await shareImage(blob, 'a.png', 'Title')
    const arg = navigator.share.mock.calls[0][0]
    expect(arg.title).toBe('Title')
    expect(arg.files).toHaveLength(1)
    expect(arg.files[0].name).toBe('a.png')
    expect(arg.files[0].type).toBe('image/png')
    expect(click).not.toHaveBeenCalled()
  })

  it('says nothing when the share sheet is dismissed', async () => {
    navigator.canShare = vi.fn(() => true)
    navigator.share = vi.fn(async () => { throw new Error('AbortError') })
    await expect(shareImage(blob, 'a.png', 'Title')).resolves.toBeUndefined()
    expect(toast).not.toHaveBeenCalled()
  })

  it('downloads the picture and says so when the browser cannot share files', async () => {
    await shareImage(blob, 'a.png', 'Title')
    expect(click).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(toast).toHaveBeenCalledWith('Image saved')
  })

  it('downloads too when canShare says no to files', async () => {
    navigator.canShare = vi.fn(() => false)
    navigator.share = vi.fn()
    await shareImage(blob, 'a.png', 'Title')
    expect(navigator.share).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })
})
