import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripMediapipeTelemetry, noMediapipeTelemetry } from './vite-no-mediapipe-telemetry.mjs'

const vendor = fileURLToPath(new URL('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', import.meta.url))

describe('no MediaPipe telemetry (EP10)', () => {
  it('the pinned vendor bundle contains the usage-logging call exactly once, and the patch removes the host', () => {
    const code = readFileSync(vendor, 'utf8')
    expect(code.split('odml.pa.googleapis.com').length - 1).toBe(1)
    const out = stripMediapipeTelemetry(code)
    expect(out).not.toContain('odml.pa.googleapis.com')
    expect(out.length).toBeLessThan(code.length)
  })

  it('fails loudly when the code it expects is gone (an upgrade must be re-checked)', () => {
    expect(() => stripMediapipeTelemetry('export const x = 1')).toThrow(/expected the usage-logging call once, found 0/)
  })

  it('only touches the MediaPipe bundle', () => {
    const p = noMediapipeTelemetry()
    expect(p.transform('this.o.send({url:"https://odml.pa.googleapis.com/v1/log"', '/app/src/lib/pose-session.js')).toBeNull()
    expect(p.transform(readFileSync(vendor, 'utf8'), vendor + '?v=abc').code).not.toContain('odml.pa.googleapis.com')
  })
})
