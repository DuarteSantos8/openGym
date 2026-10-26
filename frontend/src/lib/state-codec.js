// The profile as stored on the device: the compact form of api/migration/profile-pack.js. In memory
// it is always the canonical shape; only what is written to localStorage or the native file is packed.
import { packProfile, unpackProfile } from '../../../api/migration/profile-pack.js'
export const stringifyState = S => JSON.stringify(packProfile(S))
export const parseState = raw => unpackProfile(JSON.parse(raw))
