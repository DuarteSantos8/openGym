/* RENPHO Health's cloud, as the RENPHO Health app talks to it. RENPHO publishes no API: this is the
 * protocol several independent community clients agree on (renpho-py, renpho-mcp, the
 * RenphoGarminSync CLI it was first worked out in), kept in this one file so a change on RENPHO's
 * side is a change here and nowhere else. Nothing outside api/providers/renpho knows its shapes.
 *
 *   transport  HTTPS POST of JSON {encryptData}: the request body as JSON, AES-128-ECB with PKCS#7
 *              padding under the app's public protocol constant (not a credential), base64. The
 *              answer is {code, msg, data}, `data` encrypted the same way.
 *   headers    every request, the sign-in too, carries the app's own headers: its version, the
 *              platform, the phone, the language, the area, the time zone and a device id (one per
 *              connection, random). Without them RENPHO answers -114 "Decryption failed", or 104
 *              "wrong user name or password" to a right password (October 2026, app 7.10).
 *   login      renpho-aggregation/user/login → {login: {token, id, …}}; later requests carry the
 *              token and the account id as headers too. RENPHO keeps one session per account:
 *              signing in here signs the RENPHO app out of that account.
 *   friends    RenphoHealth/app/friend/friendsList → {list: [{userId, accountName, email}]}, and
 *              RenphoHealth/app/friend/measure/trendV2 {rhFriendId, param, timeType, endTime} →
 *              {list: [{groupDay, timeStamp, value}]}: a friend's last reading of each day, one
 *              value at a time. This is how a second account reads the main one's scale without
 *              signing the app out of it (renpho-friends, the community client it was found in).
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
const APP_VERSION = '7.10.1';
const PLATFORM = 'android';
const PHONE = 'sdk_gphone64_x86_64', SYSTEM = '14';
// The device types the app asks to be bound at sign-in.
const DEVICE_TYPES = ['00001', '00002', '00003', '00006', '00007', '00008', '00009', '00010', '00011', '00012', '00015',
  '00016', '00024', '00025', '00026', '00027', '00029', '00032', '00033', '00034', '00035', '00036', '00051', '00054', '00038',
  '00044', '00046', '00048', '00023', '00042', '00043', '00057', '00045', '00047', '00049', '00050', '00053', '00055', '00059',
  '00052', '00058', '00061', '00062', '00063', '00064', '00065', '00067', '00060', '00070'];
// What a friend's trend is asked for, one call each.
export const FRIEND_PARAMS = ['weight', 'bodyfat', 'water', 'muscle', 'bone', 'visfat', 'bmr', 'bmi'];
const SUCCESS = new Set([0, 101, 200, 20000, '0', '101', '200', '20000']);
const PATHS = {
  login: 'renpho-aggregation/user/login',
  tables: 'renpho-aggregation/device/count',
  composition: 'RenphoHealth/scale/queryBodyCompositionMeasureData',
  all: 'RenphoHealth/scale/queryAllMeasureDataList',
  friends: 'RenphoHealth/app/friend/friendsList',
  trend: 'RenphoHealth/app/friend/measure/trendV2',
};

/** A new connection's device id: 32 hex digits, as the app makes one per installation. */
export const newDeviceId = () => crypto.randomBytes(16).toString('hex').toUpperCase();

/** A zone RENPHO can be told (the app's own Intl name), or UTC. */
export function zoneOf(zone) {
  const z = String(zone || '');
  if (!z || z.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return 'UTC'; }
}
/** The zone's offset from UTC in whole hours at `at`, the way RENPHO groups readings into days. */
export function offsetHours(zone, at = Date.now()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(zone), timeZoneName: 'longOffset' })
      .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '';
    const m = /([+-])(\d{1,2})/.exec(name);
    return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) : 0;
  } catch { return 0; }
}
const signed = n => (n >= 0 ? '+' : '') + n;
const MONTH_S = 30 * 86400;

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

