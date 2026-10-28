// What the import screen says when the server refuses or fails an import, by the code the API sent.
import { describe, expect, it } from 'vitest'
import { videoImportError, stageText } from './video-import-api.js'

describe('stageText', () => {
  it('says something for every stage the worker reports, the one where it looks for the boxes included', () => {
    for (const stage of ['queued', 'metadata', 'download', 'detect', 'needs_roi', 'frames', 'ocr', 'thumbs', 'done']) expect(stageText(stage), stage).toBeTruthy()
    expect(stageText('detect')).not.toBe(stageText('needs_roi'))
    expect(stageText('nonsense')).toBe('')
  })
})

describe('videoImportError', () => {
  it('has its own sentence for each refusal the API can send, and none of them is the generic one', () => {
    const generic = videoImportError('no-such-code')
    for (const code of ['bad-url', 'busy', 'queue-full', 'daily-limit', 'worker-down', 'too-long', 'unavailable', 'blocked', 'unsupported', 'roi-timeout', 'not-found']) {
      const text = videoImportError(code)
      expect(text, code).toBeTruthy()
      expect(text, code).not.toBe(generic)
    }
  })
  it('tells the reader the daily budget is spent, not that the server is busy', () => {
    expect(videoImportError('daily-limit')).toMatch(/today/i)
    expect(videoImportError('daily-limit')).not.toBe(videoImportError('queue-full'))
  })
  it('falls back to what the server said, then to a generic sentence', () => {
    expect(videoImportError('something-new', 'the server says no')).toBe('the server says no')
    expect(videoImportError('something-new')).toBeTruthy()
  })
})
