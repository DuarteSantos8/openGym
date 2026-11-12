// The Google Play feature graphic (fastlane/metadata/android/en-US/images/featureGraphic.png),
// 1024 x 500, 24-bit PNG without alpha, from feature-graphic.html with headless Chrome.
//
//   CHROME=/path/to/chrome FONTCONFIG_FILE=fc-roboto.conf \
//     node scripts/store/feature-graphic.mjs <out.png> <phone-shot.png>
//
// <phone-shot.png> is a 1080 x 2160 phone screenshot of Home from the plain build (no exercise
// media; the Play kit uses shots/plain/android/en-US/1-home.png). Roboto must be installed or in
// FONTCONFIG_FILE. Needs Chrome and Python with Pillow (to drop the alpha channel).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [,, out, shot] = process.argv
if (!out || !shot) { console.error('usage: feature-graphic.mjs <out.png> <phone-shot.png>'); process.exit(2) }
const chrome = process.env.CHROME || 'google-chrome'
const dir = mkdtempSync(join(tmpdir(), 'og-feature-'))
const html = join(dir, 'feature.html')
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'feature-graphic.html'), 'utf8')
// inlined, so the screenshot is there before Chrome takes its picture
writeFileSync(html, src.replace('src="SHOT"', 'src="data:image/png;base64,' + readFileSync(resolve(shot)).toString('base64') + '"'))
execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1024,500',
  '--virtual-time-budget=3000', `--screenshot=${resolve(out)}`, 'file://' + html], { stdio: 'ignore' })
execFileSync('python3', ['-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[1])', resolve(out)])
rmSync(dir, { recursive: true, force: true })
console.log(`${out}: 1024 x 500`)
