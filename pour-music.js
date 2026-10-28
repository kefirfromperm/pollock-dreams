// Pollock Dreams — music for the pour painting, played live with Web Audio:
// ambient in the manner of Soviet electronic space music — the ANS
// synthesizer's glassy clusters of sines, a filtered Polivoks-like pad, a
// theremin gliding between notes, sequenced arpeggios through a wobbling tape
// echo, a held bass and cosmic wind, and the paint gurgling as the painting
// pours it, from where it pours. Nothing whistles: every voice stays low
// enough, and the wind is breathy, never a ringing tone.
// The form is fractal and random: 1/f noise walks the harmony and the
// intensity; notes come on two time scales at rates following a power law;
// the theremin's lines are midpoint-displacement curves and the arpeggios'
// rhythms are split recursively, alike at every scale.
// Needs pollock.js (mulberry32).
const PourMusic = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const AHEAD = 3, CTRL = 0.25; // seconds scheduled ahead, control-rate step
  const LEVEL = 1.3; // master gain, set so loud passages peak around -3 dBFS

  // ---- harmony ----
  // Chords on roots a third apart from one another (chromatic mediants: A,
  // F, C♯, E, C, G♯, D), mostly minor ninths, so each move is a quiet shift to
  // somewhere unexpected. Each chord brings its own mode for the melodies.
  const TYPES = {
    m9: { tones: [0, 3, 7, 10, 14], mode: [0, 2, 3, 5, 7, 9, 10] }, // dorian
    lyd: { tones: [0, 4, 7, 11, 18], mode: [0, 2, 4, 6, 7, 9, 11] }, // lydian, the light one
    sus: { tones: [0, 5, 7, 10, 14], mode: [0, 2, 5, 7, 9, 10] }, // no third at all
  };
  const CHORDS = [[9, 'm9'], [5, 'm9'], [1, 'm9'], [4, 'sus'], [0, 'm9'], [8, 'm9'], [2, 'lyd'], [5, 'lyd']]
    .map(([pc, type]) => {
      const bass = 36 + ((pc - 36) % 12 + 12) % 12; // 36..47
      const upper = TYPES[type].tones.map(i => { let m = bass + i; while (m < 55) m += 12; return m; }).sort((a, b) => a - b);
      return { bass, upper, mode: TYPES[type].mode.map(i => (pc + i) % 12) };
    });
  const notesIn = (mode, lo, hi) => { const r = []; for (let m = lo; m <= hi; m++) if (mode.includes(m % 12)) r.push(m); return r; };
  const ATT = 7, REL = 9;

  function graph(ac, seed, dest) {
    const rng = PollockDreams.mulberry32(seed);
    const t0 = ac.currentTime + 0.1; // music time 0
    const BEAT = 60 / (92 + rng() * 16), STEP = BEAT / 4; // the sequencer's tempo

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
    const form = slow(50, 6), swell = slow(4);
    const intensity = t => clamp((0.2 + 0.85 * form(t)) * Math.min(1, 0.25 + t / 120) * (0.55 + 0.9 * swell(t)), 0, 1.2);

    // ---- buses: dry mix and a long reverb send into a master ----
    const gain = (v, to) => { const g = ac.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const filter = (type, f, Q, to) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; if (to) b.connect(to); return b; };
    const panner = (pan, to) => { const p = ac.createStereoPanner(); p.pan.value = clamp(pan * 2 - 1, -1, 1); p.connect(to); return p; };
    const osc = (type, f) => { const o = ac.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; return o; };
    const hp = filter('highpass', 30, 0.5, dest);
    const dry = gain(1, hp), send = gain(1);
    const verb = ac.createConvolver();
    verb.buffer = impulse(6, 7);
    send.connect(verb);
    verb.connect(gain(0.85, hp));
    // The music can be silenced while the gurgling goes on: every voice's bus
    // passes through a gain set by one shared level (band, 1 or 0, faded),
    // all but the gurgling's and the tape echo's, which the gurgling feeds
    // too (the voices' sends into it are silenced on their own buses).
    const band = ac.createConstantSource();
    band.start();
    const bus = (wet, level = 1, muted = true) => {
      const g = gain(muted ? 0 : level, dry);
      if (muted) band.connect(gain(level, g.gain)); // level × band
      g.connect(gain(wet, send));
      return g;
    };

    // Reverb tail: a large hall, diffuse noise decaying to -60 dB in rt60
    // seconds, the highs dying sooner.
    function impulse(rt60, len) {
      const sr = ac.sampleRate, n = Math.round(len * sr), pre = Math.round(0.03 * sr);
      const b = ac.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let s = pre; s < n; s++) {
          const t = (s - pre) / sr;
          lp += (0.06 + 0.4 * Math.exp(-t / 1.2)) * (rng() * 2 - 1 - lp);
          d[s] = lp * Math.pow(10, -3 * t / rt60) * Math.min(1, t / 0.02);
        }
      }
      return b;
    }
    const noise = (() => {
      const sr = ac.sampleRate, b = ac.createBuffer(1, sr * 3, sr), d = b.getChannelData(0);
      for (let s = 0; s < d.length; s++) d[s] = rng() * 2 - 1;
      return b;
    })();
    // a curve for setValueCurveAtTime: rise over a, hold, fall over r, of a
    // total length len (seconds), times a slow random drift
    function envCurve(len, a, r, peak, drift) {
      const N = 48, pts = Array.from({ length: 6 }, rng);
      return Float32Array.from({ length: N }, (_, i) => {
        const t = len * i / (N - 1), x = i / (N - 1) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(x)), f = x - k;
        const wander = pts[k] + (pts[k + 1] - pts[k]) * (0.5 - 0.5 * Math.cos(Math.PI * f));
        const e = Math.min(1, t / a, (len - t) / r);
        return peak * Math.max(0, 0.5 - 0.5 * Math.cos(Math.PI * e)) * (1 - drift + drift * wander);
      });
    }

    // Tape echo: two heads, their delay times wobbling with wow and flutter,
    // each repeat darker and thinner, crossing sides.
    const echo = bus(0.5, 1, false);
    {
      const split = ac.createChannelSplitter(2), out = ac.createChannelMerger(2);
      echo.connect(split);
      out.connect(dry); out.connect(gain(0.7, send));
      const wow = osc('sine', 0.31), flutter = osc('sine', 5.7);
      wow.start(); flutter.start();
      const heads = [BEAT * 0.75, BEAT].map((t, c) => {
        const d = ac.createDelay(3);
        d.delayTime.value = t;
        wow.connect(gain(0.004, d.delayTime));
        flutter.connect(gain(0.0006, d.delayTime));
        split.connect(gain(0.35, d), c);
        const tone = filter('lowpass', 2400, 0.6);
        d.connect(filter('highpass', 180, 0.5)).connect(tone);
        tone.connect(gain(0.8)).connect(out, 0, 1 - c);
        return { d, tone };
      });
      heads[0].tone.connect(gain(0.42, heads[1].d));
      heads[1].tone.connect(gain(0.42, heads[0].d));
    }

    // ANS cluster: every chord tone, the lower ones an octave up too, as three
    // sines a few cents apart, each fading in and out on its own: a glassy,
    // shimmering field, as drawn on the ANS's glass plate.
    const glass = bus(0.85, 0.9);
    function cluster(c) {
      const at = t0 + c.t, len = c.end - c.t + REL;
      for (const base of c.upper) for (const oct of base < 67 ? [0, 12] : [0]) for (let v = 0; v < 3; v++) {
        const o = osc('sine', mtof(base + oct) * Math.pow(2, ((v - 1) * (3 + rng() * 6) + (rng() - 0.5) * 2) / 1200));
        const env = gain(0, panner(rng(), glass));
        env.gain.setValueCurveAtTime(envCurve(len, ATT, REL, 0.007 / (1 + oct / 12), 0.9), at, len);
        o.connect(env);
        o.start(at); o.stop(at + len);
      }
    }

    // Pad: the chord's lower tones as pairs of detuned saws through one
    // resonant low-pass that opens slowly and closes again, a Polivoks sweep.
    const saw = (() => {
      const re = new Float32Array(33), im = new Float32Array(33);
      for (let h = 1; h <= 32; h++) im[h] = 0.6 / h;
      return ac.createPeriodicWave(re, im, { disableNormalization: true });
    })();
    const pads = bus(0.6, 0.8);
    function pad(c) {
      const at = t0 + c.t, len = c.end - c.t + REL;
      const lp = filter('lowpass', 250, 6 + rng() * 4), env = gain(0);
      lp.connect(env).connect(pads);
      env.gain.setValueCurveAtTime(envCurve(len, ATT, REL, 0.018, 0.3), at, len);
      const open = 900 + rng() * 1400;
      lp.frequency.setValueAtTime(250, at);
      lp.frequency.exponentialRampToValueAtTime(open, at + len * (0.3 + rng() * 0.3));
      lp.frequency.exponentialRampToValueAtTime(220, at + len);
      for (const m of [c.bass + 12, ...c.upper.slice(0, 3)]) for (let v = 0; v < 2; v++) {
        const o = osc(saw, mtof(m));
        o.detune.value = (v - 0.5) * 14 + (rng() - 0.5) * 6;
        o.connect(panner(0.5 + (v - 0.5) * 0.7, lp));
        o.start(at); o.stop(at + len);
      }
    }

    // Bass: the root held under the chord, a sine with a little of its octave.
    const lows = filter('lowpass', 260, 0.7, bus(0.12));
    function bass(c) {
      const at = t0 + c.t, len = c.end - c.t + REL;
      const env = gain(0, lows);
      env.gain.setValueCurveAtTime(envCurve(len, 3, REL * 0.7, 0.05, 0.15), at, len);
      for (const [r, a] of [[1, 1], [2, 0.3]]) {
        const o = osc('sine', mtof(c.bass) * r), g = gain(a, env);
        o.connect(g);
        o.start(at); o.stop(at + len);
      }
    }

    // ---- chords, walked by 1/f noise ----
    const chords = [];
    let chordEnd = 0, prev = -1;
    const walk = voss(6);
    function nextChord() {
      let i = Math.floor(walk() * CHORDS.length) % CHORDS.length;
      if (i === prev) i = (i + 1 + Math.floor(rng() * (CHORDS.length - 1))) % CHORDS.length;
      if (prev < 0) i = 0;
      const len = 16 + Math.pow(2, Math.floor(walk() * 3)) * 8 * (0.8 + rng() * 0.4);
      const c = { t: chordEnd, end: chordEnd + len, ...CHORDS[i] };
      chords.push(c);
      prev = i; chordEnd = c.end;
      cluster(c); pad(c); bass(c);
    }
    const chordAt = t => chords.find(c => t < c.end) ?? chords[chords.length - 1];

    // Theremin: one continuous tone over a whole phrase, gliding from note to
    // note, its vibrato widening as each note is held. The line is a
    // midpoint-displacement curve between two chord tones, so it wanders
    // alike at every scale, then set to the chord's mode.
    const thereminWave = (() => {
      const re = new Float32Array(5), im = new Float32Array(5);
      im[1] = 1; im[2] = 0.12; im[3] = 0.05; im[4] = 0.02;
      return ac.createPeriodicWave(re, im);
    })();
    const voices = bus(0.8, 0.9);
    voices.connect(gain(0.6, echo));
    function contour(levels, a, b, spread) {
      let pts = [a, b];
      for (let l = 0; l < levels; l++, spread *= 0.55) {
        const next = [pts[0]];
        for (let i = 1; i < pts.length; i++) next.push((pts[i - 1] + pts[i]) / 2 + (rng() * 2 - 1) * spread, pts[i]);
        pts = next;
      }
      return pts;
    }
    function theremin(tier, t, I) {
      const c = chordAt(t), notes = notesIn(c.mode, 55, 76);
      const tone = m => notes.findIndex(n => n >= m);
      const tones = c.upper.map(tone).filter(i => i >= 0);
      if (!tones.length) return t;
      const a = tones[Math.floor(tier.pv() * tones.length)], b = tones[Math.floor(rng() * tones.length)];
      const line = contour(1 + Math.floor(rng() * 3), a, b, 3 + rng() * 3)
        .map(v => notes[clamp(Math.round(v), 0, notes.length - 1)])
        .filter((m, i, l) => i === 0 || m !== l[i - 1]);
      const at = t0 + t, pan = 0.25 + rng() * 0.5, g = 0.05 * (0.7 + 0.3 * I);
      const o = osc(thereminWave, mtof(line[0])), env = gain(0, panner(pan, voices));
      const vib = osc('sine', 5.2 + rng() * 1.2), depth = gain(0);
      vib.connect(depth).connect(o.detune);
      o.connect(env);
      let tt = at;
      line.forEach((m, k) => {
        const dur = (k === line.length - 1 ? 2.5 : 0.8) + rng() * 1.8 * (k === line.length - 1 ? 1 : 0.6);
        o.frequency.setTargetAtTime(mtof(m), tt, 0.06 + rng() * 0.12); // the glide
        env.gain.setTargetAtTime(g * (0.75 + 0.25 * rng()), tt, k ? 0.15 : 0.3);
        depth.gain.setTargetAtTime(0, tt, 0.05);
        depth.gain.setTargetAtTime(18 + rng() * 14, tt + 0.3, dur * 0.4);
        tt += dur;
      });
      env.gain.setTargetAtTime(0, tt, 0.5);
      for (const s of [o, vib]) { s.start(at); s.stop(tt + 3); }
      return tt - t0;
    }

    // Sequencer: a burst of arpeggio up and down the chord in sixteenths,
    // on a square-ish pulse plucked through a resonant filter, into the tape
    // echo. Its rhythm is split recursively: a span is either one note or two
    // halves, so long notes and quick runs come at every scale.
    const pulse = (() => {
      const re = new Float32Array(31), im = new Float32Array(31);
      for (let n = 1; n <= 30; n++) re[n] = 2 / (n * Math.PI) * Math.sin(n * Math.PI * 0.28);
      return ac.createPeriodicWave(re, im);
    })();
    const seqOut = bus(0.45, 0.85);
    seqOut.connect(gain(0.9, echo));
    function rhythm(n) {
      const hits = [];
      (function split(at, len) {
        if (len === 1 || rng() < [0, 0.45, 0.3, 0, 0.2, 0, 0, 0, 0.12][Math.min(len, 8)] || (len > 8 && rng() < 0.05)) {
          if (rng() < 0.88) hits.push([at, len]);
          return;
        }
        split(at, len / 2); split(at + len / 2, len / 2);
      })(0, n);
      return hits;
    }
    function sequence(tier, t, I) {
      const c = chordAt(t), steps = 16 << Math.floor(rng() * 3); // a power of two, to split
      const pool = [...c.upper, ...c.upper.map(m => m + 12)].filter(m => m <= 79).sort((a, b) => a - b);
      const sweep = slow(STEP * 8), start = t0 + Math.ceil(t / STEP) * STEP; // on the grid
      let idx = Math.floor(tier.pv() * pool.length), dir = 1;
      const g = 0.06 * (0.6 + 0.4 * I), pan = 0.3 + rng() * 0.4;
      for (const [at, len] of rhythm(steps)) {
        const s = start + at * STEP, dur = len * STEP * 0.85, f = mtof(pool[idx]);
        const o = osc(pulse, f), lp = filter('lowpass', 0, 8), env = gain(0, panner(pan + (rng() - 0.5) * 0.2, seqOut));
        o.connect(lp).connect(env);
        const top = 600 + 3200 * sweep(at * STEP);
        lp.frequency.setValueAtTime(top, s);
        lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 1.2), s + Math.min(dur, 0.25));
        env.gain.setValueAtTime(0, s);
        env.gain.linearRampToValueAtTime(g, s + 0.004);
        env.gain.setTargetAtTime(0, s + dur, 0.05);
        o.start(s); o.stop(s + dur + 0.4);
        idx += dir;
        if (idx >= pool.length - 1 || idx <= 0) { dir = -dir; idx = clamp(idx, 0, pool.length - 1); }
      }
      return t + steps * STEP;
    }

    // Gurgling: thick paint bubbling, wherever and whenever the painting
    // pours (see pour). A bubble rings as a sine that rises in pitch as it
    // nears the surface and dies away within a few of its own periods; the
    // bigger the bubble, the lower and longer. Their sizes follow a power law
    // (many small, a few big ones), all low, so they glug rather than chirp.
    // The bubbles have their own random numbers, so however the painting's
    // frames fall, the rest of the music stays the same.
    const gurgles = filter('lowpass', 1400, 0.5, bus(0.25, 1, false));
    gurgles.connect(gain(0.35, echo));
    const fizz = PollockDreams.mulberry32(seed ^ 0x5bd1e995);
    function bubble(at, g, pan, big = 1) {
      const size = Math.pow(1 - fizz() * 0.97, -1 / 1.3) * big; // power law, ≥ 1
      const f = clamp(600 / size, 90, 600) * (0.9 + fizz() * 0.2);
      const len = clamp(9 / f, 0.03, 0.16), o = osc('sine', f);
      const env = gain(0, panner(clamp(pan + (fizz() - 0.5) * 0.1, 0, 1), gurgles));
      o.connect(env);
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * (1.15 + fizz() * 0.3), at + len);
      g *= clamp(0.4 + 0.25 * size, 0.4, 1.4);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(g, at + 0.003);
      env.gain.exponentialRampToValueAtTime(g * 0.001, at + len);
      o.start(at); o.stop(at + len + 0.01);
    }
    // A stream landing somewhere new splashes: a burst of bigger bubbles, its
    // timing split recursively (bursts within bursts).
    function splash(at, g, pan) {
      const span = 0.3 + fizz() * 0.7;
      (function split(a, len, depth) {
        if (depth > 6 || len < 0.025 || fizz() < 0.12) { bubble(a + fizz() * len, g, pan, 1.6); return; }
        const cut = 0.3 + fizz() * 0.4; // uneven halves: the bursts cluster
        if (fizz() < 0.85) split(a, len * cut, depth + 1);
        if (fizz() < 0.85) split(a + len * cut, len * (1 - cut), depth + 1);
      })(at, span, 0);
    }
    // How the painting poured over dt seconds from music time t: the stream's
    // flow (1 on average, swelling and thinning with the shaking hand), where
    // it was across the screen (pan, −1 left to 1 right) and whether it has
    // just landed somewhere new. While it pours it bubbles at random, the
    // more the thicker it flows (∝ flow⁴, so the swells glug and the lulls
    // go quiet), and louder when the music is.
    let due = -Math.log(1 - fizz()), poured = 0;
    function pour(t, dt, { flow, pan, fresh }) {
      if (t < 0) return;
      const I = intensity(t), g = 0.2 * (0.7 + 0.3 * I), p = clamp((pan + 1) / 2, 0, 1);
      if (fresh) splash(t0 + t, g, p);
      if (dt <= 0) return;
      const rate = 3 * Math.pow(Math.max(0, flow), 4) * (0.5 + 0.6 * I);
      for (poured += rate * dt; poured >= due; due -= Math.log(1 - fizz()))
        bubble(t0 + t + dt * (1 - (poured - due) / (rate * dt)), g, p);
    }
    const time = () => ac.currentTime - t0;

    // Cosmic wind: noise through a band-pass sweeping slowly, rising with the
    // intensity.
    const wind = ac.createBufferSource();
    wind.buffer = noise; wind.loop = true;
    const windBand = filter('bandpass', 400, 1.2), windGain = gain(0, bus(0.9, 0.7));
    wind.connect(windBand).connect(windGain);
    wind.start(t0);
    const windPitch = slow(9), windLevel = slow(20, 6);

    // ---- two voices on two time scales, rate ~ s^-1.7 (the gurgling is the
    // painting's own) ----
    const BASE = 10;
    const TIERS = [
      { s: 1, accept: I => 0.25 + 0.6 * I, play: theremin },
      { s: 0.5, accept: I => 0.1 + 0.7 * I * I, play: sequence },
    ].map(tier => {
      const mean = BASE * Math.pow(tier.s, 1.7);
      return { ...tier, mean, pv: voss(8), tv: voss(6), t: 8 + rng() * mean };
    });
    function play(tier) {
      let t = tier.t;
      const I = intensity(t);
      if (rng() < tier.accept(I)) t = tier.play(tier, t, I);
      tier.t = t + tier.mean * Math.exp((tier.tv() - 0.5) * 1.6) * (0.4 + rng() * 1.2);
    }

    // ---- scheduler ----
    let ctrl = 0;
    function schedule(until) {
      const u = until - t0;
      for (; ctrl < u; ctrl += CTRL) { // control rate: the wind
        const at = t0 + ctrl;
        windBand.frequency.linearRampToValueAtTime(180 * Math.pow(6, windPitch(ctrl)), at);
        windGain.gain.linearRampToValueAtTime(0.05 * Math.pow(windLevel(ctrl), 2) * (0.4 + 0.6 * intensity(ctrl)), at);
      }
      while (chordEnd < u) nextChord();
      while (chords.length > 2 && chords[0].end < u - AHEAD - REL) chords.shift();
      for (const tier of TIERS) while (tier.t < u) play(tier);
    }
    // the music heard (1) or not (0), faded over fade seconds
    function music(on, fade) {
      const o = band.offset, now = ac.currentTime;
      o.cancelScheduledValues(now);
      o.setValueAtTime(o.value, now);
      o.linearRampToValueAtTime(on ? 1 : 0, now + fade);
    }
    return { schedule, pour, time, music };
  }

  // The player: a context made on the first play() (it has to come from a
  // click or a key press), faded in and out, suspended while off. It plays
  // the gurgling, with the music (play(true)) or without it (play(false)).
  // pour(s) is how the painting poured over its last frame (see graph's
  // pour): heard straight away, just far enough ahead to be scheduled
  // cleanly, and not at all while the sound is off.
  const NOW = 0.03;
  function player(seed) {
    let ac, master, music, timer, off;
    const on = () => !!timer;
    function play(withMusic = true) {
      // the music fades in and out with the rest, or on its own while the
      // gurgling goes on
      if (ac) music.music(withMusic, master.gain.value < 1e-3 ? 0 : withMusic ? 1.5 : 0.5);
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
        music.music(withMusic, 0);
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
    const pour = s => { if (on()) music.pour(music.time() + NOW, s.dt, s); };
    return { play, stop, on, pour };
  }

  return { graph, player };
})();
