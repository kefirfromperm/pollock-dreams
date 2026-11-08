// The Wall — its sound, played live with Web Audio. The wind is the wall's
// own: the painting tells, frame by frame, how hard it blows and which way,
// the same wind that tears the flakes off, so a gust is heard as it is seen,
// softly; and the paint cracking and the flakes snapping off crackle, from
// where they are. The wind and the crackle have a switch of their own.
// The music is far off in a glen beyond the wall, and keeps no time: four
// big low horns, each blown when its player pleases in long notes of 40 s to
// 2 min, swelling and dying away, so none, one or all four may be sounding;
// and a muffled barrel drum struck now and then, at random. A gust blowing
// from the glen carries them nearer.
// Needs pollock.js (mulberry32).
const WallMusic = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const AHEAD = 3; // seconds scheduled ahead
  const LEVEL = 1.2; // master gain

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
    // 0, faded), all but the wind's and the crackle's.
    const band = ac.createConstantSource();
    band.start();
    const bus = (wet, level = 1, muted = true) => {
      const g = gain(muted ? 0 : level, dry);
      if (muted) band.connect(gain(level, g.gain)); // level × band
      g.connect(gain(wet, send));
      return g;
    };

    // Open air: a short, diffuse tail, as off trees and walls, the highs
    // dying sooner (and the glen's, longer).
    function impulse(rt60, len, pre = 0.02, damp = 0.3) {
      const sr = ac.sampleRate, n = Math.round(len * sr), p = Math.round(pre * sr);
      const b = ac.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let s = p; s < n; s++) {
          const t = (s - p) / sr;
          lp += (0.1 + 0.5 * Math.exp(-t / damp)) * (rng() * 2 - 1 - lp);
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

    // ---- the wind (not the music's) ----
    // Only its gusts are heard, not the steady blowing, but every one of
    // them, a faint one too, for it may blow a bit off: on each side the
    // gust's body, soft dark noise warming as it swells, and its breath, a
    // broad band sweeping up with it: breathy, never a ringing tone, and
    // never loud, a strong gust hardly louder than a faint one. It swells
    // and dies smoothly. The side it blows from hears a gust first.
    const winds = [-1, 1].map(side => {
      const out = panner(side * 0.7, bus(0.35, 1, false));
      const body = gain(0, out), breath = gain(0, out);
      const dark = filter('lowpass', 300, 0.3), band = filter('bandpass', 450, 0.45);
      const src = noiseFrom();
      src.connect(dark).connect(body);
      src.connect(band).connect(breath);
      return { side, body, breath, dark, band };
    });

    // What the wind is now, as the wall last told it: its speed, and its
    // puff, the gust heard (0 in a lull, about 1 in a strong gust), the very
    // one that blows the bits off. And never a bit blown off without a gust
    // heard: each lifts it to at least KICK, dying away over about KICK_T s.
    const KICK = 0.2, KICK_T = 0.8;
    let ctrlAt = -1, kick = 0, kickAt = 0;
    const kicked = t => kick * Math.exp(-(t - kickAt) / KICK_T);
    function blow(t, w, blown) {
      if (blown) { kick = Math.max(kicked(t), KICK); kickAt = t; }
      else if (t - ctrlAt < 0.05) return; // control rate
      ctrlAt = t;
      const at = t0 + t, along = Math.cos(w.dir); // > 0: blowing to the right
      const e = Math.max(w.puff, kicked(t));
      const set = (p, v, tc, lag = 0) => p.setTargetAtTime(v, at + lag, tc);
      for (const x of winds) {
        const lag = Math.max(0, x.side * along) * 0.1; // downwind hears it a little later
        set(x.dark.frequency, 320 + 480 * Math.sqrt(e), 0.5, lag);
        set(x.band.frequency, 420 + 380 * e, 0.6, lag);
        set(x.body.gain, 0.06 * Math.sqrt(e) / (1 + 0.8 * e) * (1 - 0.2 * x.side * along), 0.35, lag);
        set(x.breath.gain, 0.0145 * e / (1 + e), 0.45, lag);
      }
      // a gust blowing from the glen carries the horn and the drum nearer,
      // brighter; one blowing towards it, further off
      const towards = Math.cos(w.dir - glen.dir); // > 0: from the glen to us
      set(glen.carry.gain, 1 + 0.4 * e * towards, 0.6);
      set(glen.tone.frequency, 3400 * (1 + 0.35 * e * towards), 0.6);
    }

    // ---- the glen ----
    // The horn and the drum play far off, a little to one side: their
    // sound comes dulled by the distance, mostly as the glen's long
    // reverberation, and an echo off the hill across it.
    const glen = (() => {
      const dir = rng() * Math.PI * 2, pan = (rng() < 0.5 ? -1 : 1) * (0.15 + 0.3 * rng());
      const out = bus(0.3, 0.45); // (the direct sound, faint)
      const carry = gain(1, panner(pan, out)), tone = filter('lowpass', 3400, 0.5, carry);
      const into = gain(1, tone);
      const reverb = ac.createConvolver();
      reverb.buffer = impulse(3.4, 5, 0.06, 0.5);
      out.connect(gain(0.9, reverb));
      reverb.connect(gain(0.8, air));
      const echo = ac.createDelay(2);
      echo.delayTime.value = 0.55 + rng() * 0.35;
      const back = filter('lowpass', 1800, 0.5);
      out.connect(echo).connect(back).connect(gain(0.28, air));
      back.connect(gain(0.3, echo)); // (and again, fainter)
      return { dir, into, carry, tone };
    })();

    // ---- the horns ----
    // Four big low horns, on A at about 57 Hz and a fourth, a fifth and an
    // octave over it, each player choosing their note as they blow: brassy,
    // all its harmonics, a broad bell about 480 Hz, three of it a hair apart
    // so it is wide; its tone opening as it speaks and as it swells, closing
    // as it fades. Each is blown in long notes, 40 s to 2 min, swelling and
    // ebbing slowly as each is held, then dying away to nothing; then its
    // player rests as long as they please, and blows again. Nobody keeps
    // time with anybody: none, one, or all four may be sounding at once.
    const players = gain(0.2, glen.into);
    const HORN = (452 + rng() * 18) / 8, HORN_G = 0.7;
    const NOTES = [1, 1, 4 / 3, 3 / 2, 2];
    const horns = [0, 1, 2, 3].map(() => {
      const out = gain(0, players), tone = filter('lowpass', 300, 0.8), bell = filter('peaking', 480, 0.9);
      bell.gain.value = 5;
      tone.connect(bell).connect(out);
      const reeds = [1, 1.0035, 0.9968].map(r => {
        const o = osc('sawtooth', HORN * r);
        o.connect(gain(0.33, tone));
        o.start(t0);
        return { o, r };
      });
      return { out, tone, reeds, f: HORN, g: HORN_G };
    });
    // the horn speaking on its note f: scooping up to it, a brassy edge at
    // once, settling, then swelling slowly
    function hornIn(h, at, f, g) {
      h.f = f; h.g = g;
      for (const x of h.reeds) {
        x.o.frequency.cancelScheduledValues(at);
        x.o.frequency.setValueAtTime(f * x.r * 0.95, at);
        x.o.frequency.setTargetAtTime(f * x.r, at, 0.07);
      }
      h.out.gain.setTargetAtTime(g, at, 0.08);
      h.out.gain.setTargetAtTime(g * 1.3, at + 0.6, 4);
      h.tone.frequency.setTargetAtTime(1900, at, 0.04);
      h.tone.frequency.setTargetAtTime(800, at + 0.2, 0.5);
      h.tone.frequency.setTargetAtTime(1150, at + 1.5, 4);
    }
    // the horn, held, swelling or ebbing slowly to k of its level
    function hornSwell(h, at, k) {
      h.out.gain.setTargetAtTime(h.g * k, at, 3);
      h.tone.frequency.setTargetAtTime(500 + 550 * k, at, 3);
    }
    // the horn dying away, gone in about HORN_FADE s, its tone closing,
    // sinking a little
    const HORN_FADE = 4;
    function hornFade(h, at) {
      h.out.gain.setTargetAtTime(0, at, HORN_FADE / 4.6); // (−40 dB by then)
      h.tone.frequency.setTargetAtTime(250, at, HORN_FADE / 4.6);
      for (const x of h.reeds) x.o.frequency.setTargetAtTime(h.f * x.r * 0.985, at + 1, 1.5);
    }

    // ---- the drum ----
    // A big barrel drum, muffled: the skin's low boom falling a little as it
    // rings, its higher modes more briefly, the beater's thud, and the
    // barrel's wood answering; the skin driven a little hard, so its boom
    // has overtones a small speaker can play.
    const drum = gain(1);
    const skin = ac.createWaveShaper();
    skin.curve = Float32Array.from({ length: 1025 }, (_, i) => Math.tanh(1.8 * (i / 512 - 1)) / Math.tanh(1.8));
    drum.connect(skin).connect(gain(3.6, players));
    function boom(at, v) {
      const f = 72 + rng() * 10;
      for (const [r, g, len] of [[1, 1, 1.4], [1.59, 0.45, 0.6], [2.14, 0.3, 0.4], [2.65, 0.18, 0.3]]) {
        const o = osc('sine', f * r * 1.4), env = gain(0, drum);
        o.frequency.setValueAtTime(f * r * 1.4, at);
        o.frequency.exponentialRampToValueAtTime(f * r, at + 0.1);
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(v * g, at + 0.005);
        env.gain.setTargetAtTime(0, at + 0.005, len / 4);
        o.connect(env);
        o.start(at); o.stop(at + len + 0.1);
      }
      for (const [type, fq, Q, g, tc] of [['lowpass', 1500, 0.7, 0.5, 0.012], ['bandpass', 190, 5, 2.2, 0.1], ['bandpass', 410, 7, 1.2, 0.06]]) {
        const s = ac.createBufferSource(), env = gain(0, drum);
        s.buffer = noise;
        s.connect(filter(type, fq * (0.95 + 0.1 * rng()), Q)).connect(env);
        env.gain.setValueAtTime(v * g, at);
        env.gain.setTargetAtTime(0, at, tc);
        s.start(at, rng() * 3.5, tc * 8);
      }
    }

    // ---- the music: at random ----
    // No tune, no time kept: each horn is blown when its player pleases, a
    // long note of 40 s to 2 min, then rests anything from a breath to a few
    // minutes; the drum is struck now and then, at random, loud or soft,
    // sometimes with a soft one just before. One horn starts soon, and the
    // drum, so turning the music on is soon heard.
    const queue = []; // [time, fn], the horns' swells and fades to come
    const rest = () => 2 - 70 * Math.log(1 - rng()); // s, mean about 70
    const voices = horns.map((h, i) => ({ h, next: i ? 5 + rng() * 90 : 3 + rng() * 5 }));
    function blowHorn(v) {
      const h = v.h, t = v.next, held = 40 + 80 * rng();
      const f = HORN * NOTES[Math.floor(rng() * NOTES.length)], g = HORN_G * (0.7 + 0.3 * rng());
      queue.push([t, a => hornIn(h, a, f, g)]);
      for (let sw = 8 + 4 * rng(); sw < held - 5; sw += 6 + 6 * rng()) { const k = 0.85 + 0.6 * rng(); queue.push([t + sw, a => hornSwell(h, a, k)]); }
      queue.push([t + held, a => hornFade(h, a)]);
      v.next = t + held + HORN_FADE + rest();
    }
    let drumAt = 2 + rng() * 4;
    function play(until) {
      for (const v of voices) while (v.next < until) blowHorn(v);
      queue.sort((a, b) => a[0] - b[0]);
      let n = 0;
      for (; n < queue.length && queue[n][0] < until; n++) queue[n][1](t0 + queue[n][0]);
      queue.splice(0, n);
      for (; drumAt < until; drumAt += 0.7 - 9 * Math.log(1 - rng())) { // (gaps: mean about 10 s)
        const v = 0.25 + 0.75 * Math.pow(rng(), 0.7), at = drumAt;
        if (rng() < 0.2) boom(t0 + at - 0.16 - 0.08 * rng(), 0.25 * v); // a soft one before
        boom(t0 + at, v);
      }
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
      play(until - t0);
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
