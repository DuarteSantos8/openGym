import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyError } from '../verify-error.js';

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
