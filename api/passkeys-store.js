export function listPasskeys(db, userId) {
  return (db.creds || [])
    .filter(c => c.userId === userId)
    .map(c => ({
      id: c.id,
      created: c.created || null,
      transports: c.transports || []
    }));
}

export function addPasskeyRecord(db, userId, cred) {
  db.creds = db.creds || [];
  if (db.creds.some(c => c.id === cred.id)) return { error: 'credential already registered' };
  db.creds.push({
    id: cred.id,
    userId,
    publicKey: cred.publicKey,
    counter: cred.counter || 0,
    transports: cred.transports || [],
    created: cred.created || new Date().toISOString()
  });
  return { ok: true };
}

export function removePasskeyRecord(db, userId, credId) {
  db.creds = db.creds || [];
  const i = db.creds.findIndex(c => c.id === credId && c.userId === userId);
  if (i < 0) return { error: 'passkey not found' };
  const mine = db.creds.filter(c => c.userId === userId);
  if (mine.length <= 1) return { error: 'keep at least one passkey' };
  db.creds.splice(i, 1);
  return { ok: true };
}
