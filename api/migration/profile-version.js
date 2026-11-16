/* Which engine schema a stored profile is in — the one migration discriminator.
 * Dependency-free on purpose: the frontend checks every copy at startup with this and
 * loads the migration itself (and the exercise catalogue it needs) only when there is one to run. */
export const ENGINE_SCHEMA = 2;
// The meaning of the records inside schema 2 (spec 16): 1 is programmes as engine definitions and
// runs (programme-upgrade.js). A profile without the marker is 0; a capable client sends its own.
export const ENGINE_CONTRACT = 1;
export const ENGINE_CONTRACT_HEADER = 'X-OpenGym-Engine-Contract';
export const contractOf = state => (Number.isInteger(state?.engineContractRevision) && state.engineContractRevision > 0 ? state.engineContractRevision : 0);

const versionOf = state => (typeof state?.engineSchemaVersion === 'number' && Number.isFinite(state.engineSchemaVersion) ? state.engineSchemaVersion : 1);
const count = v => (Array.isArray(v) ? v.filter(x => !!x && typeof x === 'object' && !Array.isArray(x)).length : 0);

/** Throws for a non-object, a v1 profile whose lists are not lists, or a schema or contract newer than this build.
 *  `contractRequired`: a v2 profile still to be upgraded to this build's contract. */
export function migrationStatus(state, bytes = 0) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('profile-not-an-object');
  const version = versionOf(state);
  if (version > ENGINE_SCHEMA) throw new Error('unsupported-schema');
  const required = version < ENGINE_SCHEMA;
  if (required) for (const k of ['routines', 'workouts']) if (state[k] != null && !Array.isArray(state[k])) throw new Error(`invalid-v1-${k}`);
  const contract = contractOf(state);
  if (contract > ENGINE_CONTRACT) throw new Error('unsupported-contract');
  return {
    required,
    schemaVersion: required ? 1 : ENGINE_SCHEMA,
    contract,
    contractRequired: !required && contract < ENGINE_CONTRACT,
    revision: Number.isInteger(state._rev) ? state._rev : 0,
    summary: required ? { routines: count(state.routines), workouts: count(state.workouts), bytes } : null
  };
}

export function isLegacyProfile(state) {
  try { return migrationStatus(state).required; } catch { return false; }
}
