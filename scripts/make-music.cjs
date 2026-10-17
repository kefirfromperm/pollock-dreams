#!/usr/bin/env node
// Ambient fractal music for the infinite painting, written as a stereo
// 32-bit float WAV.
//
//   node scripts/make-music.cjs [--seed N] [--seconds S] > music.wav
//
// Everything that moves is 1/f (Voss–McCartney) noise: the chord walk, the
// melodies, the timing, the swells. The notes come at three time scales, like
// the strokes of the painting: slow low tones, quicker middle ones and fast
// high drips in falling trails, their rates following N(s) ~ s^-1.7, the
// same law as the stroke sizes. No dependencies.
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, Number(v)]));
const SEED = args.seed ?? 1, DUR = args.seconds ?? 600, SR = 48000;
const N = Math.round(DUR * SR), TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// Voss–McCartney 1/f sequence, spread to roughly uniform [0, 1].
function voss(rows = 8) {
  const r = Array.from({ length: rows }, rng);
  let n = 0;
  return () => {
    n++;
    let k = 0;
    while (k < rows - 1 && !((n >> k) & 1)) k++;
    r[k] = rng();
    const z = (r.reduce((s, v) => s + v, 0) / rows - 0.5) / Math.sqrt(1 / (12 * rows));
    return 1 / (1 + Math.exp(-1.7 * z));
  };
}
// A smooth 1/f curve over time: a Voss point every `step` seconds, eased between.
function slow(step, rows = 8) {
  const v = voss(rows), pts = Array.from({ length: Math.ceil(DUR / step) + 2 }, v);
  return t => {
    const x = t / step, i = Math.floor(x), f = x - i;
    return pts[i] + (pts[i + 1] - pts[i]) * (0.5 - 0.5 * Math.cos(Math.PI * f));
  };
}

// ---- form: an arc over the whole piece, breathing with 1/f swells ----
const ARC = [[0, 0.15], [60, 0.5], [150, 0.8], [240, 1], [330, 0.5], [400, 0.85], [480, 1], [540, 0.65], [600, 0.25]]
  .map(([t, v]) => [t * DUR / 600, v]);
function arc(t) {
  for (let i = 1; i < ARC.length; i++) if (t <= ARC[i][0]) {
    const [t0, v0] = ARC[i - 1], [t1, v1] = ARC[i], f = (t - t0) / (t1 - t0);
    return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * f));
  }
  return ARC[ARC.length - 1][1];
}
const swell = slow(3);
const intensity = t => clamp(arc(t) * (0.55 + 0.9 * swell(t)), 0, 1.2);

// ---- harmony: D dorian, chords walked by 1/f noise ----
const CHORDS = [
  [38, 50, 57, 60, 64, 65], // Dm9
  [36, 48, 55, 59, 62, 64], // Cmaj9
  [43, 50, 57, 59, 62, 64], // G6/9
  [41, 48, 52, 57, 60, 67], // Fmaj7
  [45, 52, 55, 60, 62, 64], // Am7(11)
  [40, 50, 55, 57, 62, 66], // Em7 (dorian colour)
];
const SCALE = [0, 2, 3, 5, 7, 9, 10].map(p => (p + 2) % 12); // D dorian pitch classes
const chords = [];
{
  const walk = voss(6);
  let t = 0, prev = -1;
  while (t < DUR) {
    let i = Math.floor(walk() * CHORDS.length) % CHORDS.length;
    if (i === prev) i = (i + 1 + Math.floor(rng() * (CHORDS.length - 1))) % CHORDS.length;
    if (chords.length === 0) i = 0; // start and...
    const len = 14 + Math.pow(2, Math.floor(walk() * 3)) * 7 * (0.8 + rng() * 0.4);
    chords.push({ t, end: Math.min(DUR, t + len), notes: CHORDS[i] });
    prev = i; t += len;
  }
  chords[chords.length - 1].notes = CHORDS[0]; // ...end at home
}
const chordAt = t => chords.find(c => t < c.end) ?? chords[chords.length - 1];

// ---- buses ----
const bus = () => [new Float32Array(N), new Float32Array(N)];
const pad = bus(), bells = bus(), drone = bus(), wind = bus();

