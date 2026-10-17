// Pollock Dreams — ambient fractal music for the infinite painting, played
// live with Web Audio. The same voices as scripts/make-music.cjs (pad, drone,
// bells with falling drip trails, wind, echo and a long reverb), but endless:
// instead of an arc over a fixed length, the form is one more slow 1/f curve.
// Needs pollock.js (mulberry32).
const PollockMusic = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const AHEAD = 3, CTRL = 0.25; // seconds scheduled ahead, control-rate step
  const LEVEL = 2.2; // master gain, set so loud passages peak around -3 dBFS

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
  const scaleNotes = (lo, hi) => { const r = []; for (let m = lo; m <= hi; m++) if (SCALE.includes(m % 12)) r.push(m); return r; };
  const SOFT = [[1, 1, 1], [2, 0.28, 2], [3, 0.1, 3.5]];
  const GLASS = [[1, 1, 1], [2.756, 0.42, 2.5], [5.404, 0.2, 5], [8.933, 0.08, 9]];
  const ATT = 7, REL = 9;
  const curve = (a, b) => Float32Array.from({ length: 64 }, (_, i) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * i / 63)));
  const RISE = curve(0, 1), FALL = curve(1, 0);

  // The whole graph on audio context ac, its output into dest. Nothing sounds
  // until schedule(until) has scheduled the notes up to context time until.
  function graph(ac, seed, dest) {
    const rng = PollockDreams.mulberry32(seed);
    const t0 = ac.currentTime + 0.1; // music time 0

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
    // A smooth 1/f curve over music time: a Voss point every `step` seconds,
    // eased between, made as far as it is asked for.
    function slow(step, rows = 8) {
      const v = voss(rows), pts = [v(), v()];
      return t => {
        const x = Math.max(0, t / step), i = Math.floor(x), f = x - i;
        while (pts.length < i + 2) pts.push(v());
        return pts[i] + (pts[i + 1] - pts[i]) * (0.5 - 0.5 * Math.cos(Math.PI * f));
      };
    }

    // ---- form: slow 1/f waves of intensity, breathing with quicker swells ----
    const form = slow(45, 6), swell = slow(3);
    const intensity = t => clamp((0.2 + 0.85 * form(t)) * Math.min(1, 0.25 + t / 120) * (0.55 + 0.9 * swell(t)), 0, 1.2);

    // ---- buses: dry mix and reverb send into a master ----
    const gain = (v, to) => { const g = ac.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const filter = (type, f, Q, to) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; if (to) b.connect(to); return b; };
    const hp = filter('highpass', 30, 0.5, dest); // keeps the sub-bass out
    const dry = gain(1, hp), send = gain(1);
    const verb = ac.createConvolver();
    verb.buffer = impulse(7, 6);
    send.connect(verb);
    verb.connect(gain(0.9, hp));
    const bus = (wet, level = 1) => { const g = gain(level, dry); g.connect(gain(wet, send)); return g; };

    // Reverb tail: diffuse noise decaying to -60 dB in rt60 seconds, high
    // frequencies dying sooner.
    function impulse(rt60, len) {
      const sr = ac.sampleRate, n = Math.round(len * sr), pre = Math.round(0.03 * sr);
      const b = ac.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let s = pre; s < n; s++) {
          const t = (s - pre) / sr;
          lp += (0.12 + 0.6 * Math.exp(-t / 1.5)) * (rng() * 2 - 1 - lp);
          d[s] = lp * Math.pow(10, -3 * t / rt60) * Math.min(1, t / 0.02);
        }
      }
      return b;
    }

    // Pad: each chord tone as three detuned voices of a soft saw, through a
    // lowpass whose cutoff follows the intensity and its own 1/f drift.
    const padFilter = filter('lowpass', 800, 0.5, bus(0.6));
    const drift = slow(5);
    const saw = (() => {
      const re = new Float32Array(19), im = new Float32Array(19);
      for (let h = 1; h <= 18; h++) im[h] = 0.6 / Math.pow(h, 1.5);
      return ac.createPeriodicWave(re, im, { disableNormalization: true });
    })();
    const chords = [];
    let chordEnd = 0, prev = -1;
    const walk = voss(6);
    function nextChord() {
      let i = Math.floor(walk() * CHORDS.length) % CHORDS.length;
      if (i === prev) i = (i + 1 + Math.floor(rng() * (CHORDS.length - 1))) % CHORDS.length;
      if (!chords.length && prev < 0) i = 0; // start at home
      const len = 14 + Math.pow(2, Math.floor(walk() * 3)) * 7 * (0.8 + rng() * 0.4);
      const c = { t: chordEnd, end: chordEnd + len, notes: CHORDS[i] };
      chords.push(c);
      prev = i; chordEnd = c.end;
      const at = t0 + c.t, end = t0 + c.end;
      c.notes.forEach((m, k) => {
        const lowGain = (k === 0 ? 0.9 : 0.55 / Math.sqrt(k)) * 0.05;
        const env = gain(0, padFilter), trem = gain(0.8 * lowGain, env);
        env.gain.setValueCurveAtTime(RISE, at, ATT);
        env.gain.setValueCurveAtTime(FALL, end, REL);
        const lfo = ac.createOscillator();
        lfo.frequency.value = 0.05 + rng() * 0.12;
        lfo.connect(gain(0.2 * lowGain, trem.gain));
        lfo.start(at); lfo.stop(end + REL);
        lfo.onended = () => env.disconnect();
        for (let v = 0; v < 3; v++) {
          const o = ac.createOscillator();
          o.setPeriodicWave(saw);
          o.frequency.value = mtof(m);
          o.detune.value = (v - 1) * 7 + (rng() - 0.5) * 3;
          const pan = ac.createStereoPanner();
          pan.pan.value = k === 0 ? 0 : clamp((rng() - 0.5) * 0.9 * 2, -1, 1);
          o.connect(pan).connect(trem);
          o.start(at); o.stop(end + REL);
        }
      });
    }
    const chordAt = t => chords.find(c => t < c.end) ?? chords[chords.length - 1];

    // Drone: a D pedal (sine and its fifth), breathing slowly.
    const breath = slow(4);
    const drone = gain(0);
    {
      const out = ac.createChannelMerger(2);
      out.connect(bus(0.2));
      [0.031, 0.027].forEach((f, c) => {
        const side = gain(1);
        drone.connect(side).connect(out, 0, c);
        const lfo = ac.createOscillator();
        lfo.frequency.value = f;
        lfo.connect(gain(0.15, side.gain));
        lfo.start(t0);
      });
      [[1, 0.5], [2, 0.22], [3, 0.08], [1.5, 0.12]].forEach(([r, a], k) => {
        const o = ac.createOscillator();
        o.frequency.value = mtof(38) * r * (1 + k * 0.0004);
        o.connect(gain(a, drone));
        o.start(t0);
      });
    }

    // Wind: pink noise through a wandering band-pass, one per side.
    const wind = [0, 1].map(() => {
      const sr = ac.sampleRate, n = sr * 10, b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let s = 0; s < n; s++) { // Paul Kellet's economy pink filter
        const w = rng() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
        d[s] = (b0 + b1 + b2 + w * 0.1848) * 0.05;
      }
      const src = ac.createBufferSource();
      src.buffer = b; src.loop = true;
      const bp = filter('bandpass', 600, 1.4), g = gain(0);
      src.connect(bp).connect(g);
      src.start(t0, rng() * 10);
      return { bp, g, centre: slow(6) };
    });
    {
      const out = ac.createChannelMerger(2);
      out.connect(bus(0.4));
      wind.forEach((w, c) => w.g.connect(out, 0, c));
    }

    // Bells: decaying partials, with a ping-pong echo darkened on each repeat.
    const bells = bus(0.8, 0.9);
    {
      const split = ac.createChannelSplitter(2), out = ac.createChannelMerger(2);
      bells.connect(split);
      out.connect(dry); out.connect(gain(0.8, send));
      const sides = [0.75, 1.125].map((t, c) => {
        const d = ac.createDelay(2);
        d.delayTime.value = t;
        split.connect(gain(0.35, d), c);
        const lp = filter('lowpass', 3300, 0.5);
        d.connect(lp);
        lp.connect(gain(0.8 * 0.9)).connect(out, 0, 1 - c); // heard on the other side
        return { d, lp };
      });
      sides[0].lp.connect(gain(0.38, sides[1].d));
      sides[1].lp.connect(gain(0.38, sides[0].d));
    }
    function bell(t, m, g, pan, partials, T, attack) {
      const at = t0 + t, p = ac.createStereoPanner();
      p.pan.value = pan * 2 - 1;
      p.connect(bells);
      let last;
      for (const [ratio, amp, tdiv] of partials) {
        const o = ac.createOscillator(), env = gain(0, p), len = T / tdiv;
        o.frequency.value = mtof(m) * ratio * (1 + (rng() - 0.5) * 0.002);
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(amp * g, at + attack);
        env.gain.exponentialRampToValueAtTime(amp * g * 0.001, at + len);
        o.connect(env);
        o.start(at); o.stop(at + len);
        if (!last || len > last.len) last = { o, len };
      }
      last.o.onended = () => p.disconnect();
    }
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
    // three time scales, rate ~ s^-1.7, like the stroke sizes of the painting
    const BASE = 6.5;
    const TIERS = [
      { s: 1, notes: scaleNotes(50, 64), gain: 0.16, T: 7, tone: SOFT, attack: 0.04, accept: I => 0.25 + 0.6 * I },
      { s: 0.5, notes: scaleNotes(62, 76), gain: 0.085, T: 4.5, tone: GLASS, attack: 0.004, accept: I => I * I },
      { s: 0.25, notes: scaleNotes(74, 88), gain: 0.05, T: 2.5, tone: GLASS, attack: 0.002, accept: I => I * I * I * 0.9 },
    ].map(tier => {
      const mean = BASE * Math.pow(tier.s, 1.7);
      return { ...tier, mean, pv: voss(8), tv: voss(6), t: 4 + rng() * mean };
    });
    function ring(tier) {
      const t = tier.t, I = intensity(t);
      if (rng() < tier.accept(I)) {
        const m = pitch(tier.pv(), tier.notes, t), pan = clamp(0.5 + (rng() - 0.5) * 0.8, 0.05, 0.95);
        const g = tier.gain * (0.6 + 0.5 * rng()) * (0.7 + 0.3 * I);
        bell(t, m, g, pan, tier.tone, tier.T * (0.8 + rng() * 0.4), tier.attack);
        if (tier.s === 0.25 && rng() < 0.45) { // a falling trail of drips, each smaller
          let tt = t, gg = g, idx = tier.notes.indexOf(m);
          for (let k = 0, n = 2 + Math.floor(rng() * 4); k < n && idx > 0; k++) {
            tt += 0.12 + rng() * 0.22; idx = Math.max(0, idx - 1 - Math.floor(rng() * 2));
            gg *= 0.55 + rng() * 0.25;
            bell(tt, tier.notes[idx], gg, clamp(pan + (rng() - 0.5) * 0.3, 0, 1), tier.tone, tier.T * 0.7, tier.attack);
          }
        }
      }
      tier.t += tier.mean * Math.exp((tier.tv() - 0.5) * 1.6) * (0.4 + rng() * 1.2);
    }

    // ---- scheduler ----
    let ctrl = 0;
    function schedule(until) {
      const u = until - t0;
      for (; ctrl < u; ctrl += CTRL) { // control-rate curves
        const t = ctrl, at = t0 + t, I = intensity(t);
        padFilter.frequency.linearRampToValueAtTime(350 + 1900 * clamp(0.35 * I + 0.65 * drift(t), 0, 1.1), at);
        drone.gain.linearRampToValueAtTime(0.05 * (0.4 + 0.6 * breath(t)) * Math.min(1, t / 12), at);
        for (const w of wind) {
          w.bp.frequency.linearRampToValueAtTime(250 + 1400 * w.centre(t), at);
          w.g.gain.linearRampToValueAtTime(0.05 * 1.4 * (0.3 + 0.7 * I), at);
        }
      }
      while (chordEnd < u) nextChord();
      while (chords.length > 2 && chords[0].end < u - AHEAD - REL) chords.shift();
      for (const tier of TIERS) while (tier.t < u) ring(tier);
    }
    return { schedule };
  }

  // The player: a context made on the first play() (it has to come from a
  // click or a key press), faded in and out, suspended while off.
  function player(seed) {
    let ac, master, music, timer, off;
    const on = () => !!timer;
    function play() {
      if (on()) return;
      if (!ac) {
        ac = new AudioContext({ latencyHint: 'playback' });
        const limit = ac.createDynamicsCompressor(); // only a safety net
        limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20;
        limit.attack.value = 0.003; limit.release.value = 0.25;
        limit.connect(ac.destination);
        master = ac.createGain();
        master.gain.value = 0;
        master.connect(limit);
        music = graph(ac, seed, master);
      }
      clearTimeout(off);
      ac.resume();
      const tick = () => music.schedule(ac.currentTime + AHEAD);
      tick();
      timer = setInterval(tick, 250);
      const g = master.gain, now = ac.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(LEVEL, now + 1.5);
    }
    function stop() {
      if (!on()) return;
      clearInterval(timer); timer = null;
      const g = master.gain, now = ac.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.5);
      off = setTimeout(() => ac.suspend(), 600);
    }
    return { play, stop, on };
  }

  return { graph, player };
})();
