// Running yt-dlp, ffmpeg, ffprobe and tesseract. Arguments are always an array — never a shell
// string — and every run has a deadline and an abort signal, so a stuck download or a cancelled
// job never leaves a process behind.

import { spawn } from 'node:child_process'

export class ProcError extends Error {
  constructor(cmd, code, stderr) {
    super(`${cmd} failed (${code}): ${String(stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`)
    this.cmd = cmd; this.code = code; this.stderr = stderr
  }
}

/**
 * Run `cmd args`, resolve { stdout, stderr } (stdout as a Buffer when `binary`).
 * `onLine` sees stdout and stderr line by line as they come (progress parsing).
 * `maxOut` caps what is kept of stdout — yt-dlp's JSON for a long video is a few MB at most.
 */
export function run(cmd, args, { signal, timeoutMs = 10 * 60000, onLine, binary = false, maxOut = 64 * 1024 * 1024, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }))
    const child = spawn(cmd, args, { cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = [], err = []
    let outLen = 0, errLen = 0, done = false, lineBuf = ''
    const kill = () => { try { child.kill('SIGKILL') } catch { /* gone */ } }
    const timer = setTimeout(() => { kill(); finish(new ProcError(cmd, 'timeout', 'took longer than ' + Math.round(timeoutMs / 1000) + ' s')) }, timeoutMs)
    const onAbort = () => { kill(); finish(Object.assign(new Error('cancelled'), { cancelled: true })) }
    signal?.addEventListener('abort', onAbort, { once: true })
    const lines = d => {
      if (!onLine) return
      lineBuf += d.toString('utf8')
      const parts = lineBuf.split(/\r?\n|\r/)
      lineBuf = parts.pop()
      for (const p of parts) if (p) onLine(p)
    }
    child.stdout.on('data', d => {
      if (outLen < maxOut) { out.push(d); outLen += d.length }
      if (!binary) lines(d)
    })
    child.stderr.on('data', d => { if (errLen < 256 * 1024) { err.push(d); errLen += d.length } lines(d) })
    child.on('error', e => finish(Object.assign(new ProcError(cmd, e.code || 'spawn', e.message), { missing: e.code === 'ENOENT' })))
    child.on('close', code => {
      const stderr = Buffer.concat(err).toString('utf8')
      if (code !== 0) return finish(new ProcError(cmd, code, stderr))
      const buf = Buffer.concat(out)
      finish(null, { stdout: binary ? buf : buf.toString('utf8'), stderr })
    })
    function finish(e, v) {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (e) reject(e); else resolve(v)
    }
  })
}

/** Whether a tool is on the PATH: for /health and for tests that skip without it. */
export async function has(cmd, args = ['-version']) {
  try { await run(cmd, args, { timeoutMs: 15000 }); return true } catch (e) { return !e.missing }
}
