import { afterEach, describe, expect, it, vi } from 'vitest'
import { nfcSupport, writeTag, writeErrorCode, _resetNfcForTests } from './nfc.js'

afterEach(() => { delete globalThis.NDEFReader; _resetNfcForTests() })

describe('writeErrorCode', () => {
  it('keeps the plugins’ own codes and reads Web NFC’s errors', () => {
    expect(writeErrorCode({ code: 'too-small' })).toBe('too-small')
    expect(writeErrorCode({ name: 'AbortError' })).toBe('cancelled')
    expect(writeErrorCode({ name: 'NotAllowedError' })).toBe('denied')
    expect(writeErrorCode({ name: 'NotSupportedError' })).toBe('unsupported')
    expect(writeErrorCode('NFC is disabled')).toBe('disabled')
    expect(writeErrorCode(new Error('tag lost'))).toBe('failed')
  })
})

describe('Web NFC (Chrome on Android)', () => {
  it('is off without NDEFReader, as in every other browser', async () => {
    expect(await nfcSupport()).toEqual({ supported: false, enabled: false })
  })

  it('writes the link as one url record', async () => {
    const write = vi.fn(() => Promise.resolve())
    globalThis.NDEFReader = function NDEFReader() { this.write = write }
    expect((await nfcSupport()).supported).toBe(true)
    await writeTag('https://opengym.ch/nfc?do=start')
    expect(write.mock.calls[0][0]).toEqual({ records: [{ recordType: 'url', data: 'https://opengym.ch/nfc?do=start' }] })
  })

  it('rejects with a code the sheet understands', async () => {
    globalThis.NDEFReader = function NDEFReader() { this.write = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) }
    await expect(writeTag('https://opengym.ch/nfc?do=start')).rejects.toMatchObject({ code: 'denied' })
  })
})
