/* RENPHO Health's cloud, as the RENPHO Health app talks to it. RENPHO publishes no API: this is the
 * protocol several independent community clients agree on (renpho-py, renpho-mcp, the
 * RenphoGarminSync CLI it was first worked out in), kept in this one file so a change on RENPHO's
 * side is a change here and nowhere else. Nothing outside api/providers/renpho knows its shapes.
 *
 *   transport  HTTPS POST of JSON {encryptData}: the request body as JSON, AES-128-ECB with PKCS#7
 *              padding under the app's public protocol constant (not a credential), base64. The
 *              answer is {code, msg, data}, `data` encrypted the same way.
 *   login      renpho-aggregation/user/login → {login: {token, id, …}}; later requests carry the
 *              token, the account id, the app version and the platform as headers.
 *   discovery  renpho-aggregation/device/count (an empty body) → {scale: [{tableName, count,
 *              userIds}]}: the tables the account's scale readings are kept in.
 *   readings   RenphoHealth/scale/queryBodyCompositionMeasureData (impedance scales), falling back
 *              to RenphoHealth/scale/queryAllMeasureDataList, paged {pageNum, pageSize, userIds,
 *              tableName} → an array of readings (or {list|data|records: […]}).
 *
 * RENPHO's ids are integers past 2^53, so the decrypted JSON is read with every long integer kept
 * as a string (losslessParse). Errors carry a `code`: 'auth' (RENPHO refused the sign-in),
 * 'rejected' (a request refused, the session may have expired), 'network', 'format' (an answer
 * that is not what this file expects: RENPHO may have changed something). Messages never contain
 * the password, the token or RENPHO's answer.
 */
import crypto from 'node:crypto';

export const BASE_URL = 'https://cloud.renpho.com';
const KEY = Buffer.from('ed*wijdi$h6fe3ew', 'utf8');   // the app's protocol constant, public
const APP_VERSION = '6.6.0';
const PLATFORM = 'android';
// The scale device types the app asks to be bound at sign-in.
const SCALE_TYPES = Array.from({ length: 20 }, (_, i) => (i + 1).toString(16).toUpperCase().padStart(2, '0'));
const SUCCESS = new Set([0, 101, 200, 20000, '0', '101', '200', '20000']);
const PATHS = {
  login: 'renpho-aggregation/user/login',
  tables: 'renpho-aggregation/device/count',
  composition: 'RenphoHealth/scale/queryBodyCompositionMeasureData',
  all: 'RenphoHealth/scale/queryAllMeasureDataList',
};

export class RenphoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function encrypt(text) {
  const c = crypto.createCipheriv('aes-128-ecb', KEY, null);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}
export function decrypt(b64) {
  const d = crypto.createDecipheriv('aes-128-ecb', KEY, null);
  return Buffer.concat([d.update(String(b64), 'base64'), d.final()]).toString('utf8');
}

/**
 * JSON.parse, with every integer literal of 16 digits or more turned into a string first, outside
 * strings only: a RENPHO id is past what a double holds, and two readings must never share one.
 */
export function losslessParse(text) {
  let out = '', i = 0;
  const s = String(text);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1); i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < s.length && /[0-9.eE+-]/.test(s[j])) j++;
      const num = s.slice(i, j);
      out += /^-?\d{16,}$/.test(num) ? '"' + num + '"' : num;
      i = j;
    } else { out += ch; i++; }
  }
  return JSON.parse(out);
}

const records = page => {
  if (Array.isArray(page)) return page;
  if (page && typeof page === 'object') {
    for (const k of ['list', 'data', 'records', 'measurements']) if (Array.isArray(page[k])) return page[k];
  }
  return [];
};

export function createRenphoClient({ fetchFn = fetch, baseUrl = BASE_URL, timeoutMs = 20000 } = {}) {
  async function post(path, body, session) {
    const headers = { 'Content-Type': 'application/json' };
    if (session) Object.assign(headers, { token: session.token, userId: String(session.userId), appVersion: APP_VERSION, platform: PLATFORM });
    // Some endpoints take an empty body (no JSON at all), encrypted all the same.
    const plain = body === undefined ? '' : JSON.stringify(body);
    let res, text;
    try {
      res = await fetchFn(`${baseUrl}/${path}`, {
        method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ encryptData: encrypt(plain) }),
      });
      text = await res.text();
    } catch {
      throw new RenphoError('network', 'RENPHO could not be reached');
    }
    if (res.status === 401 || res.status === 403) throw new RenphoError('rejected', `RENPHO refused the request (HTTP ${res.status})`);
    if (!res.ok) throw new RenphoError('network', `RENPHO answered HTTP ${res.status}`);
    let env;
    try { env = JSON.parse(text); } catch { throw new RenphoError('format', 'RENPHO answered with something other than JSON'); }
    const ok = SUCCESS.has(env?.code) || String(env?.msg || '').toLowerCase() === 'success';
    // RENPHO's own words with its code, so a refusal says why (wrong password, too many sign-ins…).
    const why = String(env?.msg ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!ok) throw new RenphoError('rejected', `RENPHO refused the request (code ${env?.code ?? '?'}${why ? ': ' + why : ''})`);
    if (env.data == null || env.data === '') return null;
    try { return losslessParse(decrypt(env.data)); } catch { throw new RenphoError('format', 'RENPHO sent data this version cannot read'); }
  }

  /** Signs in; returns the session (token, account id) and a few profile facts, never the rest. */
  async function login({ email, password, areaCode = 'US' }) {
    let data;
    try {
      data = await post(PATHS.login, {
        questionnaire: {},
        login: { password, areaCode, appRevision: APP_VERSION, cellphoneType: 'openGym', systemType: '11', email, platform: PLATFORM },
        bindingList: { deviceTypes: SCALE_TYPES },
      });
    } catch (e) {
      if (e.code === 'rejected') throw new RenphoError('auth', 'RENPHO did not accept the sign-in: ' + e.message.replace(/^RENPHO refused the request /, ''));
      throw e;
    }
    const l = data?.login;
    if (!l || !l.token || l.id == null) throw new RenphoError('auth', 'RENPHO did not accept this e-mail and password');
    return { token: String(l.token), userId: String(l.id), weightUnit: l.weightUnit ?? null };
  }

  /** The tables the account's scale readings are in. */
  async function tables(session) {
    const data = await post(PATHS.tables, undefined, session);
    const list = Array.isArray(data?.scale) ? data.scale : [];
    return list.filter(x => x && typeof x.tableName === 'string' && x.tableName)
      .map(x => ({ tableName: x.tableName, count: Number(x.count) || 0, userIds: (Array.isArray(x.userIds) ? x.userIds : []).map(String) }));
  }

  /**
   * Every reading of `userId` in `table`, newest pages first as RENPHO serves them, at most
   * `maxPages` pages. `complete` false when the cap stopped it.
   */
  async function readings(session, table, userId, { pageSize = 50, maxPages = 100 } = {}) {
    const out = [];
    let complete = true;
    for (const path of [PATHS.composition, PATHS.all]) {
      for (let page = 1; ; page++) {
        if (page > maxPages) { complete = false; break; }
        const rows = records(await post(path, { pageNum: page, pageSize, userIds: [String(userId)], tableName: table.tableName }, session));
        out.push(...rows.filter(r => r && typeof r === 'object'));
        if (rows.length < pageSize) break;
      }
      // The body composition endpoint is the one for impedance scales; a weight-only scale's
      // readings are in the other.
      if (out.length || !table.count) break;
    }
    return { rows: out, complete };
  }

  return { login, tables, readings };
}
