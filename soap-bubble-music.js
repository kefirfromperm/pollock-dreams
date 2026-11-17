// Soap Bubble's sound: no music of its own, only the film gurgling. Each
// glare born is heard as a bubble, or a run of a few (the page decides which
// and when): a bubble rings as it is born (Minnaert), a pure tone dying away
// within a few dozen of its cycles and rising a little as it does (after van
// den Doel's model), in a small wet room.
const SoapBubbleMusic = (() => {
  const AHEAD = 0.5; // seconds scheduled ahead (nothing is: the bubbles come as the film makes them)
  const LEVEL = 2.5; // master gain (the bubbles, each brief, as loud at their peaks as the other paintings' music)

  // The sound on context ac, into dest: bubble(t, …) at its time t.
  function graph(ac, seed, dest) {
    const rng = PollockDreams.mulberry32(seed);
    const t0 = ac.currentTime + 0.05;
    const out = ac.createGain();
    // a small wet room, from decaying noise
    const len = Math.round(ac.sampleRate * 1.2), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (rng() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    const verb = ac.createConvolver(); verb.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = 0.25;
    out.connect(dest); out.connect(verb); verb.connect(wet); wet.connect(dest);

    // a bubble at time t, of pitch f0 Hz, as loud as loud, from pan (−1 left, 1 right)
    function bubble(t, f0, loud, pan) {
      if (t < 0) return;
      const t1 = t0 + t;
      const d = 0.6 * (0.13 * f0 + 0.0072 * Math.pow(f0, 1.5)); // its damping, 1/s
      const life = 5 / d;
      const osc = ac.createOscillator(), g = ac.createGain(), p = ac.createStereoPanner();
      osc.frequency.setValueAtTime(f0, t1);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t1 + life);
      g.gain.setValueAtTime(0, t1);
      g.gain.linearRampToValueAtTime(loud, t1 + 0.003);
      g.gain.setTargetAtTime(0, t1 + 0.003, 1 / d);
      p.pan.value = pan;
      osc.connect(g); g.connect(p); p.connect(out);
      osc.start(t1); osc.stop(t1 + life + 0.05);
    }
    const schedule = () => {}; // (nothing to schedule: see AHEAD)
    const time = () => ac.currentTime - t0;
    return { schedule, bubble, time };
  }

  // The player, on a context and into a node it is given: a bubble now, or
  // delay seconds from now.
  function player(ac, dest, seed, level = LEVEL) {
    const master = ac.createGain();
    master.gain.value = level;
    master.connect(dest);
    const sound = graph(ac, seed, master);
    return { bubble: (f0, loud, pan, delay = 0) => sound.bubble(sound.time() + 0.005 + delay, f0, loud, pan) };
  }

  return { graph, player };
})();
