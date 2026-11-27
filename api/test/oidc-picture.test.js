/* The `picture` claim (OIDC Core 5.1): which addresses are kept (accounts.js pictureOf), and how
   the provider module fetches one (provider.js picture): within the byte cap and the timeout, no
   redirects, and off the issuer's own origin never from a private address. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import { pictureOf, MAX_PICTURE_URL } from '../oidc/accounts.js';
import { createProvider } from '../oidc/provider.js';
import * as M from './media-samples.mjs';

test('pictureOf keeps an http(s) address and nothing else', () => {
  assert.equal(pictureOf({ picture: 'https://pics.example/a.png' }), 'https://pics.example/a.png');
  assert.equal(pictureOf({ picture: 'http://pics.example/a b.png' }), 'http://pics.example/a%20b.png');
  assert.equal(pictureOf({ picture: 'HTTPS://Pics.Example/a.png' }), 'https://pics.example/a.png');
  for (const bad of [undefined, null, 42, {}, ['https://pics.example/a.png'], '', 'not a url', '/a.png',
    'javascript:alert(1)', 'data:image/png;base64,iVBORw0KGgo=', 'file:///etc/passwd', 'ftp://pics.example/a.png',
    'https://user:pw@pics.example/a.png', 'https://user@pics.example/a.png', 'https://pics.example/' + 'a'.repeat(MAX_PICTURE_URL)]) {
    assert.equal(pictureOf({ picture: bad }), null, String(bad).slice(0, 40));
  }
  assert.equal(pictureOf({}), null);
  assert.equal(pictureOf(null), null);
});

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const providerAt = (issuer, opts) => createProvider({ issuer }, opts);
const refusal = code => e => e.code === code;

test('picture: the bytes from the issuer\'s own origin, up to the cap', async t => {
  const pic = M.png(4000);
  const base = await serve(t, (req, res) => {
    if (req.url === '/big-chunked') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(M.png(3000)); return res.end(M.png(3000)); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(pic.length) });
    res.end(pic);
  });
  const p = providerAt(base);
  assert.ok((await p.picture(base + '/a.png', 4000)).equals(pic));
  await assert.rejects(p.picture(base + '/a.png', 3999), refusal('picture-size'));
  await assert.rejects(p.picture(base + '/big-chunked', 5000), refusal('picture-size'));
});

test('picture: an error answer, a redirect and a provider that does not answer in time are refusals, final or for this time', async t => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/500') { res.writeHead(500); return res.end('nope'); }
    if (req.url === '/404') { res.writeHead(404); return res.end('gone'); }
    if (req.url === '/429') { res.writeHead(429); return res.end('later'); }
    if (req.url === '/408') { res.writeHead(408); return res.end('slow'); }
    if (req.url === '/liar') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '999999' }); return res.write(M.png(100)); }
    if (req.url === '/moved') { res.writeHead(302, { Location: '/a.png' }); return res.end(); }
    if (req.url === '/a.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(M.png(100)); }
    if (req.url === '/slow-body') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.write(M.png(100)); }
  });
  const p = providerAt(base, { timeoutMs: 300 });
  await assert.rejects(p.picture(base + '/500', 1000), e => e.code === 'picture' && e.message === 'HTTP 500');
  await assert.rejects(p.picture(base + '/429', 1000), e => e.code === 'picture' && e.message === 'HTTP 429');
  await assert.rejects(p.picture(base + '/408', 1000), e => e.code === 'picture' && e.message === 'HTTP 408');
  await assert.rejects(p.picture(base + '/404', 1000), e => e.code === 'picture-refused' && e.message === 'HTTP 404');
  await assert.rejects(p.picture(base + '/moved', 1000), e => e.code === 'picture-refused' && e.message === 'HTTP 302');
  await assert.rejects(p.picture(base + '/liar', 1000), refusal('picture-size'));
  const t0 = Date.now();
  await assert.rejects(p.picture(base + '/hang', 1000), e => e.code === 'picture' && e.message === 'timeout');
  await assert.rejects(p.picture(base + '/slow-body', 1000), e => e.code === 'picture' && e.message === 'timeout');
  assert.ok(Date.now() - t0 < 3000, 'both gave up after the timeout');
  assert.equal(p.status.lastError, null, 'a picture is not a provider error on the admin page');
});

test('picture: off the issuer\'s origin, a private address or plain http is never asked, a public https one goes through the guarded fetch', async t => {
  let asked = 0;
  const base = await serve(t, (req, res) => { asked++; res.writeHead(200); res.end(M.png(100)); });
  const guarded = [];
  const pictureFetch = async (url) => { guarded.push(url); return new Response(M.jpeg(200), { headers: { 'Content-Type': 'image/jpeg' } }); };
  const p = providerAt('https://id.example', { pictureFetch });
  for (const url of [base + '/a.png', 'http://localhost/a.png', 'http://app.localhost/a.png', 'http://[::1]/a.png',
    'http://[::ffff:127.0.0.1]/a.png', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/a.png', 'http://192.168.1.5/a.png', 'http://2130706433/a.png',
    'http://pics.example/a.jpg', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://10.0.0.1/a.png',
    'https://169.254.169.254/latest/meta-data/', 'https://2130706433/a.png', 'https://localhost/a.png']) {
    await assert.rejects(p.picture(url, 1000), refusal('picture-refused'), url);
  }
  assert.equal(asked, 0);
  assert.deepEqual(guarded, []);
  assert.equal((await p.picture('https://pics.example/a.jpg', 1000)).length, 200);
  assert.deepEqual(guarded, ['https://pics.example/a.jpg']);
});

test('picture: a name that resolves to a private address is refused in the connection\'s own lookup', async t => {
  let connections = 0;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(M.png(100)); });
  server.on('connection', () => connections++);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const real = dns.lookup;
  t.mock.method(dns, 'lookup', (host, opts, cb) => {
    if (typeof opts === 'function') [cb, opts] = [opts, {}];
    if (host !== 'pics.test') return real.call(dns, host, opts, cb);
    process.nextTick(() => opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
  });
  await assert.rejects(providerAt('https://id.example').picture(`https://pics.test:${server.address().port}/a.png`, 1000),
    e => e.code === 'picture-refused' && e.message === 'the picture is on a private address');
  assert.equal(connections, 0);
});
