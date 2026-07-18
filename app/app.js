'use strict';
/* ============================================================
   GymLog — personal gym & body-weight tracker
   Static SPA, localStorage, exercise data from data.js (EXDB)
   ============================================================ */

/* ---------- data index ---------- */
const EXIDX = {};
EXDB.forEach(e => EXIDX[e.id] = e);
const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort();

/* ---------- state ---------- */
const KEY = 'gym_state_v1';
const DEF = {
  unit: 'kg', restSec: 90, sound: true,
  bodyweight: [],          // {d:'YYYY-MM-DD', w:Number, t:ms}
  routines: [],            // {id, name, emoji, ex:[{id, sets, reps, weight}]}
  week: {},                // weekday(0-6, JS getDay) -> routineId
  dayPlan: {},             // 'YYYY-MM-DD' -> routineId | 'rest' (overrides week plan)
  exWeights: {},           // exId -> {w, d}: confirmed working weight, default next time
  workouts: [],            // finished sessions, chronological
  active: null             // in-progress session
};
let S = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(raw));
  } catch (e) { console.warn('state load failed', e); }
  return JSON.parse(JSON.stringify(DEF));
}
function save(push) {
  S._ts = Date.now();
  localStorage.setItem(KEY, JSON.stringify(S));
  if (push !== false) schedulePush();
}

/* ---------- utils ---------- */
const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const DAYN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
function fmtDate(iso, long) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', long ? {weekday:'short', day:'numeric', month:'short'} : {day:'numeric', month:'short'});
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? Math.floor(m/60) + 'h ' + (m%60) + 'm' : m + ' min';
}
function fmtNum(n) { return (Math.round(n*10)/10).toLocaleString('en-CH'); }
function fmtVol(v) { return v >= 10000 ? fmtNum(v/1000) + 't' : fmtNum(v) + ' ' + S.unit; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} }
let audioCtx = null;
function beep(freq, dur, when) {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = freq || 880; o.type = 'sine';
    const t0 = audioCtx.currentTime + (when || 0);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18));
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05);
  } catch(e){}
}

/* ============================================================
   AUTH (Apple passkeys / WebAuthn) + PER-USER SYNC
   ============================================================ */
let USER = null;
const isGuest = () => localStorage.getItem('gym_guest') === '1';
const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials);
async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return data;
}
const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer;
function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge);
  o.user.id = b64uToBuf(o.user.id);
  (o.excludeCredentials || []).forEach(c => c.id = b64uToBuf(c.id));
  return o;
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge);
  (o.allowCredentials || []).forEach(c => c.id = b64uToBuf(c.id));
  return o;
}
function credToJSON(cred) {
  const r = cred.response;
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  };
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject);
    out.response.transports = r.getTransports ? r.getTransports() : ['internal'];
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData);
    out.response.signature = bufToB64u(r.signature);
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null;
  }
  return out;
}
async function passkeyRegister(name) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name }) });
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) });
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) });
  return res.user;
}
async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' });
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) });
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) });
  return res.user;
}
function setUser(u) {
  USER = u;
  if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest'); }
  else localStorage.removeItem('gym_user');
}
/* --- state sync (server is source of truth per user) --- */
let pushTm = null;
function schedulePush() {
  if (!USER) return;
  clearTimeout(pushTm);
  pushTm = setTimeout(pushState, 1500);
}
async function pushState() {
  if (!USER) return;
  clearTimeout(pushTm);
  try {
    await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: S }) });
    localStorage.removeItem('gym_dirty');
  } catch (e) { localStorage.setItem('gym_dirty', '1'); }
}
function hasData(st) { return !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length); }
async function pullState() {
  try {
    const { state } = await api('/api/data');
    const dirty = localStorage.getItem('gym_dirty') === '1';
    if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
      const active = S.active;                 // in-progress workout stays device-local
      S = Object.assign(JSON.parse(JSON.stringify(DEF)), state);
      if (active) S.active = active;
      save(false);
    } else if (hasData(S)) await pushState();  // adopt this device's data into the account
  } catch (e) { /* offline — keep local cache */ }
}
window.addEventListener('online', () => { if (localStorage.getItem('gym_dirty') === '1') pushState(); });

/* ---------- workout history helpers ---------- */
function lastEntryFor(exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = S.workouts[i].entries.find(e => e.id === exId);
    if (en && en.sets.some(s => s.done)) return { d: S.workouts[i].d, sets: en.sets.filter(s => s.done) };
  }
  return null;
}
function bestWeightFor(exId) {
  let best = 0;
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w; });
      if (e.topW && e.topW > best) best = e.topW;
    }
  }));
  return best;
}
/* effective routine for a date: per-date override beats the weekly plan */
function effectiveRoutineId(iso) {
  const ov = S.dayPlan[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week[wd] || null;
}
function effectiveRoutine(iso) {
  const id = effectiveRoutineId(iso);
  return id ? S.routines.find(r => r.id === id) || null : null;
}
/* prefill sets: confirmed working weight > last time's sets > plan target */
function buildSets(cfg) {
  const last = lastEntryFor(cfg.id);
  const conf = S.exWeights[cfg.id];
  const sets = [];
  for (let i = 0; i < cfg.sets; i++) {
    const prevSet = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
    const w = conf && conf.w > 0 ? conf.w : (prevSet ? prevSet.w : cfg.weight);
    sets.push({ w, r: prevSet ? prevSet.r : cfg.reps, done: false });
  }
  return sets;
}
function workoutVolume(w) {
  let v = 0;
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) v += (s.w || 0) * (s.r || 0); }));
  return v;
}
function setsDone(w) {
  let n = 0; w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++; })); return n;
}
function lastBW() { return S.bodyweight.length ? S.bodyweight[S.bodyweight.length-1] : null; }
function weekKey(d) { // ISO week key
  const dt = new Date(d + 'T12:00:00');
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day + 3);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return dt.getFullYear() + '-' + week;
}
function streakWeeks() {
  if (!S.workouts.length) return 0;
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)));
  let streak = 0;
  const cur = new Date();
  for (let i = 0; i < 520; i++) {
    const iso = cur.getFullYear() + '-' + String(cur.getMonth()+1).padStart(2,'0') + '-' + String(cur.getDate()).padStart(2,'0');
    const wk = weekKey(iso);
    if (weeks.has(wk)) streak++;
    else if (i > 0) break;              // current week may still be empty
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}

/* ---------- media ---------- */
const imgEl = (ex, cls) => `<img class="${cls||'thumb'}" loading="lazy" src="img/${ex.img}" alt="">`;
/* big autoplay animation for single-exercise views; tap pauses (swaps to still) */
const mediaEl = (ex, id) => `<div class="exmedia"${id ? ` id="${id}"` : ''}><img src="gif/${ex.gif}" alt="${esc(ex.n)}"><span class="gifhint">⏸ tap to pause</span></div>`;
function bindMediaToggle(media, ex) {
  if (!media) return;
  media.onclick = () => {
    const img = media.querySelector('img');
    const hint = media.querySelector('.gifhint');
    if (img.src.includes('/gif/')) { img.src = 'img/' + ex.img; hint.textContent = '▶ tap to play'; }
    else { img.src = 'gif/' + ex.gif; hint.textContent = '⏸ tap to pause'; }
  };
}

/* ---------- body scroll lock (iOS-safe) while a modal is open ---------- */
function currentScrollY() {
  return 'slock' in document.body.dataset ? +document.body.dataset.slock : (window.scrollY || 0);
}
function lockBodyScroll() {
  if ('slock' in document.body.dataset) return;
  const y = window.scrollY || 0;
  document.body.dataset.slock = y;
  const st = document.body.style;
  st.position = 'fixed'; st.top = -y + 'px'; st.left = '0'; st.right = '0'; st.width = '100%';
}
function unlockBodyScroll() {
  if (!('slock' in document.body.dataset)) return;
  const y = +document.body.dataset.slock;
  delete document.body.dataset.slock;
  const st = document.body.style;
  st.position = st.top = st.left = st.right = st.width = '';
  window.scrollTo(0, y);
}

