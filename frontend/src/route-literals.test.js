// Every path from before the tabs lives in lib/tab-route.js and nowhere else. An old path that
// comes back in (an upstream merge, a copy from an older file) would still be redirected when it
// is navigated to, so nobody notices; but compared against — `pathname === '/workout'` — it is
// simply never true any more. This finds them in the source before anyone has to.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(process.cwd(), 'src')
const ROUTE_MODULE = 'lib/tab-route.js'
const OLD = ['plan', 'workout', 'stats', 'history', 'library', 'muscles', 'structural-balance', 'progress-photos', 'measurements', 'settings', 'coach', 'admin', 'checkin', 'body']
// A string starting with an old path ('/plan', '#/workout?x', `/settings/${p}`), not one that only
// contains it further in ('/api/coach', '/train/history').
const LITERAL = new RegExp(`['"\`]#?/(${OLD.join('|')})(?=[/'"\`?$]|$)`, 'g')

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [path] : []
  })
}

describe('route literals', () => {
  it('no source file outside the route module spells a path from before the tabs', () => {
    const hits = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file)
      if (rel === ROUTE_MODULE) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Comments may name an old route; only code is held to it.
        const code = line.replace(/\/\/.*$/, '')
        for (const m of code.matchAll(LITERAL)) hits.push(`${rel}:${i + 1} ${m[0]}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('would catch one', () => {
    expect("if (pathname === '/workout') go()".match(LITERAL)).toEqual(["'/workout"])
    expect("nav(`/settings/${id}`)".match(LITERAL)).toEqual(['`/settings'])
    expect("nav('/train/history'); api('/api/coach')".match(LITERAL)).toBeNull()
  })
})
