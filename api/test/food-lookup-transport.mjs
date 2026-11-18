// Test-only HTTPS boundary. Imported before server.js in a subprocess; never shipped.
// Keep the real route, service, timeouts, streaming and normalization in the path.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

https.request = (url, options) => {
  fs.appendFileSync(path.join(process.env.DATA_DIR, 'outbound-test.jsonl'), JSON.stringify({
    url: String(url), method: options.method, headers: options.headers,
    agent: options.agent, lookup: typeof options.lookup
  }) + '\n');
  const req = new EventEmitter();
  let body;
  req.destroy = error => { body?.destroy(); if (error) req.emit('error', error); };
  options.signal?.addEventListener('abort', () => req.destroy(), { once: true });
  req.end = () => queueMicrotask(() => {
    const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('secureConnect');
    const mode = process.env.FOOD_TEST_REPLY;
    const code = new URL(url).pathname.split('/').at(-1);
    const payload = { code, status: 'success', result: { id: 'product_found' }, product: {
      code, product_name: 'Synthetic food', brands: 'Synthetic', quantity: '100 g',
      nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold',
        nutrients: { proteins: { value: 5, unit: 'g' } } } }
    } };
    let statusCode = 200, chunks = [JSON.stringify(payload)];
    if (mode === 'missing') { statusCode = 404; chunks = [JSON.stringify({ status: 'failure', result: { id: 'product_not_found' } })]; }
    if (mode === 'error') { statusCode = 503; chunks = ['SECRET upstream body']; }
    if (mode === 'redirect') { statusCode = 302; chunks = ['SECRET redirect']; }
    if (mode === 'truncated') chunks = ['{"product":'];
    if (mode === 'oversized') chunks = [Buffer.alloc(40000), Buffer.alloc(40000)];
    body = mode === 'stall' ? new Readable({ read() {} }) : Readable.from(chunks);
    body.statusCode = statusCode;
    body.headers = mode === 'redirect' ? { location: 'http://169.254.169.254/SECRET' } : {};
    req.emit('response', body);
  });
  return req;
};
