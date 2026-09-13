import crypto from 'node:crypto';
import { socialProfile, socialSummary } from './summary.js';
import { sharedPlan } from './plan.js';

export function socialRoutes({ json, readBody, readSession, users, readState, load, save, userNow }) {
  const person = id => users().find(u => u.id === id && !u.disabled);
  const publicUser = (u, includeAvatar = false) => ({
    id: u.id, name: u.name, ...(includeAvatar && u.avatar ? { avatar: u.avatar } : {})
  });
  const between = (link, a, b) => (link.from === a && link.to === b) || (link.from === b && link.to === a);
  const blocked = (data, a, b) => (data.blocks || []).some(c => between(c, a, b));
  const friends = (data, a, b) => !!person(b) && !blocked(data, a, b)
    && data.connections.some(c => c.status === 'accepted' && between(c, a, b));
  const auth = (req, res) => {
    const user = readSession(req);
    if (!user) json(res, 401, { error: 'not signed in' });
    return user;
  };
  return {
    'GET /api/social': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const data = load();
      const incoming = [], outgoing = [], connected = [];
      for (const link of data.connections) {
        if (link.from !== user.id && link.to !== user.id) continue;
        const other = person(link.from === user.id ? link.to : link.from);
        if (!other || blocked(data, user.id, other.id)) continue;
        if (link.status === 'accepted') {
          const state = readState(other.id);
          const date = userNow(state?.reminder?.tz || 'UTC')?.date || new Date().toISOString().slice(0, 10);
          connected.push({ ...publicUser(other, true), ...socialSummary(state, date) });
        } else (link.to === user.id ? incoming : outgoing).push(publicUser(other));
      }
      connected.sort((a, b) => a.name.localeCompare(b.name));
      const suggestions = users().filter(u => u.id !== user.id && !u.disabled
        && !blocked(data, user.id, u.id)
        && !data.connections.some(c => between(c, user.id, u.id)))
        .map(u => publicUser(u)).sort((a, b) => a.name.localeCompare(b.name));
      const plans = data.plans.filter(p => p.to === user.id && friends(data, user.id, p.from)).map(p => ({
        id: p.id, from: publicUser(person(p.from), true), name: p.plan.name || '', created: p.created,
        routines: p.plan.routines.length
      }));
      const blocks = (data.blocks || []).filter(c => c.from === user.id && person(c.to))
        .map(c => publicUser(person(c.to)));
      json(res, 200, { friends: connected, incoming, outgoing, suggestions, plans, blocks });
    },
    'GET /api/social/counts': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const data = load();
      const incoming = data.connections.filter(c => c.to === user.id && c.status === 'pending'
        && person(c.from) && !blocked(data, user.id, c.from)).length;
      const plans = data.plans.filter(p => p.to === user.id && friends(data, user.id, p.from)).length;
      json(res, 200, { incoming, plans, total: incoming + plans });
    },
    'GET /api/social/profile': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const data = load();
      const other = person(id);
      if (!other || !friends(data, user.id, id)) return json(res, 404, { error: 'Friend profile not found' });
      const state = readState(other.id);
      const date = userNow(state?.reminder?.tz || 'UTC')?.date || new Date().toISOString().slice(0, 10);
      json(res, 200, { ...publicUser(other, true),
        ...socialProfile(state, date, { shareBodyWeight: other.shareBodyWeight !== false }) });
    },
    'POST /api/social/request': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const other = person(body?.userId);
      if (!other) return json(res, 404, { error: 'User not found on this server' });
      if (other.id === user.id) return json(res, 400, { error: 'You cannot add your own profile' });
      const data = load();
      if (blocked(data, user.id, other.id)) return json(res, 403, { error: 'This connection is unavailable' });
      const existing = data.connections.find(c => between(c, user.id, other.id));
      if (existing) return json(res, 409, { error: existing.status === 'accepted' ? 'You are already friends'
        : existing.to === user.id ? 'This person already sent you a request. Accept it below.' : 'A friend request is already pending' });
      if ([user.id, other.id].some(id => data.connections.filter(c => c.from === id || c.to === id).length >= 100)) {
        return json(res, 409, { error: 'The friend limit has been reached. Remove an unused connection first.' });
      }
      data.connections.push({ from: user.id, to: other.id, status: 'pending' });
      save(data);
      json(res, 200, { ok: true });
    },
    'POST /api/social/accept': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const data = load();
      const link = data.connections.find(c => c.to === user.id && c.from === body?.userId && c.status === 'pending');
      if (!link || !person(link.from) || blocked(data, user.id, link.from)) return json(res, 404, { error: 'Friend request not found' });
      link.status = 'accepted';
      save(data);
      json(res, 200, { ok: true });
    },
    'POST /api/social/remove': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const data = load();
      data.connections = data.connections.filter(c => !between(c, user.id, body?.userId));
      data.plans = data.plans.filter(p => !between(p, user.id, body?.userId));
      save(data);
      json(res, 200, { ok: true });
    },
    'POST /api/social/block': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const other = person(body?.userId);
      if (!other || other.id === user.id) return json(res, 400, { error: 'Invalid profile' });
      const data = load();
      data.blocks ||= [];
      if (!data.blocks.some(c => c.from === user.id && c.to === other.id)) {
        data.blocks.push({ from: user.id, to: other.id });
      }
      data.connections = data.connections.filter(c => !between(c, user.id, other.id));
      data.plans = data.plans.filter(p => !between(p, user.id, other.id));
      save(data);
      json(res, 200, { ok: true });
    },
    'POST /api/social/unblock': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const data = load();
      data.blocks = (data.blocks || []).filter(c => !(c.from === user.id && c.to === body?.userId));
      save(data);
      json(res, 200, { ok: true });
    },
    'POST /api/social/plan': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const data = load();
      if (!friends(data, user.id, body?.userId)) return json(res, 403, { error: 'Accept a friend request before sharing plans' });
      let plan;
      try { plan = sharedPlan(body?.plan, { includeNotes: body?.includeNotes === true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
      // One pending snapshot per direction keeps the inbox bounded and lets a sender update it
      data.plans = data.plans.filter(p => p.from !== user.id || p.to !== body.userId);
      data.plans.unshift({ id: crypto.randomUUID(), from: user.id, to: body.userId, created: new Date().toISOString(), plan });
      save(data);
      json(res, 200, { ok: true });
    },
    'GET /api/social/plan': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const data = load();
      const item = data.plans.find(p => p.id === id && p.to === user.id && friends(data, user.id, p.from));
      if (!item) return json(res, 404, { error: 'Shared plan not found' });
      json(res, 200, { plan: item.plan });
    },
    'POST /api/social/plan/dismiss': async (req, res) => {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req);
      const data = load();
      data.plans = data.plans.filter(p => !(p.id === body?.id && p.to === user.id));
      save(data);
      json(res, 200, { ok: true });
    }
  };
}
