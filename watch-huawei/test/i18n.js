// The watch's i18n files as the page's $t would read them: file name (no .json) -> { key: word }.
import { readdirSync, readFileSync } from 'node:fs'
const dir = new URL('../entry/src/main/js/MainAbility/i18n/', import.meta.url)
export const FILES = {}
readdirSync(dir).forEach(f => { FILES[f.slice(0, -5)] = JSON.parse(readFileSync(new URL(f, dir), 'utf8')).strings })
// a $t for one file: 'strings.done' -> its word, or undefined as the device does when there is no file
export const dollarT = name => path => (FILES[name] || {})[path.slice('strings.'.length)]
