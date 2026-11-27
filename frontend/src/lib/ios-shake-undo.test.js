// #921: the iPhone app showed iOS's own "Undo" alert after the phone was carried around and
// unlocked. That alert is UIKit's shake to undo, on by default for every app with a text field:
// the page has many. The app turns it off at launch; nothing in openGym undoes by shaking.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('shake to undo on the iPhone (#921)', () => {
  const swift = readFileSync(new URL('../../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8')
  it('is off from launch', () => {
    const launch = swift.slice(swift.indexOf('didFinishLaunchingWithOptions'), swift.indexOf('return true'))
    expect(launch).toMatch(/application\.applicationSupportsShakeToEdit = false/)
  })
  // One exception: lib/shake.js, the Christmas snow globe (only while that theme shows, with its
  // switch on). It draws snow and nothing else; it never undoes anything.
  it('and the page never listens for a shake, but for the snow globe, which undoes nothing', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = fileURLToPath(new URL('..', import.meta.url))
    const hits = []
    const walk = dir => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (!/locales|exercise-names|exercise-desc|instr/.test(name)) walk(p); continue }
        if (!/\.(js|jsx)$/.test(name) || /\.test\./.test(name)) continue
        if (/devicemotion|DeviceMotionEvent/.test(readFileSync(p, 'utf8')) && !p.endsWith(join('lib', 'shake.js'))) hits.push(p)
      }
    }
    walk(root)
    expect(hits).toEqual([])
    expect(readFileSync(join(root, 'lib', 'shake.js'), 'utf8')).not.toMatch(/undo/i)
  })
})
