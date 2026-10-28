// Copy the built PWA (../frontend/dist) into this deploy root's public/ so one Vercel project
// serves both the static app and the /api/passkey/* functions. Run after every app build:
//   node scripts/copy-dist.mjs        (from server/)
import { cpSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = join(root, '..', 'frontend', 'dist')
const dst = join(root, 'public')
if (!existsSync(join(src, 'index.html'))) {
  console.error(`No build at ${src}. Build the app first (see ../docs/FIREBASE_SYNC.md)`)
  process.exit(1)
}
rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })
console.log(`Copied ${src} → ${dst}`)