// Pad: each chord tone as three detuned voices from a soft saw wavetable.
const TABLE = 4096, saw = new Float32Array(TABLE + 1);
for (let i = 0; i <= TABLE; i++) {
  let s = 0;
  for (let h = 1; h <= 18; h++) s += Math.sin(TAU * h * i / TABLE) / Math.pow(h, 1.5);
  saw[i] = s * 0.6;
}
const ATT = 7, REL = 9;
for (const c of chords) {
  const s0 = Math.floor(c.t * SR), s1 = Math.min(N, Math.floor((c.end + REL) * SR));
  c.notes.forEach((m, k) => {
    const lowGain = k === 0 ? 0.9 : 0.55 / Math.sqrt(k);
    for (let v = 0; v < 3; v++) {
      const f = mtof(m) * Math.pow(2, ((v - 1) * 7 + (rng() - 0.5) * 3) / 1200);
      const inc = f * TABLE / SR, pan = k === 0 ? 0.5 : clamp(0.5 + (rng() - 0.5) * 0.9, 0, 1);
      const gl = Math.cos(pan * Math.PI / 2) * lowGain * 0.05, gr = Math.sin(pan * Math.PI / 2) * lowGain * 0.05;
      const tremF = 0.05 + rng() * 0.12, tremP = rng() * TAU;
      let ph = rng() * TABLE;
      for (let s = s0; s < s1; s++) {
        const t = s / SR, a = t - c.t, r = c.end - t;
        let env = a < ATT ? 0.5 - 0.5 * Math.cos(Math.PI * a / ATT) : 1;
        if (r < 0) env *= 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, -r / REL));
        const i = ph | 0, x = (saw[i] + (saw[i + 1] - saw[i]) * (ph - i)) * env * (0.8 + 0.2 * Math.sin(TAU * tremF * t + tremP));
        pad[0][s] += x * gl; pad[1][s] += x * gr;
        ph += inc; if (ph >= TABLE) ph -= TABLE;
      }
    }
  });
}
// Pad filter: 2-pole lowpass whose cutoff follows the intensity and its own 1/f drift.
{
  const drift = slow(5);
  for (const ch of pad) {
    let a = 0, b = 0, g = 0;
    for (let s = 0; s < N; s++) {
      if ((s & 63) === 0) {
        const t = s / SR, fc = 350 + 1900 * clamp(0.35 * intensity(t) + 0.65 * drift(t), 0, 1.1);
        g = 1 - Math.exp(-TAU * fc / SR);
      }
      a += g * (ch[s] - a); b += g * (a - b); ch[s] = b;
    }
  }
}

// Drone: a D pedal (sine and its fifth), breathing slowly.
{
  const breath = slow(4), f0 = mtof(38), parts = [[1, 0.5], [2, 0.22], [3, 0.08], [1.5, 0.12]];
  const ph = parts.map(() => rng() * TAU);
  for (let s = 0; s < N; s++) {
    const t = s / SR, e = 0.05 * (0.4 + 0.6 * breath(t)) * Math.min(1, t / 12);
    let x = 0;
    for (let k = 0; k < parts.length; k++) x += Math.sin(ph[k] + TAU * f0 * parts[k][0] * t * (1 + k * 0.0004)) * parts[k][1];
    drone[0][s] = x * e * (1 + 0.15 * Math.sin(TAU * 0.031 * t));
    drone[1][s] = x * e * (1 + 0.15 * Math.sin(TAU * 0.027 * t + 1));
  }
}

