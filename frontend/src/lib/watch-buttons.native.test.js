import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

// The Apple Watch's buttons on watchOS 26 (ios/App/Watch). An interactive glass behind a button
// takes the touch for its own bounce, so a tap now and then never reached the button: the keypad's
// ✓ on an Ultra ignored presses. The glass stays still and the button styles show the press.
const dir = new URL('../../ios/App/Watch/', import.meta.url)
const files = readdirSync(dir).filter(f => f.endsWith('.swift'))
// The code alone, without its // comments (which explain why there is no .interactive()).
const code = f => readFileSync(new URL(f, dir), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
// From `start` to the end of that declaration: the next line that closes at the left margin.
const block = (src, start) => { const from = src.indexOf(start); return from < 0 ? '' : src.slice(from, src.indexOf('\n}', from) + 2) }

describe('watch buttons take every tap and show it', () => {
  it('has no interactive glass anywhere in the watch app', () => {
    for (const f of files) {
      const src = code(f)
      expect(src, f).not.toMatch(/\.interactive\(/)
      expect(src, f).not.toMatch(/\.buttonStyle\(\s*\.glass/)
    }
    expect(code('Theme.swift')).toMatch(/glassEffect\(/)
  })

  it('leaves no button with a glass on the bare .plain style, which shows no press', () => {
    for (const f of files) {
      // Each Button( … ) up to its .buttonStyle: a glass inside it must not be on .plain.
      for (const m of code(f).matchAll(/Button[\s\S]*?\.buttonStyle\(([^)]*\)?)\)/g)) {
        if (/\.glass\(/.test(m[0]) && !/Button[\s\S]*Button/.test(m[0])) expect(m[1], f).not.toBe('.plain')
      }
    }
  })

  it('shows the press in every style, the keypad\'s ✓ taking its whole capsule', () => {
    const theme = code('Theme.swift')
    expect(block(theme, 'struct PressStyle: ButtonStyle')).toMatch(/configuration\.isPressed/)
    expect(block(theme, 'struct RowButtonStyle: ButtonStyle')).toMatch(/opacity\([^\n]*configuration\.isPressed/)
    expect(block(code('RestHold.swift'), 'struct OutlineCapsule: ButtonStyle')).toMatch(/opacity\([^\n]*configuration\.isPressed/)
    const keypad = block(code('SetPage.swift'), 'struct KeypadView')
    const save = keypad.slice(keypad.indexOf('Image(systemName: "checkmark")'), keypad.indexOf('.accessibilityLabel(Text("Save"))'))
    expect(save).toMatch(/\.contentShape\(Capsule\(\)\)/)
    expect(save).toMatch(/\.buttonStyle\(PressStyle\(\)\)/)
    expect(keypad.slice(keypad.indexOf('private func keyButton'))).toMatch(/\.glass\([\s\S]*?\}\s*\.buttonStyle\(PressStyle\(\)\)/)
  })
})
