#!/usr/bin/env node
// Redeem the one-time code from Settings → Pair the mobile app, then store the
// resulting bearer token without printing it or putting it in shell history.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { getUser } from '../src/state.js'

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.private/tunnel.env')
fs.mkdirSync(path.dirname(envFile), { recursive: true, mode: 0o700 })
const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : []
const setting = name => lines.find(line => line.startsWith(name + '='))?.slice(name.length + 1).trim() || ''
const base = process.env.OPENGYM_API_URL || setting('OPENGYM_API_URL') || 'http://127.0.0.1:8080'
const user = getUser()
const url = new URL('/api/pair/redeem', base)
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
  throw new Error('Use HTTPS or a loopback OPENGYM_API_URL for pairing')
}

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
const code = (await prompt.question('One-time pairing code from OpenGym Settings: ')).trim()
prompt.close()
if (!code) throw new Error('No pairing code supplied')
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
  signal: AbortSignal.timeout(15000)
})
const data = await res.json().catch(() => ({}))
if (!res.ok) throw new Error(data.error || `Pairing failed (HTTP ${res.status})`)
if (data.user?.id !== user.id) throw new Error('Pairing code belongs to another OpenGym profile; token was not saved')
// OpenGym signs `<uid>:<expiry>:<version>` and appends a base64url signature.
if (!/^[A-Za-z0-9:._~-]+$/.test(data.token || '')) throw new Error('API returned an invalid token')
const settings = lines.filter(line => !line.startsWith('OPENGYM_API_TOKEN=') && !line.startsWith('OPENGYM_API_URL='))
settings.push(`OPENGYM_API_URL=${url.origin}`, `OPENGYM_API_TOKEN=${data.token}`)
const updated = settings.join('\n') + '\n'
const tmp = envFile + '.tmp'
fs.writeFileSync(tmp, updated, { mode: 0o600 })
fs.renameSync(tmp, envFile)
console.log('OpenGym pairing token saved in mcp/.private/tunnel.env. Load it into your MCP server environment and restart the client to enable writes.')