/* ---------- modal system ---------- */
const modalRoot = $('#modal-root');
let modalStack = [];
function openModal(html, kind) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="mback"></div><div class="${kind || 'sheet'}">${kind === 'center' ? '' : '<div class="grab"></div>'}${html}</div>`;
  modalRoot.appendChild(wrap);
  modalRoot.classList.add('open');
  lockBodyScroll();
  const close = () => {
    wrap.remove();
    modalStack = modalStack.filter(m => m !== api);
    if (!modalRoot.children.length) { modalRoot.classList.remove('open'); unlockBodyScroll(); }
  };
  wrap.querySelector('.mback').addEventListener('click', () => { if (!wrap.dataset.lock) close(); });
  const api = { el: wrap, close, lock: v => { wrap.dataset.lock = v ? '1' : ''; } };
  // swipe-down to dismiss (bottom sheets only, when scrolled to top)
  const sh = wrap.querySelector('.sheet');
  if (sh) {
    let startY = null, delta = 0;
    sh.addEventListener('touchstart', e => {
      startY = sh.scrollTop <= 0 ? e.touches[0].clientY : null;
      delta = 0;
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (startY === null) return;
      delta = e.touches[0].clientY - startY;
      if (delta > 0 && sh.scrollTop <= 0) {
        e.preventDefault();               // only the sheet moves, never the page behind
        sh.style.transition = 'none';
        sh.style.transform = `translateY(${delta}px)`;
      } else delta = 0;
    }, { passive: false });
    sh.addEventListener('touchend', () => {
      if (startY === null) return;
      sh.style.transition = 'transform .2s';
      if (delta > 90 && !wrap.dataset.lock) {
        sh.style.transform = 'translateY(110%)';
        setTimeout(close, 180);
      } else sh.style.transform = '';
      startY = null;
    });
  }
  modalStack.push(api);
  return api;
}
function closeAllModals() { [...modalStack].forEach(m => m.close()); }

/* ============================================================
   REST TIMER
   ============================================================ */
const timerRoot = $('#timer-root');
let timer = null;
function startRest(sec) {
  stopRest();
  timer = { total: sec, left: sec, int: setInterval(tickRest, 1000) };
  renderTimer();
}
function tickRest() {
  if (!timer) return;
  timer.left--;
  if (timer.left <= 0) {
    beep(880, .15); beep(880, .15, .25); beep(1320, .4, .5);
    vibrate([200, 100, 200]);
    toast('Rest over — next set! 💪');
    stopRest();
    return;
  }
  if (timer.left <= 3) beep(660, .1);
  renderTimer();
}
function stopRest() {
  if (timer) clearInterval(timer.int);
  timer = null; timerRoot.innerHTML = '';
}
function renderTimer() {
  if (!timer) { timerRoot.innerHTML = ''; return; }
  const pct = (timer.left / timer.total) * 100;
  const m = Math.floor(timer.left / 60), s = String(timer.left % 60).padStart(2, '0');
  timerRoot.innerHTML = `
    <div id="timer">
      <div class="t">${m}:${s}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <button class="btn sm" id="tm-add">+15s</button>
      <button class="btn sm primary" id="tm-skip">Skip</button>
    </div>`;
  $('#tm-add').onclick = () => { timer.left += 15; timer.total += 15; renderTimer(); };
  $('#tm-skip').onclick = () => stopRest();
}

/* ============================================================
   CHARTS  (hand-rolled SVG)
   ============================================================ */
const tsToISO = t => {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
};
let CHART_SEQ = 0;
const CHARTS = {};   // cid -> {pts:[{x,y,iso,v}], W, H, unit}
function lineChart(points, opts) {
  // points: [{t: ms, y: num, d?: iso}] sorted by t
  const o = Object.assign({ h: 150, unit: '', color: 'var(--acc)', axes: true }, opts);
  const W = 340, H = o.h;
  const P = { l: o.axes ? 34 : 8, r: 12, t: 10, b: o.axes ? 22 : 8 };
  if (points.length === 0) return `<div class="empty small">No data yet</div>`;
  const single = points.length === 1;
  if (single) points = [points[0], points[0]];
  const ys = points.map(p => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const pad = (ymax - ymin) * 0.12; ymin -= pad; ymax += pad;
  const t0 = points[0].t, t1 = points[points.length-1].t || t0 + 1;
  const X = t => t1 === t0 ? (P.l + W - P.r) / 2 : P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r);
  const Y = y => P.t + (1 - (y - ymin) / (ymax - ymin)) * (H - P.t - P.b);

  // y-axis: nice tick steps + gridlines + kg labels
  let axes = '';
  if (o.axes) {
    const range = ymax - ymin, raw = range / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = 10 * pow;
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) { step = m * pow; break; }
    for (let v = Math.ceil(ymin / step) * step; v <= ymax + 1e-9; v += step) {
      const y = Y(v).toFixed(1);
      axes += `<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>
        <text x="${P.l-5}" y="${+y+3.5}" text-anchor="end" font-size="9.5" fill="var(--dim)">${fmtNum(v)}</text>`;
    }
    // x-axis: month boundaries in between (or 3 date labels inside one month)
    const d0 = new Date(t0), d1 = new Date(t1);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const ticks = [];
    let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    while (m <= d1) { ticks.push({ t: +m, txt: MONTHS[m.getMonth()] }); m = new Date(m.getFullYear(), m.getMonth() + 1, 1); }
    if (ticks.length === 0 && !single) {
      for (let i = 0; i <= 2; i++) {
        const t = t0 + (t1 - t0) * i / 2;
        const dd = new Date(t);
        ticks.push({ t, txt: dd.getDate() + ' ' + MONTHS[dd.getMonth()], anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle' });
      }
    }
    const every = Math.max(1, Math.ceil(ticks.length / 7));
    ticks.forEach((tk, i) => {
      if (i % every) return;
      const x = X(tk.t).toFixed(1);
      axes += `<line x1="${x}" y1="${P.t}" x2="${x}" y2="${H-P.b}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>
        <text x="${x}" y="${H-7}" text-anchor="${tk.anchor || 'middle'}" font-size="9.5" fill="var(--dim)">${tk.txt}</text>`;
    });
  }

  const pts = points.map(p => X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ');
  const last = points[points.length-1];
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const cid = 'ch' + (++CHART_SEQ);
  CHARTS[cid] = {
    W, H, unit: o.unit,
    pts: (single ? [points[0]] : points).map(p => ({ x: X(p.t), y: Y(p.y), iso: p.d || tsToISO(p.t), v: p.y })),
    top: P.t, bot: H - P.b, left: P.l, right: W - P.r
  };
  return `<div class="chart-i" data-cid="${cid}">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${o.color}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${o.color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${axes}
    <polygon points="${P.l},${H-P.b} ${pts} ${X(last.t).toFixed(1)},${H-P.b}" fill="url(#${gid})"/>
    <polyline points="${pts}" fill="none" stroke="${o.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="4" fill="${o.color}"/>
    <g class="cross" visibility="hidden">
      <line class="cvl" x1="0" y1="${P.t}" x2="0" y2="${H-P.b}" stroke="var(--mut)" stroke-width="1" stroke-dasharray="3 3"/>
      <line class="chl" x1="${P.l}" y1="0" x2="${W-P.r}" y2="0" stroke="var(--mut)" stroke-width="1" stroke-dasharray="3 3"/>
      <circle class="cdot" r="5" fill="${o.color}" stroke="var(--bg)" stroke-width="2"/>
    </g>
  </svg>
  <div class="ctip" style="display:none"></div></div>`;
}
/* finger/mouse hover: snap to nearest point, crosshair + date/value tooltip */
function bindCharts(root) {
  root.querySelectorAll('.chart-i').forEach(box => {
    const d = CHARTS[box.dataset.cid];
    if (!d || !d.pts.length) return;
    const svg = box.querySelector('svg'), tip = box.querySelector('.ctip');
    const cross = svg.querySelector('.cross');
    const vl = svg.querySelector('.cvl'), hl = svg.querySelector('.chl'), dot = svg.querySelector('.cdot');
    function show(clientX) {
      const r = svg.getBoundingClientRect();
      const w = r.width || d.W;
      const vx = (clientX - r.left) / w * d.W;
      let best = d.pts[0];
      d.pts.forEach(p => { if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p; });
      vl.setAttribute('x1', best.x); vl.setAttribute('x2', best.x);
      hl.setAttribute('y1', best.y); hl.setAttribute('y2', best.y);
      dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y);
      cross.setAttribute('visibility', 'visible');
      tip.style.display = 'block';
      tip.textContent = fmtDate(best.iso, true) + ' · ' + fmtNum(best.v) + (d.unit ? ' ' + d.unit : '');
      const px = best.x / d.W * w;
      const tw = tip.offsetWidth || 110;
      tip.style.left = Math.max(2, Math.min(w - tw - 2, px - tw / 2)) + 'px';
    }
    const onMove = e => { const p = e.touches ? e.touches[0] : e; if (p && p.clientX !== undefined) show(p.clientX); };
    box.addEventListener('mousemove', onMove);
    box.addEventListener('mousedown', onMove);
    box.addEventListener('touchstart', onMove, { passive: true });
    box.addEventListener('touchmove', onMove, { passive: true });
  });
}

/* ============================================================
   ROUTER
   ============================================================ */
let elapsedInt = null;
function nav(hash) { location.hash = hash; }
function route() { renderView(); updateTabbar(); }
function renderView() {
  const h = (location.hash || '#home').slice(1);
  // re-rendering the same view (range chips, toggles, …) keeps the scroll position;
  // only an actual view change jumps to the top
  const sameView = renderView._last === h;
  renderView._last = h;
  const keepY = sameView ? currentScrollY() : 0;
  const [view, ...rest] = h.split('/');
  clearInterval(elapsedInt);
  closeAllModals();
  const app = $('#app');
  if (!USER && !isGuest()) viewLogin(app);
  else if (view === 'plan' && rest[0] === 'r') viewRoutineEdit(app, rest[1]);
  else switch (view) {
    case 'plan': viewPlan(app); break;
    case 'workout': viewWorkout(app); break;
    case 'stats': viewStats(app); break;
    case 'library': viewLibrary(app); break;
    case 'settings': viewSettings(app); break;
    case 'history': viewHistory(app); break;
    default: viewHome(app);
  }
  window.scrollTo(0, keepY);
}
window.addEventListener('hashchange', route);
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => {
  // Start tab: jump straight into today's session (it knows what day it is)
  if (b.dataset.tab === 'workout' && (USER || isGuest()) && !S.active) {
    const r = effectiveRoutine(todayISO());
    if (r && r.ex.length) { startFlow(r.id); return; }
  }
  nav('#' + b.dataset.tab);
}));
function updateTabbar() {
  $('#tabbar').style.display = (!USER && !isGuest()) ? 'none' : '';
  const cur = (location.hash || '#home').slice(1).split('/')[0];
  document.querySelectorAll('#tabbar button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === cur || (cur === 'history' && b.dataset.tab === 'stats') || (cur === 'settings' && b.dataset.tab === 'home'));
  });
  const st = document.querySelector('#tabbar .start');
  st.classList.toggle('rec', !!S.active);
  st.querySelector('span:last-child').textContent = S.active ? 'Resume' : 'Start';
}

/* ============================================================
   VIEW: LOGIN
   ============================================================ */
function viewLogin(app) {
  app.innerHTML = `
  <div style="display:flex;flex-direction:column;justify-content:center;min-height:78vh;text-align:center">
    <div style="font-size:4rem">🏋️</div>
    <h1 style="font-size:2.2rem;font-weight:800;letter-spacing:-.02em;margin:8px 0 4px">GymLog</h1>
    <div class="muted" style="margin-bottom:34px">Your workouts. Your weights. Your profile.</div>
    ${webauthnOK() ? `
      <button class="btn primary" id="lg-in">👤 Sign in with passkey</button>
      <div style="height:10px"></div>
      <button class="btn" id="lg-new">✨ Create new profile</button>
      <div style="height:10px"></div>` : `
      <div class="card small muted" style="text-align:left">This browser doesn't support passkeys — you can still use GymLog locally on this device.</div>`}
    <button class="btn ghost dim" id="lg-guest">Continue without account</button>
    <div class="dim small" style="margin-top:26px;line-height:1.5">Passkeys use Face ID / Touch ID — no passwords.<br>Each profile keeps its own plan, workouts & body weight.</div>
  </div>`;
  const bi = $('#lg-in');
  if (bi) bi.onclick = async () => {
    try {
      const u = await passkeyLogin();
      setUser(u);
      await pullState();
      toast('Welcome back, ' + u.name + ' 💪');
      route();
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || 'Sign-in failed'); }
  };
  const bn = $('#lg-new');
  if (bn) bn.onclick = () => registerSheet();
  $('#lg-guest').onclick = () => { localStorage.setItem('gym_guest', '1'); route(); };
}
function registerSheet(fromSettings) {
  const m = openModal(`
    <h3>Create your profile ✨</h3>
    <div class="muted small" style="margin-bottom:14px">Pick a name, then confirm with Face ID / Touch ID. The passkey is saved in your iCloud Keychain — no password needed.</div>
    <input class="input" id="rg-name" placeholder="Your name" maxlength="40" autocomplete="name">
    <div style="height:12px"></div>
    <button class="btn primary" id="rg-go">Create passkey</button>`);
  const inp = m.el.querySelector('#rg-name');
  setTimeout(() => inp.focus(), 250);
  m.el.querySelector('#rg-go').onclick = async () => {
    const name = inp.value.trim();
    if (!name) { toast('Enter a name'); return; }
    try {
      const u = await passkeyRegister(name);
      setUser(u);
      m.close();
      if (hasData(S)) { await pushState(); toast('Profile created — data from this device moved into it ✓'); }
      else { await pullState(); toast('Welcome, ' + u.name + ' 💪'); }
      route();
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || 'Registration failed'); }
  };
}
async function signOut() {
  try { await pushState(); await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) {}
  setUser(null);
  localStorage.removeItem('gym_guest');
  localStorage.removeItem('gym_dirty');
  S = JSON.parse(JSON.stringify(DEF));    // local copy cleared — data lives in the profile
  localStorage.removeItem(KEY);
  stopRest(); nav('#home'); route();
  toast('Signed out — see you 👋');
}

/* ============================================================
   VIEW: HOME
   ============================================================ */
let weekOffset = 0;
function viewHome(app) {
  const today = new Date();
  const routine = effectiveRoutine(todayISO());
  const todayOverridden = S.dayPlan[todayISO()] !== undefined;
  const bw = lastBW();
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length-2] : null;
  const delta = bw && prevBW ? bw.w - prevBW.w : null;

  // week strip (Mon-start, pageable, days tappable to reschedule)
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
  const doneDays = new Set(S.workouts.map(w => w.d));
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const eff = effectiveRoutineId(iso);
    const ovr = S.dayPlan[iso] !== undefined;
    const done = doneDays.has(iso);
    strip += `<div class="wday${iso === todayISO() ? ' today' : ''}" data-date="${iso}">
      <div class="lbl">${DAYS[d.getDay()]}</div><div class="num">${d.getDate()}</div>
      <div class="dot${done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''}"></div></div>`;
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const wkLabel = weekOffset === 0 ? 'This week'
    : `${monday.getDate()} ${monday.toLocaleDateString('en-GB',{month:'short'})} – ${sunday.getDate()} ${sunday.toLocaleDateString('en-GB',{month:'short'})}`;

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length;
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length;
  const lastW = S.workouts[S.workouts.length-1];

  const bwSpark = lineChart(S.bodyweight.slice(-30).map(b => ({t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d})), {h: 90, axes: false, unit: S.unit});

  app.innerHTML = `
  <div class="hdr">
    <div><h1>${USER ? 'Hi ' + esc(USER.name) + ' 💪' : 'GymLog 🏋️'}</h1><div class="sub">${today.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'})}</div></div>
    <button class="iconbtn" id="btn-settings">⚙️</button>
  </div>

  <div class="card">
    <div class="row between" style="margin-bottom:8px">
      <button class="iconbtn" id="wk-prev" style="width:32px;height:32px">‹</button>
      <div class="small muted" style="font-weight:600">${wkLabel}</div>
      <button class="iconbtn" id="wk-next" style="width:32px;height:32px">›</button>
    </div>
    <div class="week">${strip}</div>
    <div class="small dim" style="margin-top:8px;text-align:center">Tap a day to plan or move a session</div>
  </div>

  ${S.active ? `
  <div class="card" style="border-color:var(--orange)">
    <h2 style="color:var(--orange)">Workout in progress</h2>
    <div class="row between">
      <div><div class="big">${esc(S.active.name)}</div>
      <div class="muted small">${setsDoneActive()} sets logged</div></div>
      <button class="btn sm primary" id="btn-resume">Resume ▶</button>
    </div>
  </div>` : `
  <div class="card">
    <h2>Today</h2>
    ${routine ? `
      <div class="row between" style="margin-bottom:12px">
        <div><div class="big">${esc(routine.name)}</div>
        <div class="muted small">${routine.ex.length} exercises · ~${routine.ex.length * 8} min${todayOverridden ? ' · <span style="color:var(--orange)">rescheduled</span>' : ''}</div></div>
        <div style="font-size:2rem">${routine.emoji || '💪'}</div>
      </div>
      <button class="btn primary" id="btn-start-today">Start workout</button>`
    : S.routines.length ? `
      <div class="big" style="margin-bottom:4px">Rest day 😌</div>
      <div class="muted small" style="margin-bottom:12px">Nothing planned for ${DAYN[today.getDay()]} — recovery counts too. Feeling strong anyway?</div>
      <button class="btn" id="btn-start-any">Start a workout anyway</button>`
    : `
      <div class="big" style="margin-bottom:4px">Welcome! 👋</div>
      <div class="muted small" style="margin-bottom:12px">Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.</div>
      <button class="btn primary" id="btn-starter">Load starter plan (PPL)</button>
      <div style="height:8px"></div>
      <button class="btn" id="btn-goplan">Build my own plan</button>`}
  </div>`}

  <div class="card">
    <div class="row between" style="margin-bottom:6px">
      <h2 style="margin:0">Body weight</h2>
      <button class="btn sm" id="btn-logbw">+ Log</button>
    </div>
    ${bw ? `
      <div class="row" style="gap:8px;align-items:baseline">
        <div class="big">${fmtNum(bw.w)} <span class="muted" style="font-size:1rem">${S.unit}</span></div>
        ${delta !== null ? `<span class="small" style="color:${delta > 0 ? 'var(--orange)' : delta < 0 ? 'var(--acc)' : 'var(--mut)'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${fmtNum(Math.abs(delta))}</span>` : ''}
        <span class="dim small" style="margin-left:auto">${fmtDate(bw.d, true)}</span>
      </div>
      <div class="chart" style="margin-top:8px">${bwSpark}</div>`
    : `<div class="muted small">No entries yet — log your weight to start the curve. It's also asked automatically before every workout.</div>`}
  </div>

  <div class="tiles">
    <div class="tile"><div class="l">This week</div><div class="v">${wThisWeek}<span class="muted" style="font-size:1rem">${plannedPerWeek ? ' / ' + plannedPerWeek : ''}</span></div></div>
    <div class="tile"><div class="l">Week streak</div><div class="v">${streakWeeks()} 🔥</div></div>
    <div class="tile"><div class="l">Total workouts</div><div class="v">${S.workouts.length}</div></div>
    <div class="tile"><div class="l">Last volume</div><div class="v" style="font-size:1.15rem">${lastW ? fmtVol(lastW.vol) : '—'}</div></div>
  </div>

  ${S.workouts.length ? `
  <div class="row between" style="margin-bottom:10px">
    <h4 class="sec" style="margin:0">Recent workouts</h4>
    <button class="btn sm ghost accent" id="btn-history">See all ›</button>
  </div>
  <div class="list">${[...S.workouts].reverse().slice(0, 3).map(workoutItem).join('')}</div>` : ''}
  `;

  $('#btn-settings').onclick = () => nav('#settings');
  $('#btn-logbw').onclick = () => bwSheet();
  $('#wk-prev').onclick = () => { weekOffset--; route(); };
  $('#wk-next').onclick = () => { weekOffset++; route(); };
  app.querySelectorAll('[data-date]').forEach(el => el.addEventListener('click', () => dayOverrideSheet(el.dataset.date)));
  const bs = $('#btn-start-today'); if (bs) bs.onclick = () => startFlow(routine.id);
  const ba = $('#btn-start-any'); if (ba) ba.onclick = () => nav('#workout');
  const br = $('#btn-resume'); if (br) br.onclick = () => nav('#workout');
  const bst = $('#btn-starter'); if (bst) bst.onclick = () => { loadStarterPlan(); route(); };
  const bp = $('#btn-goplan'); if (bp) bp.onclick = () => nav('#plan');
  const bh = $('#btn-history'); if (bh) bh.onclick = () => nav('#history');
  bindWorkoutItems(app);
  bindCharts(app);
}
function setsDoneActive() {
  let n = 0; if (S.active) S.active.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++; }));
  return n;
}
function workoutItem(w) {
  return `<div class="item" data-wid="${w.id}">
    <div style="font-size:1.5rem;flex:none">${(S.routines.find(r => r.id === w.routineId) || {}).emoji || '💪'}</div>
    <div class="grow"><div class="tt">${esc(w.name)}</div>
    <div class="ss">${fmtDate(w.d, true)} · ${fmtDur(w.end - w.start)} · ${setsDone(w)} sets · ${fmtVol(w.vol)}</div></div>
    ${w.prs && w.prs.length ? `<span class="pr">🏆 ${w.prs.length} PR</span>` : ''}
    <span class="chev">›</span></div>`;
}
function bindWorkoutItems(root) {
  root.querySelectorAll('[data-wid]').forEach(el => el.addEventListener('click', () => {
    const w = S.workouts.find(x => x.id === el.dataset.wid);
    if (w) workoutDetailSheet(w);
  }));
}

/* ---------- per-date session override ---------- */
function dayOverrideSheet(iso) {
  const wd = new Date(iso + 'T12:00:00').getDay();
  const weeklyR = S.routines.find(r => r.id === S.week[wd]);
  const hasOvr = S.dayPlan[iso] !== undefined;
  const effId = effectiveRoutineId(iso);
  const m = openModal(`
    <h3>${fmtDate(iso, true)}</h3>
    <div class="muted small" style="margin-bottom:12px">Weekly plan: ${weeklyR ? esc(weeklyR.name) : 'Rest'}${hasOvr ? ' · <span style="color:var(--orange)">changed for this day</span>' : ''}<br>Sick, missed a day or want a different session? Pick what to train instead.</div>
    <div class="list">
      ${S.routines.map(r => `<div class="item" data-pick="${r.id}">
        <div style="font-size:1.3rem;flex:none">${r.emoji || '💪'}</div>
        <div class="grow"><div class="tt">${esc(r.name)}</div><div class="ss">${r.ex.length} exercises</div></div>
        ${effId === r.id ? '<span class="accent">✓</span>' : ''}</div>`).join('')}
      <div class="item" data-pick="rest"><div class="grow"><div class="tt">😌 Rest / skip this day</div></div>${effId === null ? '<span class="accent">✓</span>' : ''}</div>
      ${hasOvr ? '<div class="item" data-pick=""><div class="grow"><div class="tt">↺ Back to weekly plan</div></div></div>' : ''}
    </div>`);
  m.el.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
    const v = el.dataset.pick;
    if (!v) delete S.dayPlan[iso];
    else S.dayPlan[iso] = v;
    save(); m.close(); route();
    toast(v === '' ? 'Back to weekly plan' : v === 'rest' ? fmtDate(iso) + ' set to rest' : (S.routines.find(r => r.id === v) || {}).name + ' planned for ' + fmtDate(iso) + ' ✓');
  }));
}

/* ============================================================
   BODY WEIGHT SHEET
   ============================================================ */
function bwSheet(onDone, required) {
  const bw = lastBW();
  const m = openModal(`
    <h3>${required ? 'Quick check-in ⚖️' : 'Log body weight'}</h3>
    <div class="muted small">${required ? 'Step on the scale — tracked before every workout so your curve stays honest.' : 'Today, ' + fmtDate(todayISO(), true)}</div>
    <div class="bwin"><input type="number" inputmode="decimal" step="0.1" id="bw-in" value="${bw ? bw.w : ''}" placeholder="0.0"><span>${S.unit}</span></div>
    <button class="btn primary" id="bw-save">${required ? 'Save & start workout' : 'Save'}</button>
    ${required ? `<div style="height:8px"></div><button class="btn ghost dim" id="bw-skip">Skip today</button>
    <div style="height:2px"></div><button class="btn ghost dim" id="bw-switch">↺ Choose a different workout</button>` : ''}
  `);
  if (required) m.lock(true);
  const inp = m.el.querySelector('#bw-in');
  setTimeout(() => { inp.focus(); inp.select(); }, 250);
  m.el.querySelector('#bw-save').onclick = () => {
    const v = parseFloat(inp.value);
    if (!v || v <= 0 || v > 400) { toast('Enter a valid weight'); return; }
    const iso = todayISO();
    const ex = S.bodyweight.find(b => b.d === iso);
    if (ex) { ex.w = v; ex.t = Date.now(); }
    else S.bodyweight.push({ d: iso, w: v, t: Date.now() });
    S.bodyweight.sort((a, b) => a.d < b.d ? -1 : 1);
    save(); m.close();
    if (onDone) onDone(v); else { toast('Weight saved ✓'); route(); }
  };
  const sk = m.el.querySelector('#bw-skip');
  if (sk) sk.onclick = () => { m.close(); if (onDone) onDone(null); };
  const sw = m.el.querySelector('#bw-switch');
  if (sw) sw.onclick = () => {
    m.close();
    if (location.hash === '#workout') route(); else nav('#workout');
  };
}

/* ============================================================
   VIEW: PLAN
   ============================================================ */
function viewPlan(app) {
  const dayRows = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const r = S.routines.find(x => x.id === S.week[d]);
    return `<div class="item" data-day="${d}">
      <div class="grow"><div class="tt">${DAYN[d]}</div></div>
      ${r ? `<span class="tag acc">${(r.emoji || '') + ' ' + esc(r.name)}</span>` : '<span class="tag">Rest</span>'}
      <span class="chev">›</span></div>`;
  }).join('');

  app.innerHTML = `
  <div class="hdr"><div><h1>Plan</h1><div class="sub">Your weekly routine</div></div></div>

  <h4 class="sec">Week schedule</h4>
  <div class="list">${dayRows}</div>

  <div class="row between" style="margin-top:22px;margin-bottom:10px">
    <h4 class="sec" style="margin:0">Routines</h4>
    <button class="btn sm primary" id="btn-add-routine">+ New</button>
  </div>
  ${S.routines.length ? `<div class="list">${S.routines.map(r => `
    <div class="item" data-rid="${r.id}">
      <div style="font-size:1.5rem;flex:none">${r.emoji || '💪'}</div>
      <div class="grow"><div class="tt">${esc(r.name)}</div>
      <div class="ss">${r.ex.length} exercises</div></div>
      <span class="chev">›</span></div>`).join('')}</div>`
  : `<div class="empty"><div class="ico">📋</div>No routines yet.<br>Create one or load the starter plan.</div>
     <button class="btn" id="btn-starter2">Load starter plan (Push / Pull / Legs)</button>`}
  `;

  app.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => dayAssignSheet(+el.dataset.day)));
  app.querySelectorAll('[data-rid]').forEach(el => el.addEventListener('click', () => nav('#plan/r/' + el.dataset.rid)));
  $('#btn-add-routine').onclick = () => {
    const r = { id: uid(), name: 'New routine', emoji: '💪', ex: [] };
    S.routines.push(r); save(); nav('#plan/r/' + r.id);
  };
  const bst = $('#btn-starter2'); if (bst) bst.onclick = () => { loadStarterPlan(); route(); };
}
function dayAssignSheet(day) {
  const m = openModal(`
    <h3>${DAYN[day]}</h3>
    <div class="list">
      <div class="item" data-pick=""><div class="grow"><div class="tt">😌 Rest day</div></div>${!S.week[day] ? '<span class="accent">✓</span>' : ''}</div>
      ${S.routines.map(r => `<div class="item" data-pick="${r.id}">
        <div style="font-size:1.3rem;flex:none">${r.emoji || '💪'}</div>
        <div class="grow"><div class="tt">${esc(r.name)}</div><div class="ss">${r.ex.length} exercises</div></div>
        ${S.week[day] === r.id ? '<span class="accent">✓</span>' : ''}</div>`).join('')}
    </div>`);
  m.el.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
    if (el.dataset.pick) S.week[day] = el.dataset.pick; else delete S.week[day];
    save(); m.close(); route();
  }));
}

/* ---------- routine editor ---------- */
function viewRoutineEdit(app, rid) {
  const r = S.routines.find(x => x.id === rid);
  if (!r) { nav('#plan'); return; }
  app.innerHTML = `
  <div class="hdr">
    <button class="iconbtn" id="btn-back">‹</button>
    <div style="flex:1;margin:0 12px"><input class="input" id="r-name" value="${esc(r.name)}" style="font-weight:800;font-size:1.1rem"></div>
    <button class="iconbtn" id="btn-emoji">${r.emoji || '💪'}</button>
  </div>

  ${r.ex.length ? `<div class="list">${r.ex.map((e, i) => {
    const ex = EXIDX[e.id]; if (!ex) return '';
    return `<div class="item" data-idx="${i}">
      ${imgEl(ex)}
      <div class="grow"><div class="tt">${esc(ex.n)}</div>
      <div class="ss">${e.sets} × ${e.reps}${e.weight ? ' · ' + fmtNum(e.weight) + ' ' + S.unit : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:2px;flex:none">
        <button class="iconbtn" style="width:34px;height:30px;font-size:.8rem" data-up="${i}">▲</button>
        <button class="iconbtn" style="width:34px;height:30px;font-size:.8rem" data-dn="${i}">▼</button>
      </div></div>`;
  }).join('')}</div>`
  : '<div class="empty"><div class="ico">🏋️</div>No exercises yet — add your first one.</div>'}

  <div style="height:10px"></div>
  <button class="btn primary" id="btn-add-ex">+ Add exercise</button>
  <div style="height:10px"></div>
  <button class="btn danger" id="btn-del-r">Delete routine</button>
  `;

  $('#btn-back').onclick = () => nav('#plan');
  $('#r-name').addEventListener('change', ev => { r.name = ev.target.value.trim() || 'Routine'; save(); });
  $('#btn-emoji').onclick = () => emojiPickerSheet(r.emoji, emo => { r.emoji = emo; save(); route(); });
  $('#btn-add-ex').onclick = () => exercisePicker(ex => exConfigSheet(ex, null, cfg => {
    r.ex.push({ id: ex.id, ...cfg }); save(); route();
  }));
  $('#btn-del-r').onclick = () => {
    if (!confirm('Delete "' + r.name + '"?')) return;
    S.routines = S.routines.filter(x => x.id !== rid);
    Object.keys(S.week).forEach(k => { if (S.week[k] === rid) delete S.week[k]; });
    Object.keys(S.dayPlan).forEach(k => { if (S.dayPlan[k] === rid) delete S.dayPlan[k]; });
    save(); nav('#plan');
  };
  app.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation(); const i = +b.dataset.up;
    if (i > 0) { [r.ex[i-1], r.ex[i]] = [r.ex[i], r.ex[i-1]]; save(); route(); }
  }));
  app.querySelectorAll('[data-dn]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation(); const i = +b.dataset.dn;
    if (i < r.ex.length - 1) { [r.ex[i+1], r.ex[i]] = [r.ex[i], r.ex[i+1]]; save(); route(); }
  }));
  app.querySelectorAll('.item[data-idx]').forEach(el => el.addEventListener('click', () => {
    const i = +el.dataset.idx; const e = r.ex[i]; const ex = EXIDX[e.id];
    exConfigSheet(ex, e, cfg => { Object.assign(e, cfg); save(); route(); }, () => {
      r.ex.splice(i, 1); save(); route();
    });
  }));
}

/* ---------- emoji picker (big grid instead of click-cycling) ---------- */
const ROUTINE_EMOJIS = [
  '💪','🏋️','🏋️‍♀️','🦵','🦾','🫸','🫷','🔥','⚡','💥',
  '🏃','🏃‍♀️','🚴','🏊','🤸','🥊','🧗','⛰️','🏔️','🚀',
  '🧘','🧘‍♀️','🎯','🏆','🥇','⭐','🌟','👑','🛡️','⚔️',
  '🦍','🐂','🐻','🦁','🐺','🦈','😤','🤖','🧨','❤️‍🔥'
];
function emojiPickerSheet(current, onPick) {
  const m = openModal(`
    <h3>Pick an emoji</h3>
    <div class="emoji-grid">${ROUTINE_EMOJIS.map(e =>
      `<button class="emoji-cell${e === current ? ' on' : ''}" data-emo="${e}">${e}</button>`).join('')}
    </div>`);
  m.el.querySelectorAll('[data-emo]').forEach(b => b.addEventListener('click', () => {
    m.close(); onPick(b.dataset.emo);
  }));
}

/* ---------- exercise picker ---------- */
function exercisePicker(onPick) {
  let q = '', bp = '', shown = 50;
  const m = openModal(`
    <h3>Add exercise</h3>
    <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input class="input" id="pk-q" placeholder="Search ${EXDB.length} exercises…"></div>
    <div class="chips" id="pk-chips" style="margin:10px 0"></div>
    <div class="list" id="pk-list"></div>
    <div style="height:8px"></div>
    <button class="btn" id="pk-more" style="display:none">Show more</button>
  `);
  const listEl = m.el.querySelector('#pk-list');
  const chipsEl = m.el.querySelector('#pk-chips');
  const moreBtn = m.el.querySelector('#pk-more');
  function filtered() {
    return EXDB.filter(e =>
      (!bp || e.bp === bp) &&
      (!q || e.n.includes(q) || e.tg.includes(q) || e.eq.includes(q)));
  }
  function draw() {
    chipsEl.innerHTML = `<button class="chip${!bp ? ' on' : ''}" data-bp="">All</button>` +
      BODYPARTS.map(b => `<button class="chip${bp === b ? ' on' : ''}" data-bp="${b}">${b}</button>`).join('');
    chipsEl.querySelectorAll('.chip').forEach(c => c.onclick = () => { bp = c.dataset.bp; shown = 50; draw(); });
    const f = filtered();
    listEl.innerHTML = f.slice(0, shown).map(e => `
      <div class="item" data-ex="${e.id}">${imgEl(e)}
        <div class="grow"><div class="tt">${esc(e.n)}</div>
        <div class="ss">${e.tg || e.bp} · ${e.eq}</div></div><span class="chev">+</span></div>`).join('')
      || '<div class="empty">No match 🤷</div>';
    moreBtn.style.display = f.length > shown ? '' : 'none';
    listEl.querySelectorAll('[data-ex]').forEach(el => el.addEventListener('click', () => {
      m.close(); onPick(EXIDX[el.dataset.ex]);
    }));
  }
  moreBtn.onclick = () => { shown += 50; draw(); };
  m.el.querySelector('#pk-q').addEventListener('input', ev => { q = ev.target.value.toLowerCase().trim(); shown = 50; draw(); });
  draw();
}

/* ---------- exercise config (sets/reps/weight) ---------- */
function stepperHTML(id, val, step, label) {
  return `<div><div class="small muted" style="margin-bottom:5px;text-align:center">${label}</div>
    <div class="step"><button data-st="-${step}" data-for="${id}">−</button>
    <input type="number" inputmode="decimal" id="${id}" value="${val}">
    <button data-st="${step}" data-for="${id}">+</button></div></div>`;
}
function bindSteppers(root) {
  root.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => {
    const inp = root.querySelector('#' + b.dataset.for);
    const v = (parseFloat(inp.value) || 0) + parseFloat(b.dataset.st);
    inp.value = Math.max(0, Math.round(v * 100) / 100);
    inp.dispatchEvent(new Event('change'));
  }));
}
function exConfigSheet(ex, existing, onSave, onDelete) {
  const e = existing || { sets: 3, reps: 10, weight: 0 };
  const m = openModal(`
    <h3 class="capitalize">${esc(ex.n)}</h3>
    ${mediaEl(ex)}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0 14px">
      <span class="tag">${ex.tg || ex.bp}</span><span class="tag">${ex.eq}</span>
    </div>
    <div class="row" style="justify-content:space-around;margin-bottom:18px">
      ${stepperHTML('cf-sets', e.sets, 1, 'Sets')}
      ${stepperHTML('cf-reps', e.reps, 1, 'Reps')}
      ${stepperHTML('cf-w', e.weight, 2.5, 'Weight (' + S.unit + ')')}
    </div>
    <button class="btn primary" id="cf-save">${existing ? 'Save' : 'Add to routine'}</button>
    ${onDelete ? '<div style="height:8px"></div><button class="btn danger" id="cf-del">Remove exercise</button>' : ''}
  `);
  bindSteppers(m.el);
  bindMediaToggle(m.el.querySelector('.exmedia'), ex);
  m.el.querySelector('#cf-save').onclick = () => {
    const cfg = {
      sets: Math.max(1, Math.round(parseFloat(m.el.querySelector('#cf-sets').value) || 3)),
      reps: Math.max(1, Math.round(parseFloat(m.el.querySelector('#cf-reps').value) || 10)),
      weight: Math.max(0, parseFloat(m.el.querySelector('#cf-w').value) || 0)
    };
    m.close(); onSave(cfg);
  };
  const del = m.el.querySelector('#cf-del');
  if (del) del.onclick = () => { m.close(); onDelete(); };
}

/* ============================================================
   STARTER PLAN
   ============================================================ */
function loadStarterPlan() {
  const mk = (name, emoji, list) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) });
  const push = mk('Push Day', '🫸', [['0025',4,8],['0047',3,10],['0426',3,10],['0334',3,12],['0241',3,12],['0251',3,10]]);
  const pull = mk('Pull Day', '🫷', [['2330',4,10],['0027',4,8],['1323',3,10],['0031',3,10],['0313',3,12]]);
  const legs = mk('Leg Day', '🦵', [['0043',4,8],['0085',3,10],['0739',3,12],['0585',3,12],['0586',3,12],['0605',4,15]]);
  S.routines.push(push, pull, legs);
  S.week[1] = push.id; S.week[3] = pull.id; S.week[5] = legs.id;   // Mon / Wed / Fri
  save();
  toast('Starter plan loaded — Mon Push · Wed Pull · Fri Legs');
}

/* ============================================================
   VIEW: WORKOUT
   ============================================================ */
function viewWorkout(app) {
  if (S.active) return renderActive(app);
  const today = new Date().getDay();
  const todayR = effectiveRoutine(todayISO());
  const todayOvr = S.dayPlan[todayISO()] !== undefined;
  app.innerHTML = `
  <div class="hdr"><div><h1>Start workout</h1><div class="sub">${DAYN[today]} — ${todayR ? 'today is ' + esc(todayR.name) : 'rest day, but no one’s stopping you'}</div></div></div>
  ${todayR ? `
  <div class="card" style="border-color:var(--acc)">
    <h2 class="accent">Today's plan${todayOvr ? ' · rescheduled' : ''}</h2>
    <div class="row between" style="margin-bottom:12px">
      <div><div class="big">${esc(todayR.name)}</div>
      <div class="muted small">${todayR.ex.length} exercises</div></div>
      <div style="font-size:2rem">${todayR.emoji || '💪'}</div>
    </div>
    <button class="btn primary" data-start="${todayR.id}">Start ${esc(todayR.name)} ▶</button>
  </div>` : ''}
  ${S.routines.filter(r => r !== todayR).length ? `<h4 class="sec">Other routines</h4>
  <div class="list">${S.routines.filter(r => r !== todayR).map(r => `
    <div class="item" data-start="${r.id}">
      <div style="font-size:1.5rem;flex:none">${r.emoji || '💪'}</div>
      <div class="grow"><div class="tt">${esc(r.name)}</div><div class="ss">${r.ex.length} exercises</div></div>
      <span class="tag acc">Start ▶</span></div>`).join('')}</div>` : ''}
  <div style="height:14px"></div>
  <button class="btn" id="btn-free">🎯 Freestyle workout (pick as you go)</button>
  ${!S.routines.length ? `<div style="height:10px"></div><button class="btn primary" id="btn-starter3">Load starter plan first</button>` : ''}
  `;
  app.querySelectorAll('[data-start]').forEach(el => el.addEventListener('click', () => startFlow(el.dataset.start)));
  $('#btn-free').onclick = () => startFlow(null);
  const bst = $('#btn-starter3'); if (bst) bst.onclick = () => { loadStarterPlan(); route(); };
}

function startFlow(routineId) {
  // Always ask for body weight first (core requirement)
  bwSheet(bw => beginWorkout(routineId, bw), true);
}
function beginWorkout(routineId, bw) {
  const r = routineId ? S.routines.find(x => x.id === routineId) : null;
  const entries = (r ? r.ex : []).map(cfg => ({ id: cfg.id, target: { ...cfg }, sets: buildSets(cfg) }));
  S.active = {
    id: uid(), d: todayISO(), start: Date.now(),
    routineId: routineId, name: r ? r.name : 'Freestyle',
    bw: bw || null, cur: 0, entries
  };
  save(); stopRest();
  nav('#workout'); route();
}

function renderActive(app) {
  const A = S.active;
  const totalSets = A.entries.reduce((n, e) => n + e.sets.length, 0);
  const doneSets = setsDoneActive();
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1));
  A.cur = cur;
  const entry = A.entries[cur];

  app.innerHTML = `
  <div class="hdr">
    <button class="iconbtn" id="wo-cancel">✕</button>
    <div style="text-align:center"><div style="font-weight:800">${esc(A.name)}</div>
    <div class="sub"><span id="wo-elapsed">0:00</span> · ${doneSets}/${totalSets} sets</div></div>
    <button class="iconbtn" id="wo-finish" style="color:var(--acc)">✓</button>
  </div>
  <div class="wprog"><i style="width:${totalSets ? doneSets / totalSets * 100 : 0}%"></i></div>
  ${entry ? renderExerciseCard(entry, cur, A.entries.length) : `
    <div class="empty"><div class="ico">🎯</div>Freestyle workout — add your first exercise.</div>`}
  <div style="height:12px"></div>
  <div class="row">
    <button class="btn" id="wo-prev" ${cur === 0 || !entry ? 'disabled' : ''}>‹ Prev</button>
    <button class="btn" id="wo-next" ${cur >= A.entries.length - 1 ? 'disabled' : ''}>Next ›</button>
  </div>
  <div style="height:10px"></div>
  <button class="btn" id="wo-add">+ Add exercise</button>
  <div style="height:10px"></div>
  <button class="btn primary" id="wo-finish2">Finish workout 🏁</button>
  `;

  // elapsed ticker
  const tick = () => {
    const el = $('#wo-elapsed'); if (!el) return;
    const s = Math.floor((Date.now() - A.start) / 1000);
    el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  tick(); elapsedInt = setInterval(tick, 1000);

  $('#wo-cancel').onclick = () => {
    if (confirm('Discard this workout? Logged sets will be lost.')) {
      S.active = null; save(); stopRest(); nav('#home');
    }
  };
  $('#wo-finish').onclick = $('#wo-finish2').onclick = finishWorkout;
  $('#wo-prev').onclick = () => { A.cur = Math.max(0, cur - 1); save(); route(); };
  $('#wo-next').onclick = () => { A.cur = Math.min(A.entries.length - 1, cur + 1); save(); route(); };
  $('#wo-add').onclick = () => exercisePicker(ex => exConfigSheet(ex, null, cfg => {
    A.entries.push({ id: ex.id, target: { ...cfg }, sets: buildSets({ ...cfg, id: ex.id }) });
    A.cur = A.entries.length - 1; save(); route();
  }));
  if (entry) bindExerciseCard(app, entry);
}

function renderExerciseCard(entry, idx, total) {
  const ex = EXIDX[entry.id];
  if (!ex) return '';
  const last = lastEntryFor(entry.id);
  const best = bestWeightFor(entry.id);
  // progression hint: all sets hit target reps last time → suggest +2.5
  let hint = '';
  if (last && last.sets.length >= (entry.target.sets || 1) && last.sets.every(s => s.r >= entry.target.reps) && last.sets[0].w > 0) {
    hint = `<button class="tag acc" id="wo-hint" style="border:none">💡 Last time you hit all reps — try ${fmtNum(Math.max(...last.sets.map(s => s.w)) + 2.5)} ${S.unit}</button>`;
  }
  return `
  <div class="muted small" style="margin-bottom:6px">Exercise ${idx + 1} / ${total}</div>
  ${mediaEl(ex, 'wo-media')}
  <div class="row between" style="margin-bottom:6px">
    <div style="font-size:1.2rem;font-weight:800;text-transform:capitalize;line-height:1.2">${esc(ex.n)}</div>
    <button class="iconbtn" id="wo-info">ℹ️</button>
  </div>
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
    <span class="tag">${ex.tg || ex.bp}</span><span class="tag">${ex.eq}</span>
    ${best ? `<span class="tag">Best: ${fmtNum(best)} ${S.unit}</span>` : ''}
  </div>
  ${last ? `<div class="small dim" style="margin-bottom:4px">Last time (${fmtDate(last.d)}): ${last.sets.map(s => fmtNum(s.w) + '×' + s.r).join(', ')}</div>` : ''}
  ${hint}
  <div class="card" style="margin-top:10px">
    ${entry.sets.map((s, i) => `
    <div class="setrow${s.done ? ' done' : ''}" data-set="${i}">
      <div class="n">${i + 1}</div>
      <div class="prev">${last && last.sets[i] ? fmtNum(last.sets[i].w) + ' × ' + last.sets[i].r : '—'}</div>
      <div class="step" style="flex:1"><button data-sw="-2.5" data-si="${i}">−</button>
        <input type="number" inputmode="decimal" data-win="${i}" value="${s.w}" style="width:100%">
        <button data-sw="2.5" data-si="${i}">+</button></div>
      <div class="step"><button data-sr="-1" data-si="${i}">−</button>
        <input type="number" inputmode="numeric" data-rin="${i}" value="${s.r}">
        <button data-sr="1" data-si="${i}">+</button></div>
      <button class="ck${s.done ? ' on' : ''}" data-ck="${i}"><svg viewBox="0 0 24 24"><path d="m4.5 12.5 5 5 10-11"/></svg></button>
    </div>`).join('')}
    <div style="height:8px"></div>
    <button class="btn sm" id="wo-addset">+ Add set</button>
  </div>`;
}

function bindExerciseCard(app, entry) {
  const A = S.active;
  bindMediaToggle($('#wo-media'), EXIDX[entry.id]);
  const info = $('#wo-info');
  if (info) info.onclick = () => exerciseDetailSheet(EXIDX[entry.id]);
  const hint = $('#wo-hint');
  if (hint) hint.onclick = () => {
    const last = lastEntryFor(entry.id);
    const w = Math.max(...last.sets.map(s => s.w)) + 2.5;
    entry.sets.forEach(s => { if (!s.done) s.w = w; });
    save(); route(); toast('Weights bumped to ' + fmtNum(w) + ' ' + S.unit + ' 💪');
  };
  app.querySelectorAll('[data-win]').forEach(inp => inp.addEventListener('change', () => {
    entry.sets[+inp.dataset.win].w = Math.max(0, parseFloat(inp.value) || 0); save();
  }));
  app.querySelectorAll('[data-rin]').forEach(inp => inp.addEventListener('change', () => {
    entry.sets[+inp.dataset.rin].r = Math.max(0, Math.round(parseFloat(inp.value) || 0)); save();
  }));
  app.querySelectorAll('[data-sw]').forEach(b => b.addEventListener('click', () => {
    const s = entry.sets[+b.dataset.si];
    s.w = Math.max(0, Math.round((s.w + parseFloat(b.dataset.sw)) * 100) / 100);
    save(); app.querySelector(`[data-win="${b.dataset.si}"]`).value = s.w;
  }));
  app.querySelectorAll('[data-sr]').forEach(b => b.addEventListener('click', () => {
    const s = entry.sets[+b.dataset.si];
    s.r = Math.max(0, s.r + parseInt(b.dataset.sr));
    save(); app.querySelector(`[data-rin="${b.dataset.si}"]`).value = s.r;
  }));
  app.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.ck;
    const s = entry.sets[i];
    s.done = !s.done;
    let askTop = false;
    if (s.done) {
      beep(1040, .12); vibrate(30);
      const allDoneHere = entry.sets.every(x => x.done);
      const isLastEx = A.cur >= A.entries.length - 1;
      if (!(allDoneHere && isLastEx)) startRest(S.restSec);
      if (allDoneHere && !isLastEx) toast('Exercise done ✓ — Next ›');
      if (allDoneHere && isLastEx) toast('All sets done — Finish 🏁');
      if (allDoneHere && !entry.asked) { entry.asked = true; askTop = true; }
    }
    save();
    route();
    if (askTop) {
      const maxW = Math.max(0, ...entry.sets.map(x => x.w || 0), entry.target.weight || 0, (S.exWeights[entry.id] || {}).w || 0);
      if (maxW > 0) topWeightSheet(entry);
    }
  }));
  const as = $('#wo-addset');
  if (as) as.onclick = () => {
    const lastSet = entry.sets[entry.sets.length - 1];
    entry.sets.push({ w: lastSet ? lastSet.w : 0, r: lastSet ? lastSet.r : entry.target.reps, done: false });
    save(); route();
  };
}

/* end-of-exercise weight confirmation: tracks the working weight,
   highest ever entered becomes next time's default */
function topWeightSheet(entry) {
  const ex = EXIDX[entry.id];
  if (!ex) return;
  const maxSet = Math.max(0, ...entry.sets.filter(s => s.done).map(s => s.w || 0));
  const prevBest = Math.max((S.exWeights[entry.id] || {}).w || 0, bestWeightFor(entry.id));
  const def = Math.max(maxSet, prevBest) || entry.target.weight || 0;
  const m = openModal(`
    <h3 class="capitalize">✓ ${esc(ex.n)}</h3>
    <div class="muted small">Exercise done! How much weight did you work with?<br>The highest weight becomes your default next time.</div>
    <div class="bwin"><input type="number" inputmode="decimal" step="0.5" id="tw-in" value="${def}"><span>${S.unit}</span></div>
    ${prevBest > 0 ? `<div class="small dim" style="text-align:center;margin-bottom:12px">Previous best: ${fmtNum(prevBest)} ${S.unit}${maxSet > prevBest ? ' — <span style="color:var(--gold)">new record! 🏆</span>' : ''}</div>` : ''}
    <button class="btn primary" id="tw-save">Save weight</button>
    <div style="height:8px"></div>
    <button class="btn ghost dim" id="tw-skip">Skip</button>`);
  const inp = m.el.querySelector('#tw-in');
  setTimeout(() => { inp.focus(); inp.select(); }, 250);
  m.el.querySelector('#tw-save').onclick = () => {
    const v = parseFloat(inp.value);
    if (!isFinite(v) || v < 0) { toast('Enter a valid weight'); return; }
    entry.topW = v;
    const cur = S.exWeights[entry.id];
    S.exWeights[entry.id] = { w: Math.max(v, cur ? cur.w : 0), d: todayISO() };
    save(); m.close();
    toast('Tracked — next time starts at ' + fmtNum(S.exWeights[entry.id].w) + ' ' + S.unit + ' 📈');
  };
  m.el.querySelector('#tw-skip').onclick = () => m.close();
}

function finishWorkout() {
  const A = S.active;
  const done = setsDoneActive();
  if (!done && !confirm('No sets logged — finish anyway?')) return;
  if (done < A.entries.reduce((n, e) => n + e.sets.length, 0) && done > 0) {
    if (!confirm('Some sets are unchecked. Finish workout?')) return;
  }
  // PRs: compare vs history BEFORE saving
  const prs = [];
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w));
    if (mx > 0 && mx > bestWeightFor(e.id)) prs.push(e.id);
  });
  const w = {
    id: A.id, d: A.d, start: A.start, end: Date.now(),
    routineId: A.routineId, name: A.name, bw: A.bw,
    entries: A.entries.map(e => ({ id: e.id, sets: e.sets, topW: e.topW || null })).filter(e => e.sets.some(s => s.done)),
    prs
  };
  w.vol = workoutVolume(w);
  // remember highest weight per exercise → default next time
  w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0), e.topW || 0);
    if (mx > 0) {
      const cur = S.exWeights[e.id];
      if (!cur || mx > cur.w) S.exWeights[e.id] = { w: mx, d: w.d };
    }
  });
  S.workouts.push(w);
  S.active = null;
  save(); stopRest();
  beep(880, .15); beep(1100, .15, .18); beep(1320, .3, .36);
  const m = openModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:3rem">🎉</div>
      <h3 style="margin:8px 0">Workout complete!</h3>
      <div class="tiles" style="text-align:left">
        <div class="tile"><div class="l">Duration</div><div class="v" style="font-size:1.1rem">${fmtDur(w.end - w.start)}</div></div>
        <div class="tile"><div class="l">Volume</div><div class="v" style="font-size:1.1rem">${fmtVol(w.vol)}</div></div>
        <div class="tile"><div class="l">Sets</div><div class="v" style="font-size:1.1rem">${setsDone(w)}</div></div>
        <div class="tile"><div class="l">PRs</div><div class="v" style="font-size:1.1rem">${prs.length ? '🏆 ' + prs.length : '—'}</div></div>
      </div>
      ${prs.length ? `<div style="text-align:left;margin-bottom:12px">${prs.map(id => `<div class="small accent capitalize">🏆 New PR: ${esc((EXIDX[id] || {}).n || id)}</div>`).join('')}</div>` : ''}
      <button class="btn primary" id="sum-ok">Nice! 💪</button>
    </div>`, 'center');
  m.lock(true);
  m.el.querySelector('#sum-ok').onclick = () => { m.close(); nav('#home'); };
}

/* ---------- activity heatmap (GitHub-style) ---------- */
function heatmapHTML() {
  const agg = {};                       // iso -> {n, vol}
  S.workouts.forEach(w => {
    const a = agg[w.d] = agg[w.d] || { n: 0, vol: 0 };
    a.n++; a.vol += w.vol || 0;
  });
  const vols = Object.values(agg).map(a => a.vol).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => vols.length ? vols[Math.min(vols.length - 1, Math.floor(p * vols.length))] : 0;
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  const level = a => !a ? 0 : !a.vol ? 1 : a.vol >= t3 ? 4 : a.vol >= t2 ? 3 : a.vol >= t1 ? 2 : 1;

  const today = new Date(); today.setHours(12, 0, 0, 0);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  // current week's Monday, then back 52 weeks
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const start = new Date(end); start.setDate(end.getDate() - 52 * 7);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let cols = '', months = '', lastMonth = -1;
  for (let wk = 0; wk <= 52; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7);
    const m = colStart.getMonth();
    months += `<span>${m !== lastMonth && colStart.getDate() <= 7 && wk < 51 ? MON[m] : ''}</span>`;
    if (colStart.getDate() <= 7) lastMonth = m;
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d);
      const key = iso(day);
      const a = agg[key];
      const isToday = key === todayISO();
      const future = day > today;
      cells += `<div class="hm-c l${level(a)}${isToday ? ' today' : ''}${future ? ' future' : ''}"${a ? ` data-hm="${key}"` : ''} title="${key}${a ? ' · ' + a.n + ' workout' + (a.n > 1 ? 's' : '') + ' · ' + fmtVol(a.vol) : ''}"></div>`;
    }
    cols += `<div class="hm-col">${cells}</div>`;
  }
  return `
  <div class="hm-wrap" id="hm-wrap">
    <div class="hm-months">${months}</div>
    <div class="hm-body">
      <div class="hm-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
      <div class="hm-grid">${cols}</div>
    </div>
  </div>
  <div class="hm-legend">Less <div class="hm-c l0"></div><div class="hm-c l1"></div><div class="hm-c l2"></div><div class="hm-c l3"></div><div class="hm-c l4"></div> More</div>`;
}
function bindHeatmap(root) {
  const wrap = root.querySelector('#hm-wrap');
  if (wrap) wrap.scrollLeft = wrap.scrollWidth;              // land on "now"
  root.querySelectorAll('[data-hm]').forEach(c => c.addEventListener('click', () => {
    const day = c.dataset.hm;
    const list = S.workouts.filter(w => w.d === day);
    if (list.length === 1) return workoutDetailSheet(list[0]);
    const m = openModal(`<h3>${fmtDate(day, true)}</h3><div class="list">${list.map(workoutItem).join('')}</div>`);
    m.el.querySelectorAll('[data-wid]').forEach(el => el.addEventListener('click', () => {
      const w = S.workouts.find(x => x.id === el.dataset.wid);
      if (w) { m.close(); workoutDetailSheet(w); }
    }));
  }));
}

