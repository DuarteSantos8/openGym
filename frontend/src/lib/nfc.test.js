import { afterEach, describe, expect, it, vi } from 'vitest'
import { nfcSupport, nfcReadSupport, readMachineTags, writeTag, writeErrorCode, _resetNfcForTests } from './nfc.js'

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

describe('reading a machine tag (Web NFC)', () => {
  const enc = s => new TextEncoder().encode(s)
  const fakeReader = () => {
    const r = { handlers: [], signal: null }
    globalThis.NDEFReader = function NDEFReader() {
      this.addEventListener = (n, f) => { if (n === 'reading') r.handlers.push(f) }
      this.scan = vi.fn(opts => { r.signal = opts?.signal; return Promise.resolve() })
      r.reader = this
    }
    r.fire = (serialNumber, records) => r.handlers.forEach(f => f({ serialNumber, message: { records } }))
    return r
  }
  const urlRec = v => ({ recordType: 'url', data: enc(v) })

  it('says hold on Web NFC', async () => {
    fakeReader()
    expect(await nfcReadSupport()).toEqual({ supported: true, enabled: true, mode: 'hold' })
  })

  it('hands over the uid and the url record', () => {
    const r = fakeReader()
    const onTag = vi.fn()
    readMachineTags(onTag)
    r.fire('04:a2:5b', [urlRec('https://a.b')])
    expect(onTag).toHaveBeenCalledWith({ uid: '04a25b', records: [{ type: 'uri', value: 'https://a.b' }] })
  })

  it('decodes text records and ignores other kinds', () => {
    const r = fakeReader()
    const onTag = vi.fn()
    readMachineTags(onTag)
    r.fire('04:a2:5b', [{ recordType: 'mime', data: enc('x') }, { recordType: 'text', encoding: 'utf-8', data: enc('hello') }])
    expect(onTag).toHaveBeenCalledWith({ uid: '04a25b', records: [{ type: 'text', value: 'hello' }] })
  })

  it('reads one tag once per hold', () => {
    const r = fakeReader()
    const onTag = vi.fn()
    readMachineTags(onTag)
    r.fire('04:a2:5b', [urlRec('https://a.b')])
    r.fire('04:a2:5b', [urlRec('https://a.b')])
    expect(onTag).toHaveBeenCalledTimes(1)
  })

  it('aborts the scan when stopped', () => {
    const r = fakeReader()
    const stop = readMachineTags(vi.fn())
    expect(r.signal.aborted).toBe(false)
    stop()
    expect(r.signal.aborted).toBe(true)
  })
})