// Bells: decaying partials, rendered with a recursive sine oscillator.
function bell(t, m, gain, pan, partials, T, attack) {
  const s0 = Math.floor(t * SR);
  const gl = Math.cos(pan * Math.PI / 2) * gain, gr = Math.sin(pan * Math.PI / 2) * gain;
  for (const [ratio, amp, tdiv] of partials) {
    const f = mtof(m) * ratio * (1 + (rng() - 0.5) * 0.002);
    if (f > SR * 0.45) continue;
    const w = TAU * f / SR, k = 2 * Math.cos(w), dec = Math.exp(-6.9 / (T / tdiv * SR));
    const len = Math.min(N - s0, Math.ceil(T / tdiv * SR)), att = attack * SR;
    let y1 = Math.sin(-w), y2 = Math.sin(-2 * w), env = amp;
    for (let i = 0; i < len; i++) {
      const y = k * y1 - y2; y2 = y1; y1 = y;
      const x = y * env * (i < att ? i / att : 1);
      bells[0][s0 + i] += x * gl; bells[1][s0 + i] += x * gr;
      env *= dec;
    }
  }
}
const SOFT = [[1, 1, 1], [2, 0.28, 2], [3, 0.1, 3.5]];
const GLASS = [[1, 1, 1], [2.756, 0.42, 2.5], [5.404, 0.2, 5], [8.933, 0.08, 9]];
const scaleNotes = (lo, hi) => { const r = []; for (let m = lo; m <= hi; m++) if (SCALE.includes(m % 12)) r.push(m); return r; };
function pitch(v, notes, t) {
  let m = notes[clamp(Math.floor(v * notes.length), 0, notes.length - 1)];
  if (rng() < 0.6) { // lean on the chord tones
    const pcs = chordAt(t).notes.map(n => n % 12);
    let best = m, bd = 99;
    for (const n of notes) { const d = Math.abs(n - m); if (pcs.includes(n % 12) && d < bd) { bd = d; best = n; } }
    m = best;
  }
  return m;
}
// three time scales, rate ~ s^-1.7
const TIERS = [
  { s: 1, notes: scaleNotes(50, 64), gain: 0.16, T: 7, tone: SOFT, attack: 0.04, accept: I => 0.25 + 0.6 * I },
  { s: 0.5, notes: scaleNotes(62, 76), gain: 0.085, T: 4.5, tone: GLASS, attack: 0.004, accept: I => I * I },
  { s: 0.25, notes: scaleNotes(74, 88), gain: 0.05, T: 2.5, tone: GLASS, attack: 0.002, accept: I => I * I * I * 0.9 },
];
const BASE = 6.5;
for (const tier of TIERS) {
  const pv = voss(8), tv = voss(6), mean = BASE * Math.pow(tier.s, 1.7);
  let t = 4 + rng() * mean;
  while (t < DUR - 6) {
    const I = intensity(t);
    if (rng() < tier.accept(I)) {
      const m = pitch(pv(), tier.notes, t), pan = clamp(0.5 + (rng() - 0.5) * 0.8, 0.05, 0.95);
      const g = tier.gain * (0.6 + 0.5 * rng()) * (0.7 + 0.3 * I);
      bell(t, m, g, pan, tier.tone, tier.T * (0.8 + rng() * 0.4), tier.attack);
      if (tier.s === 0.25 && rng() < 0.45) { // a falling trail of drips, each smaller
        let tt = t, mm = m, gg = g, idx = tier.notes.indexOf(m);
        for (let k = 0, n = 2 + Math.floor(rng() * 4); k < n && idx > 0; k++) {
          tt += 0.12 + rng() * 0.22; idx = Math.max(0, idx - 1 - Math.floor(rng() * 2));
          mm = tier.notes[idx]; gg *= 0.55 + rng() * 0.25;
          bell(tt, mm, gg, clamp(pan + (rng() - 0.5) * 0.3, 0, 1), tier.tone, tier.T * 0.7, tier.attack);
        }
      }
    }
    t += mean * Math.exp((tv() - 0.5) * 1.6) * (0.4 + rng() * 1.2);
  }
}
// Ping-pong echo on the bells, darkened on each repeat.
{
  const dl = Math.round(0.75 * SR), dr = Math.round(1.125 * SR), fb = 0.38;
  let lpL = 0, lpR = 0;
  const [L, R] = bells, eL = new Float32Array(N), eR = new Float32Array(N);
  for (let s = 0; s < N; s++) {
    const inL = s >= dl ? L[s - dl] * 0.35 + eR[s - dl] * fb : 0;
    const inR = s >= dr ? R[s - dr] * 0.35 + eL[s - dr] * fb : 0;
    lpL += 0.35 * (inL - lpL); lpR += 0.35 * (inR - lpR);
    eL[s] = lpL; eR[s] = lpR;
  }
  for (let s = 0; s < N; s++) { L[s] += eR[s] * 0.8; R[s] += eL[s] * 0.8; }
}

