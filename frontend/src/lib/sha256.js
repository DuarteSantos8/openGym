/* SHA-256 as lowercase hex — the name every photo and video is stored and fetched under.
 *
 * crypto.subtle does it natively, but only in a secure context: an instance reached over plain
 * http on a LAN address (http://192.168.1.10:8080, a common self-hosted setup) has no
 * crypto.subtle at all. There the pure-JS fallback below runs instead, block by block over the
 * file in slices, so a 40 MB video is never copied into one more buffer than it has to be. Both
 * paths give the same answer; sha256.test.js checks the fallback against known vectors and
 * against subtle.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/** An incremental SHA-256: update(bytes) as often as needed, then hex(). */
export function createSha256() {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const W = new Uint32Array(64)
  const buf = new Uint8Array(64)
  let bufLen = 0
  let total = 0

  const block = (b, o) => {
    for (let i = 0; i < 16; i++) W[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3]
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2]
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let a = H[0], b1 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b1) ^ (a & c) ^ (b1 & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b1; b1 = a; a = (t1 + t2) | 0
    }
    H[0] += a; H[1] += b1; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h
  }

  return {
    update(bytes) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      total += b.length
      let i = 0
      if (bufLen) {
        const take = Math.min(64 - bufLen, b.length)
        buf.set(b.subarray(0, take), bufLen)
        bufLen += take
        i = take
        if (bufLen < 64) return this
        block(buf, 0)
        bufLen = 0
      }
      for (; i + 64 <= b.length; i += 64) block(b, i)
      if (i < b.length) { buf.set(b.subarray(i), 0); bufLen = b.length - i }
      return this
    },
    hex() {
      const bits = total * 8
      const pad = new Uint8Array(((bufLen < 56 ? 56 : 120) - bufLen) + 8)
      pad[0] = 0x80
      // The length in bits, big-endian, as two 32-bit halves (a file is far below 2^53 bits).
      const hi = Math.floor(bits / 4294967296), lo = bits >>> 0
      const n = pad.length
      pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi
      pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo
      this.update(pad)
      return Array.from(H, x => x.toString(16).padStart(8, '0')).join('')
    }
  }
}

const SLICE = 4 * 1024 * 1024

/** sha256 of bytes in pure JS. */
export function sha256HexJs(bytes) {
  return createSha256().update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).hex()
}

/**
 * Lowercase hex SHA-256 of a Uint8Array, an ArrayBuffer or a Blob. `subtle` is injectable for
 * the tests; null forces the fallback.
 */
export async function sha256Hex(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const isBlob = typeof Blob !== 'undefined' && input instanceof Blob
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const data = isBlob ? await input.arrayBuffer() : input
      const d = await subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('')
    } catch { /* an insecure context can expose subtle and still refuse: fall through */ }
  }
  const h = createSha256()
  if (isBlob) {
    for (let o = 0; o < input.size; o += SLICE) h.update(new Uint8Array(await input.slice(o, o + SLICE).arrayBuffer()))
  } else h.update(input instanceof Uint8Array ? input : new Uint8Array(input))
  return h.hex()
}