export function createRenphoClient({ fetchFn = fetch, baseUrl = BASE_URL, timeoutMs = 20000, now = Date.now } = {}) {
  // `device` is the connection's {devId, zone, area}; `session` the signed-in {token, userId}.
  async function post(path, body, device = {}, session = null) {
    const zone = zoneOf(device.zone);
    const headers = {
      'Content-Type': 'application/json', TRACE_UUID: '1', language: 'en', languageCode: 'en',
      appVersion: APP_VERSION, platform: PLATFORM, systemVersion: SYSTEM, phone: PHONE,
      area: device.area || 'US', userArea: '', timeZone: signed(offsetHours(zone, now())), zoneId: zone,
      devId: device.devId || newDeviceId(),
    };
    if (session) Object.assign(headers, { token: session.token, userId: String(session.userId) });
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
    // RENPHO says it in `msg`, or since 2026 in `message`.
    const said = env?.msg || env?.message || '';
    const ok = SUCCESS.has(env?.code) || String(said).toLowerCase() === 'success';
    // RENPHO's own words with its code, so a refusal says why (wrong password, too many sign-ins…).
    const why = String(said).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!ok) throw new RenphoError('rejected', `RENPHO refused the request (code ${env?.code ?? '?'}${why ? ': ' + why : ''})`);
    if (env.data == null || env.data === '') return null;
    try { return losslessParse(decrypt(env.data)); } catch { throw new RenphoError('format', 'RENPHO sent data this version cannot read'); }
  }

  /**
   * Signs in; returns the session (token, account id) and a few profile facts, never the rest.
   * `device` as for every request: the connection's device id and zone.
   */
  async function login({ email, password, areaCode = 'US' }, device = {}) {
    let data;
    try {
      data = await post(PATHS.login, {
        questionnaire: {},
        login: { areaCode, email, password, appRevision: APP_VERSION, cellphoneType: PHONE, systemType: SYSTEM, platform: PLATFORM },
        bindingList: { deviceTypes: DEVICE_TYPES },
      }, { ...device, area: areaCode });
    } catch (e) {
      if (e.code === 'rejected') throw new RenphoError('auth', 'RENPHO did not accept the sign-in: ' + e.message.replace(/^RENPHO refused the request /, ''));
      throw e;
    }
    const l = data?.login;
    if (!l || !l.token || l.id == null) throw new RenphoError('auth', 'RENPHO did not accept this e-mail and password');
    return { token: String(l.token), userId: String(l.id), weightUnit: l.weightUnit ?? null };
  }

  /** The signed-in account's RENPHO friends: whose readings it may see. */
  async function friends(device, session) {
    const data = await post(PATHS.friends, { userId: String(session.userId), pageNum: 1, pageSize: 50 }, device, session);
    return records(data).filter(f => f && f.userId != null)
      .map(f => ({ userId: String(f.userId), name: String(f.accountName || ''), email: String(f.email || '') }));
  }

  /**
   * A friend's daily values of one `param` (FRIEND_PARAMS): windows of about a month ending at
   * `endTime` (seconds, 0 for now), moved back until one comes empty, one reaches past `since`
   * (ms) or `maxPages` have come. Each point is {day, ts (seconds), value}.
   */
  async function trend(device, session, friendId, param, { since = 0, maxPages = 36 } = {}) {
    const out = [];
    let endTime = 0, empty = 0;
    for (let page = 0; page < maxPages; page++) {
      const data = await post(PATHS.trend, {
        rhFriendId: String(friendId), timeZone: offsetHours(device.zone, now()), param,
        sourceDataType: '', timeType: 'MONTH', endTime,
      }, device, session);
      const pts = records(data).map(p => ({ day: String(p.groupDay || ''), ts: Number(p.timeStamp), value: Number(p.value) }))
        .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.day) && Number.isFinite(p.ts) && p.ts > 0);
      const real = pts.filter(p => Number.isFinite(p.value) && p.value > 0);
      out.push(...real);
      const end = endTime || Math.floor(now() / 1000);
      // A month without a weigh-in is a holiday, not the start: the window moves a month back,
      // and six empty ones in a row (half a year) are the end of the history.
      if (!real.length) {
        if (++empty >= 6 || (since && (end - MONTH_S) * 1000 < since)) break;
        endTime = end - MONTH_S;
        continue;
      }
      empty = 0;
      const oldest = Math.min(...real.map(p => p.ts));
      if (endTime && oldest > endTime) break;   // the window did not move back: nothing older
      if (since && oldest * 1000 < since) break;
      endTime = oldest - 1;
    }
    return out;
  }

  /** The tables the account's scale readings are in. */
  async function tables(device, session) {
    const data = await post(PATHS.tables, undefined, device, session);
    const list = Array.isArray(data?.scale) ? data.scale : [];
    return list.filter(x => x && typeof x.tableName === 'string' && x.tableName)
      .map(x => ({ tableName: x.tableName, count: Number(x.count) || 0, userIds: (Array.isArray(x.userIds) ? x.userIds : []).map(String) }));
  }

  /**
   * Every reading of `userId` in `table`, newest pages first as RENPHO serves them, at most
   * `maxPages` pages. `complete` false when the cap stopped it.
   */
  async function readings(device, session, table, userId, { pageSize = 50, maxPages = 100 } = {}) {
    const out = [];
    let complete = true;
    for (const path of [PATHS.composition, PATHS.all]) {
      for (let page = 1; ; page++) {
        if (page > maxPages) { complete = false; break; }
        const rows = records(await post(path, { pageNum: page, pageSize, userIds: [String(userId)], tableName: table.tableName }, device, session));
        out.push(...rows.filter(r => r && typeof r === 'object'));
        if (rows.length < pageSize) break;
      }
      // The body composition endpoint is the one for impedance scales; a weight-only scale's
      // readings are in the other.
      if (out.length || !table.count) break;
    }
    return { rows: out, complete };
  }

  return { login, tables, readings, friends, trend };
}
