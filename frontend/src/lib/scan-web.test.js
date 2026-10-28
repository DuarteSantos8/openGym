import { describe, it, expect } from 'vitest'
import { generate } from 'lean-qr'
import { decodeImageData, steadyBackCamera } from './scan-web.js'

// Round trip through the two libraries the browser path relies on: lean-qr draws a code (the
// same renderer the card view uses), jsQR reads it back. Pixels are built by hand from
// code.get(x, y) — no canvas in this environment — scaled 4× with a 4-module quiet zone, which
// is what a phone camera would roughly see.
function rasterize(code, scale = 4, quiet = 4) {
  const n = code.size + quiet * 2
  const w = n * scale
  const data = new Uint8ClampedArray(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my)
      const v = dark ? 0 : 255
      const i = (y * w + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return { data, width: w, height: w }
}

describe('decodeImageData', () => {
  it('reads back a code lean-qr generated', async () => {
    const value = 'MEMBER-0042-FITZONE'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit).toEqual({ value, fmt: 'qrcode' })
  })

  it('reads a URL-shaped code, the other common gym format', async () => {
    const value = 'https://checkin.example.com/m/8f3a1c?v=2'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit?.value).toBe(value)
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeImageData(blank)).toBeNull()
    expect(await decodeImageData(null)).toBeNull()
    expect(await decodeImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})

describe('steadyBackCamera', () => {
  const cam = (deviceId, label) => ({ kind: 'videoinput', deviceId, label })
  const iphone = [
    cam('f', 'Front Camera'), cam('t', 'Back Triple Camera'), cam('dw', 'Back Dual Wide Camera'),
    cam('uw', 'Back Ultra Wide Camera'), cam('w', 'Back Camera'), cam('tele', 'Back Telephoto Camera'),
    { kind: 'audioinput', deviceId: 'mic', label: 'iPhone Microphone' },
  ]

  it('swaps a Pro iPhone’s lens-swapping camera for its plain wide one', () => {
    expect(steadyBackCamera(iphone, 'Back Triple Camera')).toBe('w')
    expect(steadyBackCamera(iphone, 'Back Dual Wide Camera')).toBe('w')
  })

  it('reads the names in the phone’s language', () => {
    const de = [cam('f', 'Frontkamera'), cam('t', 'Rückseitige Dreifach-Kamera'), cam('uw', 'Rückseitige Ultraweitwinkelkamera'), cam('w', 'Rückkamera')]
    expect(steadyBackCamera(de, 'Rückseitige Dreifach-Kamera')).toBe('w')
    const fr = [cam('t', 'Caméra arrière triple'), cam('w', 'Caméra arrière')]
    expect(steadyBackCamera(fr, 'Caméra arrière triple')).toBe('w')
  })

  it('keeps the camera there is when it already is the plain one', () => {
    expect(steadyBackCamera(iphone, 'Back Camera')).toBeNull()
  })

  it('keeps Android’s and a laptop’s camera', () => {
    const android = [cam('0', 'camera2 0, facing back'), cam('1', 'camera2 1, facing front'), cam('2', 'camera2 2, facing back')]
    expect(steadyBackCamera(android, 'camera2 0, facing back')).toBeNull()
    expect(steadyBackCamera([cam('x', 'FaceTime HD Camera')], 'FaceTime HD Camera')).toBeNull()
  })

  it('keeps it without names (no permission yet) or without devices', () => {
    expect(steadyBackCamera(iphone.map(d => ({ ...d, label: '' })), '')).toBeNull()
    expect(steadyBackCamera(undefined, 'Back Triple Camera')).toBeNull()
  })

  it('keeps it when the plain one is not unique', () => {
    expect(steadyBackCamera([cam('t', 'Back Triple Camera'), cam('a', 'Back Camera'), cam('b', 'Rear Camera')], 'Back Triple Camera')).toBeNull()
  })
})
