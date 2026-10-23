import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMobile, mobileBuildOptions } from './build-mobile.mjs'

describe('Android slim build isolation', () => {
  it('keeps full default and requires an explicit slim source', () => {
    expect(mobileBuildOptions([], {})).toEqual({ mode: 'full', outDir: 'dist', platform: null })
    expect(() => mobileBuildOptions(['--android-slim'], {})).toThrow('HTTPS')
    expect(() => mobileBuildOptions([], { APP_MEDIA_MODE: 'slim' })).toThrow('build:android:slim')
    expect(mobileBuildOptions(['--android-slim'], { APP_MEDIA_BASE_URL: 'https://media.example/' })).toEqual({ mode: 'slim', outDir: 'dist-android-slim', platform: 'android' })
  })
  it('selects the slim webDir only for cap sync android and restores config on failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-build-'))
    const config = path.join(root, 'capacitor.config.json'), original = '{"webDir":"dist","appId":"same"}\n'
    fs.writeFileSync(config, original); fs.writeFileSync(path.join(root, 'capacitor.slim.config.json'), '{"webDir":"dist-android-slim","appId":"same"}')
    const commands = [], stages = []
    try {
      expect(() => buildMobile({ root, args: ['--android-slim'], env: { APP_MEDIA_BASE_URL: 'https://media.example/' },
        stage: o => stages.push(o), checkSource: () => [], check: () => [], run: (script, args, env) => {
          commands.push({ script, args, env })
          if (args[0] === 'sync') {
            expect(args).toEqual(['sync', 'android'])
            expect(JSON.parse(fs.readFileSync(config)).webDir).toBe('dist-android-slim')
            throw new Error('fixture sync failed')
          }
        } })).toThrow('fixture sync failed')
      expect(fs.readFileSync(config, 'utf8')).toBe(original)
      expect(fs.existsSync(path.join(root, '.mobile-build.lock'))).toBe(false)
      expect(commands[0].args).toEqual(['build', '--outDir', 'dist-android-slim'])
      expect(commands[0].env).toMatchObject({ VITE_MOBILE: '1', APP_MEDIA_MODE: 'slim' })
      expect(stages[0].out).toBe(path.join(root, 'dist-android-slim'))
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
