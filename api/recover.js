#!/usr/bin/env node
/* A one-time recovery code for a profile that lost every way in (#584), from the server itself:
 * for the owner, who nobody else can help, and for anyone else when there is no admin to ask.
 *
 *   docker compose exec api node recover.js "Their name"
 *   docker compose exec api node recover.js --id <profile id>     when several share the name
 *
 * The person enters the code on the sign-in screen ("Lost access?" → "I have a code", or "Use a
 * code from your other device"); the device they enter it on gets a new passkey for the profile
 * and is signed in. The code works once, for a day; making it signs the profile out everywhere.
 *
 * This asks the running server (admin-socket.js): the server keeps its data in memory and would
 * overwrite any change made to db.json behind its back. Run it where the server runs, as the same
 * user (in the Docker image, `docker compose exec api` does exactly that).
 */
import { askAdminSocket, socketPath } from './admin-socket.js';

const args = process.argv.slice(2);
let id = null;
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id') id = args[++i] || null;
  else if (!args[i].startsWith('-')) words.push(args[i]);
}
const name = words.join(' ').trim();

if ((!name && !id) || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node recover.js "<profile name>"   |   node recover.js --id <profile id>');
  process.exit(name || id ? 0 : 2);
}

try {
  const r = await askAdminSocket({ cmd: 'recover', ...(id ? { id } : { name }) });
  if (r.code) {
    console.log(`Recovery code for "${r.name}" (${r.id}${r.owner ? ', owner' : r.admin ? ', admin' : ''}):\n`);
    console.log(`    ${r.code}\n`);
    console.log(`Valid once, until ${new Date(r.expires).toISOString()}. Every session of the profile has been signed out.`);
    console.log('On the sign-in screen: "Lost access?" -> "I have a code". The device gets a new passkey and is signed in.');
    process.exit(0);
  }
  console.error(r.error || 'the server did not make a code');
  for (const m of r.matches || []) console.error(`  --id ${m.id}   "${m.name}"${m.owner ? ' (owner)' : m.admin ? ' (admin)' : ''}, created ${m.created || 'unknown'}`);
  process.exit(1);
} catch (e) {
  if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
    console.error(`The openGym server is not running here (no ${socketPath()}). Start it first (docker compose up -d), then run this again inside it.`);
  } else {
    console.error('Could not ask the server:', e.message);
  }
  process.exit(1);
}
