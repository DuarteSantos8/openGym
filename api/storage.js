import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Errors from a present-but-unreadable file must never be treated as a new profile. */
export class StorageCorruptError extends Error {
  constructor(file, cause) {
    super(`storage file is unreadable: ${file}`)
    this.name = 'StorageCorruptError'
    this.code = 'STORAGE_CORRUPT'
    this.file = file
    this.cause = cause
  }
}

export function readText(file, options = {}) {
  // An explicit `missing: undefined` is a useful sentinel for callers that need to
  // distinguish a missing optional file from a present JSON `null`. Destructuring with
  // a default would erase that distinction.
  const missing = Object.prototype.hasOwnProperty.call(options, 'missing') ? options.missing : null
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return missing
    throw new StorageCorruptError(file, error)
  }
}

export function readJson(file, options = {}) {
  const missing = Object.prototype.hasOwnProperty.call(options, 'missing') ? options.missing : null
  const text = readText(file, { missing })
  if (text === missing) return missing
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new StorageCorruptError(file, error)
  }
}

/**
 * Write a complete file and make both the file and its containing directory durable before
 * reporting success. A unique temp name avoids two writers clobbering the same temporary file.
 */
export function durableAtomicWrite(file, content, mode = 0o600) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`)
  let fd = null
  try {
    fd = fs.openSync(tmp, 'wx', mode)
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tmp, file)
    const dirFd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
  } catch (error) {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
    try { fs.unlinkSync(tmp) } catch {}
    throw error
  }
}

export function etagFor(content) {
  return `"${crypto.createHash('sha256').update(content).digest('hex')}"`
}

export function readRevision(file) {
  let content
  try { content = fs.readFileSync(file) }
  catch (error) { if (error?.code === 'ENOENT') return '"0"'; throw new StorageCorruptError(file, error) }
  return etagFor(content)
}

export function normalizeIfMatch(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.includes(',')) return null
  // Weak validators are not valid for a state replacement. Keep the comparison byte-exact.
  return raw.startsWith('W/') ? null : raw
}

export function isSafeId(value) {
  return /^[A-Za-z0-9_-]{1,120}$/.test(String(value || ''))
}
