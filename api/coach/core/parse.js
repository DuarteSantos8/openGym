/* Getting a JSON object back out of whatever the provider actually said.
 *
 * This is plumbing, not validation: it answers "is there a JSON object in here, and does it
 * claim the contract this build speaks", and nothing at all about whether the contents are
 * safe to act on. That judgement — the closed list of change types, the real exercise ids —
 * is the validator's, and it is the actual security boundary.
 *
 * Models are told to return bare JSON and mostly do. The two fallbacks are for the two ways
 * they don't: a fenced code block, and a sentence of preamble before the brace. Anything past
 * that is a provider having a bad day, and a clean failure is a better answer than a clever
 * recovery that guesses at half an object.
 */
import { CONTRACT } from './payload.js';

export function extractJSON(text) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'the provider returned nothing' };
  try { return { value: JSON.parse(raw) }; } catch { /* keep looking */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return { value: JSON.parse(fenced[1]) }; } catch { /* keep looking */ }
  }
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return { value: JSON.parse(raw.slice(first, last + 1)) }; } catch { /* give up */ }
  }
  return { error: 'the answer was not JSON' };
}

/** An answer may omit the contract field; it may not claim a different one. */
export const contractOK = data => !data?.coach_contract || data.coach_contract === CONTRACT;