/* ============================================================
   VIEW: STATS + HISTORY
   ============================================================ */
let statsRange = 90, statsEx = null;
function viewStats(app) {
  const now = Date.now();
  const bwPts = S.bodyweight
    .filter(b => statsRange === 0 || (b.t || new Date(b.d).getTime()) > now - statsRange * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }));
  const bw30 = S.bodyweight.filter(b => (b.t || new Date(b.d).getTime()) > now - 30 * 86400000);
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length-1].w - bw30[0].w : null;
  const monthW = S.workouts.filter(w => w.d.slice(0, 7) === todayISO().slice(0, 7)).length;

  // exercises with history
  const exHist = [...new Set(S.workouts.flatMap(w => w.entries.map(e => e.id)))]
    .filter(id => EXIDX[id]).sort((a, b) => EXIDX[a].n < EXIDX[b].n ? -1 : 1);
  if (!statsEx || !exHist.includes(statsEx)) statsEx = exHist[0] || null;
  let exChart = '', exList = '';
  if (statsEx) {
    const pts = [];
    S.workouts.forEach(w => {
      const en = w.entries.find(e => e.id === statsEx);
      if (en) {
        const mx = Math.max(0, ...en.sets.filter(s => s.done).map(s => s.w), en.topW || 0);
        if (mx > 0) pts.push({ t: w.start, y: mx, d: w.d, sets: en.sets.filter(s => s.done) });
      }
    });
    exChart = lineChart(pts.map(p => ({ t: p.t, y: p.y, d: p.d })), { h: 150, unit: S.unit, color: 'var(--blue)' });
    exList = pts.slice(-5).reverse().map(p =>
      `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--bg2)">
        <span class="muted">${fmtDate(p.d, true)}</span>
        <span>${p.sets.map(s => fmtNum(s.w) + '×' + s.r).join('  ')}</span></div>`).join('');
  }

  app.innerHTML = `
  <div class="hdr"><div><h1>Stats</h1><div class="sub">Progress & history</div></div>
    <button class="iconbtn" id="btn-hist">🗂</button></div>

  <div class="tiles">
    <div class="tile"><div class="l">Workouts</div><div class="v">${S.workouts.length}</div></div>
    <div class="tile"><div class="l">This month</div><div class="v">${monthW}</div></div>
    <div class="tile"><div class="l">Week streak</div><div class="v">${streakWeeks()} 🔥</div></div>
    <div class="tile"><div class="l">Weight 30d</div><div class="v" style="font-size:1.15rem">${bwDelta30 === null ? '—' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}</div></div>
  </div>

  <div class="card">
    <h2>Activity — last 12 months</h2>
    ${heatmapHTML()}
  </div>

  <div class="card">
    <div class="row between" style="margin-bottom:8px">
      <h2 style="margin:0">Body weight</h2>
      <button class="btn sm" id="st-logbw">+ Log</button>
    </div>
    <div class="chips" style="margin-bottom:8px">
      ${[[30,'1M'],[90,'3M'],[365,'1Y'],[0,'All']].map(([d, l]) =>
        `<button class="chip${statsRange === d ? ' on' : ''}" data-range="${d}">${l}</button>`).join('')}
    </div>
    <div class="chart">${lineChart(bwPts, { h: 160, unit: S.unit })}</div>
  </div>

  <div class="card">
    <h2>Exercise progress</h2>
    ${exHist.length ? `
      <select class="input capitalize" id="st-ex" style="margin-bottom:10px">
        ${exHist.map(id => `<option value="${id}"${id === statsEx ? ' selected' : ''}>${esc(EXIDX[id].n)}</option>`).join('')}
      </select>
      <div class="chart">${exChart}</div>
      <div style="margin-top:8px">${exList}</div>
      <div class="small dim" style="margin-top:8px">Best set weight per workout · Best ever: <b class="accent">${fmtNum(bestWeightFor(statsEx))} ${S.unit}</b></div>`
    : '<div class="muted small">Finish your first workout to see strength curves here. 📈</div>'}
  </div>

  ${S.workouts.length ? `
  <div class="row between" style="margin-bottom:10px">
    <h4 class="sec" style="margin:0">History</h4>
    <button class="btn sm ghost accent" id="st-histall">All ${S.workouts.length} ›</button>
  </div>
  <div class="list">${[...S.workouts].reverse().slice(0, 5).map(workoutItem).join('')}</div>` : ''}
  `;

  $('#btn-hist').onclick = () => nav('#history');
  $('#st-logbw').onclick = () => bwSheet();
  app.querySelectorAll('[data-range]').forEach(c => c.addEventListener('click', () => { statsRange = +c.dataset.range; route(); }));
  const sel = $('#st-ex'); if (sel) sel.addEventListener('change', () => { statsEx = sel.value; route(); });
  const ha = $('#st-histall'); if (ha) ha.onclick = () => nav('#history');
  bindWorkoutItems(app);
  bindHeatmap(app);
  bindCharts(app);
}

