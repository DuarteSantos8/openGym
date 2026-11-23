// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Offline pulse analysis for cable-stack sets (see docs/REP_ANALYSIS.md).
// Pure ES module: no DOM, no BLE, no dependencies.

export const DEFAULTS = Object.freeze({
  tau: 4,
  peakMin: 0.45,
  refractory: 1.0,
  clip: 12,
  edge: 0.1,
  minWidthS: 0.25,
  minRiseS: 0.15,
  maxClipFraction: 0.25,
  setupDurRatio: 1.4,
  setupDispRatio: 1.25,
  includeSetupPull: 'auto',
});

export const MAX_DT = 0.1; // integration step guard (s)

/** Accept {t,ax,ay,az} or the app's {elapsed_s, ax_m_s2, ...} samples. */
export function normalizeSamples(samples) {
  const out = [];
  for (const s of samples || []) {
    const t = s.t ?? s.elapsed_s;
    const ax = s.ax ?? s.ax_m_s2;
    const ay = s.ay ?? s.ay_m_s2;
    const az = s.az ?? s.az_m_s2;
    const vals = [t, ax, ay, az];
    if (vals.every((x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)))) {
      out.push({ t: Number(t), ax: Number(ax), ay: Number(ay), az: Number(az) });
    }
  }
  return out;
}

export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Mean accel vector of the stillest `win`-second window among samples in the first `limit` seconds. */
export function estimateGravity(s, win = 1, limit = 5) {
  if (!s.length) return null;
  const tEnd = s[0].t + limit;
  let n = 0;
  while (n < s.length && s[n].t <= tEnd) n++;
  n = Math.max(n, Math.min(s.length, 10));
  const mag = (i) => Math.hypot(s[i].ax, s[i].ay, s[i].az);
  let best = null;
  let bestVar = Infinity;
  let lo = 0;
  let sm = 0;
  let sm2 = 0;
  for (let hi = 0; hi < n; hi++) {
    const mg = mag(hi);
    sm += mg;
    sm2 += mg * mg;
    while (s[hi].t - s[lo].t > win) {
      const ml = mag(lo);
      sm -= ml;
      sm2 -= ml * ml;
      lo++;
    }
    const cnt = hi - lo + 1;
    const spanOk = s[hi].t - s[lo].t >= win * 0.9 || (hi === n - 1 && best === null);
    if (cnt >= 5 && spanOk) {
      const variance = sm2 / cnt - (sm / cnt) ** 2;
      if (variance < bestVar - 1e-12) {
        bestVar = variance;
        best = [lo, hi];
      }
    }
  }
  if (!best) best = [0, n - 1];
  const seg = s.slice(best[0], best[1] + 1);
  // mean (not per-axis median): equivariant under rotation, the window is the stillest second anyway
  return [mean(seg.map((p) => p.ax)), mean(seg.map((p) => p.ay)), mean(seg.map((p) => p.az))];
}

function vertical(s, g, clip) {
  const gn = Math.hypot(g[0], g[1], g[2]);
  const u = g.map((x) => x / gn);
  const aRaw = new Float64Array(s.length);
  const a = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) {
    aRaw[i] = s[i].ax * u[0] + s[i].ay * u[1] + s[i].az * u[2] - gn;
    a[i] = Math.max(-clip, Math.min(clip, aRaw[i]));
  }
  return { a, aRaw };
}

/** Leaky integral using the real dt (gaps/outliers clamped). Returns {v, gaps}. */
export function leakyVelocity(t, a, tau) {
  const v = new Float64Array(a.length);
  let gaps = 0;
  for (let i = 1; i < a.length; i++) {
    let dt = t[i] - t[i - 1];
    if (!(dt > 0)) continue;
    if (dt > MAX_DT) {
      dt = MAX_DT;
      gaps++;
    }
    v[i] = v[i - 1] * Math.max(0, 1 - dt / tau) + a[i] * dt;
  }
  return { v, gaps };
}

function findPulses(t, v, aRaw, o) {
  const peaks = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > o.peakMin && v[i] >= v[i - 1] && v[i] >= v[i + 1]) {
      if (!peaks.length || t[i] - t[peaks[peaks.length - 1]] > o.refractory) peaks.push(i);
      else if (v[i] > v[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
    }
  }
  const pulses = [];
  const rejected = [];
  for (const i of peaks) {
    let lo = i;
    while (lo > 0 && v[lo] > o.edge) lo--;
    let hi = i;
    while (hi < v.length - 1 && v[hi] > o.edge) hi++;
    let disp = 0;
    let clipped = 0;
    for (let k = lo; k < hi; k++) {
      const dt = Math.min(MAX_DT, Math.max(0, t[k + 1] - t[k]));
      disp += v[k] * dt;
      if (Math.abs(aRaw[k]) >= o.clip) clipped++;
    }
    const p = {
      t: t[i], vPeak: v[i], upstrokeCm: disp * 100, upstrokeS: t[hi] - t[lo],
      riseS: t[i] - t[lo], tStart: t[lo], tEnd: t[hi], timeToNextS: null, setup: false,
    };
    const clipFrac = clipped / Math.max(1, hi - lo);
    if (p.upstrokeS < o.minWidthS || p.riseS < o.minRiseS) {
      p.rejected = p.riseS < o.minRiseS ? 'impulse' : 'narrow';
      rejected.push(p);
    } else if (clipFrac > o.maxClipFraction) {
      p.rejected = 'clipping';
      rejected.push(p);
    } else {
      pulses.push(p);
    }
  }
  return { pulses, rejected };
}

