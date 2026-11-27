// The watch's i18n files as the page's $t would read them: file name (no .json) -> { key: word }.
import { readdirSync, readFileSync } from 'node:fs'
const dir = new URL('../entry/src/main/js/MainAbility/i18n/', import.meta.url)
export const FILES = {}
readdirSync(dir).forEach(f => { FILES[f.slice(0, -5)] = JSON.parse(readFileSync(new URL(f, dir), 'utf8')).strings })
// a $t for one file, as the framework's measured in the simulator (zh-CN, 2026-11-26): 'strings.done' -> its word;
// {0}, {1}... are filled from the params array, and a placeholder with no param comes back BLANK ("{0} / {1} 组" -> " /  组");
// a key the file lacks comes back as the path itself; with no file at all, undefined (as the device does, from ACE's source)
export const dollarT = name => (path, params) => {
  const file = FILES[name]
  if (!file) return undefined
  const w = file[path.slice('strings.'.length)]
  if (w === undefined) return path
  return w.replace(/\{(\d+)\}/g, (m, i) => (params && params[i] !== undefined ? String(params[i]) : ''))
}
