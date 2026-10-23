#!/usr/bin/env node
// Cross-platform mobile build; slim syncs Android only. The CLI only reads the default config,
// so its temporary selection is serialized and restored even when build/sync fails.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { stageMedia } from '../../scripts/catalogue/stage-media.mjs'
import { checkCopy, checkMobileBundle } from './check-mobile-bundle.mjs'
import { validateMediaBaseUrl } from '../src/lib/catalogue-media-manifest.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function mobileBuildOptions(args, env = process.env) {
  const slim = args.includes('--android-slim'), mode = slim ? 'slim' : (env.APP_MEDIA_MODE || 'full')
  if (!['full', 'slim'].includes(mode)) throw new Error('APP_MEDIA_MODE must be full or slim')
  if (!slim && mode === 'slim') throw new Error('use build:android:slim for Android-only slim output')
  validateMediaBaseUrl(env.APP_MEDIA_BASE_URL, { required: slim })
  return { mode, outDir: slim ? 'dist-android-slim' : 'dist', platform: slim ? 'android' : null }
}

export function buildMobile({ args = process.argv.slice(2), env = process.env, root = ROOT, stage = stageMedia, check = checkMobileBundle, checkSource = checkCopy, run = (script, argv, childEnv) => {
  const result = spawnSync(process.execPath, [script, ...argv], { cwd: root, env: childEnv, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(`mobile build step failed (${result.status ?? 'spawn'})`)
} } = {}) {
  const { mode, outDir, platform } = mobileBuildOptions(args, env)
  const childEnv = { ...env, APP_MEDIA_MODE: mode, VITE_MOBILE: '1' }
  const configPath = path.join(root, 'capacitor.config.json'), original = fs.readFileSync(configPath)
  const lockPath = path.join(root, '.mobile-build.lock')
  let lock
  try { lock = fs.openSync(lockPath, 'wx') } catch { throw new Error('another mobile build is active; remove .mobile-build.lock only after confirming it stopped') }
  try {
    run(path.join(root, 'node_modules/vite/bin/vite.js'), ['build', '--outDir', outDir], childEnv)
    stage({ out: path.join(root, outDir), mode, baseUrl: env.APP_MEDIA_BASE_URL || null,
      ...(env.APP_MEDIA_DIR ? { clipDir: env.APP_MEDIA_DIR } : {}), clipFormat: env.VITE_CLIP_EXT === 'webp' ? 'webp' : 'mp4' })
    const sourceProblems = checkSource(path.join(root, outDir), { requireMedia: true })
    if (sourceProblems.length) throw new Error(sourceProblems.join('\n'))
    if (platform === 'android') fs.writeFileSync(configPath, fs.readFileSync(path.join(root, 'capacitor.slim.config.json')))
    run(path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), ['sync', ...(platform ? [platform] : [])], childEnv)
    const problems = check(root, { sourceDir: outDir, platform, requireMedia: true })
    if (problems.length) throw new Error(problems.join('\n'))
    console.log(`Mobile bundle OK (${mode}${platform ? ', ' + platform : ''}).`)
  } finally {
    fs.writeFileSync(configPath, original)
    fs.closeSync(lock); fs.unlinkSync(lockPath)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { buildMobile() }
  catch (err) {
    let message = err.message
    if (process.env.APP_MEDIA_DIR) message = message.split(process.env.APP_MEDIA_DIR).join('[private media input]')
    console.error(message); process.exitCode = 1
  }
}
