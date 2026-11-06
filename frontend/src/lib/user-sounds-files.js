// Brings the files of the sounds of one's own (lib/user-sounds.js) onto this device: each one the
// media store does not have yet is fetched from the server (lib/media-sync.js fetchToStore, which
// checks it against its hash and type). Quiet on failure: no server, offline, a guest; the timer
// plays the chime for a sound whose file is not here.
import { soundsOf } from './user-sounds.js'
import { allVoiceClips } from './voice-clips.js'
import { mediaStore } from './media-store.js'
import { fetchToStore } from './media-sync.js'

export async function ensureSoundFiles(S, { store = mediaStore, fetch = fetchToStore } = {}) {
  const got = []
  // The voice clips (lib/voice-clips.js) too: they are sounds of one's own, for the spoken cues.
  for (const e of [...soundsOf(S), ...allVoiceClips(S)]) {
    try {
      if (await store.has(e.m.hash)) continue
      await fetch(e.m.hash, { mime: e.m.mime, size: e.m.size })
      got.push(e.m.hash)
    } catch { /* not now */ }
  }
  return got
}
