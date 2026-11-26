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
  const words = [...new Set(parts.filter(w => !filler.has(w)))].slice(0, 24)
  if (!words.length) return []
  const hits = []
  function add(title, steps, route, keywords, state) {
    const name = fold(title)
    const text = fold([title, ...steps, keywords].join(' '))
    const count = words.filter(w => text.includes(w)).length
    const named = name && phrase.includes(name)
    if (count || named) hits.push({ title, steps, route, state, score: (named ? 1000 + name.length : 0) + count * 10 + words.filter(w => name.includes(w)).length })
  }
  // Enumerate visible Settings rows once; complete translated labels can occur anywhere in the question.
  for (const item of searchSettings('', ctx, tr, { includeAll: true })) {
    const route = item.route || (item.page === 'coach' ? '/coach/setup' : '/settings/' + item.page)
    add(item.label, [tr('Settings'), ...(item.isPage ? [] : [pageTrail(item.page, tr)]), item.label], route, [item.kw, item.tkw?.(), ...(item.opts || []).flatMap(option => [option, tr(option)])].join(' '),
      item.isPage ? undefined : { find: item.title, via: item.via })
  }
  for (const g of GUIDES) add(tr(g.title), [tr('Learn'), tr(g.summary)], '/learn?g=' + g.id, g.title)
  for (const step of navigation) {
    const [title, instruction] = NAVIGATION_COPY[step.id]()
    add(title, [instruction], step.go, step.go.slice(1))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3)
}
