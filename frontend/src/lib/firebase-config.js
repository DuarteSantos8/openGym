// Firebase mode (Phase 2): cross-device sync through Firestore + passkey sign-in.
//
// The gate is a build-time env pair: VITE_FIREBASE=1 turns the mode on, and the VITE_FB_*
// values say which Firebase project to talk to. With either missing the app behaves exactly
// as the local demo build always has, nothing in this file (or in firestore-sync.js, which
// is only ever imported dynamically when `firebaseEnabled`) reaches the Firebase SDK.
//
// The web config values are not secrets: they identify the project, and Firestore security
// rules (firestore.rules, repo root) are what actually guard the data.
const env = import.meta.env || {}

export const FIREBASE_MODE = env.VITE_FIREBASE === '1'

export const firebaseConfig = {
  apiKey: env.VITE_FB_API_KEY || '',
  authDomain: env.VITE_FB_AUTH_DOMAIN || '',
  projectId: env.VITE_FB_PROJECT_ID || '',
  storageBucket: env.VITE_FB_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FB_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FB_APP_ID || '',
}

export const firebaseEnabled = FIREBASE_MODE
  && !!firebaseConfig.apiKey && !!firebaseConfig.projectId && !!firebaseConfig.appId
