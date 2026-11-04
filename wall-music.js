// The Wall — its sound, played live with Web Audio, is no music at all but
// nature come to take the wall back. The wind is the wall's own: the
// painting tells, frame by frame, how hard it blows and which way, the same
// wind that tears the flakes off, so a gust is heard as it is seen; and the
// paint cracking and the flakes snapping off crackle, from where they are.
// The wind and the crackle have a switch of their own. The music is the
// rest of nature about the wall: the trees' leaves and the grass rustling
// in that wind, birds and insects.
// Every voice is made of filtered noise and sines; the birds sing phrases of
// their own, each from its own place, more in the lulls than in the gusts.
// 1/f noise walks how lively the birds and insects are.
// Needs pollock.js (mulberry32).
const WallMusic = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const AHEAD = 3; // seconds scheduled ahead
  const LEVEL = 1.2; // master gain

  function graph(ac, seed, dest) {
    const rng = PollockDreams.mulberry32(seed);
    const t0 = ac.currentTime + 0.1; // music time 0
    const TAU = Math.PI * 2;

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
    // a smooth 1/f curve over music time: a Voss point every `step` seconds
    function slow(step, rows = 8) {
      const v = voss(rows), pts = [v(), v()];
      return t => {
        const x = Math.max(0, t / step), i = Math.floor(x), f = x - i;
        while (pts.length < i + 2) pts.push(v());
        return pts[i] + (pts[i + 1] - pts[i]) * (0.5 - 0.5 * Math.cos(Math.PI * f));
      };
    }
    const life = slow(40, 6); // how lively the birds and insects are

    // ---- buses: dry mix and an open-air ambience send into a master ----
    const gain = (v, to) => { const g = ac.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const filter = (type, f, Q, to) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; if (to) b.connect(to); return b; };
    const panner = (pan, to) => { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(to); return p; };
    const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const hp = filter('highpass', 35, 0.5, dest);
    const air = filter('lowpass', 9000, 0.5, hp); // nothing shrill
    const dry = gain(1, air), send = gain(1);
    const verb = ac.createConvolver();
    verb.buffer = impulse(1.6, 2.4);
    send.connect(verb);
    verb.connect(gain(0.7, air));
    // The music can be silenced while the wind and the crackle go on: every
    // voice's bus passes through a gain set by one shared level (band, 1 or
    // 0, faded), all but the wind's and the crackle's; and so does any
    // voice's own way into the open air (musical(to): a gain into to, gated
    // by band).
    const band = ac.createConstantSource();
    band.start();
    const musical = to => { const g = gain(0, to); band.connect(g.gain); return g; };
    const bus = (wet, level = 1, muted = true) => {
      const g = gain(muted ? 0 : level, dry);
      if (muted) band.connect(gain(level, g.gain)); // level × band
      g.connect(gain(wet, send));
      return g;
    };

    // Open air: a short, diffuse tail, as off trees and walls, the highs
    // dying sooner.
    function impulse(rt60, len) {
      const sr = ac.sampleRate, n = Math.round(len * sr), pre = Math.round(0.02 * sr);
      const b = ac.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let s = pre; s < n; s++) {
          const t = (s - pre) / sr;
          lp += (0.1 + 0.5 * Math.exp(-t / 0.3)) * (rng() * 2 - 1 - lp);
          d[s] = lp * Math.pow(10, -3 * t / rt60) * Math.min(1, t / 0.01);
        }
      }
      return b;
    }
    const noise = (() => {
      const sr = ac.sampleRate, b = ac.createBuffer(1, sr * 4, sr), d = b.getChannelData(0);
      for (let s = 0; s < d.length; s++) d[s] = rng() * 2 - 1;
      return b;
    })();
    const noiseFrom = () => {
      const s = ac.createBufferSource();
      s.buffer = noise; s.loop = true;
      s.start(t0, rng() * 4);
      return s;
    };
    // square the input (a rectifier: flutter that only ever adds)
    const square = (() => {
      const c = new Float32Array(1025);
      for (let i = 0; i < c.length; i++) { const x = i / 512 - 1; c[i] = x * x; }
      return c;
    })();
    // a flutter: noise slowed to about hz, squared, scaled by a level to set
    // as the wind goes; it sets the gain of `to`
    function flutter(hz, boost, to) {
      const shaper = ac.createWaveShaper();
      shaper.curve = square;
      const level = gain(0, to.gain);
      noiseFrom().connect(filter('lowpass', hz, 0.7)).connect(gain(boost)).connect(shaper).connect(level);
      return level;
    }

    // ---- the wind (not the music's) ----
    // Only its gusts are heard, not the steady blowing, but every one of
    // them, a faint one too, for it may blow a bit off: on each side the
    // gust's body, noise brightening as it swells, and its breath, a broad
    // band sweeping up with it: breathy, never a ringing tone (and never so
    // low that small speakers lose it). The side it blows from hears a gust
    // first.
    const winds = [-1, 1].map(side => {
      const out = panner(side * 0.8, bus(0.3, 1, false));
      const body = gain(0, out), breath = gain(0, out);
      const dark = filter('lowpass', 300, 0.5), band = filter('bandpass', 500, 0.7);
      const src = noiseFrom();
      src.connect(dark).connect(body);
      src.connect(band).connect(breath);
      return { side, body, breath, dark, band };
    });
    // Trees on either side, their leaves rustling: high noise, its loudness
    // fluttering fast and deep, a little in the breeze, tossing in a gust.
    const trees = [-1, 1].map(side => {
      const out = panner(side * (0.5 + rng() * 0.4), bus(0.4, 1));
      const amp = gain(0, out);
      noiseFrom().connect(filter('highpass', 1600, 0.6)).connect(filter('lowpass', 6500, 0.5)).connect(amp);
      return { side, level: flutter(9 + rng() * 6, 45, amp) };
    });
    // Grass, nearer and softer: a mid band swishing in slower waves.
    const grassAmp = gain(0, bus(0.2, 1));
    noiseFrom().connect(filter('bandpass', 2200, 0.5)).connect(grassAmp);
    const grass = flutter(2.5, 120, grassAmp);

    // What the wind is now, as the wall last told it: its speed, and its
    // puff, the gust heard (0 in a lull, about 1 in a strong gust), the very
    // one that blows the bits off. And never a bit blown off without a gust
    // heard: each lifts it to at least KICK, dying away over about KICK_T s.
    const KICK = 0.3, KICK_T = 0.5;
    let wind = { speed: 0.25, puff: 0, dir: 0 }, ctrlAt = -1, kick = 0, kickAt = 0;
    const kicked = t => kick * Math.exp(-(t - kickAt) / KICK_T);
    function blow(t, w, blown) {
      wind = w;
      if (blown) { kick = Math.max(kicked(t), KICK); kickAt = t; }
      else if (t - ctrlAt < 0.05) return; // control rate
      ctrlAt = t;
      const at = t0 + t, s = w.speed, along = Math.cos(w.dir); // > 0: blowing to the right
      const e = Math.max(w.puff, kicked(t));
      const set = (p, v, tc = 0.25, lag = 0) => p.setTargetAtTime(v, at + lag, tc);
      const lagOf = (side, most) => Math.max(0, side * along) * most;
      for (const x of winds) {
        const lag = lagOf(x.side, 0.08); // downwind hears it a little later
        set(x.dark.frequency, 500 + 1300 * Math.sqrt(e), 0.15, lag);
        set(x.band.frequency, 600 + 900 * e, 0.2, lag);
        // (heard as soon as it rises, louder as it swells, but ever less so;
        // quick to follow it, as the bits it blows off are seen at once)
        set(x.body.gain, 0.3 * Math.sqrt(e) / (1 + 0.3 * e) * (1 - 0.25 * x.side * along), 0.1, lag);
        set(x.breath.gain, 0.1 * e / (1 + 0.5 * e), 0.15, lag);
      }
      // the leaves and the grass stirring in the breeze, tossing in a gust
      const stir = Math.min(s, 1.2);
      for (const x of trees) set(x.level.gain, (0.006 + 0.012 * stir + 0.07 * e) * (1 + 0.3 * x.side * along), 0.2, lagOf(x.side, 0.15));
      set(grass.gain, 0.002 + 0.003 * stir + 0.015 * e, 0.3);
      // the birds and the crickets hushed by a gust (a song begun before it
      // fades in it)
      const hush = 1 / (1 + 8 * e);
      for (const b of cast) set(b.hush.gain, hush, 0.15);
      for (const c of crickets) set(c.out.gain, hush, 0.15);
    }

    // ---- birds ----
    // A few birds about, each in its own place (nearer ones louder and
    // brighter), each with a song of its own kind: whistled phrases repeated
    // two or three times, quick warbling runs, a two-note call, a trill, a
    // dove's soft hoots far off. They sing when the 1/f liveliness is up, in
    // the lulls, and are hushed by a gust.
    const birdBus = bus(0.55, 1), birdAir = musical(send);
    // one note: a sine (and a little of its octave) gliding from f0 to f1 by
    // shape (0 straight, > 0 arching up, < 0 dipping), in a smooth envelope
    function note(b, at, dur, f0, f1, shape, g) {
      const N = 16, curve = Float32Array.from({ length: N }, (_, i) => {
        const x = i / (N - 1);
        return Math.max(60, f0 + (f1 - f0) * x + shape * Math.sin(Math.PI * x) * Math.max(f0, f1) * 0.25);
      });
      const env = gain(0, b.out);
      const amp = Float32Array.from({ length: N }, (_, i) => { const x = i / (N - 1); return g * Math.pow(Math.sin(Math.PI * x), 0.5); });
      env.gain.setValueCurveAtTime(amp, at, dur);
      for (const [r, a] of [[1, 1], [2, 0.08]]) {
        const o = osc('sine', f0 * r), og = gain(a, env);
        o.frequency.setValueCurveAtTime(curve.map(f => f * r), at, dur);
        o.connect(og);
        o.start(at); o.stop(at + dur + 0.02);
      }
    }
    const pick = a => a[(rng() * a.length) | 0];
    function phrase(len, lo, hi, quick) { // a list of notes: [gap before, dur, f0, f1, shape]
      return Array.from({ length: len }, () => {
        const f0 = lo + rng() * (hi - lo), f1 = clamp(f0 * Math.pow(2, (rng() - 0.5) * (quick ? 1.2 : 0.6)), lo * 0.8, hi * 1.2);
        return [quick ? 0.02 + rng() * 0.03 : 0.04 + rng() * 0.1, quick ? 0.03 + rng() * 0.05 : 0.08 + rng() * 0.25, f0, f1, (rng() - 0.5) * 1.2];
      });
    }
    const KINDS = {
      // phrases of a few whistled notes, each repeated, from a repertoire
      whistler: () => { const rep = Array.from({ length: 4 + (rng() * 4 | 0) }, () => phrase(2 + (rng() * 4 | 0), 1700, 3800)); return {
        g: 0.05, rest: [3, 9],
        song: () => { const p = pick(rep), n = 2 + (rng() < 0.4); return Array.from({ length: n }, () => p).flat().map((x, i) => i % p.length ? x : [0.12 + rng() * 0.1, ...x.slice(1)]); } }; },
      // a quick run of one note, ending on another
      warbler: () => { const a = phrase(1, 3200, 6000, true)[0], b = phrase(2, 2600, 5000, true); return {
        g: 0.03, rest: [4, 12],
        song: () => [...Array.from({ length: 6 + (rng() * 9 | 0) }, (_, i) => [a[0], a[1], a[2] * (1 - i * 0.008), a[3] * (1 - i * 0.008), a[4]]), ...b] }; },
      // two notes, high then low, over and over
      caller: () => { const hi = 3600 + rng() * 1400, lo = hi * (0.7 + rng() * 0.12); return {
        g: 0.035, rest: [5, 14],
        song: () => Array.from({ length: 3 + (rng() * 4 | 0) }, () => [[0.08, 0.13, hi, hi * 0.97, 0.1], [0.03, 0.11, lo, lo * 0.95, -0.1]]).flat() }; },
      // a fast trill, falling a little
      triller: () => { const f = 3800 + rng() * 1600, rate = 0.04 + rng() * 0.02; return {
        g: 0.025, rest: [6, 16],
        song: () => Array.from({ length: 14 + (rng() * 16 | 0) }, (_, i) => [rate * 0.4, rate * 0.6, f * (1 - i * 0.004), f * (1 - i * 0.004) * 0.92, 0]) }; },
      // a wood pigeon's or a dove's soft hoots, low and far off
      dove: () => { const f = 430 + rng() * 160, rhythm = [[0, 0.35], [0.12, 0.55], [0.1, 0.3], [0.3, 0.3], [0.1, 0.45]]; return {
        g: 0.06, rest: [8, 20], far: true,
        song: () => rhythm.slice(0, 3 + (rng() * 3 | 0)).map(([gap, d], i) => [gap, d, f * (i === 1 ? 1.06 : 1), f * 0.96, 0.3]) }; },
    };
    const cast = ['whistler', 'whistler', 'warbler', 'caller', 'triller', 'dove']
      .filter((k, i) => i < 2 || rng() < 0.75)
      .map(kind => {
        const k = KINDS[kind](), dist = k.far ? 0.7 + rng() * 0.3 : rng();
        const out = gain(1 - 0.75 * dist, panner(rng() * 1.8 - 0.9, birdBus));
        const lp = filter('lowpass', 9000 - 6000 * dist, 0.5, out), hush = gain(1, lp);
        lp.connect(gain(0.5 + dist, birdAir)); // the further, the more of the air (only with the music)
        return { ...k, kind, dist, out: hush, hush, t: 3 + rng() * 15 };
      });
    function sing(b) {
      const I = life(b.t);
      if (wind.puff < 0.05 + 0.15 * rng() && rng() < 0.3 + 0.7 * I) {
        let at = t0 + b.t;
        const g = 1.6 * b.g * (0.7 + 0.3 * rng());
        for (const [gap, d, f0, f1, shape] of b.song()) {
          at += gap;
          note(b, at, d, f0, f1, shape, g);
          at += d;
        }
        b.t = at - t0;
      }
      b.t += (b.rest[0] + rng() * (b.rest[1] - b.rest[0])) * (1.6 - I);
    }

    // ---- insects ----
    // Crickets, each chirping in its own steady rhythm for a while, then
    // resting: a few short pulses of a high sine per chirp. Quieter in a
    // gust.
    const bugs = bus(0.25, 1);
    const crickets = Array.from({ length: 2 + (rng() * 2 | 0) }, () => ({
      f: 4100 + rng() * 900, pulses: 3 + (rng() * 2 | 0), rate: 24 + rng() * 12, every: 0.5 + rng() * 0.6,
      out: gain(1, panner(rng() * 1.6 - 0.8, filter('lowpass', 7000 - 2500 * rng(), 0.5, bugs))),
      t: 5 + rng() * 20, bout: 0,
    }));
    function chirp(c) {
      const I = life(c.t + 100);
      if (c.bout <= 0) { // a rest, then a new bout
        c.t += 8 + rng() * 40 * (1.5 - I);
        c.bout = 10 + rng() * 40 * (0.5 + I);
        return;
      }
      const at = t0 + c.t, pulse = 1 / c.rate, len = c.pulses * pulse;
      const N = c.pulses * 8, g = 0.006 * (0.5 + I) / (1 + 3 * wind.puff);
      const env = gain(0, c.out), o = osc('sine', c.f);
      env.gain.setValueCurveAtTime(Float32Array.from({ length: N }, (_, i) => g * Math.pow(Math.sin(Math.PI * ((i % 8) + 0.5) / 8), 2)), at, len);
      o.connect(env);
      o.start(at); o.stop(at + len + 0.02);
      const step = c.every * (0.97 + rng() * 0.06);
      c.t += step; c.bout -= step;
    }
    // A fly or a bee now and then, buzzing past from one side to the other,
    // its wings' pitch wavering, higher as it comes and lower as it goes.
    const buzzWave = (() => {
      const re = new Float32Array(16), im = new Float32Array(16);
      for (let h = 1; h < 16; h++) im[h] = 1 / h;
      return ac.createPeriodicWave(re, im);
    })();
    let buzzAt = 15 + rng() * 30;
    function buzz() {
      const I = life(buzzAt + 200);
      if (wind.puff < 0.15 && rng() < 0.4 + 0.6 * I) {
        const at = t0 + buzzAt, len = 2 + rng() * 4, f = 150 + rng() * 110, from = rng() < 0.5 ? -1 : 1;
        const o = ac.createOscillator();
        o.setPeriodicWave(buzzWave);
        o.frequency.setValueAtTime(f * 1.03, at);
        o.frequency.linearRampToValueAtTime(f * 0.97, at + len);
        const wob = osc('sine', 7 + rng() * 6), depth = gain(f * 0.025);
        wob.connect(depth).connect(o.frequency);
        const p = ac.createStereoPanner();
        p.pan.setValueAtTime(from * 0.9, at);
        p.pan.linearRampToValueAtTime(-from * 0.9, at + len);
        p.connect(bugs);
        const env = gain(0, p);
        env.gain.setValueCurveAtTime(Float32Array.from({ length: 24 }, (_, i) => 0.03 * Math.pow(Math.sin(Math.PI * i / 23), 3)), at, len);
        o.connect(filter('lowpass', 1400 + rng() * 800, 0.7)).connect(env);
        for (const s of [o, wob]) { s.start(at); s.stop(at + len + 0.05); }
      }
      buzzAt += 20 + rng() * 60;
    }

    // ---- crackle (not the music's) ----
    // The paint cracking ticks: tiny dry clicks, as many as the cracks grow,
    // from where they grow; a flake snapping off cracks louder, a few clicks
    // at once, and a bigger one with a low knock. Its own random numbers, so
    // however the frames fall, the rest stays the same.
    const crackle = bus(0.3, 1, false);
    const fizz = PollockDreams.mulberry32(seed ^ 0x5bd1e995);
    function tick(at, g, pan, f = 1800 + fizz() * 4500) {
      const s = ac.createBufferSource();
      s.buffer = noise;
      const len = 0.004 + fizz() * 0.012;
      const env = gain(0, panner(clamp(pan + (fizz() - 0.5) * 0.15, -1, 1), crackle));
      s.connect(filter('bandpass', f, 1.2 + fizz() * 2)).connect(env);
      env.gain.setValueAtTime(g, at);
      env.gain.exponentialRampToValueAtTime(g * 0.001, at + len);
      s.start(at, fizz() * 3.9, len + 0.005);
    }
    let crackDue = -Math.log(1 - fizz()), crackRun = 0;
    function cracking(t, len, pan) {
      const rate = 260; // clicks per U of crack
      for (crackRun += len * rate; crackRun >= crackDue; crackDue -= Math.log(1 - fizz()))
        tick(t0 + t + fizz() * 0.05, 0.08 * Math.pow(1 - fizz() * 0.95, 2.5), pan);
    }
    function snap(t, size, pan) {
      const at = t0 + t, n = 2 + Math.floor(fizz() * 3 + size * 60);
      for (let i = 0; i < n; i++) tick(at + fizz() * 0.03, 0.15 + 0.2 * fizz(), pan);
      if (size > 0.012) tick(at, Math.min(0.5, 4 * size), pan, 500 + fizz() * 500);
    }

    // The wall's frame dt seconds long, ending at music time t (see the
    // painting's advance).
    function hear(t, s) {
      if (t < 0) return;
      blow(t, s.wind, s.snaps.length > 0);
      if (s.crack > 0) cracking(t, s.crack, s.crackPan);
      for (const x of s.snaps) snap(t, x.size, x.pan);
    }
    const time = () => ac.currentTime - t0;

    // ---- scheduler ----
    function schedule(until) {
      const u = until - t0;
      for (const b of cast) while (b.t < u) sing(b);
      for (const c of crickets) while (c.t < u) chirp(c);
      while (buzzAt < u) buzz();
    }
    // the music heard (1) or not (0), faded over fade seconds
    function music(on, fade) {
      const o = band.offset, now = ac.currentTime;
      o.cancelScheduledValues(now);
      o.setValueAtTime(o.value, now);
      o.linearRampToValueAtTime(on ? 1 : 0, now + fade);
    }
    return { schedule, hear, time, music };
  }

  // The player: a context made on the first play() (it has to come from a
  // click or a key press), faded in and out, suspended while off. It plays
  // the wind and the crackle, with the music (play(true)) or without it
  // (play(false)).
  // hear(s) is what the wall did over its last frame: heard straight away,
  // just far enough ahead to be scheduled cleanly, and not at all while the
  // sound is off.
  const NOW = 0.03;
  function player(seed) {
    let ac, master, music, timer, off;
    const on = () => !!timer;
    function play(withMusic = true) {
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
    const hear = s => { if (on()) music.hear(music.time() + NOW, s); };
    return { play, stop, on, hear };
  }

  return { graph, player };
})();
