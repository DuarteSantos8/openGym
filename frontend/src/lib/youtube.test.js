import { describe, it, expect } from 'vitest'
import { youtubeId, youtubeLinks } from './youtube.js'

describe('YouTube exercise links', () => {
  it('accepts only known hosts and complete video IDs', () => {
    for (const url of ['https://youtu.be/99QhMQoxmOk', 'youtube.com/watch?v=99QhMQoxmOk', 'https://m.youtube.com/shorts/99QhMQoxmOk', 'https://www.youtube-nocookie.com/embed/99QhMQoxmOk']) {
      expect(youtubeId(url)).toBe('99QhMQoxmOk')
    }
    for (const url of ['https://youtube.com.evil.test/watch?v=99QhMQoxmOk', 'javascript:alert(1)', 'https://user@youtube.com/watch?v=99QhMQoxmOk', 'https://youtube.com:8443/watch?v=99QhMQoxmOk', 'https://youtube.com/playlist?list=99QhMQoxmOk', 'https://youtu.be/x', null]) expect(youtubeId(url)).toBeNull()
  })
  it('extracts and deduplicates video references without treating other links as embeds', () => {
    expect(youtubeLinks('Squat: https://www.youtube.com/watch?v=99QhMQoxmOk; same: https://youtu.be/99QhMQoxmOk\nOther: https://example.org')).toEqual(['https://youtu.be/99QhMQoxmOk'])
  })
})
