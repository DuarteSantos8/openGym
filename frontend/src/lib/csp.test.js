// The web image's Content-Security-Policy runs the one inline script in index.html by its hash.
// Change that script and the hash in web/Dockerfile has to change with it, or the app loads
// without its first-paint language and direction. Read off the files themselves.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = p => readFileSync(join(root, p), 'utf8')
const policy = read('web/Dockerfile').match(/^ENV CONTENT_SECURITY_POLICY="([^"]*)"$/m)?.[1] || ''
const directive = name => policy.split(';').map(d => d.trim().split(/\s+/)).find(d => d[0] === name)?.slice(1) || []

describe('web Content-Security-Policy', () => {
  it('allows every inline script in index.html by its hash, and nothing inline beyond that', () => {
    const html = read('frontend/index.html')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
    expect(inline.length).toBeGreaterThan(0)
    const scripts = directive('script-src')
    for (const body of inline) expect(scripts).toContain(`'sha256-${createHash('sha256').update(body).digest('base64')}'`)
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
  })
  it('keeps what the app needs: blob: media, its own frames refused, no plugins', () => {
    expect(directive('img-src')).toContain('blob:')
    expect(directive('media-src')).toContain('blob:')
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('object-src')).toEqual(["'none'"])
  })
  it('is sent from every block of the template that sets headers of its own', () => {
    const conf = read('web/nginx.conf.template')
    const sets = conf.split('\n').filter(l => /^\s*add_header X-Frame-Options/.test(l)).length
    const csp = conf.split('\n').filter(l => /^\s*add_header Content-Security-Policy "\$\{CONTENT_SECURITY_POLICY\}" always;/.test(l)).length
    expect(csp).toBe(sets)
  })
})
