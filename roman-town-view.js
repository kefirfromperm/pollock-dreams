// Roman Town — a view of the model (roman-town.js) straight down from above,
// in the sun of a clear afternoon.
//
// It knows nothing of how the town was made, only what the model says is
// there, and draws it as a relief map does, but as it would be seen: every
// pixel given a height, which way it faces and what colour it is (a 2.5D
// buffer, the ground and then everything on it, the highest seen), then
// lit: the sun or the moon on whatever faces it, the sky's light, less in the hollows
// and narrow streets, and shadows found by walking from each pixel towards
// the sun until something stands in the way or nothing could.
//
// It is drawn a piece at a time, any rectangle of the world at any scale,
// so it can be looked over closely, as map tiles are:
//   scene(town, { seed })   what holds for every piece, whatever the hour:
//     the whole world drawn coarsely once, 2 px a metre, for what lies beyond
//     a piece: the shadows cast into it and the sky hidden from it
//   tile(scene, { x0, y0, s, w, h }, sky)   the w × h pixels from (x0, y0) at s px a
//     metre, as RGBA bytes, lit as the sky is: { sun: { az, el }, moon: { az, el, lit } },
//     azimuths from north (up) clockwise, elevations, radians; lit, the moon's lit part
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
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
    return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
  }
  // (each octave turned, so the lattice does not show)
  const fnoise = (x, y, s) => 0.5 * vnoise(x, y, s) + 0.3 * vnoise(1.62 * x - 1.18 * y, 1.18 * x + 1.62 * y, s + 1)
    + 0.2 * vnoise(-1.4 * x + 3.85 * y, -3.85 * x - 1.4 * y, s + 2);
  // cells about random points a unit apart: the nearest's distance, the
  // next's, and the nearest's own number (stones of a pavement)
  function cells(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, h = hash(cx, cy, s);
      const dx = x - cx - 0.15 - 0.7 * h, dy = y - cy - 0.15 - 0.7 * hash(cx, cy, s + 1), d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = h; } else if (d < f2) f2 = d;
    }
    return [Math.sqrt(f1), Math.sqrt(f2), id];
  }
  // basalt stones, polygonal, of about a size, their joints dark
  const stones = (x, y, size, s) => {
    const [a, b, id] = cells(x / size, y / size, s);
    return (b - a < 0.09 ? 0.62 : 1) * (0.84 + 0.3 * id);
  };

  // colours, as sRGB 0…255
  const C = {
    grass: [118, 124, 68], dry: [160, 146, 96], scrub: [104, 100, 70], rock: [150, 140, 120],
    street: [148, 138, 122], main: [112, 108, 102], paving: [208, 200, 182], yard: [156, 134, 104],
    garden: [92, 112, 58], pasture: [112, 126, 60], hay: [168, 160, 92], well: [22, 34, 36], sand: [214, 194, 152], floor: [196, 180, 156], pool: [72, 140, 148],
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

  // the 2.5D buffer of a rectangle of the world: w × h pixels from (x0, y0),
  // s a metre; its colours only if asked
  function raster(sc, { x0, y0, s, w, h }, colour) {
    const { town, seed } = sc, N = w * h, X1 = x0 + w / s, Y1 = y0 + h / s;
    const vis = bb => bb[2] >= x0 - 1 && bb[0] <= X1 + 1 && bb[3] >= y0 - 1 && bb[1] <= Y1 + 1;
    const Z = new Float32Array(N), BOT = new Float32Array(N).fill(-1e9);
    const NX = new Float32Array(N), NY = new Float32Array(N); // the normal's x and y; z follows
    const ALB = new Uint8Array(colour ? N * 3 : 0), WET = new Uint8Array(N), SOLID = new Uint8Array(N);

    // ---- rasterising, in world coordinates ----
    function fillPoly(pts, fn) {
      const P = pts.map(([x, y]) => [(x - x0) * s, (y - y0) * s]);
      let ya = Infinity, yb = -Infinity;
      for (const p of P) { if (p[1] < ya) ya = p[1]; if (p[1] > yb) yb = p[1]; }
      const j0 = Math.max(0, Math.ceil(ya - 0.5)), j1 = Math.min(h - 1, Math.floor(yb - 0.5));
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
        const i0 = Math.max(0, Math.ceil(xl - 0.5 - 1e-7)), i1 = Math.min(w - 1, Math.floor(xr - 0.5 + 1e-7));
        for (let i = i0; i <= i1; i++) fn(j * w + i, (i + 0.5) / s + x0, yc / s + y0);
      }
    }
    function fillDisc(cx, cy, r, fn) {
      const i0 = Math.max(0, Math.floor((cx - r - x0) * s)), i1 = Math.min(w - 1, Math.ceil((cx + r - x0) * s));
      const j0 = Math.max(0, Math.floor((cy - r - y0) * s)), j1 = Math.min(h - 1, Math.ceil((cy + r - y0) * s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / s + x0, y = (j + 0.5) / s + y0, dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r) fn(j * w + i, x, y, dx, dy);
      }
    }
    const setAlb = !colour ? () => {} : (p, c, f = 1) => {
      ALB[3 * p] = clamp(c[0] * f, 0, 255); ALB[3 * p + 1] = clamp(c[1] * f, 0, 255); ALB[3 * p + 2] = clamp(c[2] * f, 0, 255);
    };
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

    // ---- the ground ----
    const T = town.terrain;
    {
      const { TN, zmin, zmax } = sc;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / s + x0, y = (j + 0.5) / s + y0, p = j * w + i;
        const fx = clamp(x / T.cell, 0, T.nx - 1.001), fy = clamp(y / T.cell, 0, T.ny - 1.001);
        const a = Math.floor(fx), b = Math.floor(fy), ax = fx - a, ay = fy - b, q = b * T.nx + a;
        Z[p] = lerp(lerp(T.z[q], T.z[q + 1], ax), lerp(T.z[q + T.nx], T.z[q + T.nx + 1], ax), ay);
        // (its slopes shaded as if twice as steep, as relief maps do, so the hills show)
        const gx = RELIEF * lerp(lerp(TN[2 * q], TN[2 * q + 2], ax), lerp(TN[2 * (q + T.nx)], TN[2 * (q + T.nx) + 2], ax), ay);
        const gy = RELIEF * lerp(lerp(TN[2 * q + 1], TN[2 * q + 3], ax), lerp(TN[2 * (q + T.nx) + 1], TN[2 * (q + T.nx) + 3], ax), ay);
        const n = 1 / Math.sqrt(1 + gx * gx + gy * gy);
        NX[p] = -gx * n; NY[p] = -gy * n;
        if (!colour) continue;
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
          case 'street': c = C.main; f = 1.08 * stones(x, y, 0.75, seed + 11) * (0.92 + 0.16 * n); break;
          case 'main-street': f = stones(x, y, 0.85, seed + 11) * (0.92 + 0.16 * n); break;
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
          case 'pasture': f = tint * (0.78 + 0.3 * fnoise(x / 1.3, y / 1.3, seed + 19)) * (0.9 + 0.2 * fnoise(x / 14, y / 14, seed + 23)); break;
          case 'hay': {
            // cut, and raked into windrows
            const r = fract(across(x, y, angle) / 4.5);
            c = r < 0.22 ? [196, 176, 104] : [150, 152, 84];
            f = tint * (0.88 + 0.22 * fnoise(x / 1.2, y / 1.2, seed + 29)); break;
          }
          case 'well': WET[p] = 2; break;
        }
        setAlb(p, c, f);
      });
    }
    if (colour) town.fields.forEach((fl, i) => { if (vis(sc.bb.fields[i])) paint(fl.poly, fl.crop, fl.angle); });

    // roads: earth tracks, then paved ways with their kerbs
    function road(pts, width, kind) {
      const half = width / 2, base = C[kind];
      const seg = (a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * half, ny = dx / l * half;
        return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
      };
      for (let q = 0; q + 1 < pts.length; q++) {
        const a = pts[q], b = pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        if (!vis([Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half])) continue;
        const shade = (p, x, y) => {
          const t = Math.abs(((x - a[0]) * -dy + (y - a[1]) * dx) / l) / half; // 0 in the middle, 1 at the edge
          let f;
          if (kind === 'via') {
            f = t > 0.8 ? 1.25 : stones(x, y, 0.8, seed + 11);
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
    if (colour) for (const kind of ['track', 'via']) town.roads.forEach((r, i) => { if (r.kind === kind && vis(sc.bb.roads[i])) road(r.points, r.width, kind); });

    // the river: water at its level, its banks muddy
    if (town.river) {
      const R = town.river, P = R.points, half = R.width / 2;
      for (let q = 0; q + 1 < P.length; q++) {
        const a = P[q], b = P[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const la = R.level[q], lb = R.level[q + 1];
        if (!vis([Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half])) continue;
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
    town.grounds.forEach((g, i) => { if ((colour || g.kind === 'pool') && vis(sc.bb.grounds[i])) paint(g.poly, g.kind, g.angle); });

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
        if (b.hole && d < b.hole) return;
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
        const rx = (0.8 * x - 0.6 * y) / lump, ry = (0.6 * x + 0.8 * y) / lump;
        const nn = vnoise(rx, ry, seed + 53) - 0.5, z = zb + cdep * sq + nn * 0.6 * Math.min(1, cdep / 3);
        if (SOLID[p] && z <= Z[p]) return;
        const g = -cdep * q / (rr * sq), ux = dx / (d || 1), uy = dy / (d || 1);
        const n1 = vnoise(rx + 9.1, ry, seed + 59) - 0.5, n2 = vnoise(rx, ry + 4.7, seed + 61) - 0.5;
        if (put(p, z, g * ux + 1.6 * n1, g * uy + 1.6 * n2, base, tone * (0.8 + 0.4 * (nn + 0.5)))) {
          if (hang) BOT[p] = zb - hang;
        }
      });
    }

    // a grazing beast: a body and a head, low and rounded
    const BEASTS = {
      sheep: [1.3, 0.75, 0.85, [[230, 224, 208], [226, 220, 204], [70, 62, 56]]],
      goat: [1.2, 0.55, 0.8, [[150, 126, 100], [232, 226, 214], [64, 56, 50]]],
      cow: [2.3, 0.95, 1.4, [[128, 86, 58], [96, 66, 46], [40, 36, 34], [216, 206, 186]]],
      horse: [2.2, 0.7, 1.55, [[112, 74, 48], [70, 50, 38], [176, 160, 140]]],
    };
    function drawBeast(an, k2) {
      const [Ln, Wd, Ht, cols] = BEASTS[an.kind] || BEASTS.sheep;
      const ca = Math.cos(an.angle), sa = Math.sin(an.angle), hl = Ln / 2, hw = Wd / 2;
      const col = cols[Math.floor(hash(k2, 5, seed) ** 2 * cols.length)];
      fillDisc(an.x, an.y, Ln * 0.85, (p, x, y, dx, dy) => {
        const a = dx * ca + dy * sa, c = -dx * sa + dy * ca;
        const q = (a / hl) ** 2 + (c / hw) ** 2, qh = ((a - hl * 1.1) / (Ln * 0.17)) ** 2 + (c / (hw * 0.55)) ** 2;
        if (q < 1) {
          const sq = Math.sqrt(1 - q), dz = Ht * 0.3;
          const ga = -dz * a / (hl * hl * Math.max(sq, 0.15)), gc = -dz * c / (hw * hw * Math.max(sq, 0.15));
          put(p, an.z0 + Ht * 0.7 + dz * sq, ga * ca - gc * sa, ga * sa + gc * ca, col, 1);
        } else if (qh < 1) put(p, an.z0 + Ht * 0.8, 0, 0, col, 0.85);
      });
    }

    for (let i = 0; i < town.buildings.length; i++) {
      const b = town.buildings[i];
      if (!vis(sc.bb.buildings[i])) continue;
      if (b.shape === 'box') drawBox(b);
      else if (b.shape === 'round') drawRound(b);
      else if (b.shape === 'cavea') drawCavea(b);
      else if (b.shape === 'arena') drawArena(b);
    }
    town.trees.forEach((t, i) => { if (vis(sc.bb.trees[i])) drawTree(t, i); });
    if (colour) (town.animals || []).forEach((an, i) => { if (vis(sc.bb.animals[i])) drawBeast(an, i); });
    return { Z, BOT, NX, NY, ALB, WET, w, h };
  }


  // each square of TS pixels' highest, and its neighbours': a step of a
  // square from inside one lands among them
  function tileMax(Z, w, h, TS) {
    const tw = Math.ceil(w / TS), th = Math.ceil(h / TS), TM = new Float32Array(tw * th).fill(-1e9), TD = new Float32Array(tw * th);
    let zmax = -1e9;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const z = Z[j * w + i], t = ((j / TS) | 0) * tw + ((i / TS) | 0);
      if (z > TM[t]) TM[t] = z;
      if (z > zmax) zmax = z;
    }
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      let m = -1e9;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < tw && jj < th && TM[jj * tw + ii] > m) m = TM[jj * tw + ii];
      }
      TD[j * tw + i] = m;
    }
    return { TD, tw, TS, zmax };
  }

  // a box blur of a w × h grid, r cells each way
  function blur(src, w, h, r) {
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
  }

  // The light of a moment: the sun's, reddening as it sets, or after dusk
  // the moon's, as bright as she is full; the sky's about, blue by day,
  // rosy at twilight, dark at night. Night's light is far brighter than it
  // is, as eyes used to the dark see it, and greyer.
  function lightOf(sky) {
    const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const dir = (az, el) => { const e = Math.max(el, 0.07); return [Math.cos(e) * Math.sin(az), -Math.cos(e) * Math.cos(az), Math.sin(e)]; };
    const { sun, moon } = sky, day = sm(-0.12, 0.06, sun.el), high = sm(0, 0.45, sun.el), up = sm(-0.015, 0.04, sun.el);
    const sunC = mixc([1.0, 0.42, 0.16], [1.0, 0.93, 0.8], high).map(v => v * 2.6 * up);
    const dusk = mixc([0.42, 0.36, 0.5], [0.69, 0.78, 0.92], high).map(v => v * (0.3 + 0.7 * sm(-0.12, 0.2, sun.el)));
    const mUp = sm(-0.015, 0.06, moon.el) * moon.lit * (1 - day);
    const moonC = [0.42, 0.56, 0.95].map(v => v * 0.42 * mUp);
    const night = [0.022, 0.03, 0.06].map((v, q) => v + [0.022, 0.03, 0.055][q] * moon.lit * sm(-0.015, 0.06, moon.el));
    const skyC = mixc(night, dusk, day);
    const bySun = sunC[1] >= moonC[1];
    // lamps lit from dusk, the darker the brighter they seem
    return { L: bySun ? dir(sun.az, sun.el) : dir(moon.az, moon.el), col: bySun ? sunC : moonC, sky: skyC, night: 1 - day, lamps: 1 - sm(-0.1, 0.03, sun.el) };
  }

  // what holds wherever the town is looked at
  function scene(town, { seed = 1 } = {}) {
    const T = town.terrain, sc = { town, seed };
    // the ground's slopes at its grid's points
    sc.TN = new Float32Array(T.nx * T.ny * 2);
    for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
      const zz = (a, b) => T.z[clamp(b, 0, T.ny - 1) * T.nx + clamp(a, 0, T.nx - 1)];
      sc.TN[2 * (j * T.nx + i)] = (zz(i + 1, j) - zz(i - 1, j)) / (2 * T.cell);
      sc.TN[2 * (j * T.nx + i) + 1] = (zz(i, j + 1) - zz(i, j - 1)) / (2 * T.cell);
    }
    sc.zmin = Infinity; sc.zmax = -Infinity;
    for (const v of T.z) { if (v < sc.zmin) sc.zmin = v; if (v > sc.zmax) sc.zmax = v; }
    // where each thing lies, to leave out what a piece does not show
    const ofPts = (pts, m = 0) => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
      return [a - m, b - m, c + m, d + m];
    };
    const ofDisc = (x, y, r) => [x - r, y - r, x + r, y + r];
    sc.bb = {
      fields: town.fields.map(f => ofPts(f.poly)),
      grounds: town.grounds.map(g => ofPts(g.poly)),
      roads: town.roads.map(r => ofPts(r.points, r.width)),
      trees: town.trees.map(t => ofDisc(t.x, t.y, t.r * 1.1)),
      animals: (town.animals || []).map(a => ofDisc(a.x, a.y, 2.2)),
      buildings: town.buildings.map(b =>
        b.shape === 'box' ? ofDisc(b.x, b.y, Math.hypot(b.w, b.d) / 2 + 1.5)
          : b.shape === 'round' ? ofDisc(b.x, b.y, b.r)
            : b.shape === 'cavea' ? ofDisc(b.x, b.y, b.r1 + 3)
              : ofDisc(b.x, b.y, Math.max(b.a, b.b) + 4)),
    };
    // the whole world, coarsely: heights for the shadows and the sky's light
    const cs = 2, cw = Math.ceil(town.W * cs), ch = Math.ceil(town.H * cs);
    const r = raster(sc, { x0: 0, y0: 0, s: cs, w: cw, h: ch }, false);
    sc.coarse = {
      x0: 0, y0: 0, s: cs, w: cw, h: ch, Z: r.Z, BOT: r.BOT, WET: r.WET, ...tileMax(r.Z, cw, ch, 16),
      // the heights about each point, near and further, to tell a hollow
      near: blur(blur(r.Z, cw, ch, 2), cw, ch, 2), far: blur(blur(r.Z, cw, ch, 7), cw, ch, 7),
    };
    return sc;
  }

  // How much of the sun each pixel of a piece is shaded from: a walk
  // towards the sun, rising as the light does, through the piece, then
  // through what lies towards the sun drawn coarser, then through the whole
  // world coarser still, until it is higher than anything about. The shade
  // softens as the thing casting it is further away.
  function shadows(sc, r, cam, m, more, L) {
    const hl = Math.hypot(L[0], L[1]), dx = L[0] / hl, dy = L[1] / hl, tanE = L[2] / hl;
    const layers = [{ ...cam, Z: r.Z, BOT: r.BOT, WET: r.WET, ...tileMax(r.Z, cam.w, cam.h, 16), fine: true }, ...more, sc.coarse];
    const top = Math.max(...layers.map(l => l.zmax));
    const { w, h } = cam, occ = new Float32Array(w * h);
    for (let j = m; j < h - m; j++) for (let i = m; i < w - m; i++) {
      const p = j * w + i;
      let wx = cam.x0 + (i + 0.5) / cam.s, wy = cam.y0 + (j + 0.5) / cam.s, zr = r.Z[p] + 0.03, o = 0, d = 0;
      walk: for (const G of layers) {
        let x = (wx - G.x0) * G.s, y = (wy - G.y0) * G.s;
        if (x < 0 || y < 0 || x >= G.w || y >= G.h) continue;
        const Z = G.Z, gw = G.w, rise = tanE / G.s, st = 1 / G.s;
        for (;;) {
          if (zr > top) break walk;
          if (zr > G.TD[((y / 16) | 0) * G.tw + ((x / 16) | 0)]) { x += dx * 16; y += dy * 16; zr += rise * 16; d += st * 16; }
          else { x += dx; y += dy; zr += rise; d += st; }
          if (x < 0.5 || y < 0.5 || x >= G.w - 1 || y >= G.h - 1) break;
          const q = (y | 0) * gw + (x | 0);
          let zq;
          if (G.fine) zq = Z[q];
          else {
            // (read smoothly between the coarser pixels)
            const fx = x - 0.5, fy = y - 0.5, ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, k = iy * gw + ix;
            zq = (Z[k] * (1 - ax) + Z[k + 1] * ax) * (1 - ay) + (Z[k + gw] * (1 - ax) + Z[k + gw + 1] * ax) * ay;
          }
          if (zq > zr && G.BOT[q] < zr && G.WET[q] !== 1) { // (water, flat, shades nothing)
            const v = (zq - zr) / (0.12 + 0.025 * d);
            if (v >= 1) { o = 1; break walk; }
            if (v > o) o = v;
          }
        }
        wx = G.x0 + x / G.s; wy = G.y0 + y / G.s;
      }
      occ[p] = o;
    }
    return occ;
  }

  // a piece of the town: w × h pixels from (x0, y0), s a metre, drawn k
  // times finer and averaged, with a margin about it so what stands just
  // outside casts its shadow in; RGBA bytes
  function tile(sc, { x0, y0, s, w, h, k = 2, margin = 12 }, sky) {
    const lit = lightOf(sky), L = lit.L;
    const S = s * k, m = margin, bw = w * k + 2 * m, bh = h * k + 2 * m;
    const cam = { x0: x0 - m / S, y0: y0 - m / S, s: S, w: bw, h: bh };
    const r = raster(sc, cam, true), { Z, NX, NY, ALB, WET } = r;
    // close up, what lies towards the sun drawn at 8 px a metre, 45 m of it
    const more = [];
    if (S > 10) {
      const L0 = L, hl = Math.hypot(L0[0], L0[1]), ex = 45 * L0[0] / hl, ey = 45 * L0[1] / hl;
      const X0 = Math.min(cam.x0, cam.x0 + ex) - 2, Y0 = Math.min(cam.y0, cam.y0 + ey) - 2;
      const X1 = Math.max(cam.x0, cam.x0 + ex) + bw / S + 2, Y1 = Math.max(cam.y0, cam.y0 + ey) + bh / S + 2;
      const mc = { x0: X0, y0: Y0, s: 8, w: Math.ceil((X1 - X0) * 8), h: Math.ceil((Y1 - Y0) * 8) };
      const mr = raster(sc, mc, false);
      more.push({ ...mc, Z: mr.Z, BOT: mr.BOT, WET: mr.WET, ...tileMax(mr.Z, mc.w, mc.h, 16) });
    }
    const occ = shadows(sc, r, cam, m, more, L), C = sc.coarse;
    const sample = (G, x, y) => {
      const fx = clamp(x * C.s - 0.5, 0, C.w - 1.001), fy = clamp(y * C.s - 0.5, 0, C.h - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, q = j * C.w + i;
      return lerp(lerp(G[q], G[q + 1], ax), lerp(G[q + C.w], G[q + C.w + 1], ax), ay);
    };
    const sun = lit.col, amb0 = lit.sky, grey = 0.75 * lit.night;
    // the lamps near enough to light the piece
    const R = 16, X1 = cam.x0 + bw / S, Y1 = cam.y0 + bh / S;
    const lamps = lit.lamps > 0.01 ? (sc.town.lamps || []).filter(l => l.x > cam.x0 - R && l.x < X1 + R && l.y > cam.y0 - R && l.y < Y1 + R) : [];
    const LAMP = [1.0, 0.56, 0.22];
    const tone = v => { const x = Math.max(0, v * 0.9); const y = x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14); return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(Math.min(1, y), 1 / 2.4) - 0.055; };
    const out = new Uint8ClampedArray(w * h * 4), acc = [0, 0, 0];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      acc[0] = acc[1] = acc[2] = 0;
      for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) {
        const ii = m + i * k + a, jj = m + j * k + b, p = jj * bw + ii;
        const nx = NX[p], ny = NY[p], nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * (1 - occ[p]);
        // the sky, less of it below the heights about
        const wx = cam.x0 + (ii + 0.5) / S, wy = cam.y0 + (jj + 0.5) / S;
        let ao = 1 - clamp((sample(C.near, wx, wy) - Z[p]) * 0.22, 0, 0.4) - clamp((sample(C.far, wx, wy) - Z[p]) * 0.06, 0, 0.25);
        if (WET[p] === 1) ao = Math.max(ao, 0.85);
        const amb = ao * (0.55 + 0.45 * nz);
        let glow = 0, flame = 0;
        for (const l of lamps) {
          const ddx = wx - l.x, ddy = wy - l.y, ddz = Z[p] - l.z, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > R * R) continue;
          const d = Math.sqrt(d2), f = 1 - d / R;
          glow += l.power * lit.lamps * 6 / (1 + d2 * 0.35) * f * f * Math.max(0.2, (-ddx * nx - ddy * ny - ddz * nz) / (d || 1) * 0.8 + 0.2);
          if (ddx * ddx + ddy * ddy < 0.09) flame += l.power * lit.lamps * 3;
        }
        for (let q = 0; q < 3; q++) {
          let v = LIN[ALB[3 * p + q]] * (amb0[q] * amb + sun[q] * ndl + LAMP[q] * glow) + LAMP[q] * flame;
          if (WET[p] === 1) v += 0.05 * amb0[q] * ao; // the sky in the water
          acc[q] += v;
        }
      }
      const o = 4 * (j * w + i);
      // (at night colours fade, as they do to eyes in the dark)
      const lum = 0.2126 * acc[0] + 0.7152 * acc[1] + 0.0722 * acc[2], warm = acc[0] - acc[2];
      for (let q = 0; q < 3; q++) out[o + q] = 255 * tone(lerp(acc[q], lum * [0.9, 0.97, 1.15][q], grey * clamp(1 - warm * 4, 0, 1)) / (k * k));
      out[o + 3] = 255;
    }
    return out;
  }

  return { scene, tile };
})();
