// Roman Town's reels, each a plot: the town (its seed), the day and the hour
// it begins (in Rome), how long, how fast the town's time runs (a number, or
// one for each second of the film: a sunrise hurried, then life as it goes;
// past 15 times the people can't keep up, but the sky can), and where the
// camera is at each moment: camera(t, { town, life }) gives [x, y, zoom],
// the middle of the view in metres, north up, and how close (1 the town's
// whole height on the screen, 64 a person a hand's breadth), and the speed
// too, if it is the camera's to say. Filmed by render-roman-town.cjs, in
// order, frame after frame, so a camera may keep what it needs from one
// frame to the next.
const RomanTownPlots = (() => {
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const ease = t => t * t * (3 - 2 * t);

  // ---- through keys [t, x, y, zoom]: smoothly (a cubic through each, never
  // past it, so a key held is held still), zoom by its logarithm, still
  // before the first and after the last ----
  function keys(K) {
    const P = K.map(([t, x, y, z]) => [t, x, y, Math.log(z)]);
    // the slope at each key, of each of x, y, log zoom: none at the ends, nor
    // where it turns back or holds (Fritsch–Carlson: no overshoot)
    const slope = P.map((p, i) => [1, 2, 3].map(c => {
      if (i === 0 || i === P.length - 1) return 0;
      const a = (p[c] - P[i - 1][c]) / (p[0] - P[i - 1][0]), b = (P[i + 1][c] - p[c]) / (P[i + 1][0] - p[0]);
      return a * b <= 0 ? 0 : 2 * a * b / (a + b);
    }));
    return t => {
      if (t <= P[0][0]) return [P[0][1], P[0][2], Math.exp(P[0][3])];
      const i = P.findIndex((p, k) => k > 0 && t <= p[0]);
      if (i < 0) { const p = P[P.length - 1]; return [p[1], p[2], Math.exp(p[3])]; }
      const a = P[i - 1], b = P[i], h = b[0] - a[0], s = (t - a[0]) / h;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
      const v = [1, 2, 3].map((c, j) => h00 * a[c] + h10 * h * slope[i - 1][j] + h01 * b[c] + h11 * h * slope[i][j]);
      return [v[0], v[1], Math.exp(v[2])];
    };
  }

  // ---- after someone: picked by pick(life, [x, y]) (the one that will do
  // best seen from x, y, at first from), the camera easing after them (lag
  // seconds behind), as close as zoom(t) says; where they go in, it waits
  // where they went; and if done(them) has been so a couple of seconds, it
  // takes up whoever will do best from there ----
  function follow(pick, zoom, { lag = 1.2, from = [410, 410], done = null } = {}) {
    let who = null, [x, y] = from, last = 0, since = null;
    return (t, { life }) => {
      if (!who) { who = pick(life, [x, y]); if (!who) throw new Error('nobody to follow'); last = t; }
      const k = 1 - Math.exp(-Math.max(0, t - last) / lag);
      if (who.vis !== false) { x += (who.x - x) * k; y += (who.y - y) * k; }
      if (done && done(who)) { if (t - (since ??= t) > 2) { who = pick(life, [x, y]) || who; since = null; } } else since = null;
      last = t;
      return [x, y, typeof zoom === 'function' ? zoom(t) : zoom];
    };
  }

  // ---- one camera, then another: from a to b between t0 and t1 ----
  function then(a, b, t0, t1) {
    return (t, ctx) => {
      const A = t < t1 ? a(t, ctx) : null, B = t > t0 ? b(t, ctx) : null;
      if (!B) return A;
      if (!A) return B;
      const s = ease(clamp((t - t0) / (t1 - t0), 0, 1));
      return [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, Math.exp(Math.log(A[2]) + (Math.log(B[2]) - Math.log(A[2])) * s)];
    };
  }
  const zoomKeys = K => { const k = keys(K.map(([t, z]) => [t, 0, 0, z])); return t => k(t)[2]; };
  const near = (x, y) => (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y);
  // someone out walking with a torch, the nearest to [x, y]
  const torch = (life, [x, y]) => life.people.filter(p => p.vis && p.pose === 'walk' && life.lights.some(l => Math.hypot(l.x - p.x, l.y - p.y) < 0.8))
    .sort(near(x, y))[0];

  return {
    // the sun coming up over the town, hurried; then down into a street as
    // it wakes, at its own pace: water from the fountain, the shops opening
    dawn: {
      // (an hour and more in the first half minute: the sky hurried past what
      // the people can keep up with, as a time-lapse; then a street at its pace)
      time: '2026-06-03T05:15', seconds: 45,
      speed: t => t < 24 ? 150 : t < 31 ? Math.exp(Math.log(150) * (1 - ease((t - 24) / 7))) : 1,
      camera: keys([[0, 410, 410, 1], [22, 405, 410, 1.25], [34, 386, 374, 9], [45, 385, 372, 14]]),
    },
    // a morning in the forum, the market day's crowd, then the town's grand fountain
    market: {
      time: '2026-06-07T09:30', seconds: 45,
      camera: keys([[0, 416, 395, 2.2], [12, 416, 395, 5], [26, 410, 400, 12], [36, 396, 428, 12], [45, 393, 433, 16]]),
    },
    // an afternoon at the baths: the town's roofs, the baths' halls and
    // warm pools, and out in the palaestra lengths swum in the open pool
    baths: {
      time: '2026-06-02T16:00', seconds: 45,
      camera: keys([[0, 300, 410, 2], [14, 212, 420, 6], [28, 208, 414, 14], [45, 207, 409, 20]]),
    },
    // a games day: the whole town gone out to the amphitheatre; the crowd
    // on its steps, and on the sand a hunter after the beasts
    games: {
      time: '2026-06-11T16:00', seconds: 45,
      camera: then(keys([[0, 400, 400, 1], [12, 280, 240, 2.5], [24, 266, 217, 6], [34, 266, 217, 11]]),
        follow(life => life.people.filter(p => p.job === 'venator').sort(near(266, 217))[0], zoomKeys([[30, 11], [40, 20], [45, 22]]), { lag: 2, from: [266, 217] }), 30, 37),
    },
    // a play: the crowd on the theatre's steps, the actors on the stage, the pipes
    theatre: {
      time: '2026-06-09T16:00', seconds: 45,
      camera: keys([[0, 416, 395, 3], [12, 370, 492, 3], [24, 358, 528, 7], [45, 358, 534, 14]]),
    },
    // dusk on the night of the full moon: the lamps lit along the streets,
    // and the last of the town going home by torchlight, one after another
    night: {
      time: '2026-06-29T21:25', seconds: 45,
      camera: then(keys([[0, 400, 410, 1.2], [8, 400, 410, 2.2]]),
        follow(torch, zoomKeys([[6, 2.2], [18, 11], [45, 15]]), { lag: 1.5, from: [400, 410], done: p => !p.vis || p.pose !== 'walk' }), 5, 14),
    },
    // the country in the early morning, hurried, till a shepherd begins
    // to gather his flock; then with him, at his pace, the dog bringing
    // them in, out through the gate and along the track to fresh grass
    flock: {
      time: '2026-06-02T07:00', seconds: 45,
      camera: (() => {
        const wide = [410, 410, 1.1];
        let H = null, at = 0, x, y, last = 0;
        return (t, { life }) => {
          if (!H) {
            H = t > 1 && (life.herds.find(h => h.mode === 'gather' && h.shepherd) || (t > 24 && life.herds.find(h => h.mode !== 'graze' && h.shepherd)));
            // (drawing in a little while it waits)
            if (!H) return [wide[0], wide[1], wide[2] * Math.exp(0.012 * t), 15];
            at = t; wide[2] *= Math.exp(0.012 * t); x = H.shepherd.x; y = H.shepherd.y; last = t;
          }
          const p = H.shepherd, k = 1 - Math.exp(-(t - last) / 2.5);
          x += (p.x - x) * k; y += (p.y - y) * k; last = t;
          const s = ease(clamp((t - at) / 7, 0, 1)), z = Math.exp(Math.log(wide[2]) + (Math.log(12) - Math.log(wide[2])) * ease(clamp((t - at) / 9, 0, 1)));
          return [wide[0] + (x - wide[0]) * s, wide[1] + (y - wide[1]) * s, z, 15 - 14 * ease(clamp((t - at) / 5, 0, 1))];
        };
      })(),
    },
  };
})();
