/* How much thinking a job is allowed, in the words of whichever provider serves it (#1240).

 * One setting, nine vocabularies. The canonical levels are the Claude Agent SDK's, because that
 * is where openGym can be sure of the set (#1018); every other provider names the same idea
 * differently and offers a different slice of it, so a spec says which field it uses and which
 * levels that field knows.
 *
 * Two rules keep a wrong guess from becoming a failed job. A level the provider does not have is
 * clamped to the highest one it does, never sent as a value it would refuse and never dropped to
 * nothing. And a provider that refuses the field anyway — a gateway that has never heard of
 * `reasoning_effort`, a model that does not reason — is answered by the `effort` rung of the
 * compatibility ladder in http.js, which sends the same request without it.
 *
 * Nothing here reads process.env: this file is part of the core, which runs inside the phone
 * build as well. The level arrives through the `env` object, the same way an API key does, and
 * config.js's jobEnv() is what puts it there on the server.
 */

/** The canonical levels, lowest first. The Agent SDK's vocabulary, used as the reference. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/** The level an instance asked for, or undefined for "the model decides". Anything that is not
 *  one of the levels is ignored rather than guessed at, the way the Claude adapter did before. */
export function effortFrom(env = {}) {
  const v = String((env && env.COACH_EFFORT) ?? '').trim().toLowerCase();
  return EFFORTS.includes(v) ? v : undefined;
}

/** The highest level in `levels` that is at or below `level`, so a provider is never handed a
 *  value it does not define. Returns undefined when nothing at or below it exists. */
export function clampEffort(levels, level) {
  if (!level) return undefined;
  if (levels.includes(level)) return level;
  for (let i = EFFORTS.indexOf(level) - 1; i >= 0; i--) {
    if (levels.includes(EFFORTS[i])) return EFFORTS[i];
  }
  return undefined;
}
