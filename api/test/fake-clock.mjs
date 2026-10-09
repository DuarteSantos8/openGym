/* A clock the test drives, for a server.js spawned in a child. Load it ahead of the server with
 * `node --import ./test/fake-clock.mjs server.js` and an 'ipc' entry in stdio.
 *
 * Date.now() is the real clock until the parent sends { now: <ms> }; from then on it returns that
 * value and stands still until the next one. Every message is answered with { now } once it has
 * taken effect, so a request the test sends after the answer is served at the new time. Only
 * Date.now() moves: timers keep real time, so nothing fires early or late because of it.
 */
const realNow = Date.now;
let fixed = null;
Date.now = () => (fixed === null ? realNow() : fixed);
process.on('message', m => {
  if (!m || typeof m.now !== 'number') return;
  fixed = m.now;
  process.send({ now: fixed });
});
