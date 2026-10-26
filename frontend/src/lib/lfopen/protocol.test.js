import { describe, expect, it } from 'vitest'
import {
  ChunkAssembler, checksum, encodeIncline, encodeLevel, encodeTargetHr, encodeWatts, matchesDevice,
  parseCrossTrainer, parseIndoorBike, parseTreadmill, payloadSize, protocolOf, splitChunks, UUID,
} from './protocol.js'

describe('checksum', () => {
  it('the bytes summed, mod 256', () => {
    expect(checksum([1, 2, 3])).toBe(6)
    expect(checksum([200, 100])).toBe(44)
    expect(checksum('')).toBe(0)
  })
})

describe('splitChunks', () => {
  it('frames with seq/total big-endian and the payload’s checksum', () => {
    const frames = splitChunks('abcdefg', 3)
    expect(frames).toHaveLength(3)
    expect([...frames[0].subarray(0, 5)]).toEqual([0, 0, 0, 3, checksum('abc')])
    expect([...frames[2].subarray(0, 5)]).toEqual([0, 2, 0, 3, checksum('g')])
    expect(new TextDecoder().decode(frames[1].subarray(5))).toBe('def')
  })
  it('empty data is one empty frame (an empty preset list still goes out)', () => {
    expect(splitChunks('', 20)).toHaveLength(1)
  })
  it('payload size: MTU minus 100, or 20 without one', () => {
    expect(payloadSize(517)).toBe(417)
    expect(payloadSize(null)).toBe(20)
  })
})

describe('ChunkAssembler', () => {
  const json = JSON.stringify({ id: 'g', et: 1800, c: 312, d: { v: 12.5, u: 1 } })

  it('puts frames back together, in any order', () => {
    const frames = splitChunks(json, 10)
    const a = new ChunkAssembler()
    const order = frames.map((f, i) => i).reverse()
    let out = null
    for (const i of order) out = a.push(frames[i])
    expect(out).toBe(json)
  })

  it('a first frame that is already JSON is the whole summary', () => {
    const [frame] = splitChunks(json, 1000)
    // claims 3 frames, but its payload parses: done
    frame[3] = 3
    expect(new ChunkAssembler().push(frame)).toBe(json)
  })

  it('a frame with a wrong checksum is dropped and waited for again', () => {
    const frames = splitChunks(json, 10)
    const a = new ChunkAssembler()
    const bad = Uint8Array.from(frames[1]); bad[4] ^= 0xff
    frames.forEach((f, i) => i !== 1 && a.push(f))
    expect(a.push(bad)).toBeNull()
    expect(a.dropped).toBe(1)
    expect(a.push(frames[1])).toBe(json)
  })

  it('a duplicate frame does not count twice; short frames are dropped', () => {
    const frames = splitChunks(json, 10)
    const a = new ChunkAssembler()
    a.push(frames[1]); a.push(frames[1])
    expect(a.got).toBe(1)
    expect(a.push([0, 0, 0])).toBeNull()
  })
})

// FTMS records built by hand from the spec's field order.
const le16 = n => [n & 0xff, (n >> 8) & 0xff]
describe('FTMS parsers', () => {
  it('Indoor Bike Data: speed, cadence, distance, level, power, energy, heart rate, time', () => {
    // flags: speed present (bit0 clear), cadence (2), distance (4), level (5), power (6), energy (8), hr (9), elapsed (11)
    const flags = (1 << 2) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 8) | (1 << 9) | (1 << 11)
    const bytes = [...le16(flags), ...le16(2534), ...le16(170), 0x10, 0x27, 0x00, ...le16(8), ...le16(185), ...le16(120), ...le16(600), 10, 142, ...le16(905)]
    expect(parseIndoorBike(bytes)).toEqual({ speed: 25.34, cadence: 85, distance: 10000, level: 8, watts: 185, kcal: 120, kcalPerHour: 600, kcalPerMinute: 10, hr: 142, elapsed: 905 })
  })

  it('"more data" set: no instantaneous speed', () => {
    expect(parseIndoorBike([...le16(1 | (1 << 9)), 150])).toEqual({ hr: 150 })
  })

  it('Treadmill Data: speed, distance, incline, heart rate', () => {
    const flags = (1 << 2) | (1 << 3) | (1 << 8)
    const bytes = [...le16(flags), ...le16(1050), 0xe8, 0x03, 0x00, ...le16(35), ...le16(20), 131]
    expect(parseTreadmill(bytes)).toEqual({ speed: 10.5, distance: 1000, incline: 3.5, rampAngle: 2, hr: 131 })
  })

  it('a negative incline reads as one', () => {
    expect(parseTreadmill([...le16(1 | (1 << 3)), ...le16(-20 & 0xffff), 0, 0]).incline).toBe(-2)
  })

  it('Cross Trainer Data: 24-bit flags, level and power', () => {
    const flags = (1 << 7) | (1 << 8)
    expect(parseCrossTrainer([flags & 0xff, (flags >> 8) & 0xff, 0, ...le16(1000), ...le16(65), ...le16(160)])).toEqual({ speed: 10, level: 6.5, watts: 160 })
  })

  it('a truncated record gives what it has', () => {
    expect(parseIndoorBike([...le16(1 << 2), ...le16(500)])).toEqual({ speed: 5 })
    expect(parseIndoorBike([1])).toBeNull()
  })
})

describe('control encoders', () => {
  it('level one byte; incline ×10, watts and heart rate 16-bit little-endian', () => {
    expect([...encodeLevel(12)]).toEqual([12])
    expect([...encodeLevel(300)]).toEqual([255])
    expect([...encodeIncline(4.5)]).toEqual([45, 0])
    expect([...encodeIncline(-3)]).toEqual([0xe2, 0xff])
    expect([...encodeWatts(250)]).toEqual([250, 0])
    expect([...encodeWatts(300)]).toEqual([44, 1])
    expect([...encodeTargetHr(140)]).toEqual([140, 0])
  })
})

describe('discovery', () => {
  it('protocol version from the advertised services', () => {
    expect(protocolOf([UUID.FTMS_SERVICE])).toBe('v3')
    expect(protocolOf([UUID.FTMS_SERVICE, UUID.WAHOO_SERVICE.toUpperCase()])).toBe('v2')
    expect(protocolOf([])).toBe('v1')
  })
  it('a device matches a connect code by a or u in its name, case aside', () => {
    expect(matchesDevice('LFOPEN 7f3a 042', { a: '7F3A' })).toBe(true)
    expect(matchesDevice('LFOPEN 9C1E', { a: 'zzzz', u: '9c1e' })).toBe(true)
    expect(matchesDevice('Other', { a: '7F3A' })).toBe(false)
    expect(matchesDevice('', { a: '' })).toBe(false)
  })
})
