/* Where this server may connect out to. Moved out of server.js (v1.4.4) so the push sender and
   the integrations (integrations/, the outbound webhooks) judge an address by the same rules.
   The reasoning for push lives next to its sender in server.js; the rules themselves are here. */
import dns from 'node:dns';
import net from 'node:net';

export function parseAllowedPrivateIps(raw) {
  const list = new net.BlockList();
  for (const entry of String(raw || '').split(/[\s,]+/).filter(Boolean)) {
    const [from, to] = entry.split('-');
    const [addr, prefix] = entry.split('/');
    const family = net.isIPv6(addr) || net.isIPv6(from) ? 'ipv6' : 'ipv4';
    try {
      if (to !== undefined) list.addRange(from, to, family);
      else if (prefix !== undefined && /^\d{1,3}$/.test(prefix)) list.addSubnet(addr, +prefix, family);
      else if (net.isIP(entry)) list.addAddress(entry, family);
      else throw new Error('not an address, range or CIDR block');
    } catch {
      console.warn(`ALLOWED_PRIVATE_IPS entry "${entry.slice(0, 60)}" is not a valid address, range or CIDR block — ignored`);
    }
  }
  return list;
}
const ALLOWED_PRIVATE_IPS = parseAllowedPrivateIps(process.env.ALLOWED_PRIVATE_IPS);

export function isAllowedPrivateAddr(v) {
  const family = net.isIPv6(v) ? 'ipv6' : net.isIPv4(v) ? 'ipv4' : null;
  return family !== null && ALLOWED_PRIVATE_IPS.check(v.replace(/%.*$/, ''), family);
}

export function isPrivateAddr(ip) {
  const v = String(ip).toLowerCase();
  if (isAllowedPrivateAddr(v)) return false;
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    if (a === 0 || a === 10 || a === 127) return true;            // this-network, private, loopback
    if (a === 169 && b === 254) return true;                      // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;             // private
    if (a === 192 && b === 168) return true;                      // private
    if (a === 192 && b === 0) return true;                        // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true;         // benchmarking 198.18.0.0/15
    if (a >= 224) return true;                                    // multicast + reserved
    return false;
  }
  // IPv6 is judged on its eight groups, never on the text: the same address arrives as
  // `::ffff:127.0.0.1` from dns.lookup, as `::ffff:7f00:1` from new URL, and in whatever
  // spelling a caller chose, and a rule keyed to one spelling misses the others.
  const g = ipv6Groups(v);
  if (!g) return false;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {     // IPv4-mapped IPv6
    return isPrivateAddr(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g.slice(0, 7).every(x => x === 0) && g[7] <= 1) return true; // unspecified, loopback
  if ((g[0] & 0xffc0) === 0xfe80) return true;                    // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true;                    // site-local fec0::/10 (deprecated, still routed by some)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                    // unique local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return true;                    // multicast ff00::/8
  // The forms that carry an IPv4 address inside: on a host with NAT64 or a 6to4 relay they reach
  // that IPv4 address, so they are judged by it. 64:ff9b:1::/48 is the local-use NAT64 prefix,
  // which only ever translates into a network of the operator's own.
  const v4 = (hi, lo) => isPrivateAddr(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 6).every(x => x === 0)) return v4(g[6], g[7]);          // IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return v4(g[6], g[7]); // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;       // local-use NAT64 64:ff9b:1::/48
  if (g[0] === 0x2002) return v4(g[1], g[2]);                            // 6to4 2002::/16
  return false;
}

// The eight 16-bit groups of an IPv6 literal in any textual form — compressed, zero-padded,
// upper-case, with a dotted IPv4 tail — or null when the string is not one.
export function ipv6Groups(v) {
  if (!net.isIPv6(v)) return null;
  let s = v.replace(/%.*$/, '');                                  // zone id
  const m4 = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m4) {
    const [a, b, c, d] = m4[1].split('.').map(Number);
    s = s.slice(0, -m4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail = ''] = s.split('::');
  const groups = head ? head.split(':') : [];
  const rest = tail ? tail.split(':') : [];
  if (s.includes('::')) while (groups.length + rest.length < 8) groups.push('0');
  return groups.concat(rest).map(x => parseInt(x, 16));
}

