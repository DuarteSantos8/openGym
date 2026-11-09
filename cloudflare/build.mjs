// Builds what wrangler.toml deploys: node cloudflare/build.mjs, from anywhere, on any OS.
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, dir) => execSync(cmd, { cwd: root + dir, stdio: 'inherit' });

run('npm ci --ignore-scripts --omit=optional', 'api');
run('npm ci --ignore-scripts', 'frontend');
run('npm run build', 'frontend');

const dist = root + 'cloudflare/dist';
rmSync(dist, { recursive: true, force: true });
cpSync(root + 'frontend/dist', dist, { recursive: true });
cpSync(root + 'catalogue/media', dist + '/exercise-media', { recursive: true });
cpSync(root + 'cloudflare/_headers', dist + '/_headers');