function viewHistory(app) {
  app.innerHTML = `
  <div class="hdr"><button class="iconbtn" id="btn-back">‹</button>
    <div style="flex:1;margin-left:12px"><h1>History</h1><div class="sub">${S.workouts.length} workouts</div></div></div>
  ${S.workouts.length ? `<div class="list">${[...S.workouts].reverse().map(workoutItem).join('')}</div>`
    : '<div class="empty"><div class="ico">🗂</div>No workouts yet.</div>'}`;
  $('#btn-back').onclick = () => nav('#stats');
  bindWorkoutItems(app);
}

function workoutDetailSheet(w) {
  const m = openModal(`
    <h3>${esc(w.name)}</h3>
    <div class="muted small" style="margin-bottom:12px">${fmtDate(w.d, true)} · ${fmtDur(w.end - w.start)} · ${fmtVol(w.vol)}${w.bw ? ' · ⚖️ ' + fmtNum(w.bw) + ' ' + S.unit : ''}</div>
    ${w.entries.map(e => {
      const ex = EXIDX[e.id];
      return `<div class="row" style="margin-bottom:12px;align-items:flex-start">
        ${ex ? imgEl(ex) : ''}
        <div class="grow"><div class="tt capitalize" style="font-weight:700">${esc(ex ? ex.n : e.id)} ${w.prs && w.prs.includes(e.id) ? '<span class="pr">🏆 PR</span>' : ''}</div>
        <div class="ss">${e.sets.filter(s => s.done).map(s => fmtNum(s.w) + '×' + s.r).join('  ·  ') || 'no sets'}</div></div></div>`;
    }).join('')}
    <button class="btn danger" id="wd-del">Delete workout</button>`);
  m.el.querySelector('#wd-del').onclick = () => {
    if (!confirm('Delete this workout from history?')) return;
    S.workouts = S.workouts.filter(x => x.id !== w.id);
    save(); m.close(); route(); toast('Workout deleted');
  };
}

