// The push the server sends (api/trainers/push-copy.js, generated from TRAINER_PUSH) and the notice
// the app shows (noticeText) must say the same words.
import { describe, expect, it } from 'vitest'
import { TRAINER_PUSH, NOTICE_KINDS } from './trainer-notices.js'
import { noticeText } from './trainer-notice-text.js'

describe('trainer notices', () => {
  it('the in-app notice is the push, word for word', () => {
    for (const kind of NOTICE_KINDS) {
      const n = noticeText(kind, ['{0}', '{1}'])
      expect(n.title, kind).toBe(TRAINER_PUSH[kind].title)
      expect(n.body, kind).toBe(TRAINER_PUSH[kind].body)
    }
  })
  it('no em dashes', () => {
    for (const c of Object.values(TRAINER_PUSH)) expect(c.title + c.body).not.toMatch(/—/)
  })
})