export function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddr(a.address))) {
      return cb(Object.assign(new Error('refusing to connect to a private address: ' + hostname), { code: 'EPUSHBLOCKED' }));
    }
    cb(null, address, family);
  });
}

// Cheap pre-check so a bad endpoint is refused at subscribe time with a useful message, rather
// than silently never delivering. For a hostname PUSH_AGENT is what actually enforces the address
// rule; for a literal address this is the check, which is why sendPush runs it again.
export function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  // A literal address is judged right here — and only here: Node hands a literal straight to
  // connect() without consulting the Agent's lookup. Hostnames are left to PUSH_AGENT, which is
  // the check that has to hold against rebinding.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

/* ---------- outbound integrations (integrations/, v1.4.4) ----------
   A webhook URL is chosen by whoever is signed in, exactly like a push endpoint, so it gets the
   same rules: https only, and never a private, loopback or link-local address, judged in the
   lookup the request itself uses (DNS rebinding) and, for a literal address, before every send.

   One door the push sender does not have: Home Assistant, Node-RED and n8n usually live on the
   same home network as openGym. INTEGRATIONS_ALLOW_LAN=1 opens exactly that, a home network's
   addresses (below) and plain http:// to them, never anything else: loopback, link-local (cloud
   metadata sits at 169.254.169.254), multicast and the reserved blocks stay shut whatever the
   setting. Plain http:// is only ever allowed towards such an address, so a webhook cannot send
   a workout unencrypted across the internet. ALLOWED_PRIVATE_IPS (push) counts here too. */

// A home network: the RFC 1918 blocks, CGNAT (100.64.0.0/10, where Tailscale and friends hand
// out addresses) and IPv6 unique local (fc00::/7), the IPv4-mapped forms included.
export function isLanAddr(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const g = ipv6Groups(v);
  if (!g) return false;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isLanAddr(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  return (g[0] & 0xfe00) === 0xfc00;
}

/** Whether an outbound integration may open a connection to this address. */
export function outboundAddrOk(ip, { allowLan = false, plain = false } = {}) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  // Plain http:// only ever towards the home network (or an address the admin listed).
  if (plain) return allowLan && (isLanAddr(v) || isAllowedPrivateAddr(v));
  if (!isPrivateAddr(v)) return true;
  return allowLan && isLanAddr(v);
}

/** A dns.lookup-shaped function for an http(s).Agent that enforces outboundAddrOk on every address. */
export function outboundLookup(opts = {}) {
  return (hostname, options, cb) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return cb(err);
      const list = Array.isArray(address) ? address : [{ address, family }];
      if (!list.length || list.some(a => !outboundAddrOk(a.address, opts))) {
        return cb(Object.assign(new Error('refusing to connect to that address: ' + hostname), { code: 'EBLOCKED' }));
      }
      cb(null, address, family);
    });
  };
}

export const MAX_URL_LENGTH = 2048;

/** Why a webhook URL is refused, or null. Run when it is added and again before every send. */
export function outboundUrlError(raw, { allowLan = false } = {}) {
  const s = String(raw || '').trim();
  if (!s) return 'url required';
  if (s.length > MAX_URL_LENGTH) return 'url is too long';
  let u;
  try { u = new URL(s); } catch { return 'url is not valid'; }
  const plain = u.protocol === 'http:';
  if (u.protocol !== 'https:' && !(plain && allowLan)) return allowLan ? 'url must start with https:// or http://' : 'url must start with https://';
  if (u.username || u.password) return 'url must not carry a user name or password';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) return 'url is not valid';
  if (/^localhost$|\.localhost$/i.test(host)) return 'url must not point at this server';
  // A literal address never reaches the Agent's lookup (Node connects to it directly), so it is
  // judged here, and the caller runs this again right before each send.
  if (net.isIP(host) || /^[0-9.]+$/.test(host)) {
    if (!net.isIP(host)) return 'url is not valid';
    if (!outboundAddrOk(host, { allowLan, plain })) {
      return allowLan ? 'url points at an address openGym never calls' : 'url points at a private address (your admin can allow the home network)';
    }
  }
  return null;
}
