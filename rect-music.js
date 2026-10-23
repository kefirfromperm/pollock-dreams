// Pollock Dreams — ambient fractal music for the rectangles painting, played
// live with Web Audio. The same 1/f form as music.js (chords walked by 1/f
// noise, slow waves of intensity, notes on three time scales), other
// instruments: a choir pad, a felt electric piano, a soft plucked bass,
// marimba and a breathy flute, in E♭ lydian, in a warm room.
// Needs pollock.js (mulberry32).
const RectMusic = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const AHEAD = 3, CTRL = 0.25; // seconds scheduled ahead, control-rate step
  const LEVEL = 1.4; // master gain, set so loud passages peak around -3 dBFS

  // ---- harmony: E♭ lydian, chords walked by 1/f noise ----
  const CHORDS = [
    [39, 51, 58, 62, 65, 67], // E♭maj9
    [41, 53, 57, 60, 65, 67], // Fadd9 (the lydian colour)
    [36, 48, 55, 58, 62, 63], // Cm9
    [43, 55, 58, 62, 65, 70], // Gm7
    [46, 53, 58, 60, 65, 69], // B♭6/9
    [38, 50, 57, 60, 65, 69], // Dm7
  ];
  const SCALE = [0, 2, 4, 6, 7, 9, 11].map(p => (p + 3) % 12); // E♭ lydian pitch classes
  const scaleNotes = (lo, hi) => { const r = []; for (let m = lo; m <= hi; m++) if (SCALE.includes(m % 12)) r.push(m); return r; };
  // struck tones: [frequency ratio, amplitude, decay seconds]
  const MARIMBA = [[1, 1, 1.4], [3.93, 0.28, 0.35], [9.8, 0.05, 0.1]];
  const BASS = [[1, 1, 3.2], [2, 0.25, 1.2], [3, 0.06, 0.5]];
  // choir vowels: three formants each, ah → oh → oo
  const VOWELS = [[800, 1150, 2800], [450, 800, 2830], [325, 700, 2530]];
  const ATT = 6, REL = 8;
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
    const panner = (pan, to) => { const p = ac.createStereoPanner(); p.pan.value = clamp(pan * 2 - 1, -1, 1); p.connect(to); return p; };
    const hp = filter('highpass', 35, 0.5, dest); // keeps the sub-bass out
    const dry = gain(1, hp), send = gain(1);
    const verb = ac.createConvolver();
    verb.buffer = impulse(3.6, 4);
    send.connect(verb);
    verb.connect(gain(0.8, hp));
    const bus = (wet, level = 1) => { const g = gain(level, dry); g.connect(gain(wet, send)); return g; };

    // Reverb tail: a warm room, diffuse noise decaying to -60 dB in rt60
    // seconds, high frequencies dying sooner.
    function impulse(rt60, len) {
      const sr = ac.sampleRate, n = Math.round(len * sr), pre = Math.round(0.02 * sr);
      const b = ac.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let s = pre; s < n; s++) {
          const t = (s - pre) / sr;
          lp += (0.08 + 0.4 * Math.exp(-t / 0.8)) * (rng() * 2 - 1 - lp);
          d[s] = lp * Math.pow(10, -3 * t / rt60) * Math.min(1, t / 0.015);
        }
      }
      return b;
    }
    const noise = (() => { // white noise for the flute's breath
      const sr = ac.sampleRate, b = ac.createBuffer(1, sr * 2, sr), d = b.getChannelData(0);
      for (let s = 0; s < d.length; s++) d[s] = rng() * 2 - 1;
      return b;
    })();

    // Echo for the struck instruments: ping-pong, darkened on each repeat.
    const echo = bus(0.5);
    {
      const split = ac.createChannelSplitter(2), out = ac.createChannelMerger(2);
      echo.connect(split);
      out.connect(dry); out.connect(gain(0.6, send));
      const sides = [0.6, 0.9].map((t, c) => {
        const d = ac.createDelay(2);
        d.delayTime.value = t;
        split.connect(gain(0.28, d), c);
        const lp = filter('lowpass', 2600, 0.5);
        d.connect(lp);
        lp.connect(gain(0.7)).connect(out, 0, 1 - c); // heard on the other side
        return { d, lp };
      });
      sides[0].lp.connect(gain(0.32, sides[1].d));
      sides[1].lp.connect(gain(0.32, sides[0].d));
    }

    // Choir: each chord tone as two detuned soft saws with vibrato, sung
    // through three formant filters that drift between vowels.
    const vowel = slow(11);
    const choirIn = gain(1);
    const choirOut = bus(0.7);
    const formants = VOWELS[0].map((f, k) => {
      const b = filter('bandpass', f, 9);
      choirIn.connect(b);
      b.connect(gain([1.6, 1.0, 0.45][k], choirOut));
      return b;
    });
    choirIn.connect(filter('lowpass', 500, 0.5)).connect(gain(0.18, choirOut)); // chest
    const saw = (() => {
      const re = new Float32Array(25), im = new Float32Array(25);
      for (let h = 1; h <= 24; h++) im[h] = 0.6 / Math.pow(h, 1.2);
      return ac.createPeriodicWave(re, im, { disableNormalization: true });
    })();

    // Electric piano: a sine carrier with a sine modulator at the same
    // frequency, its index falling as the note fades, as a Rhodes tine
    // softens; a faint high partial for the strike.
    const keys = bus(0.45, 0.9);
    keys.connect(echo);
    function epiano(t, m, g, pan) {
      const at = t0 + t, f = mtof(m), len = 5.5 * clamp(64 / m, 0.6, 1.4);
      const p = panner(pan, keys), env = gain(0, p);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(g, at + 0.006);
      env.gain.exponentialRampToValueAtTime(g * 0.001, at + len);
      const c = ac.createOscillator(), mod = ac.createOscillator(), idx = gain(0);
      c.frequency.value = f;
      mod.frequency.value = f * (1 + (rng() - 0.5) * 0.002);
      idx.gain.setValueAtTime(f * (1.2 + rng() * 0.8), at);
      idx.gain.exponentialRampToValueAtTime(f * 0.08, at + 1.4);
      mod.connect(idx).connect(c.frequency);
      c.connect(env);
      const tine = ac.createOscillator(), te = gain(0, p);
      tine.frequency.value = f * 4;
      te.gain.setValueAtTime(0, at);
      te.gain.linearRampToValueAtTime(g * 0.12, at + 0.003);
      te.gain.exponentialRampToValueAtTime(g * 0.0001, at + 0.35);
      tine.connect(te);
      for (const o of [c, mod]) { o.start(at); o.stop(at + len); }
      tine.start(at); tine.stop(at + 0.4);
      c.onended = () => p.disconnect();
    }

    // Struck tones (marimba, bass): decaying partials.
    const mallets = filter('lowpass', 5000, 0.5, bus(0.5, 0.9));
    mallets.connect(echo);
    const low = filter('lowpass', 520, 0.6, bus(0.15));
    function struck(t, m, g, pan, partials, attack, out) {
      const at = t0 + t, p = panner(pan, out);
      let last;
      for (const [ratio, amp, len] of partials) {
        const o = ac.createOscillator(), env = gain(0, p);
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

    // Flute: a sine with a little second and third harmonic, vibrato that
    // grows into the note, and breath noise around its pitch.
    const flutes = bus(0.75, 0.9);
    const fluteWave = (() => {
      const re = new Float32Array(4), im = new Float32Array(4);
      im[1] = 1; im[2] = 0.2; im[3] = 0.07;
      return ac.createPeriodicWave(re, im);
    })();
    function flute(t, m, g, dur, pan) {
      const at = t0 + t, f = mtof(m), end = at + dur;
      const p = panner(pan, flutes), env = gain(0, p);
      env.gain.setValueAtTime(0, at);
      env.gain.setTargetAtTime(g, at, 0.09);
      env.gain.setTargetAtTime(0, end, 0.25);
      const o = ac.createOscillator();
      o.setPeriodicWave(fluteWave);
      o.frequency.value = f;
      const vib = ac.createOscillator(), depth = gain(0);
      vib.frequency.value = 4.6 + rng() * 0.8;
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(0, at + 0.4);
      depth.gain.linearRampToValueAtTime(14, at + Math.max(0.5, dur * 0.8));
      vib.connect(depth).connect(o.detune);
      o.connect(env);
      const br = ac.createBufferSource();
      br.buffer = noise; br.loop = true;
      br.connect(filter('bandpass', f * 1.5, 1.2)).connect(gain(0.07, env));
      for (const s of [o, vib]) { s.start(at); s.stop(end + 1.5); }
      br.start(at, rng() * 2); br.stop(end + 1.5);
      o.onended = () => p.disconnect();
    }

    // ---- chords: a choir chord, rolled on the piano, the root on the bass ----
    const chords = [];
    let chordEnd = 0, prev = -1;
    const walk = voss(6);
    function nextChord() {
      let i = Math.floor(walk() * CHORDS.length) % CHORDS.length;
      if (i === prev) i = (i + 1 + Math.floor(rng() * (CHORDS.length - 1))) % CHORDS.length;
      if (prev < 0) i = 0; // start at home
      const len = 14 + Math.pow(2, Math.floor(walk() * 3)) * 7 * (0.8 + rng() * 0.4);
      const c = { t: chordEnd, end: chordEnd + len, notes: CHORDS[i] };
      chords.push(c);
      prev = i; chordEnd = c.end;
      const at = t0 + c.t, end = t0 + c.end;
      c.notes.slice(1).forEach((m, k) => {
        const env = gain(0, choirIn), g = 0.05 / Math.sqrt(k + 1);
        env.gain.setValueCurveAtTime(RISE.map(v => v * g), at, ATT);
        env.gain.setValueCurveAtTime(FALL.map(v => v * g), end, REL);
        const vib = ac.createOscillator(), depth = gain(5 + rng() * 4);
        vib.frequency.value = 4.2 + rng() * 1.2;
        vib.connect(depth);
        vib.start(at); vib.stop(end + REL);
        vib.onended = () => env.disconnect();
        for (let v = 0; v < 2; v++) {
          const o = ac.createOscillator();
          o.setPeriodicWave(saw);
          o.frequency.value = mtof(m);
          o.detune.value = (v - 0.5) * 12 + (rng() - 0.5) * 4;
          depth.connect(o.detune);
          o.connect(panner(clamp(0.5 + (rng() - 0.5) * 0.9, 0, 1), env));
          o.start(at); o.stop(end + REL);
        }
      });
      // the chord rolled upwards on the piano, the root on the bass, and the
      // bass again halfway through longer chords
      const roll = 0.09 + rng() * 0.1;
      c.notes.slice(1).forEach((m, k) => epiano(c.t + 0.4 + k * roll, m, 0.05 * (0.8 + rng() * 0.3), 0.3 + k * 0.08));
      const root = c.notes[0] < 40 ? c.notes[0] + 12 : c.notes[0];
      struck(c.t + 0.4, root, 0.22, 0.5, BASS, 0.012, low);
      if (len > 24) struck(c.t + len / 2, root, 0.16, 0.5, BASS, 0.012, low);
    }
    const chordAt = t => chords.find(c => t < c.end) ?? chords[chords.length - 1];

    // lean v (0..1 over notes) on the chord tones at time t
    function pitch(v, notes, t, lean = 0.6) {
      let m = notes[clamp(Math.floor(v * notes.length), 0, notes.length - 1)];
      if (rng() < lean) {
        const pcs = chordAt(t).notes.map(n => n % 12);
        let best = m, bd = 99;
        for (const n of notes) { const d = Math.abs(n - m); if (pcs.includes(n % 12) && d < bd) { bd = d; best = n; } }
        m = best;
      }
      return m;
    }

    // ---- three voices on three time scales, rate ~ s^-1.7 ----
    const BASE = 9;
    const MARIMBA_NOTES = scaleNotes(58, 82), PIANO_NOTES = scaleNotes(55, 74), FLUTE_NOTES = scaleNotes(67, 86);
    const TIERS = [
      { s: 1, accept: I => 0.2 + 0.6 * I, play: flutePhrase },
      { s: 0.5, accept: I => 0.25 + 0.5 * I, play: pianoTones },
      { s: 0.25, accept: I => 0.1 + 0.8 * I * I, play: marimbaNotes },
    ].map(tier => {
      const mean = BASE * Math.pow(tier.s, 1.7);
      return { ...tier, mean, pv: voss(8), tv: voss(6), t: 6 + rng() * mean };
    });

    // a slow stepwise phrase that starts and ends on chord tones
    function flutePhrase(tier, t, I) {
      let idx = FLUTE_NOTES.indexOf(pitch(tier.pv(), FLUTE_NOTES, t, 1));
      const n = 2 + Math.floor(rng() * 4), pan = 0.3 + rng() * 0.4;
      for (let k = 0; k < n; k++) {
        const lastNote = k === n - 1, dur = (lastNote ? 2.4 : 0.9) + rng() * 1.6;
        let m = FLUTE_NOTES[idx];
        if (lastNote) m = pitch(idx / FLUTE_NOTES.length, FLUTE_NOTES, t, 1);
        flute(t, m, 0.045 * (0.7 + 0.3 * I), dur, pan);
        t += dur * (0.92 + rng() * 0.1);
        idx = clamp(idx + Math.round((tier.pv() - 0.5) * 4.4), 0, FLUTE_NOTES.length - 1);
      }
      return t; // the next phrase comes after this one
    }
    // two or three tones of the chord, gently rolled
    function pianoTones(tier, t, I) {
      const pcs = chordAt(t).notes.map(n => n % 12), pool = PIANO_NOTES.filter(n => pcs.includes(n % 12));
      let i = Math.floor(tier.pv() * pool.length);
      for (let k = 0, n = 2 + Math.floor(rng() * 2); k < n && i < pool.length; k++, i += 1 + Math.floor(rng() * 2))
        epiano(t + k * (0.12 + rng() * 0.15), pool[i], 0.045 * (0.6 + 0.5 * rng()) * (0.7 + 0.3 * I), 0.2 + rng() * 0.6);
      return t;
    }
    // a marimba note, or a short rising run, stacking up like the rectangles
    function marimbaNotes(tier, t, I) {
      const m = pitch(tier.pv(), MARIMBA_NOTES, t), pan = clamp(0.5 + (rng() - 0.5) * 0.8, 0.05, 0.95);
      const g = 0.11 * (0.6 + 0.5 * rng()) * (0.7 + 0.3 * I);
      struck(t, m, g, pan, MARIMBA, 0.002, mallets);
      if (rng() < 0.35) {
        let tt = t, gg = g, idx = MARIMBA_NOTES.indexOf(m);
        for (let k = 0, n = 2 + Math.floor(rng() * 3); k < n && idx < MARIMBA_NOTES.length - 1; k++) {
          tt += 0.16 + rng() * 0.08; idx = Math.min(MARIMBA_NOTES.length - 1, idx + 1 + Math.floor(rng() * 2));
          gg *= 0.75 + rng() * 0.15;
          struck(tt, MARIMBA_NOTES[idx], gg, clamp(pan + (rng() - 0.5) * 0.3, 0, 1), MARIMBA, 0.002, mallets);
        }
      }
      return t;
    }
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
      for (; ctrl < u; ctrl += CTRL) { // control-rate curves: the choir's vowel
        const at = t0 + ctrl, v = clamp(vowel(ctrl) * 2, 0, 2), i = Math.min(1, Math.floor(v)), f = v - i;
        formants.forEach((b, k) => b.frequency.linearRampToValueAtTime(VOWELS[i][k] + (VOWELS[i + 1][k] - VOWELS[i][k]) * f, at));
      }
      while (chordEnd < u) nextChord();
      while (chords.length > 2 && chords[0].end < u - AHEAD - REL) chords.shift();
      for (const tier of TIERS) while (tier.t < u) play(tier);
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
