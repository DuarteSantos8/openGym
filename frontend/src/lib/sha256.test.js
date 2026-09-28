import { describe, it, expect } from 'vitest'
import { sha256Hex, sha256HexJs, createSha256 } from './sha256.js'

const enc = s => new TextEncoder().encode(s)
// FIPS 180-2 / NIST vectors.
const VECTORS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1']
]

describe('sha256', () => {
  it('the fallback matches the published vectors', () => {
    for (const [msg, hex] of VECTORS) expect(sha256HexJs(enc(msg))).toBe(hex)
  })

  it('the fallback matches a million a’s fed in odd pieces', () => {
    const h = createSha256()
    const piece = enc('a'.repeat(997))
    let left = 1000000
    while (left > 0) { const n = Math.min(left, piece.length); h.update(piece.subarray(0, n)); left -= n }
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })

  it('the fallback and subtle agree on every length around a block boundary, for bytes and Blobs', async () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 128, 5000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff)
      const native = await sha256Hex(b)
      expect(await sha256Hex(b, { subtle: null })).toBe(native)
      expect(await sha256Hex(new Blob([b]), { subtle: null })).toBe(native)
      expect(await sha256Hex(new Blob([b]))).toBe(native)
    }
  })

  it('falls back when subtle is there but refuses (an insecure context)', async () => {
    const subtle = { digest: () => Promise.reject(new Error('insecure')) }
    expect(await sha256Hex(enc('abc'), { subtle })).toBe(VECTORS[1][1])
  })
})
