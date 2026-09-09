import { describe, it, expect } from 'vitest'
import { scanCode, importCodeFromImage } from './scan.js'

// In the test environment VITE_MOBILE is unset, so MOBILE is false — the same as a web build.
// The native ML Kit scanner must refuse to run there rather than reach for a plugin that isn't
// present; the view opens the browser camera sheet instead. (On-device decoding is exercised by
// hand; the browser decoder has its own round-trip test in scan-web.test.js.)

describe('scan off mobile', () => {
  it('scanCode rejects — the native scanner is app-only', async () => {
    await expect(scanCode()).rejects.toThrow(/only available in the app/)
  })

  it('importCodeFromImage takes the browser path and is a no-op without a file', async () => {
    expect(await importCodeFromImage(null)).toBeNull()
  })
})
