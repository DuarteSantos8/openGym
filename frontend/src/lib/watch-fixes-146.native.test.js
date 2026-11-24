// 1.4.6 watch round: fixes in native code (Kotlin, Java, Swift) that cannot be compiled or run
// here. Their source is read for the rule each fix puts in place, so a later edit that drops one
// fails here instead of on a wrist.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
// The code alone, comments dropped (they often name what the code no longer does).
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:"])\/\/.*$/, '$1')).join('\n')
const between = (src, a, b) => {
  const from = src.indexOf(a)
  if (from < 0) return ''
  const to = src.indexOf(b, from + a.length)
  return src.slice(from, to < 0 ? src.length : to)
}

const ANDROID = '../../android/app/src/main/java/ch/duartesantos/opengym/'

describe('Android rest countdown (RestTimerService.java, #1453 / #1454)', () => {
  const src = code(ANDROID + 'RestTimerService.java')
  const start = between(src, 'public int onStartCommand', '\n    @Override')
  it('posts its card before stopping when the rest is already over', () => {
    const past = between(start, 'if (nextEnd <= System.currentTimeMillis())', 'return START_NOT_STICKY')
    expect(past).toMatch(/show\(\);\s*stopForegroundCompat\(\);/)
  })
  it('posts its card on every start, screen on or off, before the first tick', () => {
    const tail = start.slice(start.indexOf('handler.removeCallbacks(tick);'))
    expect(tail).toMatch(/show\(\);\s*tick\.run\(\);/)
    expect(tail).not.toMatch(/!interactive\(\)\) show\(\)/)
  })
})
