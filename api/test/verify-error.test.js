import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyError, originHint, isMisconfigured } from '../verify-error.js';

const cfg = { rpId: 'gym.example.com', origin: 'https://gym.example.com' };

test('names the configured values when the RP ID does not match', () => {
  const out = verifyError(new Error('Unexpected RP ID hash'), cfg);
  assert.match(out, /RP_ID=gym\.example\.com/);
  assert.match(out, /ORIGIN=https:\/\/gym\.example\.com/);
  assert.match(out, /SELF_HOSTING\.md/);
});

test('does the same for an origin mismatch, on login and on registration', () => {
  assert.match(verifyError(new Error('Unexpected authentication response origin'), cfg), /must match the address you opened/);
  assert.match(verifyError(new Error('Unexpected registration response origin'), cfg), /must match the address you opened/);
});

test('leaves an unrelated verification failure alone', () => {
  assert.equal(
    verifyError(new Error('Signature verification failed'), cfg),
    'verification failed: Signature verification failed'
  );
});

test('does not throw on a missing or empty error', () => {
  assert.equal(verifyError(undefined, cfg), 'verification failed: verification failed');
  assert.equal(verifyError(new Error(''), cfg), 'verification failed: verification failed');
});

test('a refused write names the setting that fixes it when the browser is just at another address', () => {
  const line = originHint('POST /api/data', 'http://10.11.0.4:3030', 'http://localhost:8080', undefined);
  assert.match(line, /^refused cross-origin POST \/api\/data: origin="http:\/\/10\.11\.0\.4:3030" expected=http:\/\/localhost:8080/);
  assert.match(line, /set ORIGIN=http:\/\/10\.11\.0\.4:3030 and RP_ID=10\.11\.0\.4 on the api service/);
});

test('a page on another site is not told to change ORIGIN', () => {
  const line = originHint('POST /api/data', 'https://evil.test', 'https://gym.test', 'cross-site');
  assert.doesNotMatch(line, /set ORIGIN/);
  assert.match(line, /sec-fetch-site="cross-site"/);
});

test('an Origin header cannot add a line or a suggestion of its own', () => {
  const line = originHint('POST /api/data', 'http://a\nrefused cross-origin fake', 'https://gym.test');
  assert.equal(line.split('\n').length, 1);
  assert.doesNotMatch(line, /set ORIGIN/);
  assert.match(originHint('POST /api/data', undefined, 'https://gym.test'), /origin=\(none\)/);
  assert.doesNotMatch(originHint('POST /api/data', 'null', 'https://gym.test'), /set ORIGIN/);
});

test('tells an origin or RP ID mismatch apart from other verify errors', () => {
  assert.equal(isMisconfigured(new Error('Unexpected RP ID hash')), true);
  assert.equal(isMisconfigured(new Error('Signature verification failed')), false);
  assert.equal(isMisconfigured(undefined), false);
});
