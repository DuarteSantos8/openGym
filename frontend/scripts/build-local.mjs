// Cross-platform, including Windows PowerShell.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const env = { ...process.env, VITE_LOCAL: '1', VITE_DEMO: '0', VITE_MOBILE: '0', VITE_UMAMI_SRC: '', VITE_UMAMI_ID: '' }
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root + 'frontend', env, stdio: 'inherit' })
execFileSync(process.execPath, ['scripts/catalogue/stage-media.mjs', 'frontend/dist'], { cwd: root, env, stdio: 'inherit' })
