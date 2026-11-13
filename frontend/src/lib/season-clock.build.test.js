// The seasonal QA date hook (lib/season-clock.js) must not exist in a production bundle: nobody
// may open the advent calendar early with ?season-date=. This builds the module the way
// `vite build` does and looks for the hook's traces in what comes out.
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./season-clock.js', import.meta.url))
const bundle = async clock => {
  // vitest runs with NODE_ENV=test, which vite reads as a dev build; `vite build` sets production.
  const was = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const out = await build({
    configFile: false, logLevel: 'silent', mode: 'production',
    define: { __SEASON_CLOCK__: JSON.stringify(clock) },
    build: { write: false, minify: true, lib: { entry, formats: ['es'], fileName: 'clock' } },
  }).finally(() => { process.env.NODE_ENV = was })
  return [].concat(out).flatMap(o => o.output).map(c => c.code || '').join('\n')
}

describe('the season clock in a production build', () => {
  it('has no date hook: no query parameter, no storage key', async () => {
    const code = await bundle(false)
    expect(code).toContain('seasonNow')
    for (const trace of ['season-date', 'og_season_clock', 'localStorage', 'URLSearchParams']) expect(code, trace).not.toContain(trace)
  }, 30000)

  it('keeps it only in a build made for screenshots (VITE_SEASON_CLOCK=1)', async () => {
    expect(await bundle(true)).toContain('og_season_clock')
  }, 30000)
})
