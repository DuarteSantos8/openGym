// yt-dlp: the video's metadata, and a small video-only download.
//
// The URL handed in is always canonicalYouTube()'s output, never the caller's text. Playlists
// are refused, live streams are refused, and the download is capped in resolution, size and
// length: this is an exercise caption at 480p at most, not an archive.

import fs from 'node:fs'
import path from 'node:path'
import { run } from './proc.js'

export const MAX_DURATION = Math.max(60, +process.env.VIDEO_IMPORT_MAX_MINUTES * 60 || 90 * 60)
const MAX_FILESIZE = process.env.VIDEO_IMPORT_MAX_MB ? `${+process.env.VIDEO_IMPORT_MAX_MB}M` : '600M'
const BASE = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--no-cache-dir']

export class VideoError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

/**
 * yt-dlp's info JSON for one video. YouTube now and then serves a page without the chapters it
 * has (more often under load): a long video that comes back with none is asked for once more.
 */
export async function metadata(url, opts = {}) {
  const info = await metadataOnce(url, opts)
  if (!info.chapters?.length && (+info.duration || 0) > 600) {
    const again = await metadataOnce(url, opts).catch(e => { if (e.cancelled) throw e; return null })
    if (again?.chapters?.length) return again
  }
  return info
}

async function metadataOnce(url, { signal } = {}) {
  let stdout
  try {
    ({ stdout } = await run('yt-dlp', [...BASE, '--skip-download', '--dump-single-json', url], { signal, timeoutMs: 120000, maxOut: 32 * 1024 * 1024 }))
  } catch (e) {
    if (e.cancelled) throw e
    const msg = String(e.stderr || e.message)
    if (/private video|members-only|sign in to confirm your age|age-restricted/i.test(msg)) throw new VideoError('unavailable', 'this video is private, age-restricted or members-only')
    if (/sign in to confirm you.?re not a bot|HTTP Error 429/i.test(msg)) throw new VideoError('blocked', 'YouTube refused this server (bot check or rate limit) — try again later')
    if (/video unavailable|not available|removed/i.test(msg)) throw new VideoError('unavailable', 'this video is not available')
    throw new VideoError('metadata', 'could not read the video: ' + msg.split('\n').filter(Boolean).pop()?.slice(0, 200))
  }
  const info = JSON.parse(stdout)
  if (info._type && info._type !== 'video') throw new VideoError('unsupported', 'only single videos can be imported')
  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') throw new VideoError('unsupported', 'live streams cannot be imported')
  if ((+info.duration || 0) > MAX_DURATION) throw new VideoError('too-long', `the video is longer than ${Math.round(MAX_DURATION / 60)} minutes`)
  return info
}

/** Download at most 480p, video only when YouTube offers it. Resolves the file path. */
export async function download(url, workDir, { signal, onProgress } = {}) {
  const tpl = path.join(workDir, 'video.%(ext)s')
  await run('yt-dlp', [
    ...BASE, '--newline', '--progress', '--no-part', '--no-mtime',
    // Video-only at ≤480p first; a combined stream at ≤480p if that is all there is.
    '-f', 'bv*[height<=480][vcodec!=none]/b[height<=480]/wv*/w',
    '--max-filesize', MAX_FILESIZE,
    '-o', tpl, url
  ], {
    signal, timeoutMs: 45 * 60000,
    onLine: l => {
      const m = /\[download\]\s+([\d.]+)%/.exec(l)
      if (m) onProgress?.(Math.min(1, +m[1] / 100))
    }
  })
  const file = fs.readdirSync(workDir).find(f => f.startsWith('video.'))
  if (!file) throw new VideoError('download', 'the download produced no file (too large?)')
  return path.join(workDir, file)
}
