// Roman Town — its sounds: what is to be heard of whatever is in view, made
// as it is heard, live with Web Audio. The work in the shops and the fields:
// the anvil ringing under the hammer, a cleaver or an axe coming down, a saw,
// a chisel on stone, swords on the sand; people talking, children shouting at
// their games, the pipes, a crowd at the play applauding, at the games roaring;
// the beasts, each its own cry: sheep and goats bleating, cattle lowing,
// horses whinnying, a donkey braying, dogs barking, cats, hens, pigs; the
// arena's lions roaring, its elephant trumpeting, its bear growling; the
// fountains and the river, the mills grinding, the carts' wheels; feet and
// hooves, a whisper alone, a clatter when a crowd or a herd goes by; fires
// roaring low and crackling, the ovens', the forges', the torches'; birds in
// the trees by day, crickets, frogs and an owl by night; and the wind.
//
// How loud each is goes by everything in view: each kind of sound has its
// share of one and the same loudness, as much as what makes it is of all
// that is to be heard there. Looked at close, the few things in view are
// heard the louder for being all there is; from far out, the whole town at
// once, each thing in it the quieter for there being so much; the whole as
// loud either way. The wind always, so that nothing is ever all there is.
//
//   const sound = RomanTownSound.create(town, seed)
//   sound.toggle()                          on or off (it must be begun by a click or a key)
//   sound.update(life, rect, sky, playing)  what is in rect [x, y, w, h] now, a few times a second
const RomanTownSound = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const LEVEL = 0.14; // the loudness the whole always has (about −20 dB)

  // ================= the voices: each a sound made once, at t =================
  // Each is given where to sound (dest), when (t), how loud at its loudest
  // (amp), from which side (pan) and a die (r); each ends of itself.
  function voice(ac, dest, t, pan, len) {
    const g = ac.createGain(), p = ac.createStereoPanner();
    g.gain.value = 0; p.pan.value = clamp(pan, -1, 1);
    g.connect(p).connect(dest);
    setTimeout(() => { try { p.disconnect(); } catch (e) { void e; } }, (t - ac.currentTime + len + 0.5) * 1000);
    return g;
  }
  // an envelope: up in a, down over d (exponentially), from t
  function env(g, t, amp, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + a);
    g.gain.setTargetAtTime(0.0001, t + a, d / 4);
  }
  let NOISE = null;
  const noiseOf = ac => {
    if (NOISE && NOISE.sampleRate === ac.sampleRate) return NOISE;
    const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0), r = mulberry32(7);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return (NOISE = b);
  };
  const osc = (ac, type, f, t, len) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + len); return o; };
  const noise = (ac, t, len) => { const s = ac.createBufferSource(); s.buffer = noiseOf(ac); s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + len); return s; };
  const filter = (ac, type, f, q = 1) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  // a tone shaped by the mouth or the throat: formants
  function formants(ac, src, g, fs) { for (const [f, q, k] of fs) { const b = filter(ac, 'bandpass', f, q), h = ac.createGain(); h.gain.value = k; src.connect(b).connect(h).connect(g); } }
  // a slow wobble on a parameter
  function wobble(ac, param, rate, depth, t, len) { const l = osc(ac, 'sine', rate, t, len), k = ac.createGain(); k.gain.value = depth; l.connect(k).connect(param); }

  const V = {
    // the anvil under the hammer: a bright ring of a few partials, dying away
    anvil(ac, dest, t, amp, pan, r) {
      const f0 = 900 + r() * 500, g = voice(ac, dest, t, pan, 1.2);
      for (const [m, k, d] of [[1, 1, 0.6], [2.76, 0.5, 0.3], [5.4, 0.3, 0.15], [8.9, 0.15, 0.08]]) {
        const o = osc(ac, 'sine', f0 * m, t, 1.2), h = ac.createGain(); h.gain.setValueAtTime(k, t); h.gain.setTargetAtTime(0, t, d / 3); o.connect(h).connect(g);
      }
      const n = noise(ac, t, 0.02), hp = filter(ac, 'highpass', 3000); n.connect(hp).connect(g);
      env(g, t, amp, 0.002, 1.0);
    },
    // swords on the sand: a sharper, higher clash, a scrape after it
    clash(ac, dest, t, amp, pan, r) {
      const f0 = 2100 + r() * 900, g = voice(ac, dest, t, pan, 0.8);
      for (const [m, k] of [[1, 1], [1.47, 0.6], [2.31, 0.4], [3.9, 0.2]]) { const o = osc(ac, 'sine', f0 * m, t, 0.8); const h = ac.createGain(); h.gain.value = k; o.connect(h).connect(g); }
      const n = noise(ac, t, 0.25), bp = filter(ac, 'bandpass', 4000, 1.5); n.connect(bp).connect(g);
      env(g, t, amp, 0.002, 0.45);
    },
    // a chisel on stone: a tap, dry, small
    chisel(ac, dest, t, amp, pan, r) {
      const g = voice(ac, dest, t, pan, 0.3), o = osc(ac, 'triangle', 1700 + r() * 600, t, 0.3), n = noise(ac, t, 0.05), bp = filter(ac, 'bandpass', 2500, 2);
      o.connect(g); n.connect(bp).connect(g);
      env(g, t, amp, 0.001, 0.12);
    },
    // a cleaver into meat on a block, an axe into wood: a thud, a knock
    chop(ac, dest, t, amp, pan, r) {
      const g = voice(ac, dest, t, pan, 0.4), o = osc(ac, 'sine', 140 + r() * 40, t, 0.4);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
      const n = noise(ac, t, 0.1), lp = filter(ac, 'lowpass', 900); o.connect(g); n.connect(lp).connect(g);
      env(g, t, amp, 0.002, 0.18);
    },
    axe(ac, dest, t, amp, pan, r) {
      const g = voice(ac, dest, t, pan, 0.5), o = osc(ac, 'triangle', 220 + r() * 60, t, 0.5);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.2);
      const n = noise(ac, t, 0.12), bp = filter(ac, 'bandpass', 700 + r() * 300, 3); o.connect(g); n.connect(bp).connect(g);
      env(g, t, amp, 0.002, 0.25);
    },
    // a saw's stroke: a rasp, up and back
    saw(ac, dest, t, amp, pan, r) {
      const len = 0.45 + r() * 0.2, g = voice(ac, dest, t, pan, len + 0.1), n = noise(ac, t, len + 0.1), bp = filter(ac, 'bandpass', 2600 + r() * 900, 2.5), bp2 = filter(ac, 'bandpass', 5200, 3);
      n.connect(bp).connect(g); n.connect(bp2).connect(g);
      wobble(ac, g.gain, 38 + r() * 10, amp * 0.35, t, len);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp * 0.6, t + len * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + len);
    },
    // the pipes: a double reed, two pipes a little apart, a note of a tune
    pipe(ac, dest, t, amp, pan, r, note) {
      const f = 440 * Math.pow(2, ((note ?? 69) - 69) / 12), len = 0.3 + r() * 0.35, g = voice(ac, dest, t, pan, len + 0.2);
      const a = osc(ac, 'sawtooth', f, t, len + 0.1), b = osc(ac, 'square', f * 1.004, t, len + 0.1), bp = filter(ac, 'bandpass', f * 2.2, 0.9), lp = filter(ac, 'lowpass', 3200);
      wobble(ac, a.frequency, 5.5, f * 0.006, t, len); a.connect(bp); b.connect(bp); bp.connect(lp).connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + 0.03); g.gain.setValueAtTime(amp, t + len - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.05);
    },
    // children shouting at their games: a short call, up or down
    kid(ac, dest, t, amp, pan, r) {
      const f = 330 + r() * 160, len = 0.18 + r() * 0.25, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', f, t, len + 0.1);
      o.frequency.linearRampToValueAtTime(f * (r() < 0.5 ? 1.35 : 0.75), t + len);
      formants(ac, o, g, [[900 + r() * 300, 4, 1], [1700 + r() * 400, 5, 0.6], [3000, 6, 0.2]]);
      env(g, t, amp, 0.02, len);
    },
    // a voice in a crowd, a word or two
    word(ac, dest, t, amp, pan, r) {
      const f = 110 + r() * 120, len = 0.12 + r() * 0.2, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', f, t, len + 0.1);
      o.frequency.linearRampToValueAtTime(f * (0.85 + r() * 0.3), t + len);
      formants(ac, o, g, [[500 + r() * 400, 5, 1], [1200 + r() * 800, 6, 0.5]]);
      env(g, t, amp, 0.02, len);
    },
    // sheep and goats: a quavering bleat
    bleat(ac, dest, t, amp, pan, r, goat) {
      const f = (goat ? 560 : 420) + r() * 120, len = 0.55 + r() * 0.35, g = voice(ac, dest, t, pan, len + 0.2), o = osc(ac, 'sawtooth', f, t, len + 0.1);
      o.frequency.linearRampToValueAtTime(f * 0.85, t + len);
      wobble(ac, o.frequency, 7 + r() * 3, f * 0.05, t, len);
      wobble(ac, g.gain, 9 + r() * 4, amp * 0.35, t, len);
      formants(ac, o, g, [[800 + r() * 200, 4, 1], [2300, 6, 0.4]]);
      env(g, t, amp * 0.8, 0.05, len);
    },
    // cattle: a long low moo, opening and closing
    moo(ac, dest, t, amp, pan, r) {
      const f = 105 + r() * 35, len = 1.0 + r() * 0.6, g = voice(ac, dest, t, pan, len + 0.3), o = osc(ac, 'sawtooth', f, t, len + 0.2), lp = filter(ac, 'lowpass', 250, 3);
      o.frequency.linearRampToValueAtTime(f * 0.88, t + len);
      lp.frequency.setValueAtTime(250, t); lp.frequency.linearRampToValueAtTime(900, t + len * 0.4); lp.frequency.linearRampToValueAtTime(300, t + len);
      o.connect(lp).connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + 0.25); g.gain.setValueAtTime(amp, t + len * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + len);
    },
    // a horse: a whinny, high and shaking, falling away
    neigh(ac, dest, t, amp, pan, r) {
      const f = 650 + r() * 200, len = 0.9 + r() * 0.4, g = voice(ac, dest, t, pan, len + 0.2), o = osc(ac, 'sawtooth', f, t, len + 0.1);
      o.frequency.exponentialRampToValueAtTime(f * 0.45, t + len);
      wobble(ac, o.frequency, 11, f * 0.08, t, len);
      formants(ac, o, g, [[1100, 3, 1], [2400, 5, 0.4]]);
      env(g, t, amp, 0.05, len);
    },
    // a donkey: hee-haw, hee-haw
    bray(ac, dest, t, amp, pan, r) {
      const n = 3 + (r() * 3 | 0), g = voice(ac, dest, t, pan, n * 0.7 + 0.3), o = osc(ac, 'sawtooth', 600, t, n * 0.7 + 0.2);
      for (let k = 0; k < n; k++) { o.frequency.setValueAtTime(620, t + k * 0.7); o.frequency.linearRampToValueAtTime(560, t + k * 0.7 + 0.3); o.frequency.setValueAtTime(240, t + k * 0.7 + 0.32); o.frequency.linearRampToValueAtTime(210, t + k * 0.7 + 0.65); }
      formants(ac, o, g, [[1000, 3, 1], [2200, 5, 0.4]]);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + 0.05); g.gain.setValueAtTime(amp, t + n * 0.7 - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + n * 0.7);
    },
    // a dog: a bark or two or three
    bark(ac, dest, t, amp, pan, r) {
      const n = 1 + (r() * 3 | 0), f = 300 + r() * 250;
      for (let k = 0; k < n; k++) {
        const s = t + k * (0.18 + r() * 0.1), g = voice(ac, dest, s, pan, 0.3), o = osc(ac, 'sawtooth', f, s, 0.2), nz = noise(ac, s, 0.12), bp = filter(ac, 'bandpass', 900, 1.2);
        o.frequency.exponentialRampToValueAtTime(f * 0.6, s + 0.12);
        o.connect(bp); nz.connect(bp); bp.connect(g);
        env(g, s, amp, 0.005, 0.12);
      }
    },
    meow(ac, dest, t, amp, pan, r) {
      const f = 480 + r() * 150, len = 0.5 + r() * 0.3, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', f, t, len + 0.1), bp = filter(ac, 'bandpass', 900, 3);
      o.frequency.linearRampToValueAtTime(f * 1.45, t + len * 0.4); o.frequency.linearRampToValueAtTime(f * 0.9, t + len);
      bp.frequency.setValueAtTime(700, t); bp.frequency.linearRampToValueAtTime(1600, t + len * 0.4); bp.frequency.linearRampToValueAtTime(800, t + len);
      o.connect(bp).connect(g);
      env(g, t, amp, 0.04, len);
    },
    // hens: a few clucks
    cluck(ac, dest, t, amp, pan, r) {
      const n = 2 + (r() * 4 | 0), f = 650 + r() * 300;
      for (let k = 0; k < n; k++) {
        const s = t + k * (0.11 + r() * 0.06), g = voice(ac, dest, s, pan, 0.15), o = osc(ac, 'triangle', f * (k === n - 1 && r() < 0.4 ? 1.5 : 1), s, 0.1), bp = filter(ac, 'bandpass', 1400, 2);
        o.connect(bp).connect(g);
        env(g, s, amp, 0.004, 0.06);
      }
    },
    // pigs: a grunt, low, rumbling; now and then a squeal
    oink(ac, dest, t, amp, pan, r) {
      const squeal = r() < 0.08, f = squeal ? 700 + r() * 300 : 95 + r() * 50, len = squeal ? 0.4 : 0.22 + r() * 0.2, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', f, t, len + 0.1), lp = filter(ac, 'lowpass', squeal ? 3000 : 700, 2);
      if (squeal) o.frequency.linearRampToValueAtTime(f * 1.5, t + len); else wobble(ac, g.gain, 22 + r() * 8, amp * 0.5, t, len);
      const nz = noise(ac, t, len), nl = filter(ac, 'lowpass', 500); o.connect(lp).connect(g); nz.connect(nl).connect(g);
      env(g, t, amp, 0.02, len);
    },
    // a bird in a tree: a run of chirps
    chirp(ac, dest, t, amp, pan, r) {
      const n = 2 + (r() * 5 | 0), f = 2400 + r() * 2200, up = r() < 0.6;
      for (let k = 0; k < n; k++) {
        const s = t + k * (0.07 + r() * 0.06), g = voice(ac, dest, s, pan, 0.12), o = osc(ac, 'sine', up ? f : f * 1.4, s, 0.08);
        o.frequency.exponentialRampToValueAtTime(up ? f * 1.5 : f, s + 0.06);
        o.connect(g);
        env(g, s, amp, 0.004, 0.05);
      }
    },
    // a cricket: three quick pulses
    cricket(ac, dest, t, amp, pan, r) {
      const f = 4300 + r() * 600;
      for (let k = 0; k < 3; k++) { const s = t + k * 0.035, g = voice(ac, dest, s, pan, 0.05), o = osc(ac, 'sine', f, s, 0.03); o.connect(g); env(g, s, amp, 0.003, 0.02); }
    },
    frog(ac, dest, t, amp, pan, r) {
      const f = 130 + r() * 60, len = 0.25 + r() * 0.15, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', f, t, len + 0.1), bp = filter(ac, 'bandpass', 600, 2);
      wobble(ac, g.gain, 28, amp * 0.6, t, len); o.connect(bp).connect(g);
      env(g, t, amp, 0.02, len);
    },
    owl(ac, dest, t, amp, pan, r) {
      const f = 380 + r() * 60;
      [[0, 0.5], [0.8, 0.25], [1.15, 0.6]].forEach(([d, l]) => { const s = t + d, g = voice(ac, dest, s, pan, l + 0.2), o = osc(ac, 'sine', f, s, l + 0.1); o.frequency.linearRampToValueAtTime(f * 0.94, s + l); o.connect(g); g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(amp, s + 0.08); g.gain.linearRampToValueAtTime(0.0001, s + l); });
    },
    // a fire: a crackle, a spark
    crackle(ac, dest, t, amp, pan, r) {
      const g = voice(ac, dest, t, pan, 0.05), n = noise(ac, t, 0.02), bp = filter(ac, 'bandpass', 2000 + r() * 3000, 1.5);
      n.connect(bp).connect(g);
      env(g, t, amp, 0.001, 0.012);
    },
    // the arena's beasts: a lion's roar, swelling and rumbling away; an
    // elephant's trumpet; a bear's growl
    roar(ac, dest, t, amp, pan, r) {
      const len = 1.4 + r() * 0.8, g = voice(ac, dest, t, pan, len + 0.3), o = osc(ac, 'sawtooth', 150 + r() * 40, t, len + 0.2), lp = filter(ac, 'lowpass', 700, 2), nz = noise(ac, t, len), nl = filter(ac, 'lowpass', 400);
      o.frequency.linearRampToValueAtTime(90, t + len); wobble(ac, g.gain, 18, amp * 0.3, t, len);
      o.connect(lp).connect(g); nz.connect(nl).connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + len * 0.25); g.gain.linearRampToValueAtTime(0.0001, t + len);
    },
    trumpet(ac, dest, t, amp, pan, r) {
      const len = 0.9 + r() * 0.6, f = 420 + r() * 160, g = voice(ac, dest, t, pan, len + 0.2), o = osc(ac, 'sawtooth', f, t, len + 0.1), b = osc(ac, 'square', f * 1.5, t, len + 0.1);
      o.frequency.linearRampToValueAtTime(f * 1.35, t + len * 0.3); o.frequency.linearRampToValueAtTime(f * 1.1, t + len);
      wobble(ac, o.frequency, 9, f * 0.04, t, len);
      formants(ac, o, g, [[1200, 3, 1], [2600, 4, 0.5]]); b.connect(filter(ac, 'bandpass', 1800, 4)).connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + 0.08); g.gain.setValueAtTime(amp, t + len * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + len);
    },
    growl(ac, dest, t, amp, pan, r) {
      const len = 0.8 + r() * 0.6, g = voice(ac, dest, t, pan, len + 0.2), o = osc(ac, 'sawtooth', 85 + r() * 25, t, len + 0.1), lp = filter(ac, 'lowpass', 500, 3), nz = noise(ac, t, len), nl = filter(ac, 'bandpass', 300, 1);
      wobble(ac, g.gain, 26, amp * 0.4, t, len); o.connect(lp).connect(g); nz.connect(nl).connect(g);
      env(g, t, amp, 0.1, len);
    },
    // a footstep on stone or beaten earth: a soft scuff
    step(ac, dest, t, amp, pan, r) {
      const g = voice(ac, dest, t, pan, 0.1), n = noise(ac, t, 0.06), bp = filter(ac, 'bandpass', 900 + r() * 1400, 1.2), lp = filter(ac, 'lowpass', 3500);
      n.connect(bp).connect(lp).connect(g);
      env(g, t, amp, 0.004, 0.045);
    },
    // a hoof: clip-clop, a hollow knock and its pair
    hoof(ac, dest, t, amp, pan, r) {
      for (const [d, k] of [[0, 1], [0.12 + r() * 0.06, 0.8]]) {
        const s = t + d, g = voice(ac, dest, s, pan, 0.12), o = osc(ac, 'triangle', 520 + r() * 260, s, 0.08), n = noise(ac, s, 0.03), bp = filter(ac, 'bandpass', 700 + r() * 300, 4);
        o.frequency.exponentialRampToValueAtTime(300, s + 0.05); o.connect(g); n.connect(bp).connect(g);
        env(g, s, amp * k, 0.002, 0.05);
      }
    },
    // a cart's wheel: a creak and a knock
    creak(ac, dest, t, amp, pan, r) {
      const len = 0.3 + r() * 0.3, g = voice(ac, dest, t, pan, len + 0.1), o = osc(ac, 'sawtooth', 180 + r() * 120, t, len + 0.1), bp = filter(ac, 'bandpass', 1300, 6);
      o.frequency.linearRampToValueAtTime(260 + r() * 200, t + len); o.connect(bp).connect(g);
      env(g, t, amp, 0.05, len);
    },
  };

  // ================= the beds: sounds that go on =================
  // noise shaped into the wind, water, a crowd's talk, applause, a roar, a
  // mill's grinding, carts rumbling; each a gain to be turned up and down
  // (each turned up by one over how loud it is alone, as measured, so that
  // its loudness is its share's)
  function beds(ac, dest) {
    const B = {};
    const bed = (name, chain, pan = 0) => {
      const s = ac.createBufferSource(); s.buffer = noiseOf(ac); s.loop = true; s.start(0, Math.random() * 1.5);
      const g = ac.createGain(); g.gain.value = 0;
      const p = ac.createStereoPanner(); p.pan.value = pan;
      let x = s;
      for (const f of chain) { x.connect(f); x = f; }
      x.connect(g).connect(p).connect(dest);
      B[name] = { g, p, k: 1, level: 0 };
      return B[name];
    };
    bed('wind', [filter(ac, 'lowpass', 380, 0.7)]).k = 14.45;
    bed('fire', [filter(ac, 'lowpass', 600, 0.8), filter(ac, 'highpass', 70)]).k = 11.17;
    bed('water', [filter(ac, 'highpass', 900), filter(ac, 'peaking', 2500, 1)]).k = 2.44;
    bed('river', [filter(ac, 'lowpass', 1400), filter(ac, 'highpass', 200)]).k = 7.23;
    bed('voices', [filter(ac, 'bandpass', 520, 1.4), filter(ac, 'peaking', 1600, 2)]).k = 15.11;
    bed('crowd', [filter(ac, 'bandpass', 700, 0.8)]).k = 10.08;
    bed('mill', [filter(ac, 'lowpass', 180, 1)]).k = 20.45;
    bed('carts', [filter(ac, 'lowpass', 140, 1)]).k = 22.94;
    // applause: a loop of many hands clapping, made once
    {
      const n = ac.sampleRate * 3, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0), r = mulberry32(11);
      for (let c = 0; c < 240; c++) {
        const at = r() * n | 0, len = ac.sampleRate * 0.012 | 0, a = 0.4 + r() * 0.6, tone = r();
        let prev = 0;
        for (let i = 0; i < len && at + i < n; i++) { const w = (r() * 2 - 1) * a * Math.exp(-i / (len / 4)); prev = prev * tone * 0.6 + w; d[at + i] += prev * 0.5; }
      }
      const s = ac.createBufferSource(); s.buffer = b; s.loop = true; s.start();
      const hp = filter(ac, 'highpass', 600), g = ac.createGain(); g.gain.value = 0;
      const p = ac.createStereoPanner(); s.connect(hp).connect(g).connect(p).connect(dest);
      B.applause = { g, p, k: 18.02, level: 0 };
    }
    return B;
  }

  // ================= what makes each sound, and how much of it =================
  // a kind of sound: a voice (V) made now and then by each that makes it, so
  // often (rate a second), so loud (w, of the whole, each); E, how much sound
  // there is in one at its fullest, and pk, how high it peaks (as measured,
  // each made alone); or a bed turned up by each that makes it
  const KIND = {
    anvil: { v: 'anvil', rate: 0.75, w: 1, E: 0.0195, pk: 1.94 },
    clash: { v: 'clash', rate: 0.8, w: 1, E: 0.0235, pk: 1.58 },
    chisel: { v: 'chisel', rate: 1.2, w: 0.4, E: 0.0027, pk: 0.87 },
    chop: { v: 'chop', rate: 0.7, w: 0.5, E: 0.0061, pk: 0.92 },
    axe: { v: 'axe', rate: 0.6, w: 0.8, E: 0.0054, pk: 0.83 },
    saw: { v: 'saw', rate: 1.1, w: 0.45, E: 0.0035, pk: 0.61 },
    pipe: { v: 'pipe', rate: 2.2, w: 1.2, E: 0.0739, pk: 1.45 },
    kid: { v: 'kid', rate: 0.08, w: 0.25, E: 0.0006, pk: 0.32 },
    word: { v: 'word', rate: 0.3, w: 0.08, E: 0.0002, pk: 0.25 },
    bleat: { v: 'bleat', rate: 1 / 35, w: 0.18, E: 0.0015, pk: 0.26 },
    goat: { v: 'bleat', rate: 1 / 30, w: 0.18, E: 0.0012, pk: 0.23, arg: true },
    moo: { v: 'moo', rate: 1 / 80, w: 0.35, E: 0.1065, pk: 0.91 },
    neigh: { v: 'neigh', rate: 1 / 120, w: 0.35, E: 0.0027, pk: 0.3 },
    bray: { v: 'bray', rate: 1 / 240, w: 0.5, E: 0.0344, pk: 0.35 },
    bark: { v: 'bark', rate: 1 / 25, w: 0.5, E: 0.0011, pk: 0.6 },
    meow: { v: 'meow', rate: 1 / 120, w: 0.2, E: 0.0017, pk: 0.24 },
    cluck: { v: 'cluck', rate: 1 / 7, w: 0.07, E: 0.001, pk: 0.53 },
    oink: { v: 'oink', rate: 1 / 9, w: 0.18, E: 0.0101, pk: 1.19 },
    chirp: { v: 'chirp', rate: 1 / 14, w: 0.12, E: 0.007, pk: 0.72 },
    cricket: { v: 'cricket', rate: 1.2, w: 0.05, E: 0.0026, pk: 0.7 },
    frog: { v: 'frog', rate: 1 / 3, w: 0.12, E: 0.0015, pk: 0.58 },
    owl: { v: 'owl', rate: 1 / 90, w: 0.4, E: 0.1125, pk: 0.71 },
    crackle: { v: 'crackle', rate: 5, w: 0.25, E: 5e-05, pk: 0.44 },
    roar: { v: 'roar', rate: 1 / 60, w: 1.2, E: 0.0894, pk: 1.2 },
    trumpet: { v: 'trumpet', rate: 1 / 120, w: 1.2, E: 0.0293, pk: 0.66 },
    growl: { v: 'growl', rate: 1 / 50, w: 0.6, E: 0.0359, pk: 1.22 },
    step: { v: 'step', rate: 1.8, w: 0.02, E: 0.0001, pk: 0.36, cap: 24 },
    hoof: { v: 'hoof', rate: 1.6, w: 0.08, E: 0.0019, pk: 0.73, cap: 16 },
    creak: { v: 'creak', rate: 0.5, w: 0.25, E: 0.0003, pk: 0.17 },
    wind: { bed: true }, fire: { bed: true }, water: { bed: true }, river: { bed: true }, voices: { bed: true }, crowd: { bed: true }, mill: { bed: true }, carts: { bed: true }, applause: { bed: true },
  };
  // (no more of a kind than this a second, each the louder for it)
  const CAP = 7;
  // a tune for the pipes: a mode, wandering, each piper his own phrase
  const MODE = [62, 64, 65, 67, 69, 70, 72, 74, 76];

  function create(town, seed = 1) {
    const r = mulberry32((seed ^ 0x50d) >>> 0);
    let ac = null, master = null, B = null, on = false, last = 0;
    const tunes = new Map();
    // the town's still things that sound: the fountains, the nymphaeum's
    // basin, the river's course, the trees birds sing in, the fires of the
    // ovens and forges
    const fountains = town.buildings.filter(b => b.use === 'fountain').map(b => [b.x, b.y, 1]).concat((town.places || []).filter(p => p.kind === 'nymphaeum').map(p => [p.x, p.y, 2.5]));
    const river = town.river ? town.river.points.filter((_, i) => i % 2 === 0) : [];
    const trees = town.trees.filter(t => t.kind !== 'shrub' && t.r > 1.6).map(t => [t.x, t.y]);
    const fires = (town.lamps || []).filter(l => l.hearth).map(l => [l.x, l.y]), lamps = (town.lamps || []).filter(l => !l.hearth).map(l => [l.x, l.y]);

    function start() {
      ac = new AudioContext({ latencyHint: 'playback' });
      const limit = ac.createDynamicsCompressor();
      limit.threshold.value = -6; limit.knee.value = 6; limit.ratio.value = 12; limit.attack.value = 0.003; limit.release.value = 0.25;
      limit.connect(ac.destination);
      master = ac.createGain(); master.gain.value = 0; master.connect(limit);
      B = beds(ac, master);
    }
    function toggle() {
      on = !on;
      if (on && !ac) start();
      if (!ac) return on;
      ac.resume();
      const g = master.gain, t = ac.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(on ? 1 : 0, t + 1.2);
      return on;
    }

    // what is in view, a few times a second: how much of each kind, and
    // where; each kind its share of the whole; the beds turned to theirs,
    // the voices sounded as often as their makers would, as loud as their share
    function update(life, rect, sky, playing) {
      if (!on || !ac) return;
      const now = ac.currentTime;
      if (now - last < 0.15) return;
      const dt = Math.min(0.5, now - last);
      last = now;
      const [x0, y0, w, h] = rect, x1 = x0 + w, y1 = y0 + h, cx = x0 + w / 2;
      const inView = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const day = sky.sun.el > -0.05, dusk = sky.sun.el > -0.15 && !day;
      const src = {}, add = (k, x, y, n = 1) => { const s = src[k] || (src[k] = { n: 0, at: [] }); s.n += n; if (s.at.length < 64) s.at.push([x, y, n]); };
      if (life && playing) for (const f of life.figures) {
        if (!inView(f.x, f.y)) continue;
        // (a beast lying down is quiet: asleep, by night; by day, now and then)
        const resting = f.kind !== 'person' && f.pose === 'lie' ? (day ? 0.15 : 0) : 1;
        if (!resting) continue;
        switch (f.kind) {
          case 'person': {
            const a = f.anim, L = f.leg;
            if (a === 'hammer') add('anvil', f.x, f.y);
            else if (a === 'fight') add('clash', f.x, f.y, 0.5);
            else if (a === 'chisel') add('chisel', f.x, f.y);
            else if (a === 'chop') add('chop', f.x, f.y);
            else if (a === 'axe') add('axe', f.x, f.y);
            else if (a === 'saw') add('saw', f.x, f.y);
            else if (a === 'pipe') add('pipe', f.x, f.y);
            else if (a === 'push') add('mill', f.x, f.y);
            else if (a === 'clap') add('applause', f.x, f.y);
            else if (a === 'cheer') add('crowd', f.x, f.y, 1.5);
            else if (L && L.watch) add('crowd', f.x, f.y, 0.15);
            else if (L && L.play) add('kid', f.x, f.y);
            else if (a === 'talk' || a === 'declaim' || a === 'sell' || a === 'dice') { add('voices', f.x, f.y); add('word', f.x, f.y); }
            else if (f.pose === 'walk' || f.pose === 'stand') add('voices', f.x, f.y, 0.08);
            if (f.pose === 'walk' || f.pose === 'run') add('step', f.x, f.y, f.pose === 'run' ? 1.6 : 1);
            break;
          }
          case 'sheep': add('bleat', f.x, f.y, resting); break;
          case 'goat': add('goat', f.x, f.y, resting); break;
          case 'cow': case 'ox': add('moo', f.x, f.y, resting); break;
          case 'horse': case 'rider': add('neigh', f.x, f.y, resting); break;
          case 'donkey': add('bray', f.x, f.y, resting); break;
          case 'dog': add('bark', f.x, f.y, f.pose === 'run' ? 3 : resting); break;
          case 'cat': add('meow', f.x, f.y, resting); break;
          case 'lion': add('roar', f.x, f.y, resting * (f.male ? 1 : 0.6)); break;
          case 'elephant': add('trumpet', f.x, f.y, resting); break;
          case 'bear': add('growl', f.x, f.y, resting * (f.pose === 'rear' ? 4 : 1)); break;
          case 'hen': add('cluck', f.x, f.y); break;
          case 'pig': add('oink', f.x, f.y, f.pose === 'lie' ? resting * 2 : 1); break;
          case 'cart': if (f.pose === 'walk') { add('carts', f.x, f.y); add('creak', f.x, f.y); } break;
        }
        // (and the hooves of whatever big goes by, the feet of the small)
        if ((f.kind === 'horse' || f.kind === 'rider' || f.kind === 'donkey' || f.kind === 'cow' || f.kind === 'ox' || f.kind === 'elephant') && (f.pose === 'walk' || f.pose === 'run')) add('hoof', f.x, f.y, f.pose === 'run' ? 2 : 1);
        if ((f.kind === 'sheep' || f.kind === 'goat' || f.kind === 'pig') && (f.pose === 'walk' || f.pose === 'run')) add('step', f.x, f.y, 0.6);
      }
      for (const [x, y, n] of fountains) if (inView(x, y)) add('water', x, y, n);
      for (const [x, y] of river) if (inView(x, y)) { add('river', x, y, 0.25); if (!day) add('frog', x, y, 0.3); }
      let tn = 0;
      for (const [x, y] of trees) if (inView(x, y)) { tn++; if (day || dusk) add('chirp', x, y, day ? 1 : 0.5); }
      if (!day && tn) add('owl', cx, y0 + h / 2, Math.min(1, tn / 40));
      // fires: the ovens', forges', kilns' and hearths', always; the torches
      // carried and the lamps along the streets, by night
      for (const [x, y] of fires) if (inView(x, y)) { add('fire', x, y, 0.6); add('crackle', x, y, 1); }
      if (!day) for (const [x, y] of lamps) if (inView(x, y)) { add('fire', x, y, 0.3); add('crackle', x, y, 0.4); }
      if (life && playing) for (const l of life.lights) if (inView(l.x, l.y)) { add('fire', l.x, l.y, 0.4); add('crackle', l.x, l.y, 0.6); }
      // crickets in the grass by night, all over
      if (!day) add('cricket', cx, y0 + h / 2, 6);
      add('wind', cx, y0 + h / 2, 1);
      // the whole, and each kind's share of it
      let P = 0;
      for (const k in src) P += src[k].n * (KIND[k].w ?? BEDW[k]);
      const panOf = x => clamp((x - cx) / (w / 2), -1, 1) * 0.8;
      for (const k in B) {
        const s = src[k], share = s ? s.n * BEDW[k] / P : 0, b = B[k];
        if (s) { let sx = 0, sn = 0; for (const [x, , n] of s.at) { sx += x * n; sn += n; } b.p.pan.setTargetAtTime(panOf(sx / sn), now, 0.3); }
        // (the wind rising and falling of itself)
        const gust = k === 'wind' ? 0.75 + 0.25 * Math.sin(now * 0.31 + Math.sin(now * 0.13) * 2) : k === 'fire' ? 0.7 + 0.6 * r() : 1;
        // (the wind counted in the whole, so that nothing is ever all there is, but itself kept low: a breath behind it all)
        b.g.gain.setTargetAtTime(LEVEL * b.k * Math.sqrt(share) * gust * (k === 'wind' ? 0.35 : 1), now, 0.25);
      }
      for (const k in src) {
        const K = KIND[k];
        if (K.bed) continue;
        const s = src[k], rate = s.n * K.rate, play = Math.min(rate, K.cap || CAP), share = s.n * K.w / P;
        // (as loud as makes its share, played as often as it is: louder the rarer)
        const amp = Math.min(0.9 / K.pk, LEVEL * Math.sqrt(share / (play * K.E)));
        // (how many in this moment: as many as are due, the odd one at random)
        const lam = play * dt, count = Math.min(K.cap ? 8 : 6, Math.floor(lam) + (r() < lam % 1 ? 1 : 0));
        for (let c = 0; c < count; c++) {
          const [x, y] = s.at[r() * s.at.length | 0], t = now + 0.05 + r() * dt;
          let note;
          if (k === 'pipe') { const key = Math.round(x * 3) + ',' + Math.round(y * 3); const st = tunes.get(key) || { i: r() * MODE.length | 0 }; st.i = clamp(st.i + (r() < 0.5 ? -1 : 1) * (r() < 0.8 ? 1 : 2), 0, MODE.length - 1); tunes.set(key, st); note = MODE[st.i]; }
          V[K.v](ac, master, t, amp, panOf(x), r, K.arg ?? note);
        }
      }
    }
    return { toggle, update, get on() { return on; } };
  }
  // how loud a bed is of the whole, for each that makes it
  const BEDW = { fire: 0.25, wind: 1.2, water: 0.6, river: 0.35, voices: 0.12, crowd: 0.12, mill: 0.35, carts: 0.5, applause: 0.2 };
  return { create, V, KIND, beds };
})();
