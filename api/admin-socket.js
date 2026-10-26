/* The server's local admin socket (#584): how `node recover.js <name>` asks the running server for
 * a recovery code.
 *
 * Why a socket and not the file: the server keeps db.json in memory and writes all of it on every
 * change (saveDb). A second process editing db.json while the server runs would be overwritten by
 * the next save, or overwrite one the server just made. So the command never touches the data: it
 * asks the server, which makes the code through the same code path an admin's request takes, in
 * its own memory, and saves and audits it like any other change.
 *
 * Who may ask: whoever can open the socket. It is a Unix socket in a directory only this process's
 * user can enter (0700, checked: ours, not a symlink, nobody else's bits), the socket itself 0600.
 * In the Docker image that is root, which is who `docker compose exec api` runs as; the Coach's
 * jobs run as their own unprivileged user and cannot reach it, any more than they can read /data.
 * Being able to reach it is being able to read db.json anyway. Nothing listens on the network.
 *
 * The path is derived from the data directory, so two instances on one machine do not meet, and
 * recover.js finds it from the same environment the server has (DATA_DIR, or ADMIN_SOCKET_DIR).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_LINE = 4096;

/** The directory the socket lives in: ADMIN_SOCKET_DIR, else a per-user, per-data-dir one in the temp dir. */
export function socketDir(env = process.env) {
  if (env.ADMIN_SOCKET_DIR) return env.ADMIN_SOCKET_DIR;
  const data = path.resolve(env.DATA_DIR || '/data');
  const tag = crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  return path.join(os.tmpdir(), `opengym-admin-${uid}-${tag}`);
}
export const socketPath = (env = process.env) => path.join(socketDir(env), 'admin.sock');

/** Creates the directory 0700, or checks the one there is ours and private. Throws when it is not. */
export function privateDir(dir) {
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${dir} is not a directory`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`${dir} belongs to someone else`);
  if ((st.mode & 0o077) !== 0) throw new Error(`${dir} is open to others (mode ${(st.mode & 0o777).toString(8)})`);
  return dir;
}

/**
 * Listens on the socket. `handle(msg)` answers one request ({ cmd, ... }) with a plain object; each
 * connection carries one JSON line in and one out. Returns the server, or null when there is no
 * safe place for it (logged; the instance runs without the command then).
 */
export function startAdminSocket({ env = process.env, handle, log = console }) {
  if (process.platform === 'win32') return null;
  let file;
  try {
    privateDir(socketDir(env));
    file = socketPath(env);
    // A socket left by the previous process; only ever one of ours, in our private directory.
    try { if (fs.lstatSync(file).isSocket()) fs.unlinkSync(file); } catch { /* none */ }
  } catch (e) {
    log.error('admin socket: not started,', e.message);
    return null;
  }
  const server = net.createServer(conn => {
    let buf = '';
    conn.setTimeout(5000, () => conn.destroy());
    conn.on('error', () => {});
    conn.on('data', async chunk => {
      buf += chunk;
      if (buf.length > MAX_LINE) { conn.end(JSON.stringify({ error: 'request too long' }) + '\n'); return }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let out;
      try { out = await handle(JSON.parse(buf.slice(0, nl))); }
      catch (e) { out = { error: e instanceof SyntaxError ? 'not JSON' : 'server error' }; if (!(e instanceof SyntaxError)) log.error('admin socket:', e); }
      conn.end(JSON.stringify(out) + '\n');
    });
  });
  server.on('error', e => log.error('admin socket:', e.message));
  const old = process.umask(0o177);
  try { server.listen(file, () => { try { fs.chmodSync(file, 0o600); } catch { /* the umask already did */ } }); }
  finally { process.umask(old); }
  server.unref();
  return server;
}

/** One request to the running server: resolves with its answer. For recover.js. */
export function askAdminSocket(msg, { env = process.env, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath(env));
    let buf = '';
    const timer = setTimeout(() => { conn.destroy(); reject(Object.assign(new Error('no answer'), { code: 'ETIMEDOUT' })) }, timeoutMs);
    conn.on('connect', () => conn.write(JSON.stringify(msg) + '\n'));
    conn.on('data', d => { buf += d });
    conn.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(buf)) } catch { reject(new Error('the server sent something unexpected')) }
    });
    conn.on('error', e => { clearTimeout(timer); reject(e) });
  });
}
