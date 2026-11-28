#!/usr/bin/env node
/* Prints curl commands that send your flow a delivery signed exactly as openGym signs one
 * (HMAC-SHA256 over "<t>.<body>", header "t=<t>,v1=<hex>"), plus two it must refuse.
 *
 *   OPENGYM_WEBHOOK_SECRET=ogwh_... node sign-example.mjs [http://localhost:1880/opengym/webhook]
 *
 * The secret is read from the environment and is not printed. */
import crypto from 'node:crypto'

const secret = process.env.OPENGYM_WEBHOOK_SECRET
if (!secret) { console.error('Set OPENGYM_WEBHOOK_SECRET to the secret openGym showed you.'); process.exit(1) }
const url = process.argv[2] || 'http://localhost:1880/opengym/webhook'
const now = new Date()
const id = 'evt_example_' + crypto.randomBytes(4).toString('hex')
const body = JSON.stringify({
  version: 1, id, type: 'workout.finished', createdAt: now.toISOString(), test: true,
  data: { workout: { id: 'example', name: 'Example workout', date: now.toISOString().slice(0, 10), unit: 'kg', totals: { exercises: 1, sets: 3, reps: 24, volume: 1440 }, exercises: [], records: [] } },
})
const t = Math.floor(now / 1000)
const sign = (b, ts = t) => `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex')}`
const q = s => `'${s.replace(/'/g, `'\\''`)}'`
const curl = (label, header, b = body) => console.log(`# ${label}\ncurl -sS -i -X POST ${q(url)} -H 'Content-Type: application/json'${header ? ` -H ${q('X-OpenGym-Signature: ' + header)}` : ''} --data-binary ${q(b)}\n`)

curl('valid: 200 {"ok":true,"handled":"workout.finished"} (a second run of this same command: 200 duplicate)', sign(body))
curl('tampered body: 401', sign(body), body.replace('Example workout', 'Changed workout'))
curl('ten minutes old: 401', sign(body, t - 600))
console.log('# The signature is good for five minutes: print fresh commands to try again.')
