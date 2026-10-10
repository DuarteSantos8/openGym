import { getLang } from './i18n-core.js'
import it from '../admin-locales/it.js'

export function adminT(source, ...args) {
  let value = getLang() === 'it' ? (it[source] || source) : source
  for (let i = 0; i < args.length; i++) value = value.replaceAll('{' + i + '}', args[i])
  return value
}
