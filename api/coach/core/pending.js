/* The pending slot: one proposal per profile, waiting for a decision. Shared by the server's job
   queue, the phone's own Coach and the demo, so all three hand back the same thing. Kept apart
   from validate.js so the demo can use it without loading the exercise library. */

/* An answer to a question holds the pending slot only for as long as it takes to read it. A
   question is often about the suggestion on screen ("why one set less?"), so the proposal still
   waiting for a decision rides along on the answer (`prev`) and comes back once it is read.
   Never an older answer, and never one that has run out meanwhile. */
export function waitingProposal(p, now = Date.now()) {
  if (!p) return null;
  if (p.kind === 'ask') return waitingProposal(p.prev, now);
  return p.expiresAt && p.expiresAt < now ? null : p;
}
