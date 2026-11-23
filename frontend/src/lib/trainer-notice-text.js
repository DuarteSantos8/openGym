// The notices of lib/trainer-notices.js in the app's language. Written out as t() literals so the
// string checks see them (check-source-strings.mjs only finds literals); trainer-notices.test.js
// keeps both lists the same words.
import { t } from './i18n.js'

export function noticeText(kind, names = []) {
  const [a = '', b = ''] = names
  switch (kind) {
    case 'connected': return { title: t('{0} is now your trainer', a), body: t('They see what you shared, nothing more. Change it any time in Trainer & gym.') }
    case 'scopes': return { title: t('Your sharing changed'), body: t('What {0} sees just changed. Not you? Check Trainer & gym.', a) }
    case 'joined': return { title: t('Welcome to {0}', a), body: t('Your gym lead sees only what you ticked.') }
    case 'change': return { title: t('{0} updated your training', a), body: t('Have a look. If it is not for you, undo is one tap in Trainer & gym.') }
    case 'suggest': return { title: t('{0} has an idea for you', a), body: t('Take it or leave it in Trainer & gym.') }
    case 'comment': return { title: t('{0} left you a note', a), body: '' }
    case 'offer': return { title: t('{0} left {1}', a, b), body: t('Keep training together privately? You have 30 days to decide.') }
    default: return { title: kind || '', body: '' }
  }
}
