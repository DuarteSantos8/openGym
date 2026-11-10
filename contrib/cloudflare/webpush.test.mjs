// node --test contrib/cloudflare/webpush.test.mjs: decrypts what encrypt() made, as a browser would (RFC 8291).
import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, vapidAuth } from './webpush.js';

const s = crypto.subtle;
const b64u = b => Buffer.from(b).toString('base64url');
const hmac = async (key, data) => new Uint8Array(await s.sign('HMAC', await s.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const cat = (...p) => new Uint8Array(p.flatMap(x => [...x]));
const te = new TextEncoder();

test('a browser can decrypt the payload', async () => {
  const ua = await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await s.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encrypt('{"title":"hi"}', { p256dh: b64u(uaPub), auth: b64u(auth) });
  const salt = body.slice(0, 16), idlen = body[20], as = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  const asKey = await s.importKey('raw', as, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await s.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(te.encode('WebPush: info\0'), uaPub, as, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const plain = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv: nonce }, await s.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(plain.at(-1), 2);
  assert.equal(new TextDecoder().decode(plain.slice(0, -1)), '{"title":"hi"}');
});

test('the VAPID token verifies with the public key', async () => {
  const kp = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await s.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await s.exportKey('raw', kp.publicKey));
  const vapid = { publicKey: b64u(pub), privateKey: jwk.d };
  const h = await vapidAuth('https://push.example.com/abc', vapid, 'mailto:a@b.c', 1e12);
  const [, tok, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [hd, pl, sig] = tok.split('.');
  assert.equal(JSON.parse(Buffer.from(pl, 'base64url')).aud, 'https://push.example.com');
  assert.ok(await s.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(sig, 'base64url'), te.encode(hd + '.' + pl)));
});