/* ============================================================
   VIEW: LIBRARY
   ============================================================ */
let libQ = '', libBP = '', libShown = 40;
function viewLibrary(app) {
  app.innerHTML = `
  <div class="hdr"><div><h1>Exercises</h1><div class="sub">${EXDB.length} exercises with animations</div></div></div>
  <div class="search" style="margin-bottom:10px"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="input" id="lib-q" placeholder="Search…" value="${esc(libQ)}"></div>
  <div class="chips" id="lib-chips" style="margin-bottom:12px"></div>
  <div class="list" id="lib-list"></div>
  <div style="height:10px"></div>
  <button class="btn" id="lib-more" style="display:none">Show more</button>`;

  const chipsEl = $('#lib-chips'), listEl = $('#lib-list'), moreBtn = $('#lib-more');
  function filtered() {
    return EXDB.filter(e =>
      (!libBP || e.bp === libBP) &&
      (!libQ || e.n.includes(libQ) || e.tg.includes(libQ) || e.eq.includes(libQ)));
  }
  function draw() {
    chipsEl.innerHTML = `<button class="chip${!libBP ? ' on' : ''}" data-bp="">All</button>` +
      BODYPARTS.map(b => `<button class="chip${libBP === b ? ' on' : ''}" data-bp="${b}">${b}</button>`).join('');
    chipsEl.querySelectorAll('.chip').forEach(c => c.onclick = () => { libBP = c.dataset.bp; libShown = 40; draw(); });
    const f = filtered();
    listEl.innerHTML = f.slice(0, libShown).map(e => `
      <div class="item" data-ex="${e.id}">${imgEl(e)}
        <div class="grow"><div class="tt">${esc(e.n)}</div>
        <div class="ss">${e.tg || e.bp} · ${e.eq}</div></div>
        ${bestWeightFor(e.id) ? `<span class="tag acc">${fmtNum(bestWeightFor(e.id))}</span>` : ''}
        <span class="chev">›</span></div>`).join('') || '<div class="empty">No match 🤷</div>';
    moreBtn.style.display = f.length > libShown ? '' : 'none';
    listEl.querySelectorAll('[data-ex]').forEach(el => el.addEventListener('click', () => exerciseDetailSheet(EXIDX[el.dataset.ex])));
  }
  moreBtn.onclick = () => { libShown += 40; draw(); };
  $('#lib-q').addEventListener('input', ev => { libQ = ev.target.value.toLowerCase().trim(); libShown = 40; draw(); });
  draw();
}

