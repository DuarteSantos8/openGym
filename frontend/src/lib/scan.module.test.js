// lib/scan.js on a phone whose Google scanner module never arrives (QA66, Android emulator without
// the Play Store): the module calls hang, so the tap did nothing and the check-in's Scan button
// stayed disabled. Now they have a deadline and scanCode() says MODULE_MISSING for the camera sheet.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const bs = vi.hoisted(() => ({ available: true, hang: false, installs: 0, scans: 0 }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('./channel.js', () => ({ nativeScanner: async () => true }))
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({ BarcodeScanner: {
  isSupported: async () => ({ supported: true }),
  checkPermissions: async () => ({ camera: 'granted' }),
  requestPermissions: async () => ({ camera: 'granted' }),
  isGoogleBarcodeScannerModuleAvailable: () => bs.hang ? new Promise(() => {}) : Promise.resolve({ available: bs.available }),
  installGoogleBarcodeScannerModule: () => { bs.installs++; return new Promise(() => {}) },
  scan: async () => { bs.scans++; return { barcodes: [{ rawValue: 'https://opengym.ch/r#x', format: 'QR_CODE' }] } },
} }))

import { scanCode, MODULE_MISSING } from './scan.js'

beforeEach(() => { bs.available = true; bs.hang = false; bs.installs = 0; bs.scans = 0 })

describe('scanCode and the Google scanner module', () => {
  it('scans right away when the module is there', async () => {
    const code = await scanCode({ moduleWaitMs: 50 })
    expect(code.value).toBe('https://opengym.ch/r#x')
    expect(bs.installs).toBe(0)
  })
  it('a download that never finishes ends in MODULE_MISSING, not a promise that never settles', async () => {
    bs.available = false
    await expect(scanCode({ moduleWaitMs: 50 })).rejects.toThrow(MODULE_MISSING)
    expect(bs.installs).toBe(1)
    expect(bs.scans).toBe(0)
  })
  it('a check that never answers counts as there: scan() decides', async () => {
    bs.hang = true
    expect((await scanCode({ moduleWaitMs: 50 })).value).toBe('https://opengym.ch/r#x')
  })
})
