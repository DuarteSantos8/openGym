#!/usr/bin/env node
/* Coach evals: run the test lifters (lifters.mjs) through the real Coach review and mark the answers.
 *
 *   node scripts/coach-evals/run.mjs --dry
 *       No AI call. Checks each lifter's payload carries the checks its test expects.
 *   node scripts/coach-evals/run.mjs --model sonnet --judge opus [--only name]
 *       Runs every lifter through the Coach's Claude provider (the Agent SDK, signed in as this Mac's
 *       Claude login), then the exact checks, then the judge.
 *   OPENROUTER_API_KEY=... node scripts/coach-evals/run.mjs --via openrouter --model <id> --judge <id>
 *       The same on OpenRouter.
 *       Prints a table and saves the run under scripts/coach-evals/runs/ (git-ignored),
 *       with the change since the last run of the same model.
 *
 * What goes to the provider is what the Coach sends today: the made-up lifter's plan and log and
 * a short list of exercise names. Never pictures, never the whole catalogue.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../api/coach/core/payload.js';
import { runPipeline } from '../../api/coach/core/pipeline.js';
import { extractJSON } from '../../api/coach/core/parse.js';
import { EVIDENCE } from '../../api/coach/core/evidence.js';
import { LIBRARY } from '../../api/coach/core/library.js';
import openrouter from '../../api/coach/core/adapters/openrouter.js';
import claude, { LOCKDOWN } from '../../api/coach/adapters/claude.js';
import { PROMPTS } from '../../api/coach/core/prompts.js';
import { fieldsOf } from '../../api/coach/core/validate.js';
import { LIFTERS } from './lifters.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry');
const VIA = arg('--via') || 'claude';
const ONLY = arg('--only');
const NOW = Date.parse('2026-11-16T12:00:00Z'); // a Monday, so every run sees the same eight weeks
const RUNS = new URL('./runs/', import.meta.url);
const bpOf = id => LIBRARY.find(e => e.id === id)?.bp || null;

const lifters = LIFTERS.filter(l => !ONLY || l.name === ONLY);
const payloadOf = l => build(l.state(NOW), { handle: 'eval-' + l.name, kind: 'review', now: NOW, lang: 'en' });

/* ---------- the exact checks: plain code, the same every run ---------- */

// Author surnames and years from the source list: the Coach must never write a study itself.
const AUTHORS = [...new Set(Object.values(EVIDENCE).flatMap(t => t.sources.map(s => s.cite.split(/[ ,&]/)[0])))].filter(w => w.length > 3);
// A year on its own, not one inside a date like 2026-09-21.
const STUDY_TEXT = new RegExp(`\\bet al\\b|(?<![-\\d])(19|20)\\d\\d(?![-\\d])|\\b(${AUTHORS.join('|')})\\b`, 'i');

const TAG_TEXT = new RegExp(`\\b(${Object.keys(EVIDENCE).filter(t => t.includes('-')).join('|')})\\b|\\b(volume-low|volume-high|frequency|sets-per-exercise):\\S+`, 'i');

