/* The transport half of the seam, pinned on its own.
 *
 * It matters that these two failure kinds stay distinguishable: "there was no JSON in what the
 * provider said" and "there was, and the validator refused it" both feed the same single repair
 * round, but only the second can name what was wrong. If extraction quietly succeeded on half
 * an object, the validator would be arguing with a truncated answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { extractJSON, contractOK } = await import('../coach/core/parse.js');

test('JSON is recovered from whatever the model wrapped it in', () => {
  assert.deepEqual(extractJSON('{"a":1}').value, { a: 1 });
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJSON('Here you go:\n```\n{"a":1}\n```\nHope that helps!').value, { a: 1 });
  assert.deepEqual(extractJSON('Sure. {"a":1} — let me know.').value, { a: 1 });
});

test('an answer with no JSON in it fails rather than being guessed at', () => {
  assert.ok(extractJSON('I cannot help with that.').error);
  assert.ok(extractJSON('').error);
  assert.ok(extractJSON('{"a": ').error, 'half an object is not an object');
});

test('an answer may omit the contract version, but may not claim a different one', () => {
  assert.equal(contractOK({ ok: true }), true);
  assert.equal(contractOK({ coach_contract: 1 }), true);
  assert.equal(contractOK({ coach_contract: 2 }), false);
});
