// Roman Town — a view of the model (roman-town.js) straight down from above,
// in the sun of a clear afternoon.
//
// It knows nothing of how the town was made, only what the model says is
// there, and draws it as a relief map does, but as it would be seen: every
// pixel given a height, which way it faces and what colour it is (a 2.5D
// buffer, the ground and then everything on it, the highest seen), then
// lit: the sun on whatever faces it, the sky's light, less in the hollows
// and narrow streets, and shadows found by walking from each pixel towards
// the sun until something stands in the way or nothing could.
const RomanTownView = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = x => x - Math.floor(x);
  const RELIEF = 2;

  // value noise, hashed, smooth, about 0…1
  function hash(i, j, s) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2147483647) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
    return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
  }
  const fnoise = (x, y, s) => 0.5 * vnoise(x, y, s) + 0.3 * vnoise(x * 2.03, y * 2.03, s + 1) + 0.2 * vnoise(x * 4.1, y * 4.1, s + 2);

  // colours, as sRGB 0…255
  const C = {
    grass: [118, 124, 68], dry: [160, 146, 96], scrub: [104, 100, 70], rock: [150, 140, 120],
    street: [148, 138, 122], main: [112, 108, 102], paving: [208, 200, 182], yard: [156, 134, 104],
    garden: [92, 112, 58], sand: [214, 194, 152], floor: [196, 180, 156], pool: [72, 140, 148],
    via: [116, 110, 102], track: [168, 146, 112], river: [52, 82, 80],
    wheat: [212, 186, 110], stubble: [196, 176, 128], fallow: [128, 98, 72], meadow: [122, 142, 66],
    vines: [128, 108, 80], olives: [150, 136, 100], orchard: [112, 124, 70],
    tile: [176, 92, 60], stone: [182, 172, 152], marble: [228, 224, 214], timber: [130, 96, 64], turf: [104, 122, 62],
    trees: {
      cypress: [44, 62, 38], pine: [62, 84, 46], oak: [58, 76, 42], olive: [116, 126, 92],
      poplar: [92, 118, 56], fruit: [82, 112, 50], shrub: [70, 96, 48], plane: [86, 112, 56],
    },
  };
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }

  // draws the town on a canvas, its world fitted to it; returns nothing
  function render(town, canvas, { sunAzimuth = -2.3, sunElevation = 0.7, seed = 1 } = {}) {
    const CW = canvas.width, CH = canvas.height;
    const k = CW * CH * 4 <= 10e6 ? 2 : 1; // drawn finer, then averaged
    const w = CW * k, h = CH * k, N = w * h, s = w / town.W;
    const Z = new Float32Array(N), BOT = new Float32Array(N).fill(-1e9);
    const NX = new Float32Array(N), NY = new Float32Array(N); // the normal's x and y; z follows
    const ALB = new Uint8Array(N * 3), WET = new Uint8Array(N), SOLID = new Uint8Array(N);

    // ---- rasterising, in world coordinates ----
    function fillPoly(pts, fn) {
      const P = pts.map(([x, y]) => [x * s, y * s]);
      let y0 = Infinity, y1 = -Infinity;
      for (const p of P) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const j0 = Math.max(0, Math.ceil(y0 - 0.5)), j1 = Math.min(h - 1, Math.floor(y1 - 0.5));
      for (let j = j0; j <= j1; j++) {
        const yc = j + 0.5;
        let xl = Infinity, xr = -Infinity;
        for (let q = 0; q < P.length; q++) {
          const a = P[q], b = P[(q + 1) % P.length];
          if ((a[1] <= yc) !== (b[1] <= yc)) {
            const x = a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if (x < xl) xl = x;
            if (x > xr) xr = x;
          }
        }
        const i0 = Math.max(0, Math.ceil(xl - 0.5)), i1 = Math.min(w - 1, Math.floor(xr - 0.5));
        for (let i = i0; i <= i1; i++) fn(j * w + i, (i + 0.5) / s, yc / s);
      }
    }
    function fillDisc(cx, cy, r, fn) {
      const i0 = Math.max(0, Math.floor((cx - r) * s)), i1 = Math.min(w - 1, Math.ceil((cx + r) * s));
      const j0 = Math.max(0, Math.floor((cy - r) * s)), j1 = Math.min(h - 1, Math.ceil((cy + r) * s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / s, y = (j + 0.5) / s, dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r) fn(j * w + i, x, y, dx, dy);
      }
    }
    const setAlb = (p, c, f = 1) => {
      ALB[3 * p] = clamp(c[0] * f, 0, 255); ALB[3 * p + 1] = clamp(c[1] * f, 0, 255); ALB[3 * p + 2] = clamp(c[2] * f, 0, 255);
    };
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

    // ---- the ground ----
    const T = town.terrain;
    {
      const TN = new Float32Array(T.nx * T.ny * 2);
      for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
        const zz = (a, b) => T.z[clamp(b, 0, T.ny - 1) * T.nx + clamp(a, 0, T.nx - 1)];
        TN[2 * (j * T.nx + i)] = (zz(i + 1, j) - zz(i - 1, j)) / (2 * T.cell);
        TN[2 * (j * T.nx + i) + 1] = (zz(i, j + 1) - zz(i, j - 1)) / (2 * T.cell);
      }
      let zmin = Infinity, zmax = -Infinity;
      for (const v of T.z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / s, y = (j + 0.5) / s, p = j * w + i;
        const fx = clamp(x / T.cell, 0, T.nx - 1.001), fy = clamp(y / T.cell, 0, T.ny - 1.001);
        const a = Math.floor(fx), b = Math.floor(fy), ax = fx - a, ay = fy - b, q = b * T.nx + a;
        Z[p] = lerp(lerp(T.z[q], T.z[q + 1], ax), lerp(T.z[q + T.nx], T.z[q + T.nx + 1], ax), ay);
        // (its slopes shaded as if twice as steep, as relief maps do, so the hills show)
        const gx = RELIEF * lerp(lerp(TN[2 * q], TN[2 * q + 2], ax), lerp(TN[2 * (q + T.nx)], TN[2 * (q + T.nx) + 2], ax), ay);
        const gy = RELIEF * lerp(lerp(TN[2 * q + 1], TN[2 * q + 3], ax), lerp(TN[2 * (q + T.nx) + 1], TN[2 * (q + T.nx) + 3], ax), ay);
        const n = 1 / Math.sqrt(1 + gx * gx + gy * gy);
        NX[p] = -gx * n; NY[p] = -gy * n;
        // grass, drier up the hills, scrub and rock where it is steep
        const sl = Math.hypot(gx, gy) / RELIEF, up = (Z[p] - zmin) / (zmax - zmin + 1e-6);
        const m = fnoise(x / 40, y / 40, seed), f = fnoise(x / 6, y / 6, seed + 7);
        let c = mix(C.grass, C.dry, clamp(0.25 + 0.6 * up + 0.5 * (m - 0.5), 0, 1));
        c = mix(c, C.scrub, clamp((sl - 0.12) * 5 + (f - 0.5), 0, 1) * 0.8);
        c = mix(c, C.rock, clamp((sl - 0.3) * 4, 0, 0.7));
        setAlb(p, c, 0.88 + 0.24 * f);
      }
    }

    // patches of ground: colour only, on the ground as it lies
    const ta = town.town.angle, tc = Math.cos(ta), tsn = Math.sin(ta);
    const across = (x, y, a) => -x * Math.sin(a) + y * Math.cos(a), alongA = (x, y, a) => x * Math.cos(a) + y * Math.sin(a);
    const pu = (x, y) => x * tc + y * tsn, pv = (x, y) => -x * tsn + y * tc;
    function paint(poly, kind, angle) {
      const base = C[kind] || C.yard, sd = hash(Math.round(poly[0][0] * 7), Math.round(poly[0][1] * 7), seed);
      const tint = 0.9 + 0.2 * sd;
      fillPoly(poly, (p, x, y) => {
        let c = base, f = 1;
        const n = fnoise(x / 3, y / 3, seed + 3);
        switch (kind) {
          case 'street': f = 0.9 + 0.2 * n; break;
          case 'main-street': {
            // stones, polygonal: a cell pattern of about a metre
            const g = vnoise(x * 1.3, y * 1.3, seed + 11);
            f = 0.82 + 0.3 * g * g; break;
          }
          case 'paving': {
            const a = fract(pu(x, y) / 1.8), b = fract(pv(x, y) / 1.2);
            f = (a < 0.05 || b < 0.07 ? 0.86 : 1) * (0.94 + 0.12 * vnoise(Math.floor(pu(x, y) / 1.8), Math.floor(pv(x, y) / 1.2), seed));
            break;
          }
          case 'yard': f = 0.88 + 0.24 * n; break;
          case 'garden': {
            const b = fract(pv(x, y) / 1.6);
            f = (b < 0.35 ? 0.86 : 1.04) * (0.85 + 0.3 * n); break;
          }
          case 'floor': f = 0.95 + 0.1 * n; break;
          case 'sand': f = 0.94 + 0.12 * n; break;
          case 'pool': c = C.pool; f = 0.95 + 0.1 * n; WET[p] = 2; break;
          case 'wheat': {
            const r = fract(across(x, y, angle) / 0.7);
            f = tint * (0.93 + 0.1 * Math.sin(r * TAU)) * (0.9 + 0.2 * fnoise(x / 15, y / 15, seed + 5)); break;
          }
          case 'stubble': f = tint * (0.95 + 0.07 * Math.sin(across(x, y, angle) / 0.5 * TAU)); break;
          case 'fallow': f = tint * (0.86 + 0.18 * (0.5 + 0.5 * Math.sin(across(x, y, angle) / 0.9 * TAU)) + 0.1 * n); break;
          case 'meadow': f = tint * (0.85 + 0.3 * fnoise(x / 8, y / 8, seed + 9)); break;
          case 'vines': {
            const r = fract(across(x, y, angle) / 2.2);
            c = r < 0.38 ? mix(C.trees.fruit, C.vines, 0.25 + 0.3 * vnoise(alongA(x, y, angle) / 0.8, r, seed)) : C.vines;
            f = 0.9 + 0.15 * n; break;
          }
          case 'olives': case 'orchard': f = tint * (0.9 + 0.2 * n); break;
        }
        setAlb(p, c, f);
      });
    }
    for (const fl of town.fields) paint(fl.poly, fl.crop, fl.angle);

    // roads: earth tracks, then paved ways with their kerbs
    function road(pts, width, kind) {
      const half = width / 2, base = C[kind];
      const seg = (a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * half, ny = dx / l * half;
        return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
      };
      for (let q = 0; q + 1 < pts.length; q++) {
        const a = pts[q], b = pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const shade = (p, x, y) => {
          const t = Math.abs(((x - a[0]) * -dy + (y - a[1]) * dx) / l) / half; // 0 in the middle, 1 at the edge
          let f;
          if (kind === 'via') {
            const g = vnoise(x * 1.4, y * 1.4, seed + 11);
            f = t > 0.8 ? 1.25 : (0.84 + 0.3 * g * g);
          } else {
            const rut = Math.abs(t - 0.5) < 0.12 ? 0.86 : 1;
            f = rut * (0.9 + 0.2 * fnoise(x / 2, y / 2, seed + 13)) * (t > 0.85 ? 0.97 : 1);
          }
          setAlb(p, base, f);
        };
        fillPoly(seg(a, b), shade);
        fillDisc(b[0], b[1], half, (p, x, y) => shade(p, x, y));
      }
    }
    for (const r of town.roads) if (r.kind === 'track') road(r.points, r.width, 'track');
    for (const r of town.roads) if (r.kind === 'via') road(r.points, r.width, 'via');

    // the river: water at its level, its banks muddy
    if (town.river) {
      const R = town.river, P = R.points, half = R.width / 2;
      for (let q = 0; q + 1 < P.length; q++) {
        const a = P[q], b = P[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const la = R.level[q], lb = R.level[q + 1];
        const water = (p, x, y) => {
          const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (l * l), 0, 1), d = Math.abs(((x - a[0]) * -dy + (y - a[1]) * dx) / l);
          const lev = lerp(la, lb, t);
          if (d > half - 0.6) { if (WET[p] !== 1) setAlb(p, C.yard, 0.75); return; }
          if (WET[p] === 1 && Z[p] <= lev) return;
          Z[p] = lev; NX[p] = 0; NY[p] = 0; WET[p] = 1;
          setAlb(p, C.river, 0.92 + 0.12 * fnoise(x / 9, y / 9, seed + 17));
        };
        const nx = -dy / l * half, ny = dx / l * half;
        fillPoly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], water);
        fillDisc(b[0], b[1], half, water);
      }
    }
    for (const g of town.grounds) paint(g.poly, g.kind, g.angle);

    // ---- what stands on it ----
    // write a pixel if it is higher than what stands there; the ground gives
    // way to anything built on it, even below it, cut into a slope
    const put = (p, z, gx, gy, c, f) => {
      if (SOLID[p] && z <= Z[p]) return false;
      const n = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      Z[p] = z; NX[p] = -gx * n; NY[p] = -gy * n; BOT[p] = -1e9; WET[p] = 0; SOLID[p] = 1;
      setAlb(p, c, f);
      return true;
    };
    function tint(b, base) {
      const r = hash(Math.round(b.x * 10), Math.round(b.y * 10), seed + 21);
      if (b.mat !== 'tile') return [base, 0.94 + 0.1 * r];
      // tiles: some newer and redder, some old and brown
      return [mix(base, [150, 104, 78], r * 0.6), 0.88 + 0.22 * hash(Math.round(b.x * 3), Math.round(b.y * 3), seed + 22)];
    }
    function drawBox(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), hw = b.w / 2, hd = b.d / 2;
      const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, c]) => [b.x + a * ca - c * sa, b.y + a * sa + c * ca]);
      const [base, f0] = tint(b, C[b.mat] || C.stone), top = b.z0 + b.h, pitch = b.pitch, W2 = b.w, D2 = b.d;
      const hole = b.hole;
      fillPoly(pts, (p, x, y) => {
        const dx = x - b.x, dy = y - b.y;
        const a = dx * ca + dy * sa + hw, c = -dx * sa + dy * ca + hd;
        let e = 0, ga = 0, gc = 0, along = a, down = 0;
        switch (b.roof) {
          case 'hip': {
            const m = Math.min(a, W2 - a, c, D2 - c);
            e = m;
            if (m === a) { ga = 1; along = c; } else if (m === W2 - a) { ga = -1; along = c; } else if (m === c) gc = 1; else gc = -1;
            break;
          }
          case 'gable':
            if (b.axis === 'w') { e = Math.min(c, D2 - c); gc = c < D2 - c ? 1 : -1; }
            else { e = Math.min(a, W2 - a); ga = a < W2 - a ? 1 : -1; along = c; }
            break;
          case 'shed':
            if (b.low === '+w') { e = W2 - a; ga = -1; along = c; } else if (b.low === '-w') { e = a; ga = 1; along = c; }
            else if (b.low === '+d') { e = D2 - c; gc = -1; } else { e = c; gc = 1; }
            break;
          case 'court': {
            if (a > hole[0] && a < hole[2] && c > hole[1] && c < hole[3]) return;
            const da = a < hole[0] ? hole[0] - a : a > hole[2] ? a - hole[2] : 0;
            const dc = c < hole[1] ? hole[1] - c : c > hole[3] ? c - hole[3] : 0;
            if (da >= dc) { e = da; ga = a < hole[0] ? -1 : 1; along = c; } else { e = dc; gc = c < hole[1] ? -1 : 1; }
            break;
          }
        }
        down = e;
        const z = top + pitch * e;
        const gx = pitch * (ga * ca - gc * sa), gy = pitch * (ga * sa + gc * ca);
        let f = f0;
        if (b.mat === 'tile' && pitch > 0) {
          // the rows of cover tiles running down the slope, the courses across
          const r = fract(along / 0.55);
          f *= (r < 0.3 ? 1.1 : 0.94) * (fract(down / 0.42) < 0.1 ? 0.93 : 1) * (0.9 + 0.2 * fnoise(x / 2.5, y / 2.5, seed + 23));
        } else if (b.use === 'wall' || b.use === 'gate') {
          f *= 0.9 + 0.2 * vnoise(x * 1.5, y * 1.5, seed + 29);
          // the parapet along both faces of the wall walk
          if (b.use === 'wall' && (c < 0.5 || c > D2 - 0.5)) { put(p, z + 1.2, 0, 0, base, f * 1.08); return; }
        } else if (b.mat === 'stone' || b.mat === 'marble') {
          f *= 0.92 + 0.12 * vnoise(x * 2, y * 2, seed + 31);
          if (b.use === 'steps') f *= fract(a / 0.4) < 0.25 ? 0.85 : 1.03;
        } else if (b.mat === 'timber') f *= fract(a / 0.3) < 0.15 ? 0.8 : 1;
        put(p, z, gx, gy, base, f);
      });
    }
    function drawRound(b) {
      const [base, f0] = tint(b, C[b.mat] || C.stone);
      fillDisc(b.x, b.y, b.r, (p, x, y, dx, dy) => {
        const d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d;
        let z = b.z0 + b.h, g = 0;
        if (b.roof === 'cone') { z += b.pitch * (b.r - d); g = -b.pitch; }
        else if (b.roof === 'dome') {
          const q = Math.min(d / b.r, 0.985), c = b.r * b.pitch;
          z += c * Math.sqrt(1 - q * q); g = -c * q / (b.r * Math.sqrt(1 - q * q));
        }
        let f = f0;
        if (b.mat === 'tile' && b.roof === 'cone') f *= fract(Math.atan2(dy, dx) * b.r / 0.55 / TAU * TAU) < 0.3 ? 1.08 : 0.95;
        if (b.mat === 'turf') f *= 0.85 + 0.3 * fnoise(x / 1.5, y / 1.5, seed + 37);
        put(p, z, g * ux, g * uy, base, f);
      });
    }
    // a theatre's seats: steps rising in half rings, aisles between wedges of them
    function drawCavea(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), steps = Math.round((b.r1 - b.r0) / 0.8), rise = b.h / steps;
      fillDisc(b.x, b.y, b.r1 + 2.5, (p, x, y, dx, dy) => {
        const fx = dx * ca + dy * sa, fy = -dx * sa + dy * ca, d = Math.hypot(dx, dy);
        if (fx < -0.2) return;
        let z = b.z0, c = C.paving, f = 1;
        if (d < b.r0) { z += 0.05; f = 0.95 + 0.08 * vnoise(x * 2, y * 2, seed); }
        else if (d <= b.r1) {
          const n = Math.floor((d - b.r0) / 0.8), r = fract((d - b.r0) / 0.8);
          z += 1 + n * rise; c = C.stone;
          const phi = Math.atan2(fy, fx), wedge = fract((phi + Math.PI / 2) / (Math.PI / (n < steps / 2 ? 6 : 12)));
          f = (r > 0.85 ? 0.88 : 1) * (wedge < 0.04 || wedge > 0.96 ? 1.12 : 1) * (Math.abs(n - (steps >> 1)) < 1 ? 1.1 : 1);
          f *= 0.94 + 0.1 * vnoise(x * 2, y * 2, seed + 41);
        } else { z += 1 + b.h + 3; c = C.stone; f = 0.95; }
        put(p, z, 0, 0, c, f);
      });
    }
    // an amphitheatre: the arena of sand, the seats rising round it, the gates through
    function drawArena(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), ro = 1 + 3 / b.a, r0 = b.a0 / b.a, steps = Math.round((b.a - b.a0) / 0.8);
      const R = Math.max(b.a, b.b) * ro;
      fillDisc(b.x, b.y, R, (p, x, y, dx, dy) => {
        const fx = dx * ca + dy * sa, fy = -dx * sa + dy * ca;
        const rho = Math.hypot(fx / b.a, fy / b.b);
        if (rho > ro) return;
        let z = b.z0, c = C.sand, f = 0.95 + 0.1 * fnoise(x / 2, y / 2, seed);
        const gate = (Math.abs(fy) < 2.2 || Math.abs(fx) < 2.2) && rho > r0;
        const ra = Math.hypot(fx / b.a0, fy / b.b0);
        if (ra > 1 && !gate) {
          if (rho <= 1) {
            const t = (rho - r0) / (1 - r0), n = Math.floor(t * steps);
            z += 3.5 + n * b.h / steps; c = C.stone;
            f = (fract(t * steps) > 0.85 ? 0.88 : 1) * (0.94 + 0.1 * vnoise(x * 2, y * 2, seed + 43));
          } else { z += 3.5 + b.h + 3; c = C.stone; f = 0.95; }
        } else if (gate) { c = C.yard; f = 0.7; }
        put(p, z, 0, 0, c, f);
      });
    }
    // a tree: a crown of leaves, round or narrow or a spread umbrella, lumpy
    function drawTree(t, k2) {
      const shape = {
        cypress: [1, 0], poplar: [0.95, 0], pine: [2.4 / t.h, 1.2], oak: [0.6, 0], olive: [0.6, 0],
        fruit: [0.55, 0], shrub: [1, 0], plane: [0.55, 0.8],
      }[t.kind] || [0.6, 0];
      const cdep = shape[0] * t.h, zb = t.z0 + t.h - cdep, hang = shape[1];
      const base = C.trees[t.kind] || C.trees.oak, sd = k2 * 7.31;
      const tone = 0.88 + 0.24 * hash(k2, 3, seed);
      const lump = t.kind === 'cypress' || t.kind === 'poplar' ? 0.6 : 1.1;
      fillDisc(t.x, t.y, t.r * 1.1, (p, x, y, dx, dy) => {
        const d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        const rr = t.r * (0.86 + 0.24 * vnoise(ang * 2.2 + sd, sd, seed + 47));
        if (d >= rr) return;
        const q = Math.min(d / rr, 0.97), sq = Math.sqrt(1 - q * q);
        const nn = vnoise(x / lump, y / lump, seed + 53) - 0.5, z = zb + cdep * sq + nn * 0.6 * Math.min(1, cdep / 3);
        if (SOLID[p] && z <= Z[p]) return;
        const g = -cdep * q / (rr * sq), ux = dx / (d || 1), uy = dy / (d || 1);
        const n1 = vnoise(x / lump + 9.1, y / lump, seed + 59) - 0.5, n2 = vnoise(x / lump, y / lump + 4.7, seed + 61) - 0.5;
        if (put(p, z, g * ux + 1.6 * n1, g * uy + 1.6 * n2, base, tone * (0.8 + 0.4 * (nn + 0.5)))) {
          if (hang) BOT[p] = zb - hang;
        }
      });
    }

    for (const b of town.buildings) {
      if (b.shape === 'box') drawBox(b);
      else if (b.shape === 'round') drawRound(b);
      else if (b.shape === 'cavea') drawCavea(b);
      else if (b.shape === 'arena') drawArena(b);
    }
    town.trees.forEach((t, i) => drawTree(t, i));

    // ---- light ----
    const L = [Math.cos(sunElevation) * Math.cos(sunAzimuth), Math.cos(sunElevation) * Math.sin(sunAzimuth), Math.sin(sunElevation)];
    const occl = shadows(Z, BOT, WET, w, h, s, L);
    const ao = ambientOcclusion(Z, w, h, s);
    const sun = [1.0 * 2.6, 0.93 * 2.6, 0.8 * 2.6], sky = [0.66 * 1.05, 0.74 * 1.05, 0.88 * 1.05];
    const out = new Float32Array(N * 3);
    for (let p = 0; p < N; p++) {
      const nx = NX[p], ny = NY[p], nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * (1 - occl[p]);
      const amb = (WET[p] === 1 ? Math.max(ao[p], 0.85) : ao[p]) * (0.55 + 0.45 * nz);
      for (let q = 0; q < 3; q++) {
        let v = LIN[ALB[3 * p + q]] * (sky[q] * amb + sun[q] * ndl);
        if (WET[p] === 1) v += 0.05 * sky[q] * ao[p]; // the sky in the water
        out[3 * p + q] = v;
      }
    }
    // averaged down to the canvas, a filmic curve, back to sRGB
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(CW, CH), D = img.data;
    const tone = v => { const x = Math.max(0, v * 0.9); const y = x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14); return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(Math.min(1, y), 1 / 2.4) - 0.055; };
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      const o = 4 * (j * CW + i);
      for (let q = 0; q < 3; q++) {
        let v = 0;
        for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) v += out[3 * ((j * k + b) * w + i * k + a) + q];
        D[o + q] = 255 * tone(v / (k * k));
      }
      D[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // How much of the sun each pixel is shaded from: a walk towards the sun,
  // rising as the light does, until it is higher than anything about. The
  // shade softens as the thing casting it is further away.
  function shadows(Z, BOT, WET, w, h, s, L) {
    const TS = 16, tw = Math.ceil(w / TS), th = Math.ceil(h / TS);
    const TM = new Float32Array(tw * th).fill(-1e9), TD = new Float32Array(tw * th);
    let zmax = -1e9;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const z = Z[j * w + i], t = ((j / TS) | 0) * tw + ((i / TS) | 0);
      if (z > TM[t]) TM[t] = z;
      if (z > zmax) zmax = z;
    }
    // each tile's highest, and its neighbours': a step of a tile from inside it
    // lands among them
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      let m = -1e9;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < tw && jj < th && TM[jj * tw + ii] > m) m = TM[jj * tw + ii];
      }
      TD[j * tw + i] = m;
    }
    const hl = Math.hypot(L[0], L[1]), dx = L[0] / hl, dy = L[1] / hl, dz = L[2] / hl / s; // per pixel stepped
    const occ = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p = j * w + i;
      let x = i + 0.5, y = j + 0.5, zr = Z[p] + 0.03, o = 0, dist = 0;
      for (;;) {
        const ti = (x / TS) | 0, tj = (y / TS) | 0;
        if (zr > TD[tj * tw + ti]) {
          if (zr > zmax) break;
          x += dx * TS; y += dy * TS; zr += dz * TS; dist += TS;
        } else { x += dx; y += dy; zr += dz; dist++; }
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        const q = (y | 0) * w + (x | 0), zq = Z[q];
        if (zq > zr && BOT[q] < zr && WET[q] !== 1) { // (water, flat, shades nothing)
          const v = (zq - zr) / (0.12 + 0.025 * dist / s);
          if (v >= 1) { o = 1; break; }
          if (v > o) o = v;
        }
      }
      occ[p] = o;
    }
    return occ;
  }

  // Less of the sky in the hollows: how far each pixel lies below the
  // heights about it, near and further.
  function ambientOcclusion(Z, w, h, s) {
    const blur = (src, r) => {
      const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
      for (let j = 0; j < h; j++) {
        let acc = 0;
        const row = j * w;
        for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, w - 1)];
        for (let i = 0; i < w; i++) {
          tmp[row + i] = acc / (2 * r + 1);
          acc += src[row + Math.min(i + r + 1, w - 1)] - src[row + Math.max(i - r, 0)];
        }
      }
      for (let i = 0; i < w; i++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) acc += tmp[clamp(j, 0, h - 1) * w + i];
        for (let j = 0; j < h; j++) {
          dst[j * w + i] = acc / (2 * r + 1);
          acc += tmp[Math.min(j + r + 1, h - 1) * w + i] - tmp[Math.max(j - r, 0) * w + i];
        }
      }
      return dst;
    };
    const near = blur(blur(Z, Math.max(1, Math.round(0.8 * s))), Math.max(1, Math.round(0.8 * s)));
    const far = blur(blur(Z, Math.max(2, Math.round(3.5 * s))), Math.max(2, Math.round(3.5 * s)));
    const ao = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      ao[p] = 1 - clamp((near[p] - Z[p]) * 0.22, 0, 0.4) - clamp((far[p] - Z[p]) * 0.06, 0, 0.25);
    }
    return ao;
  }

  return { render };
})();
