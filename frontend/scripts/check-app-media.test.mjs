/* check-app-media.mjs: the guard behind #962, where the App Store build had every still and not a
 * single animation, and the file count passed. Fixtures: a three-exercise catalogue, a bundle
 * chunk with the env object Vite leaves in lib/exercises.js, and empty files by name (plus a
 * synthetic 30-byte WebP header, never a real picture). */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleMediaConfig, checkAppMedia, wantedMedia, webpWidth } from './check-app-media.mjs'
import { EXDB } from '../src/lib/exercises-data.js'

const DB = [
  { id: '0001', img: '0001.webp', gif: '0001.mp4', fv: '9001' },
  { id: '0002', img: '0002.webp', gif: '0002.mp4' },
  { id: '9002', img: '9002.webp', gif: '9002.mp4', mv: '0003' },
]
const chunk = env => `F={BASE_URL:\`./\`,DEV:!1,${env}VITE_MOBILE:\`1\`},Le=F.VITE_GIF_BASE||\`exercise-media/clip/\`,I=F.VITE_CLIP_EXT===\`webp\`?\`.webp\`:\`.mp4\``
// RIFF....WEBPVP8X + 10 bytes: flags, reserved, then the canvas width and height minus one.
const header = px => {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1')
  b.writeUInt32LE(10, 16); b[20] = 0b10
  b.writeUIntLE(px - 1, 24, 3); b.writeUIntLE(px - 1, 27, 3)
  return b
}
const STILLS = ['0001', '9001', '0002', '9002', '0003'].map(n => `exercise-media/still/${n}.webp`)
const clipsOf = ext => ['0001', '9001', '0002', '9002', '0003'].map(n => `exercise-media/clip/${n}${ext}`)

function run(files, { env = 'VITE_CLIP_EXT:`webp`,', px = 180 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-media-'))
  try {
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets/exercises-abc.js'), chunk(env))
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true })
      writeFileSync(join(dir, f), f.endsWith('.webp') && f.includes('/clip/') ? header(px) : '')
    }
    return checkAppMedia(dir, DB).map(p => p.replace(dir + '/', ''))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('check-app-media', () => {
  it('reads the clip extension and built-in size the bundle was built with', () => {
    expect(bundleMediaConfig(chunk('VITE_CLIP_EXT:`webp`,VITE_BUILTIN_CLIP_PX:`360`,'))).toMatchObject({ ext: '.webp', builtinPx: 360, clipBase: null })
    expect(bundleMediaConfig(chunk(''))).toMatchObject({ ext: '.mp4', builtinPx: 180 })
    expect(bundleMediaConfig('a={VITE_GIF_BASE:"https://cdn.example/clip/"}').clipBase).toBe('https://cdn.example/clip/')
  })

  it('wants both figures of an exercise drawn twice, in the bundle\'s extension', () => {
    const { clips, stills } = wantedMedia(DB, '.webp')
    expect([...clips].sort()).toEqual(['0001.webp', '0002.webp', '0003.webp', '9001.webp', '9002.webp'])
    expect(stills.has('9001.webp') && stills.has('0003.webp')).toBe(true)
  })

  it('passes the App Store build: WebP clips for a WebP bundle, all there, at the size it says', () => {
    expect(run([...STILLS, ...clipsOf('.webp')])).toEqual([])
    expect(run([...STILLS, ...clipsOf('.webp')], { env: 'VITE_CLIP_EXT:`webp`,VITE_BUILTIN_CLIP_PX:`360`,', px: 360 })).toEqual([])
  })

  it('passes the plain mobile build: the repository MP4s for an MP4 bundle', () => {
    expect(run([...STILLS, ...clipsOf('.mp4')], { env: '' })).toEqual([])
  })

  it('fails 1.4.3: stills only, no animation staged (#962)', () => {
    const problems = run(STILLS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^exercise-media\/clip\/: missing/)
  })

  it('fails a bundle asking for MP4 next to WebP clips, and says which switch is missing', () => {
    const [p] = run([...STILLS, ...clipsOf('.webp')], { env: '' })
    expect(p).toMatch(/5 of 5 animations .* missing \(the bundle asks for \.mp4; a release folder of WebP needs VITE_CLIP_EXT=webp\)/)
  })

  it('names the drawings that are missing, a female twin included', () => {
    const files = [...STILLS, ...clipsOf('.webp')].filter(f => f !== 'exercise-media/clip/9001.webp')
    expect(run(files)).toEqual(['exercise-media/clip/: 1 of 5 animations the app asks for are missing: 9001.webp'])
  })

  it('fails when the built-in size the bundle claims is not the size it carries', () => {
    const [p] = run([...STILLS, ...clipsOf('.webp')], { env: 'VITE_CLIP_EXT:`webp`,VITE_BUILTIN_CLIP_PX:`360`,', px: 180 })
    expect(p).toMatch(/180 px but the bundle says 360 px/)
  })

  it('leaves a build that loads its media from elsewhere alone', () => {
    expect(run([], { env: 'VITE_GIF_BASE:`https://cdn.example/clip/`,VITE_IMG_BASE:`https://cdn.example/still/`,' })).toEqual([])
  })

  it('reads a WebP canvas width, and nothing from what is not one', () => {
    expect(webpWidth(header(720))).toBe(720)
    expect(webpWidth(Buffer.from('not a webp at all, honestly, no'))).toBe(null)
  })

  it('agrees with lib/exercises.js on the file names of the real catalogue', async () => {
    const { gifSrc, imgSrc } = await import('../src/lib/exercises.js')
    const { clips, stills } = wantedMedia(EXDB, '.mp4')
    const fromApp = new Set(), stillsApp = new Set()
    for (const ex of EXDB) for (const fig of ['male', 'female']) {
      if (ex.gif) fromApp.add(gifSrc(ex, fig).replace('exercise-media/clip/', ''))
      if (ex.img) stillsApp.add(imgSrc(ex, fig).replace('exercise-media/still/', ''))
    }
    expect([...clips].sort()).toEqual([...fromApp].sort())
    expect([...stills].sort()).toEqual([...stillsApp].sort())
  })
})
