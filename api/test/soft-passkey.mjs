/* A software authenticator: a P-256 key that makes attestations ("none") and assertions the way a
   browser's would, for the tests that run real WebAuthn ceremonies against server.js. Shared by
   server-passkeys.test.js and server-onboarding-passkeys.test.js.

   `regFlags` and `authFlags` are the authenticator data flags byte of the attestation and of every
   assertion: UP 0x01, UV 0x04, BE 0x08 (backup eligible), BS 0x10 (backed up), AT 0x40 (attested
   credential data, which an attestation always carries). */
import crypto from 'node:crypto';

export const ORIGIN = 'http://localhost:8080';
export const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 };

const b64u = b => Buffer.from(b).toString('base64url');
const sha = b => crypto.createHash('sha256').update(b).digest();

// Just enough CBOR for an attestation object: a map of text keys to text, bytes or an empty map.
const cborHead = (major, n) => n < 24 ? Buffer.from([(major << 5) | n])
  : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cborText = s => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cborBytes = b => Buffer.concat([cborHead(2, b.length), b]);

export function softPasskey({ regFlags = FLAGS.UP | FLAGS.UV | FLAGS.AT, authFlags = FLAGS.UP | FLAGS.UV } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')
  ]);
  const raw = crypto.randomBytes(16);
  const id = b64u(raw);
  let counter = 0;
  const key = {
    id,
    row: (userId, extra = {}) => ({ id, userId, publicKey: cose.toString('base64url'), counter: 0, transports: ['internal'], ...extra }),
    // The flags of the assertions from here on, as a synced authenticator's backup state can change.
    setAuthFlags(flags) { authFlags = flags; },
    // What navigator.credentials.create() hands back, serialised the way lib/api.js does.
    attestation(challenge, { origin = ORIGIN } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const len = Buffer.from([raw.length >> 8, raw.length & 255]);
      const authData = Buffer.concat([sha('localhost'), Buffer.from([regFlags | FLAGS.AT]), Buffer.alloc(4), Buffer.alloc(16), len, raw, cose]);
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]),
        cborText('authData'), cborBytes(authData)
      ]);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] }
      };
    },
    assertion(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter);
      const authData = Buffer.concat([sha('localhost'), Buffer.from([authFlags]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }
      };
    }
  };
  return key;
}
