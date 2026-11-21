import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

// The Apple Watch's buttons on watchOS 26 (ios/App/Watch). An interactive glass behind a button
// takes the touch for its own bounce, so a tap now and then never reached the button: the keypad's
// ✓ on an Ultra ignored presses. The glass stays still, it sits inside the button whose whole
// shape takes the tap, and the button styles show the press.
const dir = new URL('../../ios/App/Watch/', import.meta.url)
const files = readdirSync(dir).filter(f => f.endsWith('.swift'))
// The code alone, without its comments (which explain why there is no .interactive()). A `//`
// right after a colon is a URL in a string and stays.
const code = f => readFileSync(new URL(f, dir), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
// From `start` to the end of that declaration: the next line that closes at the left margin.
const block = (src, start) => {
  const from = src.indexOf(start)
  if (from < 0) return ''
  const end = src.indexOf('\n}', from)
  return src.slice(from, end < 0 ? src.length : end + 2)
}
const lineOf = (src, at) => src.slice(0, at).split('\n').length
const isPlain = style => /^\s*(\.plain|PlainButtonStyle\(\))\s*$/.test(style)

// Every Button { or Button( call (not a name such as addButton or RoundButton) with its label, the
// style it is given and the modifiers chained after that style. When another button starts before
// the style, the style is the other's, and that one is judged on its own.
const buttons = src => {
  const starts = [...src.matchAll(/(?<![\w.])Button\s*[({]/g)].map(m => m.index)
  return starts.flatMap((at, i) => {
    const style = src.indexOf('.buttonStyle(', at)
    if (style < 0 || (starts[i + 1] ?? Infinity) < style) return []
    const [whole, name] = src.slice(style).match(/^\.buttonStyle\(([^)]*\)?)\)/)
    // The modifiers chained after the style: the lines that go on starting with a dot.
    const rest = src.slice(style + whole.length).split('\n')
    const chain = [rest[0], ...rest.slice(1).filter((l, j, all) => all.slice(0, j + 1).every(x => /^\s*\./.test(x)))].join('\n')
    return [{ at, label: src.slice(at, style), name, chain }]
  })
}

describe('watch buttons take every tap and show it', () => {
  it('has no interactive glass anywhere in the watch app', () => {
    for (const f of files) {
      const src = code(f)
      expect(src, f).not.toMatch(/\.interactive\(/)
      expect(src, f).not.toMatch(/\.buttonStyle\(\s*\.glass/)
    }
    expect(code('Theme.swift')).toMatch(/glassEffect\(/)
  })

  it('keeps every glass inside its button, on a style that shows the press', () => {
    let glassy = 0
    for (const f of files) {
      const src = code(f)
      for (const b of buttons(src)) {
        const where = `${f}:${lineOf(src, b.at)}`
        // A glass chained after the style is outside the button: it neither takes the tap nor dims.
        expect(b.chain, where).not.toMatch(/\.glass\(/)
        if (!/\.glass\(/.test(b.label)) continue
        glassy++
        expect(isPlain(b.name), `${where} is on ${b.name}`).toBe(false)
      }
    }
    // The scan found the buttons it is about (the keypad's keys, ‹ ›, ✓, ✕, the chips...).
    expect(glassy).toBeGreaterThan(8)
  })

  it('reads the cases it is there for', () => {
    const found = src => buttons(src).map(b => [isPlain(b.name), /\.glass\(/.test(b.label), /\.glass\(/.test(b.chain)])
    expect(found('func addButton() -> some View {\n  Button { go() } label: { Color.clear.glass(Circle(), fill: c, dimmed: d) }\n  .buttonStyle( .plain )\n}')).toEqual([[true, true, false]])
    expect(found('Button(action: go) { Image("x") }\n.buttonStyle(PlainButtonStyle())\n.glass(Circle(), fill: c, dimmed: d)')).toEqual([[true, false, true]])
    expect(found('Button { a() } label: { Text("a") }\n.buttonStyle(PressStyle())\nText("b").glass(Capsule(), fill: c, dimmed: d)')).toEqual([[false, false, false]])
    expect(isPlain('PressStyle()')).toBe(false)
  })

  it('shows the press in every style, the keypad\'s ✓ and ✕ taking their whole shape', () => {
    const theme = code('Theme.swift')
    expect(block(theme, 'struct PressStyle: ButtonStyle')).toMatch(/configuration\.isPressed/)
    // With Reduce Motion the scale is off and the glass ignores `fill`: the opacity shows the press.
    expect(block(theme, 'struct PrimaryButtonStyle: ButtonStyle')).toMatch(/opacity\([^\n]*configuration\.isPressed/)
    expect(block(theme, 'struct RowButtonStyle: ButtonStyle')).toMatch(/opacity\([^\n]*configuration\.isPressed/)
    expect(block(code('RestHold.swift'), 'struct OutlineCapsule: ButtonStyle')).toMatch(/opacity\([^\n]*configuration\.isPressed/)
    const keypad = block(code('SetPage.swift'), 'struct KeypadView')
    const save = keypad.slice(keypad.indexOf('Image(systemName: "checkmark")'), keypad.indexOf('.accessibilityLabel(Text("Save"))'))
    expect(save).toMatch(/\.contentShape\(Capsule\(\)\)/)
    expect(save).toMatch(/\.buttonStyle\(PressStyle\(\)\)/)
    const close = keypad.slice(keypad.indexOf('Image(systemName: "xmark")'), keypad.indexOf('.accessibilityLabel(Text("Cancel"))'))
    expect(close).toMatch(/\.glass\([\s\S]*\.contentShape\(Circle\(\)\)[\s\S]*\}\s*\.buttonStyle\(PressStyle\(\)\)/)
    expect(keypad.slice(keypad.indexOf('private func keyButton'))).toMatch(/\.glass\([\s\S]*?\}\s*\.buttonStyle\(PressStyle\(\)\)/)
  })
})