function exactChecks(l, attempt, rawRefs, rawKept = []) {
  const out = [];
  const add = (id, pass, note = '') => out.push({ id, pass, note });
  add('answered', attempt.ok, attempt.ok ? '' : `${attempt.errorClass}: ${attempt.detail || (attempt.errors || []).join(' · ')}`.slice(0, 200));
  if (!attempt.ok) return out;
  const changes = attempt.nochange ? [] : attempt.result?.changes || [];
  const texts = [attempt.reading, attempt.result?.summary, ...(attempt.result?.notes || []), ...changes.map(c => c.why)].filter(t => typeof t === 'string');
  const study = texts.find(t => STUDY_TEXT.test(t));
  add('no-study-in-text', !study, study ? study.slice(0, 120) : '');
  // The tag belongs in `ref`; in the text it is jargon ("volume-cap", "volume-low:lats").
  const tagged = texts.find(t => TAG_TEXT.test(t));
  add('no-tag-in-text', !tagged, tagged ? tagged.match(TAG_TEXT)[0] : '');
  const { library, ...sent } = payloadOf(l);
  const field = fieldsOf(sent).find(f => texts.some(t => new RegExp(`(?<!\\w)${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).test(t)));
  add('no-field-in-text', !field, field || '');
  const kept = changes.map(c => c.refCheck?.id || c.ref).filter(Boolean);
  const dropped = rawRefs.filter(r => !changes.some(c => c.ref === r || c.refCheck?.id === r));
  add('no-made-up-ref', !dropped.length, dropped.join(', '));
  const e = l.expect;
  // A `kept` reason ("why the plan stays") answers a check as well as a change citing it does.
  const answered = [...kept, ...(attempt.ok ? rawKept : [])];
  if (e.cite) add('cites', answered.some(r => e.cite.some(want => r === want || (want.endsWith(':') && (r.startsWith(want) || r === want.slice(0, -1))))), `wanted ${e.cite.join(' or ')}; got ${answered.join(', ') || 'none'}`);
  if (e.touches) add('touches', changes.some(c => e.touches.includes(c.target?.exId) || e.touches.includes(c.after?.id)), `wanted a change on ${e.touches.join(', ')}`);
  if (e.adds) add('adds', changes.some(c => e.adds.includes(bpOf(c.after?.id)) || (c.type === 'sets' && e.adds.includes(bpOf(c.target?.exId)))), `wanted more ${e.adds.join(', ')} work`);
  if (e.calm) add('calm', changes.length <= 2, `${changes.length} changes`);
  return out;
}

/* ---------- the judge: reads the reasons only, against one short standard ---------- */

const STANDARD = `You mark an AI gym coach's review of a lifter's plan. Answer JSON only:
{"score": 1-5, "pass": true|false, "notes": "one or two short sentences"}.
5 = every reason is right for this lifter and clearly put. Pass means 4 or 5.
Mark down when a reason:
- does not match the lifter's story or misses their main problem;
- uses a number that is not in the app's data shown (the coach must copy numbers, never work them out; a session count or a date range it read off the log is fine);
- names a study, an author or a year (the app adds sources itself);
- treats being over a range as a fault or scolds (it is a note at most);
- uses jargon a non-expert would not follow, or is long-winded.`;

// The Claude provider's child gets only what it needs to find this Mac's Claude login.
const CLAUDE_ENV = Object.fromEntries(['HOME', 'PATH', 'USER', 'LOGNAME'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const JOB_DIR = mkdtempSync(join(tmpdir(), 'coach-eval-'));

async function ask(model, system, user) {
  if (VIA === 'claude') {
    const { query } = await import('../../api/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');
    for await (const m of query({ prompt: user, options: { ...LOCKDOWN, cwd: JOB_DIR, env: CLAUDE_ENV, model, systemPrompt: system } })) {
      if (m.type === 'result') return { status: m.subtype, text: m.subtype === 'success' ? m.result : '' };
    }
    return { status: 'no result', text: '' };
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } })
  });
  const data = await res.json().catch(() => ({}));
  return { status: `${res.status} ${JSON.stringify(data.error || '').slice(0, 120)}`, text: data.choices?.[0]?.message?.content || '' };
}

// The Coach's own notes on what each field means ("recent" is the last 4 weeks), so a number
// read straight off a field is not marked as worked out.
const READING = (PROMPTS.common || '').split('## Reading their data')[1]?.split('\n## ')[0] || '';

async function judge(model, l, payload, attempt) {
  const answer = attempt.nochange ? { nochange: true, reading: attempt.reading } : {
    summary: attempt.result?.summary, notes: attempt.result?.notes,
    changes: (attempt.result?.changes || []).map(c => ({ type: c.type, target: c.target, after: c.after, why: c.why, ref: c.refCheck?.id || c.ref || null }))
  };
  // Everything the coach got except the exercise list, so the judge can tell a copied number from a worked-out one.
  const { library: _l, ...data } = payload;
  const user = `Lifter: ${l.story}\n\nHow the coach was told to read the data:\n${READING}\n\nThe app's data the coach was given: ${JSON.stringify(data)}\n\nThe coach's answer: ${JSON.stringify(answer)}`;
  // A judge that fails (network, quota) marks this review unjudged; it never loses the run.
  const r = await ask(model, STANDARD, user).catch(e => ({ status: `error ${String(e?.message || e).slice(0, 120)}`, text: '' }));
  const v = extractJSON(r.text).value;
  return v && Number.isFinite(v.score) ? { score: v.score, pass: !!v.pass, notes: String(v.notes || '') } : { score: null, pass: false, notes: `judge failed: ${r.status}` };
}

/* ---------- dry run: the lifters still say what their tests expect ---------- */

if (DRY) {
  let bad = 0;
  for (const l of lifters) {
    const ids = (payloadOf(l).checks || []).map(c => c.id);
    const e = l.expect;
    const ok = e.cite ? e.cite.some(w => ids.some(i => i === w || i.startsWith(w) || TAG_OF(i) === w)) : ids.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${l.name.padEnd(14)} checks: ${ids.join(', ') || 'none'}`);
  }
  process.exit(bad ? 1 : 0);
}
function TAG_OF(id) { return { 'volume-low': 'volume', 'volume-high': 'volume-cap', frequency: 'frequency', 'sets-per-exercise': 'sets-per-exercise' }[id.split(':')[0]]; }

/* ---------- the real run ---------- */

const MODEL = arg('--model');
const JUDGE = arg('--judge');
if (!MODEL || !JUDGE || (VIA === 'openrouter' && !process.env.OPENROUTER_API_KEY) || !['claude', 'openrouter'].includes(VIA)) {
  console.error('usage: node scripts/coach-evals/run.mjs [--via claude|openrouter] --model <coach model> --judge <judge model> [--only name] [--repeat 3]  (or --dry)');
  process.exit(2);
}
if (MODEL === JUDGE) console.error('note: the judge is marking its own model\'s work');

const REPEAT = Math.max(1, Number(arg('--repeat')) || 3);
const results = [];
for (const l of lifters) {
  const payload = payloadOf(l);
  const tries = [];
  for (let n = 0; n < REPEAT; n++) {
    const rawRefs = [], rawKept = [];
    let calls = 0;
    // Keeps what the model wrote, so a ref the validator dropped still counts as a slip, and counts retries.
    const base = VIA === 'claude' ? claude : openrouter;
    const adapter = { ...base, invoke: async o => {
      calls++;
      const r = await base.invoke(o);
      const v = extractJSON(r.text || '').value;
      rawRefs.length = 0;
      (Array.isArray(v?.changes) ? v.changes : []).forEach(c => typeof c?.ref === 'string' && rawRefs.push(c.ref));
      rawKept.length = 0;
      (Array.isArray(v?.kept) ? v.kept : []).forEach(k => typeof k?.ref === 'string' && rawKept.push(k.ref));
      return r;
    } };
    const t0 = Date.now();
    process.stderr.write(`${l.name} ${n + 1}/${REPEAT}: coach… `);
    const attempt = await runPipeline({
      adapter, cfg: { provider: VIA, providerOptions: {} }, kind: 'review', payload, model: MODEL, timeoutMs: 10 * 60000,
      invokeOpts: VIA === 'claude' ? { env: CLAUDE_ENV, jobDir: JOB_DIR } : { env: { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } }
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const exact = exactChecks(l, attempt, rawRefs, rawKept);
    process.stderr.write('judge… ');
    const verdict = attempt.ok ? await judge(JUDGE, l, payload, attempt) : { score: null, pass: false, notes: 'no answer to mark' };
    process.stderr.write('done\n');
    tries.push({ seconds, calls, exact, judge: verdict, answer: attempt.ok ? (attempt.nochange ? { nochange: true, reading: attempt.reading } : attempt.result) : null });
  }
  results.push({ lifter: l.name, tries });
}

mkdirSync(RUNS, { recursive: true });
const slug = `${VIA}-${MODEL}`.replace(/[^\w.-]+/g, '_');
const file = `${new Date().toISOString().replace(/[:.]/g, '-')}--${slug}.json`;
writeFileSync(new URL(file, RUNS), JSON.stringify({ model: MODEL, judge: JUDGE, repeat: REPEAT, at: new Date().toISOString(), results }, null, 2));

const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`\nCoach: ${VIA} ${MODEL} · judge: ${JUDGE} · ${REPEAT} runs per lifter\n`);
console.log('| Lifter | Every exact check passed | Judge (average of 5) | Retries | Checks failed (times) |');
console.log('|---|---|---|---|---|');
for (const r of results) {
  const t = r.tries;
  const failed = {};
  t.forEach(x => x.exact.filter(c => !c.pass).forEach(c => { failed[c.id] = (failed[c.id] || 0) + 1; }));
  const scores = t.map(x => x.judge.score).filter(Number.isFinite);
  console.log(`| ${r.lifter} | ${t.filter(x => x.exact.every(c => c.pass)).length}/${t.length} | ${scores.length ? avg(scores).toFixed(1) : '-'} | ${t.reduce((a, x) => a + x.calls - 1, 0)} | ${Object.entries(failed).map(([k, v]) => `${k} ×${v}`).join(', ') || '-'} |`);
}
const all = results.flatMap(r => r.tries);
console.log(`\nAll: every exact check passed ${all.filter(x => x.exact.every(c => c.pass)).length}/${all.length} · judge ${avg(all.map(x => x.judge.score).filter(Number.isFinite)).toFixed(2)} · retries ${all.reduce((a, x) => a + x.calls - 1, 0)}`);
console.log('\nLowest judge note per lifter:');
for (const r of results) {
  const worst = r.tries.filter(x => Number.isFinite(x.judge.score)).sort((a, b) => a.judge.score - b.judge.score)[0];
  if (worst && worst.judge.score < 4) console.log(`- ${r.lifter} (${worst.judge.score}/5): ${worst.judge.notes}`);
}
console.log(`\nSaved: scripts/coach-evals/runs/${file}`);
