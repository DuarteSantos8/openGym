/* The generated prompt module is what both runtimes read; the .md files are what people edit.
 * If they disagree, a prompt change silently never reaches the model. The generator's --check
 * makes the same assertion in CI; this one fails faster, inside the unit suite. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { PROMPTS } = await import('../coach/core/prompts.js');
const { buildPrompt } = await import('../coach/core/prompt.js');

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'coach', 'prompts');

test('core/prompts.js matches api/coach/prompts/*.md byte for byte', () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  assert.deepEqual(Object.keys(PROMPTS).sort(), files.map(f => f.replace(/\.md$/, '')));
  for (const f of files) {
    assert.equal(PROMPTS[f.replace(/\.md$/, '')], fs.readFileSync(path.join(dir, f), 'utf8'), `${f} is stale — run node scripts/build-coach-assets.mjs`);
  }
});

test('buildPrompt picks the task by kind and refine, and only adds the repair block when asked', () => {
  const payload = { coach_contract: 1, plan: { routines: [], week: {} } };
  const review = buildPrompt('review', payload, null);
  assert.ok(review.startsWith(PROMPTS.common));
  assert.ok(review.includes(PROMPTS.review));
  assert.ok(!review.includes(PROMPTS.repair.slice(0, 40)));

  const debrief = buildPrompt('debrief', payload, null);
  assert.ok(debrief.includes(PROMPTS.debrief) && !debrief.includes(PROMPTS.review) && !debrief.includes(PROMPTS.create));

  const create = buildPrompt('create', payload, null);
  assert.ok(create.includes(PROMPTS.create) && !create.includes(PROMPTS.refine));
  const refine = buildPrompt('create', { ...payload, refine: { text: 'x' } }, null);
  assert.ok(refine.includes(PROMPTS.refine) && !refine.includes(PROMPTS.create));

  const repaired = buildPrompt('review', payload, { previous: '{"bad": true}', errors: ['first', 'second'] });
  assert.ok(repaired.includes('{"bad": true}'));
  assert.ok(repaired.includes('- first\n- second'));
  assert.ok(!repaired.includes('{{PREVIOUS}}') && !repaired.includes('{{ERRORS}}'));
});