// Wind: pink noise through a wandering band-pass.
{
  const centre = slow(6);
  wind.forEach((ch, c) => {
    let b0 = 0, b1 = 0, b2 = 0, lo = 0, bp = 0, f = 0;
    for (let s = 0; s < N; s++) {
      const w = rng() * 2 - 1; // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.05;
      if ((s & 63) === 0) f = 2 * Math.sin(Math.PI * (250 + 1400 * centre(s / SR + c * 1.7)) / SR);
      lo += f * bp; bp += f * (pink - lo - 0.7 * bp);
      ch[s] = bp * 0.05 * (0.3 + 0.7 * intensity(s / SR));
    }
  });
}

// ---- reverb: 4 allpass diffusers into an 8-line feedback delay network ----
function reverb(inL, inR, rt60) {
  const outL = new Float32Array(N), outR = new Float32Array(N);
  const ap = [142, 107, 379, 277].map(n => ({ buf: new Float32Array(n * 2), n: n * 2, i: 0 }));
  const lens = [2203, 2617, 3011, 3469, 3907, 4441, 4987, 5503].map(n => Math.round(n * 1.4));
  const lines = lens.map(n => ({ buf: new Float32Array(n), n, i: 0, lp: 0, g: Math.pow(10, -3 * n / (SR * rt60)) }));
  const pre = Math.round(0.03 * SR), out = new Float64Array(8);
  for (let s = 0; s < N; s++) {
    let x = s >= pre ? (inL[s - pre] + inR[s - pre]) * 0.5 : 0;
    for (const a of ap) { const d = a.buf[a.i], y = -0.6 * x + d; a.buf[a.i] = x + 0.6 * y; a.i = (a.i + 1) % a.n; x = y; }
    let sum = 0;
    for (let k = 0; k < 8; k++) { const l = lines[k]; out[k] = l.buf[l.i]; sum += out[k]; }
    sum *= 2 / 8; // Householder feedback matrix
    let l = 0, r = 0;
    for (let k = 0; k < 8; k++) {
      const ln = lines[k], v = (out[k] - sum) * ln.g;
      ln.lp += 0.55 * (v - ln.lp); // high frequencies die sooner
      ln.buf[ln.i] = ln.lp + x * (k & 1 ? 0.5 : -0.5);
      ln.i = (ln.i + 1) % ln.n;
      if (k & 1) r += out[k]; else l += out[k];
    }
    outL[s] = l * 0.35; outR[s] = r * 0.35;
  }
  return [outL, outR];
}
const send = bus();
for (let c = 0; c < 2; c++) for (let s = 0; s < N; s++)
  send[c][s] = pad[c][s] * 0.6 + bells[c][s] * 0.8 + drone[c][s] * 0.2 + wind[c][s] * 0.4;
const wet = reverb(send[0], send[1], 7);

// ---- master ----
const mix = bus();
let peak = 0;
const hp = 1 - Math.exp(-TAU * 30 / SR); // two one-pole high-passes keep the sub-bass out
for (let c = 0; c < 2; c++) {
  let l1 = 0, l2 = 0;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const fade = Math.min(1, t / 4, (DUR - t) / 10);
    let x = pad[c][s] + bells[c][s] * 0.9 + drone[c][s] + wind[c][s] + wet[c][s] * 0.9;
    l1 += hp * (x - l1); x -= l1;
    l2 += hp * (x - l2); x -= l2;
    mix[c][s] = x * fade;
    peak = Math.max(peak, Math.abs(x * fade));
  }
}
const gain = 0.89 / peak; // -1 dBFS
const out = Buffer.alloc(44 + N * 8);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 8, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(3, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 8, 28); out.writeUInt16LE(8, 32); out.writeUInt16LE(32, 34);
out.write('data', 36); out.writeUInt32LE(N * 8, 40);
for (let s = 0; s < N; s++) { out.writeFloatLE(mix[0][s] * gain, 44 + s * 8); out.writeFloatLE(mix[1][s] * gain, 48 + s * 8); }
process.stdout.write(out);
process.stderr.write(`${chords.length} chords, peak gain ${gain.toFixed(2)}\n`);
