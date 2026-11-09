import { describe, expect, test } from 'vitest'
import { voiceClipsOf, addVoiceClip, removeVoiceClip, pickClip, allVoiceClips, CLIPS_PER_MOMENT } from './voice-clips.js'
import { soundsOf, addSound } from './user-sounds.js'
import { ownItems } from './shared-items.js'

const m = c => ({ kind: 'audio', hash: c.repeat(64), mime: 'audio/wav', size: 1000, width: 1, height: 1, dur: 1.5 })

describe('voice clips', () => {
  test('per moment, at most a few, kept apart from the sounds for a slot', () => {
    const s = {}
    expect(addSound(s, { name: 'Gong', m: m('a') })).toBeTruthy()
    for (let k = 0; k < CLIPS_PER_MOMENT; k++) expect(addVoiceClip(s, 'restOver', { name: 'Mate ' + k, m: m('b') }, 'v' + k)).toBe('v' + k)
    expect(addVoiceClip(s, 'restOver', { name: 'one too many', m: m('c') })).toBeNull()
    expect(addVoiceClip(s, 'kazoo', { name: 'x', m: m('c') })).toBeNull()
    expect(voiceClipsOf(s, 'restOver').map(c => c.id)).toEqual(['v0', 'v1', 'v2'])
    expect(voiceClipsOf(s, 'record')).toEqual([])
    expect(soundsOf(s).map(e => e.name)).toEqual(['Gong'])
    expect(allVoiceClips(s)).toHaveLength(3)
    expect(pickClip(s, 'restOver', () => 0.99).id).toBe('v2')
    expect(pickClip(s, 'tenLeft')).toBeNull()
  })
  test('removing a clip leaves the sounds alone', () => {
    const s = { sounds: [{ id: 'x', name: 'Gong', m: m('a') }, { id: 'v', name: 'Mate', m: m('b'), voice: 'record' }] }
    removeVoiceClip(s, 'x')
    expect(s.sounds).toHaveLength(2)
    removeVoiceClip(s, 'v')
    expect(s.sounds.map(e => e.id)).toEqual(['x'])
  })
  test('a clip that is not audio is not a clip', () => {
    expect(voiceClipsOf({ sounds: [{ id: 'v', m: { ...m('a'), kind: 'image' }, voice: 'record' }] }, 'record')).toEqual([])
  })
  test('never offered to the community library', () => {
    const S = { sounds: [{ id: 'x', name: 'Gong', m: m('a') }, { id: 'v', name: 'My mate', m: m('b'), voice: 'record' }] }
    const items = ownItems(S, 'sound')
    expect(items.map(i => i.title)).toEqual(['Gong'])
  })
})
