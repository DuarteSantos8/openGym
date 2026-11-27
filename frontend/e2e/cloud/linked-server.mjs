// The app's own server as the Cloud edition will meet it (ADR 0013, docs/next/CLOUD-SERVER.md):
// a real API whose one way in is an identity provider. The provider here is the API tests' own
// small one (api/test/mock-oidc.mjs), standing in for the hosted project's OAuth server: it signs
// the test person straight in, where the real one first shows our consent page. Everything stays
// on this machine.
//
//   node e2e/cloud/linked-server.mjs <port> <origin>
//
// Started by playwright.config.mjs; the Cloud preview proxies /api to it.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockOidc } from '../../../api/test/mock-oidc.mjs'

const [port = '3001', origin = 'http://localhost:4174'] = process.argv.slice(2)
const API = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'api')

const idp = await startMockOidc()
// The same person pretend-project.mjs signs in to the account as.
idp.next = { sub: 'u-1', name: 'Sam', email: 'sam@example.com', email_verified: true }

const api = spawn(process.execPath, ['server.js'], {
  cwd: API, stdio: 'inherit',
  env: {
    ...process.env, PORT: port, DATA_DIR: mkdtempSync(join(tmpdir(), 'og-e2e-linked-')), ORIGIN: origin, RP_ID: 'localhost',
    INVITE_ONLY: '', ADMIN_UIDS: '', FIRST_USER_ADMIN: '', PASSWORD_LOGIN: '',
    OIDC_ISSUER: idp.issuer, OIDC_CLIENT_ID: idp.clientId, OIDC_CLIENT_SECRET: idp.clientSecret, OIDC_LABEL: 'Ironvane', OIDC_ONLY: '1',
    OIDC_BURST_PER_MIN: '300',
  },
})
const stop = () => { api.kill(); idp.close().finally(() => process.exit(0)) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
api.on('exit', code => { idp.close().finally(() => process.exit(code ?? 0)) })