export function flagSetupPull(pulses, o = DEFAULTS) {
  if (pulses.length < 3) return false;
  const rest = pulses.slice(1);
  const f = pulses[0];
  return f.upstrokeS > o.setupDurRatio * median(rest.map((p) => p.upstrokeS))
    || f.upstrokeCm > o.setupDispRatio * median(rest.map((p) => p.upstrokeCm));
}

function metricsFor(reps) {
  const m = {
    meanPeakVelocity: null, velocityLossPct: null, meanUpstrokeCm: null,
    meanRepPeriodS: null, repPeriodTrend: null,
  };
  if (!reps.length) return m;
  m.meanPeakVelocity = mean(reps.map((p) => p.vPeak));
  m.meanUpstrokeCm = mean(reps.map((p) => p.upstrokeCm));
  if (reps.length >= 4) {
    const first = mean(reps.slice(0, 2).map((p) => p.vPeak));
    const last = mean(reps.slice(-2).map((p) => p.vPeak));
    m.velocityLossPct = (100 * (first - last)) / first;
  }
  const per = reps.map((p) => p.timeToNextS).filter((x) => x !== null);
  if (per.length) m.meanRepPeriodS = mean(per);
  if (per.length >= 3) { // least-squares slope, seconds per rep
    const n = per.length;
    const mx = (n - 1) / 2;
    const my = mean(per);
    let num = 0;
    let den = 0;
    per.forEach((y, x) => {
      num += (x - mx) * (y - my);
      den += (x - mx) ** 2;
    });
    m.repPeriodTrend = num / den;
  }
  return m;
}

export function analyzeSet(samples, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const warnings = [];
  const empty = (w) => ({
    reps: [], setupPull: null, repCount: 0, totalPulses: 0, metrics: metricsFor([]),
    series: { t: [], aVert: [], v: [] }, warnings: [...warnings, w], gravity: null, rejected: [],
  });
  let s = normalizeSamples(samples);
  if (s.length < 10) return empty('too few samples');
  const mono = s.filter((p, i) => i === 0 || p.t > s[i - 1].t);
  if (mono.length !== s.length) warnings.push(`dropped ${s.length - mono.length} non-monotonic samples`);
  s = mono;
  if (s.length < 10) return empty('too few samples');

  const g = o.gravity && o.gravity.length === 3 ? [...o.gravity] : estimateGravity(s);
  const gn0 = Math.hypot(...g);
  if (!(gn0 > 5 && gn0 < 15)) warnings.push(`gravity magnitude ${gn0.toFixed(2)} m/s^2 looks wrong`);
  const t = Float64Array.from(s, (p) => p.t);
  const { a, aRaw } = vertical(s, g, o.clip);
  const { v, gaps } = leakyVelocity(t, a, o.tau);
  if (gaps) warnings.push(`${gaps} sample gap(s) longer than ${MAX_DT} s`);

  const { pulses, rejected } = findPulses(t, v, aRaw, o);
  pulses.forEach((p, k) => {
    p.n = k + 1;
    p.timeToNextS = k + 1 < pulses.length ? pulses[k + 1].t - p.t : null;
  });
  if (pulses.length) pulses[0].setup = flagSetupPull(pulses, o);
  if (pulses.length && pulses.length < 3) warnings.push('fewer than 3 pulses: setup pull not assessed');
  if (rejected.length) warnings.push(`${rejected.length} pulse(s) rejected as handling noise`);

  const setupPull = pulses.length && pulses[0].setup ? pulses[0] : null;
  const include = o.includeSetupPull === true;
  const reps = pulses.filter((p) => include || !p.setup);
  if (t[t.length - 1] - t[0] < 5) warnings.push('recording shorter than 5 s');
  return {
    reps, setupPull, repCount: reps.length, totalPulses: pulses.length,
    metrics: metricsFor(reps),
    series: { t: Array.from(t), aVert: Array.from(a), v: Array.from(v) },
    warnings, gravity: g, rejected,
  };
}
