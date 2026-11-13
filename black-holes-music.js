// Black Holes — music for the universe, played live with Web Audio: slow
// micropolyphony, inspired by György Ligeti's Lux Aeterna (none of its
// notes, only the way it moves), for instruments, and random and fractal
// all through, new with every universe. One long line, a 1/f melody of
// small steps, is followed in canon by many voices, each at its own uneven
// pace, so that at any moment they are spread over a few neighbouring
// notes: a cluster, shimmering, that drifts as the line does. Everything
// else is 1/f noise too, on its own slow time scale: where the line lies,
// how many voices sing and how loud, how far apart in the canon they may
// stray (all but gathered to one note, or spread wide), how bright, and,
// on doubling time scales, how long each note is; now and then low voices
// come in under it. Soft bowed strings and glassy sines, in a long dark room.
// Needs pollock.js (mulberry32).
const BlackHolesMusic = (() => {
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const AHEAD = 3; // seconds scheduled ahead
  const LEVEL = 0.7; // master gain (as loud, about, as the other paintings' music)

  // The music on context ac, into dest; nothing sounds until
  // schedule(until) has scheduled it up to context time until. A merger is
  // heard (chirp) into fx, by itself, whether the music plays or not.
  function graph(ac, seed, dest, fx = dest) {
    const rng = PollockDreams.mulberry32(seed);
    const t0 = ac.currentTime + 0.2;

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
    // a smooth 1/f curve over music time: a Voss point every `step` seconds, eased between
    function slow(step, rows = 8) {
      const v = voss(rows), pts = [v(), v()];
      return t => {
        const x = Math.max(0, t / step), i = Math.floor(x), f = x - i;
        while (pts.length < i + 2) pts.push(v());
        return pts[i] + (pts[i + 1] - pts[i]) * (0.5 - 0.5 * Math.cos(Math.PI * f));
      };
    }

    // ---- form: each its own 1/f curve, slower and quicker ----
    const register = slow(40, 7); // where the line lies
    const crowd = slow(25, 7), swell = slow(6, 5); // how many voices, how loud
    const spread = slow(30, 6); // how far apart in the canon they may stray
    const bright = slow(20, 6);
    const depth = slow(55, 6); // low voices, under it, when this is high
    const fade = t => Math.min(1, 0.3 + (t - t0) / 40); // (it comes in slowly at first)

    // ---- the room: a long, dark tail ----
    const len = Math.round(ac.sampleRate * 7), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += 0.35 * ((rng() * 2 - 1) - lp); // (darker as it goes: a low-passed noise)
        d[i] = lp * Math.pow(1 - i / len, 2.2) * 2.2;
      }
    }
    const verb = ac.createConvolver(); verb.buffer = ir;
    const dry = ac.createGain(); dry.gain.value = 0.35;
    const wet = ac.createGain(); wet.gain.value = 0.9;
    dry.connect(dest); verb.connect(wet); wet.connect(dest);
    const bus = ac.createGain(); bus.gain.value = 1;
    bus.connect(dry); bus.connect(verb);

    // ---- the line: a 1/f melody about a centre that drifts ----
    // (each step's pitch is the 1/f curve's, so it moves by small steps
    // mostly, and now and then further, at every scale alike)
    const line = [], melody = voss(9);
    function extend(t) {
      const centre = 55 + Math.round(16 * register(t - t0));
      line.push(centre - 6 + Math.round(12 * melody()));
    }
    // ---- the voices: each the line, in canon, at its own pace ----
    const N = 16;
    const voices = Array.from({ length: N }, (_, k) => ({
      k,
      at: t0 + k * (1.5 + rng() * 3), // (coming in one by one)
      idx: 0,
      pace: 0.75 + rng() * 0.6, // (its notes this much longer than the others', or shorter)
      dur: voss(4), // (its own 1/f note lengths)
      pan: (k / (N - 1)) * 1.6 - 0.8,
      kind: k % 3 === 2 ? 'glass' : 'string',
    }));
    let lead = 0; // the furthest any voice has got along the line

    // One note of a voice: m (midi), from t for d seconds, swelling in and
    // out over the next and last ones (legato, no attack at all).
    function note(v, m, t, d, level, cutoff) {
      const f = mtof(m), fd = Math.min(2.4, d * 0.6);
      const g = ac.createGain();
      const pan = ac.createStereoPanner(); pan.pan.value = v.pan;
      g.connect(pan); pan.connect(bus);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + fd);
      g.gain.setValueAtTime(level, t + d);
      g.gain.linearRampToValueAtTime(0, t + d + fd);
      const end = t + d + fd + 0.05;
      // a slow, slight vibrato, its own
      const vib = ac.createOscillator(), vd = ac.createGain();
      vib.frequency.value = 3.5 + rng() * 2; vd.gain.value = f * 0.0025;
      vib.connect(vd);
      if (v.kind === 'string') {
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.value = Math.min(4000, f * cutoff); lp.Q.value = 0.4;
        lp.connect(g);
        for (const det of [-5, 4]) {
          const o = ac.createOscillator(); o.type = 'sawtooth';
          o.frequency.value = f; o.detune.value = det + (rng() - 0.5) * 4;
          vd.connect(o.frequency);
          const og = ac.createGain(); og.gain.value = 0.5;
          o.connect(og); og.connect(lp);
          o.start(t); o.stop(end);
        }
      } else {
        for (const [mult, lv] of [[1, 1], [2, 0.18 * cutoff / 3], [3, 0.05 * cutoff / 3]]) {
          const o = ac.createOscillator(); o.type = 'sine';
          o.frequency.value = f * mult;
          if (mult === 1) vd.connect(o.frequency);
          const og = ac.createGain(); og.gain.value = lv;
          o.connect(og); og.connect(g);
          o.start(t); o.stop(end);
        }
      }
      vib.start(t); vib.stop(end);
    }

    function schedule(until) {
      for (const v of voices) {
        if (v.at < ac.currentTime) v.at = ac.currentTime + 0.1 + rng() * 3; // (back after a pause: in again, one by one)
        while (v.at < until) {
          const t = v.at, mt = t - t0;
          // note lengths on doubling scales: 1, 2, 4 or 8 times the shortest
          const d = 1.4 * Math.pow(2, Math.floor(v.dur() * 3.99)) * v.pace;
          v.at = t + d;
          // how many sing now: the rest wait (a voice's place in the crowd its k)
          const sing = 3 + Math.round(13 * crowd(mt));
          if (v.k >= sing) { v.idx++; continue; }
          // how far behind the leader it may be: all but gathered, or spread wide
          const lag = Math.round(1 + 7 * spread(mt));
          if (v.idx < lead - lag) v.idx = lead - lag;
          while (line.length <= v.idx) extend(t);
          let m = line[v.idx];
          const low = depth(mt) > 0.62 && v.k < 4;
          if (low) m -= 24;
          const level = (low ? 0.08 : 0.05) * (v.kind === 'glass' ? 0.8 : 1) * (0.45 + 0.75 * swell(mt)) * fade(t);
          note(v, m, t, d, level, 1.8 + 3 * bright(mt));
          lead = Math.max(lead, ++v.idx);
          if (rng() < 0.06) v.at += 1 + rng() * 3; // (a breath)
        }
      }
    }
    // A merger heard, at music time t, in one ear (pan): a chirp, the pair
    // going round faster and faster, rising to the moment they are one, then
    // the new hole's ringing, dying away; the heavier the hole, the lower.
    const CHIRP = 1.4, RING = 0.9; // seconds of the chirp, and of the ringing
    function chirp(t, M, loud, pan) {
      if (t < 0) return;
      const t1 = t0 + t, fEnd = clamp(150 * Math.pow(0.15 / M, 0.7), 55, 660); // (its ringing)
      const p = ac.createStereoPanner(); p.pan.value = pan;
      p.connect(fx);
      for (const [mult, lv] of [[1, 1], [2, 0.22], [3, 0.07]]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(fEnd * mult / 5, t1);
        o.frequency.exponentialRampToValueAtTime(fEnd * mult * 0.8, t1 + CHIRP * 0.85);
        o.frequency.exponentialRampToValueAtTime(fEnd * mult, t1 + CHIRP);
        g.gain.setValueAtTime(0.0001, t1);
        g.gain.exponentialRampToValueAtTime(loud * lv * 0.3, t1 + CHIRP * 0.6);
        g.gain.exponentialRampToValueAtTime(loud * lv, t1 + CHIRP);
        g.gain.exponentialRampToValueAtTime(0.0001, t1 + CHIRP + RING);
        o.connect(g); g.connect(p);
        o.start(t1); o.stop(t1 + CHIRP + RING + 0.05);
      }
    }
    const time = () => ac.currentTime - t0;
    return { schedule, chirp, time, CHIRP };
  }

  // The player, on a context and into a node it is given (the page's, the
  // mergers' sound going to the same place), faded in and out.
  function player(ac, dest, seed, fx = dest, level = LEVEL) {
    const master = ac.createGain();
    master.gain.value = 0;
    master.connect(dest);
    const music = graph(ac, seed, master, fx);
    let timer = null;
    function play() {
      if (timer) return;
      const tick = () => music.schedule(ac.currentTime + AHEAD);
      tick();
      timer = setInterval(tick, 250);
      const g = master.gain, now = ac.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(level, now + 4);
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer); timer = null;
      const g = master.gain, now = ac.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.5);
    }
    // a merger heard now (see chirp)
    const chirp = (M, loud, pan) => music.chirp(music.time() + 0.02, M, loud, pan);
    return { play, stop, on: () => !!timer, chirp, CHIRP: music.CHIRP };
  }

  return { graph, player };
})();
