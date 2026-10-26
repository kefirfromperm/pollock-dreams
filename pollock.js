// Pollock Dreams — drip painting engine, shared by the page (pollock-static.html)
// and the Open Graph image generator (og/og.html).
const PollockDreams = (() => {
  const TAU = Math.PI * 2;

  // Palettes after specific Pollock paintings (colours approximated by eye).
  // colors: [structure dark, light, ...other colours]; bg: the ground.
  const PALETTES = [
    { name: 'Autumn Rhythm (Number 30), 1950', bg: '#d6c6a5', colors: ['#16130f', '#efe9dc', '#6e4f34', '#8d8a80', '#3d3a36', '#a68b62'] },
    { name: 'Blue Poles (Number 11), 1952', bg: '#c4ad84', colors: ['#14110f', '#f2ecdf', '#1d3570', '#e5762c', '#efc63a', '#b0b4b6', '#c9475a'] },
    { name: 'Lavender Mist (Number 1), 1950', bg: '#d2c4b8', colors: ['#1b1918', '#ede7e2', '#c9a0aa', '#8a8f9a', '#b8916b', '#a9a39c', '#6d6670'] },
    { name: 'Convergence, 1952', bg: '#e9e3d6', colors: ['#111111', '#f6f2e8', '#d43a28', '#ecc62c', '#2a58a6', '#e2792a'] },
    { name: 'Number 1A, 1948', bg: '#cdbb98', colors: ['#141210', '#f1ece1', '#8f8c86', '#c9a13c', '#a23b2a', '#5a5249'] },
    { name: 'One: Number 31, 1950', bg: '#d8c9ab', colors: ['#171411', '#ece6d8', '#9c8f7a', '#6f7a7e', '#b9a684', '#4a443c'] },
    { name: 'Number 5, 1948', bg: '#5a4a38', colors: ['#141110', '#efe6d0', '#c8a03a', '#8a6a44', '#a7a29a', '#6b5a48', '#b84a2b'] },
    { name: 'Full Fathom Five, 1947', bg: '#2d3a32', colors: ['#0f1512', '#e9e8de', '#3f6b5b', '#1f4a4f', '#a8acaa', '#d9822b', '#6f8c3a'] },
    { name: 'Cathedral, 1947', bg: '#d9d4c8', colors: ['#131313', '#f7f5ef', '#a9abaa', '#c7a246', '#7c7f80', '#d9c58a'] },
    { name: 'Alchemy, 1947', bg: '#8a7356', colors: ['#141211', '#f3eee3', '#e2852e', '#e6c13d', '#2f7d7a', '#a9a9a6', '#a3402c'] },
    { name: 'Shimmering Substance, 1946', bg: '#d9b54a', colors: ['#4a3a1e', '#fbf6e4', '#f1d24a', '#e8933a', '#f2b9a0', '#c7d4c2'] },
    { name: 'Eyes in the Heat, 1946', bg: '#b94a2e', colors: ['#1d1512', '#fbf3e3', '#f0c23e', '#e2702d', '#d93a2c', '#7aa0a8'] },
    { name: 'Number 8, 1949', bg: '#6e5a45', colors: ['#121010', '#efe9db', '#b5b7b6', '#e8be3c', '#d0532e', '#8f9aa0'] },
    { name: 'Summertime: Number 9A, 1948', bg: '#e3d7bd', colors: ['#121110', '#f6f2e7', '#f0c53a', '#2c5ea8', '#d2402c', '#8fb0c6'] },
    { name: 'Reflection of the Big Dipper, 1947', bg: '#2a3f66', colors: ['#0d1220', '#eef0f2', '#3e6db5', '#f0cd45', '#7fa8d6', '#1c2a4a'] },
    { name: 'Galaxy, 1947', bg: '#2b2620', colors: ['#0e0c0a', '#f1ebd9', '#c3b49a', '#b8a565', '#a7aaa9', '#e1c341'] },
    { name: 'Out of the Web: Number 7, 1949', bg: '#8b6f50', colors: ['#121010', '#f2ede2', '#a0a3a4', '#e8c13f', '#c75a4a', '#5f6d74'] },
    { name: 'Number 17A, 1948', bg: '#e6dcc5', colors: ['#141210', '#faf6ec', '#efc43a', '#d23c2b', '#9b9a96', '#4a6fa0'] },
    { name: 'Phosphorescence, 1947', bg: '#3a3d33', colors: ['#121411', '#f2f1e9', '#b2b6b3', '#e9cf4b', '#5c8a52', '#d48a3b'] },
    { name: 'Greyed Rainbow, 1953', bg: '#4a4a4a', colors: ['#101010', '#f2f2ef', '#8c8c8a', '#bcbcb8', '#e2b23a', '#3c79b5', '#d6612d'] },
    { name: 'White Light, 1954', bg: '#2a2622', colors: ['#0f0d0c', '#fbf8f0', '#d53a2a', '#ecc53a', '#4c8c4f', '#b9bdbd'] },
    { name: 'Number 14: Gray, 1948', bg: '#8f8e8a', colors: ['#121212', '#f4f3ef', '#c4c3bf', '#5f5e5b', '#a9a8a4'] },
    { name: 'Lucifer, 1947', bg: '#c9bfa5', colors: ['#111111', '#f3efe4', '#2f6b45', '#b4b7b6', '#d63b2c', '#efc63c', '#6aa0a8'] },
    { name: 'Enchanted Forest, 1947', bg: '#ddd2b8', colors: ['#121110', '#faf7ee', '#cf3b2c', '#f0c43d', '#2c5aa4', '#6c8f4a'] },
    { name: 'Number 13A: Arabesque, 1948', bg: '#8d8273', colors: ['#121110', '#efe9dc', '#5d564c', '#b3aa9a', '#c9a24a'] },
    { name: 'Number 18, 1950', bg: '#d8c2b0', colors: ['#161313', '#f1e9e3', '#d68aa0', '#9aa0a8', '#b47c5c', '#5d4f57'] },
    { name: 'The Deep, 1953', bg: '#e9e6df', colors: ['#0c0c0c', '#fbfaf6', '#9fa2a3', '#3a3c3e', '#cfd1cf'] },
    { name: 'Number 23, 1948', bg: '#e2ddd0', colors: ['#111111', '#faf8f2', '#c43a2c', '#7d7a74', '#d9b44a'] },
    { name: 'Number 32, 1950', bg: '#d4c3a2', colors: ['#121010', '#e4d8bf', '#5b4f40', '#8f826d', '#2e2924'] },
    { name: 'Ocean Greyness, 1953', bg: '#5c6670', colors: ['#121518', '#eef1f2', '#2f5f8f', '#9aa6ae', '#e7c443', '#6d8fa8'] },
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
  function jitter(c, rng, amt) {
    const k = 1 + (rng() - 0.5) * amt;
    return c.map(v => Math.max(0, Math.min(255, v * k + (rng() - 0.5) * amt * 40)));
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Power-law sample in [min, max] with exponent alpha (heavy tail).
  function powerLaw(rng, min, max, alpha) {
    return Math.min(max, min * Math.pow(1 - rng(), -1 / alpha));
  }

  // canvas coverage controls
  const UNDER_PASSES = 3, UNDER_WEIGHT = 0.55, UNDER_WB = 6, DENSITY = 5, MAX_W = 20;

  // Everything that draws is bound to one 2D context, W×H in CSS pixels.
  function engine(ctx, W, H) {
    function grainPattern(rng, light) {
      const g = document.createElement('canvas');
      g.width = g.height = 160;
      const gx = g.getContext('2d');
      const img = gx.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = light ? 255 : 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = rng() * 255;
      }
      gx.putImageData(img, 0, 0);
      // faint canvas weave
      gx.globalAlpha = 0.25;
      gx.strokeStyle = light ? '#fff' : '#000';
      for (let i = 0; i < 160; i += 3) {
        gx.beginPath(); gx.moveTo(0, i + 0.5); gx.lineTo(160, i + 0.5); gx.stroke();
        gx.beginPath(); gx.moveTo(i + 0.5, 0); gx.lineTo(i + 0.5, 160); gx.stroke();
      }
      return ctx.createPattern(g, 'repeat');
    }

    function paintGround(rng, bg) {
      ctx.fillStyle = rgba(bg, 1);
      ctx.fillRect(0, 0, W, H);
      // stains and uneven priming
      for (let i = 0; i < 26; i++) {
        const x = rng() * W, y = rng() * H, r = (0.1 + rng() * 0.45) * Math.max(W, H);
        const c = jitter(bg, rng, 0.35);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c, 0.06 + rng() * 0.08));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = grainPattern(rng, false);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = grainPattern(rng, true);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    function blob(x, y, r, rng, fill) {
      const n = 9 + (rng() * 6 | 0);
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU;
        const rr = r * (0.7 + rng() * 0.5);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Closed organic outline: a circle whose radius is perturbed by a few
    // integer harmonics (so it closes cleanly), drawn with smooth curves.
    function wobblyPath(rng, x, y, r, rough, stretch, rot) {
      const harm = [2, 3, 4, 5, 7, 9, 13].map((f, k) => ({ f, a: rough * (0.3 + rng() * 0.7) / Math.pow(k + 1, 0.7), p: rng() * TAU }));
      const n = 40, pts = [];
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        let k = 1;
        for (const h of harm) k += h.a * Math.sin(h.f * t + h.p);
        const px = Math.cos(t) * r * k * stretch, py = Math.sin(t) * r * k;
        pts.push([x + px * cr - py * sr, y + px * sr + py * cr]);
      }
      ctx.beginPath();
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m = mid(pts[n - 1], pts[0]);
      ctx.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) {
        const q = mid(pts[i], pts[(i + 1) % n]);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]);
      }
      ctx.closePath();
    }

    // Ink blot: a dropped or thrown splash of paint — a pool with a wobbly rim,
    // tapered spikes thrown out (biased toward the throw direction), droplets
    // at the spike tips and a spray of satellites whose sizes follow a power law.
    function inkblot(rng, x, y, r, col, alpha) {
      const fill = rgba(col, alpha);
      const dir = rng() * TAU, bias = rng() * 0.9;
      const stretch = 1 + bias * 0.5 * rng();

      if (rng() < 0.3) { // paint soaked into the raw canvas around the pool
        wobblyPath(rng, x, y, r * (1.3 + rng() * 0.7), 0.3, stretch, dir);
        ctx.fillStyle = rgba(col, 0.07 + rng() * 0.08);
        ctx.fill();
      }

      wobblyPath(rng, x, y, r, 0.22 + rng() * 0.25, stretch, dir);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.fillStyle = fill;
      const spikes = 3 + (rng() * (6 + r * 0.6) | 0);
      for (let i = 0; i < spikes; i++) {
        const a = rng() * TAU;
        const pull = 1 + bias * Math.max(0, Math.cos(a - dir));
        const reach = r * (0.9 + powerLaw(rng, 0.12, 1.3, 1.6) * pull);
        const base = r * (0.08 + rng() * 0.22);
        const ca = Math.cos(a), sa = Math.sin(a);
        const bx = x + ca * r * 0.5, by = y + sa * r * 0.5;
        const tx = x + ca * reach, ty = y + sa * reach;
        const nx = -sa * base, ny = ca * base;
        const mx = (bx + tx) / 2, my = (by + ty) / 2;
        ctx.beginPath();
        ctx.moveTo(bx + nx, by + ny);
        ctx.quadraticCurveTo(mx + nx * 0.25, my + ny * 0.25, tx, ty);
        ctx.quadraticCurveTo(mx - nx * 0.25, my - ny * 0.25, bx - nx, by - ny);
        ctx.fill();
        if (rng() < 0.55) {
          const dr = base * (0.35 + rng() * 0.5);
          ctx.beginPath();
          ctx.arc(tx + ca * dr * 0.6, ty + sa * dr * 0.6, dr, 0, TAU);
          ctx.fill();
        }
      }

      const sats = (r * (0.8 + rng() * 2.2)) | 0;
      for (let i = 0; i < sats; i++) {
        const a = rng() * TAU;
        const pull = 1 + bias * Math.max(0, Math.cos(a - dir)) * 2.5;
        const d = r * (1.1 + powerLaw(rng, 0.2, 5, 1.1) * pull);
        const sr = powerLaw(rng, 0.35, Math.max(0.6, r * 0.3), 1.8);
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, sr * (1 + rng() * 0.8 * pull), sr, a, 0, TAU);
        ctx.fill();
      }

      if (r > 7) { // enamel sheen
        wobblyPath(rng, x - r * 0.18, y - r * 0.22, r * 0.45, 0.3, stretch, dir);
        ctx.fillStyle = rgba(col.map(v => Math.min(255, v + 70)), 0.1);
        ctx.fill();
      }
    }

    // One blot, or a trail of shrinking blots left by a flick of the stick.
    function throwBlots(rng, L, maxR) {
      const r0 = powerLaw(rng, 2.5, maxR, 1.5);
      let x = -0.05 * W + rng() * 1.1 * W, y = -0.05 * H + rng() * 1.1 * H;
      const col = jitter(L.c, rng, 0.12), alpha = 0.9 + rng() * 0.1;
      if (rng() < 0.7) { inkblot(rng, x, y, r0, col, alpha); return; }
      const n = 2 + (rng() * 5 | 0), a = rng() * TAU;
      let r = r0;
      for (let i = 0; i < n; i++) {
        inkblot(rng, x, y, r, col, alpha);
        const gap = r * (2.5 + rng() * 4);
        x += Math.cos(a + (rng() - 0.5) * 0.5) * gap;
        y += Math.sin(a + (rng() - 0.5) * 0.5) * gap;
        r *= 0.55 + rng() * 0.3;
      }
    }

    // One continuous pour of paint: a "hand" moving with multi-octave
    // (1/f-like) turning and speed, giving self-similar loops at many scales.
    function pour(rng, o) {
      const step = 1.4;
      const n = Math.max(10, Math.floor(o.length / step));
      const turn = [], spd = [];
      for (let k = 0; k < 5; k++) {
        const lam = (o.scale / Math.pow(2, k)) * (0.6 + rng() * 0.8);
        const f = TAU / lam;
        turn.push({ f, a: f * o.curl * 2.2 * Math.pow(0.55, k) * (0.3 + rng() * 0.9), p: rng() * TAU });
      }
      for (let k = 0; k < 3; k++) {
        const lam = (o.scale / Math.pow(2.5, k)) * (0.5 + rng());
        spd.push({ f: TAU / lam, a: 0.85 * Math.pow(0.7, k), p: rng() * TAU });
      }
      const bias = (rng() - 0.5) * TAU / o.scale * 0.9 * (o.arc || o.curl);
      // paint surges: slow swells where the stream briefly runs fat
      const surge = [0, 1].map(k => ({ f: TAU / (o.scale * (0.25 + rng() * 0.5) / (k + 1)), p: rng() * TAU }));
      const col = o.color, fill = rgba(col, o.alpha);
      const hi = rgba(col.map(v => Math.min(255, v + 70)), 0.22);
      const paintLoss = 0.55 + rng() * 0.4;

      let x = o.x, y = o.y, h = o.heading;
      let path = new Path2D(), pathW = -1, segs = 0;
      path.moveTo(x, y);

      const flush = () => {
        if (segs > 0 && pathW > 0) {
          ctx.lineWidth = pathW;
          ctx.strokeStyle = fill;
          ctx.stroke(path);
          if (pathW >= 3.2) { // enamel sheen
            ctx.save();
            ctx.translate(-pathW * 0.14, -pathW * 0.14);
            ctx.lineWidth = pathW * 0.28;
            ctx.strokeStyle = hi;
            ctx.stroke(path);
            ctx.restore();
          }
        }
        path = new Path2D(); path.moveTo(x, y); segs = 0;
      };

      for (let i = 0; i < n; i++) {
        const s = i * step;
        let w = bias;
        for (const t of turn) w += t.a * Math.sin(t.f * s + t.p);
        let lv = 0;
        for (const t of spd) lv += t.a * Math.sin(t.f * s + t.p);
        let v = Math.exp(lv) * o.speed / (1 + Math.abs(w) * o.scale * 0.01);
        v = Math.max(0.22, Math.min(2.8, v));

        h += w * step;
        if (o.kink && rng() < o.kink * step * 0.004) h += (rng() < 0.5 ? -1 : 1) * (0.8 + rng() * 1.6); // flick: sharp corner
        const nx = x + Math.cos(h) * step, ny = y + Math.sin(h) * step;

        const paint = Math.max(0.08, 1 - Math.pow(s / o.length, 1.4) * paintLoss);
        const sw = Math.max(0, (Math.sin(surge[0].f * s + surge[0].p) + Math.sin(surge[1].f * s + surge[1].p)) / 2);
        let width = o.width * paint * (0.6 + 0.4 / v) * (1 + o.surge * sw * sw * 1.6) * (0.9 + rng() * 0.2);
        width = Math.min(width, MAX_W);

        if (width < 0.7) {
          // paint runs thin: line breaks up into beads
          flush();
          if (rng() < width / 0.9 * 0.5) {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(nx, ny, 0.35 + width * 0.6, 0, TAU);
            ctx.fill();
          }
          x = nx; y = ny; path.moveTo(x, y);
        } else {
          const qw = width < 4 ? Math.round(width * 4) / 4 : Math.round(width * 1.5) / 1.5;
          if (qw !== pathW) { flush(); pathW = qw; }
          path.lineTo(nx, ny); segs++;
          x = nx; y = ny;
        }

        // pooling where the hand lingers
        if (v < 0.35 && rng() < 0.012 * o.pool) {
          flush();
          const pr = Math.min(width * (0.6 + rng() * 0.5), 12);
          wobblyPath(rng, x, y, pr, 0.25, 1.5 + rng(), h); // puddle stretched along the stroke
          ctx.fillStyle = fill;
          ctx.fill();
        }

        // splatter flung from fast moves
        if (rng() < o.splat * v * v * step * 0.012) {
          const dir = h + (rng() - 0.5) * (rng() < 0.3 ? Math.PI : 1.1);
          const dist = width + powerLaw(rng, 2, 90, 1.3);
          const r = powerLaw(rng, 0.3, Math.max(1, o.width * 1.3), 1.7);
          const sx = x + Math.cos(dir) * dist, sy = y + Math.sin(dir) * dist;
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.ellipse(sx, sy, r * (1 + rng() * 1.2 * v), r, dir, 0, TAU);
          ctx.fill();
          // satellite droplets
          const sat = rng() < 0.4 ? 1 + (rng() * 4 | 0) : 0;
          for (let k = 0; k < sat; k++) {
            const d2 = dist + r * (2 + rng() * 6);
            ctx.beginPath();
            ctx.arc(x + Math.cos(dir) * d2, y + Math.sin(dir) * d2, r * (0.15 + rng() * 0.35), 0, TAU);
            ctx.fill();
          }
        }
      }
      flush();
    }

    function buildJobs(rng, opts = {}) {
      const pi = Math.floor(rng() * PALETTES.length);
      const pal = PALETTES[opts.palette ?? pi];
      const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
      // per-painting variation of the palette: an overall tint, sometimes a
      // colour left out, and random dominance of each colour
      const tint = [0, 0, 0].map(() => (rng() - 0.5) * 18);
      const tinted = h => hexToRgb(h).map((v, i) => Math.max(0, Math.min(255, v + tint[i])));
      const bgc = tinted(pal.bg);
      const cols = pal.colors.map(tinted);
      const dark = cols[0], light = cols[1], others = shuffle(cols.slice(2), rng);
      if (others.length > 3 && rng() < 0.5) others.pop();
      const dom = new Map(cols.map(c => [c, Math.exp(gauss() * 0.6)]));
      const D = Math.hypot(W, H);
      const areaK = Math.sqrt((W * H) / (1440 * 900));

      // Dense underpainting: Pollock built the web up in many passes before the
      // final layers, so very little raw canvas shows through.
      const layers = [];
      for (let p = 0; p < UNDER_PASSES; p++) {
        for (const c of shuffle([dark, light, ...others], rng)) {
          layers.push({ c, weight: UNDER_WEIGHT * dom.get(c) * (0.6 + rng() * 0.8), wb: UNDER_WB * (0.7 + rng() * 0.6) });
        }
      }
      layers.push({ c: dark, weight: 1.0, wb: 3.2 });
      others.forEach((c, i) => layers.push({ c, weight: (0.45 + rng() * 0.6) * dom.get(c), wb: 2 + rng() * 1.6 }));
      layers.splice(2 + (rng() * 2 | 0), 0, { c: light, weight: 0.4, wb: 2.2 });
      layers.push({ c: light, weight: 0.75, wb: 2.4 });
      layers.push({ c: dark, weight: 0.4, wb: 2.4 });
      if (rng() < 0.6) layers.push({ c: others[0], weight: 0.25, wb: 2.2 });
      // how blotty this painting is; dark paint gets the most blots
      const blotty = 0.4 + rng() * 1.3;
      // how bold this painting is: spread of line widths and share of heavy ropes
      const bold = rng();
      for (const L of layers) L.blots = (L.c === dark ? 22 : 10) * L.weight * blotty;

      // fractal distribution of stroke sizes: N(s) ~ s^-1.7
      const scales = [0.5, 0.25, 0.12, 0.06];
      const jobs = [() => paintGround(rng, bgc)];

      for (const L of layers) {
        const strokes = [];
        for (const sf of scales) {
          const count = Math.round(DENSITY * Math.pow(sf / 0.5, -1.7) * L.weight * areaK * (0.7 + rng() * 0.6));
          for (let i = 0; i < count; i++) strokes.push(sf);
        }
        const blots = Math.round(L.blots * areaK * (0.5 + rng()));
        for (let i = 0; i < blots; i++) strokes.push(0);
        shuffle(strokes, rng);
        for (const sf of strokes) {
          if (sf === 0) { jobs.push(() => throwBlots(rng, L, D * 0.03)); continue; }
          jobs.push(() => {
            const kind = rng();
            const scale = D * sf * (0.7 + rng() * 0.6);
            const o = {
              x: -0.1 * W + rng() * 1.2 * W,
              y: -0.1 * H + rng() * 1.2 * H,
              heading: rng() * TAU,
              scale,
              length: scale * (1.4 + rng() * 2.2),
              color: jitter(L.c, rng, 0.12),
              alpha: 0.86 + rng() * 0.14,
              // log-normal: mostly modest lines, occasionally very bold ones
              width: L.wb * (0.35 + sf * 2.2) * 0.6 * Math.exp(gauss() * (0.45 + bold * 0.3)),
              curl: 0.3 + rng() * 0.6,
              speed: 0.7 + rng() * 0.6,
              splat: 0.8 + rng() * 1.4,
              pool: 1,
              surge: 0.2 + rng() * 0.6,
            };
            const rope = 0.05 + bold * 0.1;
            if (kind < 0.22) {               // fine tangled skein
              o.width *= 0.4; o.curl *= 1.4; o.length *= 1.4; o.splat *= 0.4;
            } else if (kind < 0.31) {        // fast flung line
              o.curl *= 0.15; o.speed *= 2; o.splat *= 3; o.width *= 0.7; o.pool = 0;
            } else if (kind < 0.39) {        // hairline: long, fast, barely there
              o.width = 0.6 + rng() * 0.8; o.length *= 1.8; o.speed *= 1.5; o.surge = 0; o.splat *= 0.3;
            } else if (kind < 0.47) {        // whipped line with sharp corners
              o.kink = 2 + rng() * 4; o.curl *= 0.5; o.speed *= 1.3;
            } else if (kind < 0.53) {        // long sweeping arc
              o.curl *= 0.2; o.arc = 0.6 + rng() * 0.8; o.length *= 1.3; o.width *= 1.4;
            } else if (kind < 0.53 + rope) { // heavy rope: bold, slow, swelling, pooling
              o.width *= 1.8 + rng() * 1.2; o.speed *= 0.6; o.curl *= 0.6; o.surge = 0.8 + rng() * 0.8;
              o.pool = 3; o.length *= 0.7; o.splat *= 0.5;
            }
            o.width = Math.min(MAX_W, o.width);
            pour(rng, o);
          });
        }
      }
      // a final splash of droplets and grain to sit the paint into the canvas
      jobs.push(() => {
        for (let i = 0; i < 260 * areaK; i++) {
          const c = rng() < 0.5 ? dark : cols[(rng() * cols.length) | 0];
          ctx.fillStyle = rgba(c, 0.9);
          ctx.beginPath();
          ctx.arc(rng() * W, rng() * H, powerLaw(rng, 0.4, 7, 1.6), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 0.035;
        ctx.fillStyle = grainPattern(rng, false);
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      });
      return { jobs, bg: rgba(bgc, 1), name: pal.name };
    }

    return { buildJobs, pour, inkblot, wobblyPath, grainPattern };
  }

  return { TAU, PALETTES, mulberry32, hexToRgb, rgba, jitter, shuffle, powerLaw, engine };
})();
