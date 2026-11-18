// Browser QA only. Preload before server.js. HTTPS is intercepted before DNS/network;
// real route/auth/module checks, cache/rate limits and normalization still execute.
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

https.request = (url, options) => {
  const u = new URL(url)
  if (u.origin !== 'https://world.openfoodfacts.org') throw new Error('Unexpected HTTPS in synthetic QA')
  const code = u.pathname.split('/').at(-1)
  fs.appendFileSync(path.join(process.env.DATA_DIR, 'outbound-test.jsonl'), JSON.stringify({ url: String(url), method: options.method, headers: options.headers }) + '\n')
  const req = new EventEmitter()
  let body
  req.destroy = error => { body?.destroy(); if (error) req.emit('error', error) }
  options.signal?.addEventListener('abort', () => req.destroy(), { once: true })
  req.end = () => queueMicrotask(() => {
    const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('secureConnect')
    const volume = code === '012345678905'
    const payload = { status: 'success', result: { id: 'product_found' }, product: {
      code, product_name: volume ? 'Synthetic drink' : 'Synthetic oats', brands: 'QA fixture', quantity: '330 ml',
      serving_size: volume ? '125 ml' : '30 g',
      nutrition: { aggregated_set: { per: volume ? '100ml' : '100g', preparation: 'as_sold', nutrients: {
        'energy-kcal': { value: volume ? 40 : 200, unit: 'kcal' }, proteins: { value: volume ? 0 : 8, unit: 'g' }, fat: { value: 0, unit: 'g' }
      } } }
    } }
    const missing = code === '96385074', failure = code === '036000291452'
    body = Readable.from([JSON.stringify(missing ? { status: 'failure', result: { id: 'product_not_found' } } : payload)])
    body.statusCode = missing ? 404 : failure ? 503 : 200; body.headers = {}
    req.emit('response', body)
  })
  return req
}
