import { describe, expect, it } from 'vitest'
import { cameraConstraints, portraitScreen } from './camera-capture.js'

/* #1315: the progress-photo camera asked for a 1920 x 1920 frame and got a square. */
describe('cameraConstraints', () => {
  it('asks for a 16:9 frame the way the phone is held, never a square', () => {
    const up = cameraConstraints('user', { portrait: true }).video
    expect([up.width.ideal, up.height.ideal]).toEqual([1080, 1920])
    const side = cameraConstraints('environment', { portrait: false }).video
    expect([side.width.ideal, side.height.ideal]).toEqual([1920, 1080])
    for (const v of [up, side]) expect(v.width.ideal).not.toBe(v.height.ideal)
  })
  it('only as an ideal, so a camera without that mode still opens', () => {
    const c = cameraConstraints('user', { portrait: true })
    expect(c.audio).toBe(false)
    expect(Object.keys(c.video.width)).toEqual(['ideal'])
    expect(c.video.facingMode).toEqual({ ideal: 'user' })
    expect(cameraConstraints('environment').video.facingMode).toEqual({ ideal: 'environment' })
  })
  it('reads the screen: taller than wide is upright, unknown counts as upright', () => {
    expect(portraitScreen({ innerWidth: 390, innerHeight: 844 })).toBe(true)
    expect(portraitScreen({ innerWidth: 1280, innerHeight: 720 })).toBe(false)
    expect(portraitScreen({})).toBe(true)
  })
})
