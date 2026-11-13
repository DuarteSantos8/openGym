// #962: the App Store app showed every animation as a still. A release folder of WebP animations
// staged without VITE_CLIP_EXT=webp copied no clip at all, and the IPA check counted the stills
// (WebP too) as animations, so the build went out. Both stop now.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../../../scripts/catalogue/stage-media.mjs', import.meta.url))

describe('staging the app\'s animations (#962)', () => {
  it('a WebP release folder asked for MP4 stops before copying anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'og-stage-'))
    try {
      writeFileSync(join(dir, '0001.webp'), 'x')
      const env = { ...process.env, APP_MEDIA_DIR: dir }
      delete env.VITE_CLIP_EXT
      const run = spawnSync(process.execPath, [script, join(dir, 'out')], { env, encoding: 'utf8' })
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/VITE_CLIP_EXT=webp/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('the IPA check counts animations, not stills', () => {
    const sh = readFileSync(new URL('../../../scripts/ios/finish-ipa.sh', import.meta.url), 'utf8')
    expect(sh).toMatch(/find "\$PUBLIC\/exercise-media\/clip" -name '\*\.webp'/)
    expect(sh).not.toMatch(/find "\$PUBLIC\/exercise-media" -name/)
  })
})
