/* Bookkeeping for identities linked to a profile through an external OIDC provider.
 *
 * Kept out of server.js so these rules are testable without a provider round trip, in the same
 * style passkeys-store.js already keeps passkey bookkeeping out of it: which row belongs to which
 * profile, and how a lookup is matched. The identity handle is the issuer and the subject
 * TOGETHER, never the subject alone -- a second provider configured later would otherwise collide
 * with the first, with nothing in the stored data able to tell the two apart.
 */

// Read defensively everywhere: a db.json written before this array existed has no such key, and
// that has to read as "nothing linked" rather than throw on the first lookup. No migration writes
// the key into place; every reader here treats its absence, or anything that is not a list, as an
// empty list.
const identities = db => (Array.isArray(db.identities) ? db.identities : []);

// A stored entry a reader can dereference. A hand edit or a bad restore can leave a null, a
// string or a number in the list, and reading `.userId` off one of those throws.
const isRow = x => !!x && typeof x === 'object' && !Array.isArray(x);

// An issuer or a subject is a real handle only as a non-empty string. Anything else - undefined
// from an entry that was never a verified identity, a number, an object - must neither be written
// nor matched: two absent handles compare equal, and one row written with them would then answer
// for every later lookup that also carries none.
const handle = v => typeof v === 'string' && v.length > 0;

// Matched on the pair, always both members together. Returns the row or null.
export function findIdentity(db, iss, sub) {
  if (!handle(iss) || !handle(sub)) return null;
  return identities(db).find(x => x.iss === iss && x.sub === sub) || null;
}

// At most one linked identity per profile today -- the row for a given profile, or null.
export function identityOf(db, userId) {
  return identities(db).find(x => x.userId === userId) || null;
}

// Writes a new identity row, refusing a pair already linked to any profile and a profile that
// already has one -- at most one identity per profile, exactly like identityOf's own contract.
export function addIdentity(db, { iss, sub, userId, email, linkedAt }) {
  if (!handle(iss) || !handle(sub)) return { error: 'not a verified identity', code: 'identity-invalid' };
  if (findIdentity(db, iss, sub)) return { error: 'this identity is already linked to a profile', code: 'identity-collision' };
  if (identityOf(db, userId)) return { error: 'this profile already has a linked identity', code: 'profile-linked' };
  db.identities = identities(db);
  db.identities.push({ iss, sub, userId, email, linkedAt });
  return { ok: true };
}

// The minimal-disclosure shape an owner's own account screen needs for the identity linked to
// their profile -- the issuer and the subject are lookup keys, never shown to anyone, including
// the owner. Null when nothing is linked. `usable` is the caller's answer to whether the row still
// signs anyone in; one that does not carries no provider name, since whatever provider is
// configured now is not the one it was linked at.
export function identityView(row, providerName, usable = true) {
  if (!row) return null;
  return { providerName: usable ? providerName : null, email: row.email ?? null, linkedAt: row.linkedAt, usable: !!usable };
}

// Detaches the identity linked to a profile -- whether that is ever the last way in is server.js's
// own question, answered (and re-answered after the owner's proof) before this is ever called.
export function unlinkIdentity(db, userId) {
  const rows = identities(db);
  const i = rows.findIndex(x => x.userId === userId);
  if (i < 0) return { error: 'no identity is linked to this profile', code: 'not-linked' };
  const [row] = rows.splice(i, 1);
  return { ok: true, row };
}

// Drops the identity linked to a profile that is being deleted. A row left behind would keep the
// address it holds and go on matching its identity for good: a sign-in with it would reach a
// profile that is gone, and linking it to any other profile would be refused as already linked.
export function dropIdentities(db, userId) {
  if (Array.isArray(db.identities)) db.identities = db.identities.filter(x => !isRow(x) || x.userId !== userId);
}

// Drops every row no profile can use: a malformed one (not an object, or without a real issuer
// and subject), and one whose profile no longer exists (`userIds` is the set of ids that do).
// `userIds` is null when the profile list itself cannot be read; then no row is judged orphaned,
// because a damaged profile list must not cost every profile its linked identity once it is
// repaired. An `identities` value that is not a list is left exactly as it is: every reader
// already treats it as empty, and rewriting it would destroy whatever a person might still recover
// from it by hand. Total over any shape of db.json, since it runs on every start: a throw here
// would keep the whole instance from starting. Answers how many of each kind went, so the caller
// writes only when something changed. Running it again changes nothing, and a db.json with no
// identities key keeps having none.
export function pruneIdentities(db, userIds) {
  const none = { orphaned: 0, malformed: 0 };
  if (!Array.isArray(db.identities)) return none;
  const kept = [];
  for (const x of db.identities) {
    if (!isRow(x) || !handle(x.iss) || !handle(x.sub)) none.malformed++;
    else if (userIds && !userIds.has(x.userId)) none.orphaned++;
    else kept.push(x);
  }
  if (kept.length !== db.identities.length) db.identities = kept;
  return none;
}
