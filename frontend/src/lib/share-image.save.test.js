import { describe, it, expect, vi, beforeEach } from 'vitest'

// The phone build: saveImage goes to the SaveImage plugin through mobile.js, and only falls back
// to the share sheet where the phone can't save (Android 9 and older).
const save = vi.fn()
const share = vi.fn()
vi.mock('./mobile.js', () => ({ MOBILE: true, saveImageToPhotos: (...a) => save(...a), shareExportBlob: (...a) => share(...a) }))
const { saveImage } = await import('./share-image.js')

describe('saveImage on a phone', () => {
  beforeEach(() => { save.mockReset(); share.mockReset() })
  const blob = new Blob(['x'], { type: 'image/png' })

  it('saves to Photos and says so', async () => {
    save.mockResolvedValue('saved')
    const toast = vi.fn()
    expect(await saveImage(blob, 'a.png', 'openGym', toast)).toBe(true)
    expect(save).toHaveBeenCalledWith(blob, 'a.png')
    expect(toast).toHaveBeenCalledWith('Saved to Photos')
    expect(share).not.toHaveBeenCalled()
  })
  it('keeps the sheet open and points to Settings when Photos access was refused', async () => {
    save.mockResolvedValue('denied')
    const toast = vi.fn()
    expect(await saveImage(blob, 'a.png', 'openGym', toast)).toBe(false)
    expect(toast.mock.calls[0][0]).toMatch(/phone settings/)
  })
  it('falls back to the share sheet where the phone cannot save', async () => {
    save.mockResolvedValue('unsupported')
    expect(await saveImage(blob, 'a.png', 'openGym', vi.fn())).toBe(true)
    expect(share).toHaveBeenCalledWith(blob, 'a.png')
  })
  it('reports a failure without closing', async () => {
    save.mockRejectedValue(new Error('disk full'))
    const toast = vi.fn()
    expect(await saveImage(blob, 'a.png', 'openGym', toast)).toBe(false)
    expect(toast).toHaveBeenCalledWith('Could not save the picture.')
  })
})
