import { fold, pageTrail, searchSettings } from '../views/settings-pages.js'
import { GUIDES } from '../content/learn.js'
import { NAVIGATION_COPY, STEPS } from './tour.js'
import { t } from './i18n.js'

// These stops have an unconditional, reachable destination and need no practice session.
const navigation = STEPS.filter(step => step.go && !step.when && NAVIGATION_COPY[step.id])
const filler = new Set('a an the to is are i my can how where do does change long lasts find me on in of for'.split(' '))
export function helpMatches(question, ctx, tr = t) {
  const phrase = fold(question)
  const parts = phrase.match(/[\p{L}\p{N}]+/gu) || []
  // Index adjacent characters as well when words are not separated by spaces.
  const words = [...new Set(parts.flatMap(part => {
    const chars = Array.from(part)
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(part) && chars.length > 2
      ? [part, ...chars.slice(1).map((char, i) => chars[i] + char)] : [part]
  }).filter(w => !filler.has(w)))].slice(0, 24)
  if (!words.length) return []
  const tokens = words.join(' ')
  const hits = []
  function add(title, steps, route, keywords, state) {
    const name = fold(title)
    const text = fold([title, ...steps, keywords].join(' '))
    const count = words.filter(w => text.includes(w)).length
    if (count) hits.push({ title, steps, route, state, score: count * 10 + (name === tokens || phrase.includes(name) ? 8 : 0) + words.filter(w => name.includes(w)).length })
  }
  const seen = new Set()
  for (const word of words) {
    for (const item of searchSettings(word, ctx, tr)) {
      const key = item.page + ':' + item.title
      if (seen.has(key)) continue
      seen.add(key)
      const route = item.route || (item.page === 'coach' ? '/coach/setup' : '/settings/' + item.page)
      add(item.label, [tr('Settings'), ...(item.isPage ? [] : [pageTrail(item.page, tr)]), item.label], route, [item.kw, item.tkw?.(), ...(item.opts || []).flatMap(option => [option, tr(option)])].join(' '),
        item.isPage ? undefined : { find: item.title, via: item.via })
    }
  }
  for (const g of GUIDES) add(tr(g.title), [tr('Learn'), tr(g.summary)], '/learn?g=' + g.id, g.title)
  for (const step of navigation) {
    const [title, instruction] = NAVIGATION_COPY[step.id]()
    add(title, [instruction], step.go, step.go.slice(1))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3)
}