function exerciseDetailSheet(ex) {
  const last = lastEntryFor(ex.id);
  const best = bestWeightFor(ex.id);
  const m = openModal(`
    <h3 class="capitalize">${esc(ex.n)}</h3>
    ${mediaEl(ex)}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0">
      <span class="tag acc">${ex.bp}</span>
      ${ex.tg ? `<span class="tag">🎯 ${ex.tg}</span>` : ''}
      <span class="tag">🛠 ${ex.eq}</span>
      ${(ex.sm || []).slice(0, 3).map(s => `<span class="tag">${s}</span>`).join('')}
    </div>
    ${best ? `<div class="small" style="margin-bottom:6px">🏆 Best: <b class="accent">${fmtNum(best)} ${S.unit}</b>${last ? ` · last ${fmtDate(last.d)}: ${last.sets.map(s => fmtNum(s.w) + '×' + s.r).join(', ')}` : ''}</div>` : ''}
    ${ex.st && ex.st.length ? `<h4 class="sec">How to</h4><ol class="steps-list">${ex.st.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  `);
  bindMediaToggle(m.el.querySelector('.exmedia'), ex);
}

/* ============================================================
   VIEW: SETTINGS
   ============================================================ */
function viewSettings(app) {
  app.innerHTML = `
  <div class="hdr"><button class="iconbtn" id="btn-back">‹</button>
    <div style="flex:1;margin-left:12px"><h1>Settings</h1></div></div>

  <div class="card">
    <h2>Account</h2>
    ${USER ? `
      <div class="row between">
        <div><b>${esc(USER.name)}</b><div class="small muted">Signed in with passkey — data syncs to this profile.</div></div>
        <button class="btn sm danger" id="acc-out">Sign out</button>
      </div>`
    : `
      <div class="small muted" style="margin-bottom:10px">Guest mode — data lives only in this browser. Create a passkey profile to keep it safe and separate per person.</div>
      ${webauthnOK() ? `<button class="btn primary" id="acc-new">✨ Create passkey profile</button>
      <div style="height:8px"></div>
      <button class="btn" id="acc-in">👤 Sign in with passkey</button>` : '<div class="small dim">Passkeys not supported in this browser.</div>'}`}
  </div>

  <div class="card">
    <h2>Units & timer</h2>
    <div class="row between" style="padding:8px 0">
      <span>Weight unit</span>
      <div class="chips"><button class="chip${S.unit === 'kg' ? ' on' : ''}" data-unit="kg">kg</button>
      <button class="chip${S.unit === 'lb' ? ' on' : ''}" data-unit="lb">lb</button></div>
    </div>
    <div class="row between" style="padding:8px 0">
      <span>Rest timer</span>
      <select class="input" id="set-rest" style="width:120px">
        ${[60, 90, 120, 150, 180].map(s => `<option value="${s}"${S.restSec === s ? ' selected' : ''}>${s}s</option>`).join('')}
      </select>
    </div>
    <div class="row between" style="padding:8px 0">
      <span>Sounds</span>
      <button class="chip${S.sound ? ' on' : ''}" id="set-sound">${S.sound ? 'On 🔔' : 'Off 🔕'}</button>
    </div>
    <div class="small dim" style="margin-top:6px">Note: switching units only changes the label — logged numbers are not converted.</div>
  </div>

  <div class="card">
    <h2>Data</h2>
    <button class="btn" id="set-export">⬇️ Export backup (JSON)</button>
    <div style="height:8px"></div>
    <button class="btn" id="set-import">⬆️ Import backup</button>
    <input type="file" id="set-file" accept=".json,application/json" style="display:none">
    <div style="height:8px"></div>
    <button class="btn" id="set-starter">Load starter plan (PPL)</button>
    <div style="height:8px"></div>
    <button class="btn danger" id="set-reset">Reset everything</button>
  </div>

  <div class="card">
    <h2>Tip</h2>
    <div class="small muted" style="line-height:1.5">📱 In Safari: <b>Share → Add to Home Screen</b> to install GymLog as a full-screen app. All data stays on this device (localStorage) — export a backup now and then!</div>
  </div>
  <div class="dim small" style="text-align:center;margin-top:8px">GymLog · exercise data: hasaneyldrm/exercises-dataset (CC)</div>
  `;

  $('#btn-back').onclick = () => nav('#home');
  const ao = $('#acc-out'); if (ao) ao.onclick = () => { if (confirm('Sign out? Local data is synced to your profile first, then cleared from this device.')) signOut(); };
  const an = $('#acc-new'); if (an) an.onclick = () => registerSheet(true);
  const ai = $('#acc-in'); if (ai) ai.onclick = async () => {
    try {
      const u = await passkeyLogin();
      setUser(u); await pullState(); route();
      toast('Welcome back, ' + u.name + ' 💪');
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || 'Sign-in failed'); }
  };
  app.querySelectorAll('[data-unit]').forEach(c => c.addEventListener('click', () => { S.unit = c.dataset.unit; save(); route(); }));
  $('#set-rest').addEventListener('change', ev => { S.restSec = +ev.target.value; save(); });
  $('#set-sound').onclick = () => { S.sound = !S.sound; save(); route(); };
  $('#set-export').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gymlog-backup-' + todayISO() + '.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Backup exported ✓');
  };
  $('#set-import').onclick = () => $('#set-file').click();
  $('#set-file').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!data.workouts || !data.routines) throw new Error('not a GymLog backup');
        if (!confirm('Replace all current data with this backup?')) return;
        S = Object.assign(JSON.parse(JSON.stringify(DEF)), data);
        save(); toast('Backup imported ✓'); route();
      } catch (e) { toast('Import failed: ' + e.message); }
    };
    rd.readAsText(f);
  });
  $('#set-starter').onclick = () => { loadStarterPlan(); route(); };
  $('#set-reset').onclick = () => {
    if (!confirm('Delete ALL data (plan, workouts, body weight)?')) return;
    if (!confirm('Really sure? This cannot be undone.')) return;
    S = JSON.parse(JSON.stringify(DEF)); save(); stopRest(); nav('#home'); route();
    toast('All data reset');
  };
}

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  try {
    const me = await api('/api/me');
    setUser(me.user);
    await pullState();
  } catch (e) {
    if (e.status === 401) setUser(null);
    else {
      // network error (offline / API down): fall back to cached login
      try { USER = JSON.parse(localStorage.getItem('gym_user')) || null; } catch (x) { USER = null; }
    }
  }
  route();
})();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
