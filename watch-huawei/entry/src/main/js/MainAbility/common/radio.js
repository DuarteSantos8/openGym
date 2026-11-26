// What core.js calls env.radio: messages out as frames over Huawei's P2P client, frames in as
// messages. The client is passed in (wearengine.js's P2pClient on the watch, a fake in the tests);
// `build(text)` makes Huawei's Message for one frame (Builder.setDescription, see the page).
import { frames, createReceiver } from './frames.js'

const ID_RANGE = 2176782336 // 36^6: an id is at most six base-36 characters
const SENT = 207 // Wear Engine's "send succeeded"; 206 is "send failed"
// Each transmit takes the next turn; a frame chain of an older turn stops. One count for every radio: a page that
// replaces another makes its own radio, and the old page's chain must not go on between the new one's frames.
let turn = 0

export function createRadio (client, build, seed) {
  let rx = createReceiver()
  let counter = seed % ID_RANGE

  // One frame out; done(true|false) once. wearengine.js calls onSuccess then onSendResult (or
  // onFailure then onSendResult), and throws nothing, but its callbacks all get called unchecked,
  // so every one is defined.
  function sendFrame (text, done) {
    let settled = false
    const end = ok => { if (!settled) { settled = true; done(ok) } }
    try {
      client.send(build(text), {
        onSuccess: () => end(true),
        onFailure: () => end(false),
        onSendResult: r => end(!!r && r.code === SENT),
        onSendProgress: () => {}
      })
    } catch (e) { end(false) }
  }

  return {
    // message = a plain object; onComplete once every frame reported success, onError at the first
    // failure (nothing half-sent is repaired: the next hello or snapshot sends the latest whole).
    transmit: function (message, listener) {
      turn += 1
      const mine = turn
      counter = (counter + 1) % ID_RANGE
      const fs = frames(JSON.stringify(message), counter.toString(36))
      if (!fs) { listener.onError(); return }
      const step = i => {
        if (mine !== turn) return
        if (i >= fs.length) { listener.onComplete(); return }
        sendFrame(fs[i], ok => { if (ok) step(i + 1); else if (mine === turn) listener.onError() })
      }
      step(0)
    },
    // onMessage(object) for each whole message from the phone; onState(true|false) when the receiver
    // registered or failed to (it needs the phone's package name and fingerprint).
    listen: function (onMessage, onState) {
      const receiver = {
        onSuccess: () => onState(true),
        onFailure: () => onState(false),
        onReceiveMessage: data => {
          if (typeof data !== 'string') return // a file
          onState(true) // a frame arrived, so the receiver is registered whatever its own callback did
          const text = rx.accept(data)
          if (text === null) return
          let obj = null
          try { obj = JSON.parse(text) } catch (e) { return }
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) onMessage(obj)
        }
      }
      try { client.registerReceiver(receiver) } catch (e) { onState(false) }
    },
    // true while a multi-frame message is being gathered: a receiver registered again now would lose frames
    gathering: function () { return rx.busy() },
    stop: function () {
      const receiver = { onSuccess: () => {} } // wearengine.js calls it unconditionally
      try { client.unregisterReceiver(receiver) } catch (e) { /* already gone */ }
      // what was gathered is of the subscription that ended: a part kept would hold `gathering` true when the next one fails
      rx = createReceiver()
    }
  }
}
