// Roman Town — the model: a small Roman colony laid out at random on its
// ground, as a surveyor would set it down, and the country about it.
//
// It says only what is there and where, never how it looks: the ground's
// heights, the river, the walls and gates, the streets and blocks, every
// building as boxes with roofs, the roads, the fields and the trees. How
// it is drawn is left to a view (roman-town-view.js), so another can take
// its place without anything here changing.
//
// Units are metres; x runs right, y down (as on the screen), z up. The town
// has its own frame, (u, v), turned by the augur's angle: u along the
// decumanus maximus, v along the cardo maximus.
//
// What town(rng, { W, H }) returns, all in world coordinates:
//   W, H                 the world's size
//   terrain              { cell, nx, ny, z } heights on a grid, z[j·nx + i] at (i·cell, j·cell)
//   river                null, or { points, width, level } its centreline and its water's height at each point
//   town                 { x, y, angle, hu, hv, corner, wall: { thickness, height } } the walls' rounded rectangle
//   gates                [{ x, y, angle }] where the main streets leave, angle outwards
//   grounds              [{ poly, kind }] convex patches of ground, to be laid in order:
//                        street, main-street, paving, yard, garden, sand, floor, pool, well
//   fields               [{ poly, crop, angle }] crop: wheat, stubble, fallow, meadow, hay, pasture, vines,
//                        olives, orchard;
//                        angle, of its rows or furrows
//   roads                [{ points, width, kind }] kind: via (paved), track (earth)
//   buildings            boxes and other solids, each { shape, use, mat, z0, ... }:
//     box                { x, y, angle, w, d, h, roof, pitch, axis, low, hole } w along angle, d across;
//                        its eaves h above z0; roof: flat, hip, gable (ridge along axis 'w' or 'd'),
//                        shed (its low edge on side low: '+w', '-w', '+d', '-d'), court (open over
//                        hole [s1, t1, s2, t2], from its corner, every side sloping down to it); pitch
//                        the rise per metre
//     round              { x, y, r, h, roof: flat | cone | dome, pitch, hole } hole: an open
//                        middle that radius (a well's curb)
//     cavea              { x, y, angle, r0, r1, h } a theatre's seats: a half ring about its orchestra
//                        (r0), rising h to r1 the way angle points
//     arena              { x, y, angle, a, b, a0, b0, h } an amphitheatre: an ellipse a × b, its arena
//                        a0 × b0, the seats rising h between
//   trees                [{ x, y, z0, r, h, kind }] kind: cypress, pine, oak, olive, poplar, fruit, shrub, plane
//   animals              [{ x, y, z0, angle, kind }] grazing, kind: sheep, goat, cow, horse
//   rocks                [{ x, y, z0, r, h, angle }] boulders, r across, h high, sunk a little
//   lamps                [{ x, y, z, power }] where a lamp or a fire burns at night, z its height
const RomanTown = (() => {
  const TAU = Math.PI * 2;
  // no beasts in the pastures for now (true puts the flocks and herds back)
  const GRAZING = false;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const range = (rng, a, b) => a + (b - a) * rng();
  const gauss = rng => { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng()); };
  const pick = (rng, weights) => {
    let s = 0;
    for (const k in weights) s += Math.max(0, weights[k]);
    let r = rng() * s;
    for (const k in weights) { r -= Math.max(0, weights[k]); if (r <= 0) return k; }
    return Object.keys(weights)[0];
  };

  // gradient noise, about −1…1
  function perlin(rng) {
    const perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; const a = rng() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, I = i & 255, J = j & 255;
      const h00 = perm[I + perm[J]], h10 = perm[I + 1 + perm[J]], h01 = perm[I + perm[J + 1]], h11 = perm[I + 1 + perm[J + 1]];
      const a = gx[h00] * fx + gy[h00] * fy, b = gx[h10] * (fx - 1) + gy[h10] * fy;
      const c = gx[h01] * fx + gy[h01] * (fy - 1), d = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
      const sx = fade(fx), sy = fade(fy);
      return 1.4 * (a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy);
    };
  }
  function fbm(n, x, y, oct) {
    let s = 0, a = 1, f = 1, t = 0;
    for (let k = 0; k < oct; k++) { s += a * n(x * f + k * 17.3, y * f - k * 9.1); t += a; a *= 0.5; f *= 2; }
    return s / t;
  }

  // ---- plane geometry ----
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  function area(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - a[1] * b[0]; }
    return s / 2;
  }
  function insideConvex(poly, x, y) {
    const sg = Math.sign(area(poly));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (sg * cross(b[0] - a[0], b[1] - a[1], x - a[0], y - a[1]) < -1e-6) return false;
    }
    return true;
  }
  // a convex polygon clipped by another (Sutherland–Hodgman)
  function clip(subject, by) {
    const sg = Math.sign(area(by));
    let out = subject;
    for (let i = 0; i < by.length && out.length; i++) {
      const a = by[i], b = by[(i + 1) % by.length], ex = b[0] - a[0], ey = b[1] - a[1];
      const side = p => sg * cross(ex, ey, p[0] - a[0], p[1] - a[1]);
      const inp = out;
      out = [];
      for (let k = 0; k < inp.length; k++) {
        const P = inp[k], Q = inp[(k + 1) % inp.length], dp = side(P), dq = side(Q);
        if (dp >= 0) out.push(P);
        if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
      }
    }
    return out;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return [Math.hypot(px - ax - t * dx, py - ay - t * dy), t];
  }
  // a rounded rectangle about the origin, half sizes hu × hv, a point a metre, going round
  function roundRect(hu, hv, r) {
    const pts = [], corners = [[hu - r, hv - r, 0], [-hu + r, hv - r, 1], [-hu + r, -hv + r, 2], [hu - r, -hv + r, 3]];
    for (const [cx, cy, q] of corners) {
      const a0 = q * Math.PI / 2, n = Math.max(4, Math.ceil(r * Math.PI / 2));
      for (let k = 0; k < n; k++) { const a = a0 + k / n * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      // then the straight side to the next corner
      const a1 = a0 + Math.PI / 2, sx = cx + r * Math.cos(a1), sy = cy + r * Math.sin(a1);
      const [nx, ny] = corners[(q + 1) % 4], ex = nx + r * Math.cos(a1), ey = ny + r * Math.sin(a1);
      const m = Math.max(1, Math.ceil(Math.hypot(ex - sx, ey - sy)));
      for (let k = 0; k < m; k++) pts.push([sx + (ex - sx) * k / m, sy + (ey - sy) * k / m]);
    }
    return pts;
  }

  // a closed line resampled to a point about every metre
  function resample(pts, step = 1) {
    const out = [];
    let carry = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t = carry;
      while (t < l) { out.push([a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l]); t += step; }
      carry = t - l;
    }
    return out;
  }
  // The wall's line, in the town's frame, round its middle once and seen
  // from it everywhere: a rounded rectangle, as a camp's; a polygon, its
  // corners eased, as the ground allowed; an oval; or a wavering round.
  // No wider than hu × hv; points a metre apart.
  function outline(rng, hu, hv) {
    const kind = pick(rng, { rect: 2, polygon: 3, oval: 2, round: 2 });
    if (kind === 'rect') return { kind, ring: roundRect(hu, hv, range(rng, 12, 30)) };
    let raw = [];
    if (kind === 'polygon') {
      const k = 5 + (rng() * 5 | 0), a0 = rng() * TAU;
      for (let i = 0; i < k; i++) {
        const a = a0 + (i + range(rng, -0.28, 0.28)) / k * TAU, r = range(rng, 0.78, 1);
        raw.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      // each corner cut back a little, twice
      for (let it = 0; it < 2; it++) {
        const q = 0.12, next = [];
        for (let i = 0; i < raw.length; i++) {
          const a = raw[i], b = raw[(i + 1) % raw.length];
          next.push([lerp(a[0], b[0], q), lerp(a[1], b[1], q)], [lerp(a[0], b[0], 1 - q), lerp(a[1], b[1], 1 - q)]);
        }
        raw = next;
      }
    } else {
      // a superellipse, squarer or rounder, its radius wavering
      const ex = kind === 'oval' ? range(rng, 2, 3) : range(rng, 2.2, 3.6), amp = kind === 'oval' ? 0.025 : 0.07;
      const harm = [2, 3, 4, 5].map(k => [k, range(rng, 0, amp) * 2 / k, rng() * TAU]);
      for (let i = 0; i < 720; i++) {
        const a = i / 720 * TAU, c = Math.cos(a), sn = Math.sin(a);
        let r = 1 / Math.pow(Math.abs(c) ** ex + Math.abs(sn) ** ex, 1 / ex);
        for (const [k, A, ph] of harm) r *= 1 + A * Math.cos(k * a + ph);
        raw.push([c * r, sn * r]);
      }
    }
    // fitted to hu × hv about the middle
    const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    const sx = (Math.max(...xs) - Math.min(...xs)) / 2, sy = (Math.max(...ys) - Math.min(...ys)) / 2;
    return { kind, ring: resample(raw.map(([x, y]) => [(x - mx) / sx * hu, (y - my) / sy * hv])) };
  }
  // the signed distance to the wall's line, negative inside, on a 4 m grid
  // over the world, read between its points
  function sdfGrid(W, H, T, ring) {
    const R = ring.filter((_, i) => i % 3 === 0), n = R.length;
    const cell = 4, nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1, g = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [u, v] = T.loc(i * cell, j * cell);
      let inside = false, d2 = Infinity;
      for (let k = 0, m = n - 1; k < n; m = k++) {
        const a = R[k], b = R[m];
        if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
        const t = l2 ? clamp(((u - a[0]) * ex + (v - a[1]) * ey) / l2, 0, 1) : 0;
        const dx = u - a[0] - t * ex, dy = v - a[1] - t * ey, q = dx * dx + dy * dy;
        if (q < d2) d2 = q;
      }
      g[j * nx + i] = (inside ? -1 : 1) * Math.sqrt(d2);
    }
    return (x, y) => {
      const fx = clamp(x / cell, 0, nx - 1.001), fy = clamp(y / cell, 0, ny - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, k = j * nx + i;
      return lerp(lerp(g[k], g[k + 1], ax), lerp(g[k + nx], g[k + nx + 1], ax), ay);
    };
  }

  // the town's frame: (u, v) to the world and back
  function frame(cx, cy, th) {
    const c = Math.cos(th), s = Math.sin(th);
    return {
      cx, cy, th,
      pt: (u, v) => [cx + u * c - v * s, cy + u * s + v * c],
      loc: (x, y) => { const dx = x - cx, dy = y - cy; return [dx * c + dy * s, -dx * s + dy * c]; },
    };
  }

  // a grid of what is taken, 2 m a cell: 0 free, 1 a field, 2 a road, 3 built on or water
  function occupancy(W, H) {
    const cell = 2, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell), a = new Uint8Array(nx * ny);
    function each(x0, y0, x1, y1, test, v) {
      const i0 = Math.max(0, Math.floor(x0 / cell)), i1 = Math.min(nx - 1, Math.floor(x1 / cell));
      const j0 = Math.max(0, Math.floor(y0 / cell)), j1 = Math.min(ny - 1, Math.floor(y1 / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (a[k] < v && test((i + 0.5) * cell, (j + 0.5) * cell)) a[k] = v;
      }
    }
    return {
      get(x, y) {
        const i = Math.floor(x / cell), j = Math.floor(y / cell);
        return i < 0 || j < 0 || i >= nx || j >= ny ? 255 : a[j * nx + i];
      },
      disc(x, y, r, v) { each(x - r, y - r, x + r, y + r, (px, py) => Math.hypot(px - x, py - y) <= r, v); },
      seg(ax, ay, bx, by, r, v) {
        each(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r,
          (px, py) => distSeg(px, py, ax, ay, bx, by)[0] <= r, v);
      },
      poly(p, v) {
        const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
        each(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => insideConvex(p, px, py), v);
      },
      // whether a disc is all free (or no more taken than v)
      free(x, y, r, v = 0) {
        for (let dy = -r; dy <= r; dy += cell) for (let dx = -r; dx <= r; dx += cell) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          if (this.get(x + dx, y + dy) > v) return false;
        }
        return true;
      },
    };
  }

  function heightAt(t, x, y) {
    const fx = clamp(x / t.cell, 0, t.nx - 1.001), fy = clamp(y / t.cell, 0, t.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, k = j * t.nx + i;
    return lerp(lerp(t.z[k], t.z[k + 1], ax), lerp(t.z[k + t.nx], t.z[k + t.nx + 1], ax), ay);
  }

  // ---- the river: a meander past the town, on one side ----
  function makeRiver(rng, W, H, T, hu, hv) {
    const phi = T.th + (rng() < 0.5 ? 0 : Math.PI / 2) + range(rng, -0.35, 0.35);
    const e = [Math.cos(phi), Math.sin(phi)], n = [-e[1], e[0]];
    const c = Math.cos(T.th), s = Math.sin(T.th);
    const ext = hu * Math.abs(c * n[0] + s * n[1]) + hv * Math.abs(-s * n[0] + c * n[1]);
    const A1 = range(rng, 10, 38), k1 = TAU / range(rng, 260, 560), p1 = rng() * TAU;
    const A2 = range(rng, 4, 12), k2 = TAU / range(rng, 70, 160), p2 = rng() * TAU;
    const width = range(rng, 13, 24), side = rng() < 0.5 ? -1 : 1;
    const d0 = side * (ext + 40 + A1 + A2 + width / 2 + rng() * 45);
    const L = Math.hypot(W, H), points = [];
    let inside = 0;
    for (let t = -L; t <= L; t += 5) {
      const off = d0 + A1 * Math.sin(k1 * t + p1) + A2 * Math.sin(k2 * t + p2);
      const x = T.cx + e[0] * t + n[0] * off, y = T.cy + e[1] * t + n[1] * off;
      if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
      points.push([x, y]);
      if (x > 0 && y > 0 && x < W && y < H) inside++;
    }
    return inside < 30 ? null : { points, width, level: [] };
  }
  // the nearest point of the river: its distance, and its water's height there
  function riverNear(R, x, y) {
    let best = Infinity, lev = 0;
    const P = R.points;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1];
      if (Math.abs(x - a[0]) > best + 10 && Math.abs(x - b[0]) > best + 10) continue;
      const [d, t] = distSeg(x, y, a[0], a[1], b[0], b[1]);
      if (d < best) { best = d; lev = R.level.length ? lerp(R.level[k], R.level[k + 1], t) : 0; }
    }
    return [best, lev];
  }

  // ---- the ground: hills about, the town on a low rise, levelled a little ----
  function makeTerrain(rng, W, H, T, hu, hv, tsd, river, ditch) {
    const cell = 4, nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1;
    const z = new Float32Array(nx * ny);
    const n1 = perlin(rng), n2 = perlin(rng), n3 = perlin(rng), n4 = perlin(rng);
    const tilt = [range(rng, -0.02, 0.02), range(rng, -0.02, 0.02)];
    const R = Math.hypot(hu, hv), hills = range(rng, 70, 140), rise = range(rng, 6, 16);
    const slope = [range(rng, -0.03, 0.03), range(rng, -0.03, 0.03)];
    // ridges: the hills' crests sharpened, folded noise
    const ridge = (x, y) => { let s = 0, a = 1, f = 1; for (let k = 0; k < 3; k++) { s += a * (1 - Math.abs(n4(x * f + k * 5.3, y * f - k * 3.7))); a *= 0.45; f *= 2.1; } return s / 1.65; };
    const raw = (x, y) => {
      const d = Math.hypot(x - T.cx, y - T.cy);
      return 28 * fbm(n1, x / 700, y / 700, 2) + 10 * fbm(n2, x / 170, y / 170, 3) + 0.6 * n3(x / 22, y / 22)
        + tilt[0] * (x - T.cx) + tilt[1] * (y - T.cy)
        + hills * smooth(R * 0.7, R * 1.9, d) * (0.25 + 0.9 * ridge(x / 300, y / 300))
        + rise * Math.exp(-((d / (R * 1.25)) ** 2));
    };
    const zc = raw(T.cx, T.cy);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * cell, y = j * cell;
      let h = raw(x, y);
      // the town levelled to a gentle slope, a little of the ground's lie kept
      const sd = tsd(x, y), m = 1 - smooth(10, 75, sd);
      const flat = zc + slope[0] * (x - T.cx) + slope[1] * (y - T.cy);
      h = lerp(h, flat + 0.3 * (h - flat), m);
      // the ditch before the wall
      if (ditch) { const q = (sd - 15) / 8; if (q > -1 && q < 1) h -= 2 * (1 - q * q) ** 2; }
      z[j * nx + i] = h;
    }
    const terrain = { cell, nx, ny, z };
    if (river) {
      // the water runs down from the end where the ground is higher, never rising
      const P = river.points, hs = P.map(p => heightAt(terrain, p[0], p[1]));
      const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
      const fwd = mean(hs.slice(0, hs.length >> 2)) >= mean(hs.slice(-(hs.length >> 2)));
      const lev = new Array(P.length);
      let m = Infinity;
      for (let k = 0; k < P.length; k++) { const q = fwd ? k : P.length - 1 - k; m = Math.min(m, hs[q] - 2); lev[q] = m; }
      // smoothed, still never rising: a moving average of a falling run falls
      river.level = lev.map((_, k) => { let a = 0, n = 0; for (let q = Math.max(0, k - 8); q <= Math.min(lev.length - 1, k + 8); q++) { a += lev[q]; n++; } return a / n; });
      const w = river.width / 2, F = range(rng, 25, 55);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [d, l] = riverNear(river, i * cell, j * cell);
        if (d > w + F + 10) continue;
        const target = d < w ? l - 1.6 * (1 - (d / w) ** 2) - 0.3 : l + 0.5 + (d - w) * 0.035;
        const k = j * nx + i;
        z[k] = Math.min(z[k], lerp(target, z[k], smooth(w + 3, w + F, d)));
      }
    }
    return terrain;
  }

  // blocks of the grid along one axis, from the main street outwards
  function spans(start, end, block, gap) {
    const out = [];
    let x = start;
    while (end - x >= 1.55 * block + gap) { out.push([x, x + block]); x += block + gap; }
    const rest = end - x;
    if (rest > 1.5 * block + gap) { const b = (rest - gap) / 2; out.push([x, x + b], [x + b + gap, end]); }
    else if (rest > 6) out.push([x, end]);
    return out;
  }

  function town(rng, { W, H }) {
    const out = { W, H, river: null, grounds: [], fields: [], roads: [], buildings: [], trees: [], animals: [], rocks: [], lamps: [], gates: [] };

    // ---- the site, as big as the world allows, turned by the augur ----
    const th = range(rng, -0.35, 0.35), ar = range(rng, 1.05, 1.45);
    const cx = W / 2 + range(rng, -0.06, 0.06) * W, cy = H / 2 + range(rng, -0.05, 0.05) * H;
    const margin = 78;
    let hu, hv;
    for (let L = 400; ; L *= 0.97) {
      hu = L / 2; hv = hu / ar;
      const bx = hu * Math.abs(Math.cos(th)) + hv * Math.abs(Math.sin(th)), by = hu * Math.abs(Math.sin(th)) + hv * Math.abs(Math.cos(th));
      if ((bx <= Math.min(cx, W - cx) - margin && by <= Math.min(cy, H - cy) - margin) || L < 140) break;
    }
    const T = frame(cx, cy, th);
    const wallT = range(rng, 2.6, 3.6), wallH = range(rng, 7, 9.5);
    const shape = outline(rng, hu, hv), ring = shape.ring;
    const tsd = sdfGrid(W, H, T, ring), psd = (u, v) => tsd(...T.pt(u, v));
    out.town = {
      x: cx, y: cy, angle: th, hu, hv, shape: shape.kind, wall: { thickness: wallT, height: wallH },
      outline: ring.filter((_, i) => i % 2 === 0).map(([u, v]) => T.pt(u, v)),
    };

    if (rng() < 0.75) out.river = makeRiver(rng, W, H, T, hu, hv);
    const river = out.river;
    const terrain = out.terrain = makeTerrain(rng, W, H, T, hu, hv, tsd, river, rng() < 0.65);
    const hAt = (x, y) => heightAt(terrain, x, y);
    const riverD = (x, y) => river ? riverNear(river, x, y)[0] - river.width / 2 : Infinity;
    const occ = occupancy(W, H);

    // ---- building blocks: in plan coordinates, turned into the world ----
    const B = out.buildings, G = out.grounds;
    const P = (u, v) => T.pt(u, v);
    const rectPoly = ([u1, v1, u2, v2]) => [P(u1, v1), P(u2, v1), P(u2, v2), P(u1, v2)];
    function box(r, p, within) {
      const [u1, v1, u2, v2] = r;
      if (u2 - u1 < 0.8 || v2 - v1 < 0.8) return null;
      if (within && !(inTown(u1, v1) && inTown(u2, v1) && inTown(u2, v2) && inTown(u1, v2))) return null;
      const [x, y] = P((u1 + u2) / 2, (v1 + v2) / 2);
      const b = {
        shape: 'box', use: p.use || 'house', mat: p.mat || 'tile', x, y, angle: th, w: u2 - u1, d: v2 - v1,
        z0: p.z0 ?? hAt(x, y), h: p.h, roof: p.roof || 'flat', pitch: p.pitch ?? 0.42,
      };
      if (p.axis) b.axis = p.axis === 'u' ? 'w' : 'd';
      if (p.low) b.low = p.low[0] + (p.low[1] === 'u' ? 'w' : 'd');
      if (p.hole) b.hole = [p.hole[0] - u1, p.hole[1] - v1, p.hole[2] - u1, p.hole[3] - v1];
      B.push(b);
      return b;
    }
    // a patch of ground; inside the walls (within, or 'wall' up to the
    // wall's line) cut to the town's shape, in convex pieces
    function ground(r, kind, within, extra) {
      const poly = r.length === 4 && typeof r[0] === 'number' ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : r;
      const pieces = within ? cut(poly, within === 'wall' ? outerFan : innerFan, within === 'wall' ? 0.5 : -gap + 0.3) : [poly];
      for (const q of pieces) if (q.length >= 3) G.push({ poly: q.map(([u, v]) => P(u, v)), kind, ...extra });
      return pieces;
    }
    function tree(u, v, kind, r, h, within) {
      if (within && !inTown(u, v)) return;
      const [x, y] = P(u, v);
      out.trees.push({ x, y, z0: hAt(x, y), r, h, kind });
    }
    // a lamp, or a fire, h above the ground
    function lamp(u, v, h, power = 1, within) {
      if (within && !inTown(u, v)) return;
      const [x, y] = P(u, v);
      out.lamps.push({ x, y, z: hAt(x, y) + h, power });
    }
    // a well: a round stone curb, the water dark down inside
    function well(u, v, within) {
      if (within && !inTown(u, v)) return;
      const [x, y] = P(u, v), r = range(rng, 0.7, 0.9);
      B.push({ shape: 'round', use: 'well', mat: 'stone', x, y, r, hole: r - 0.28, z0: hAt(x, y), h: 0.8, roof: 'flat', pitch: 0 });
      G.push({ poly: Array.from({ length: 8 }, (_, k) => [x + (r - 0.2) * Math.cos(k * TAU / 8), y + (r - 0.2) * Math.sin(k * TAU / 8)]), kind: 'well' });
    }
    // a frame on a rectangle of the plan: s along it, t across, from a corner
    function lf([u1, v1, u2, v2], along, flipS = false, flipT = false) {
      const S = along === 'u' ? u2 - u1 : v2 - v1, D = along === 'u' ? v2 - v1 : u2 - u1;
      const map = (s, t) => { if (flipS) s = S - s; if (flipT) t = D - t; return along === 'u' ? [u1 + s, v1 + t] : [u1 + t, v1 + s]; };
      const axis = w => (w === 's') === (along === 'u') ? 'u' : 'v';
      return {
        S, D, pt: map,
        rect(s1, t1, s2, t2) { const a = map(s1, t1), b = map(s2, t2); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; },
        axis,
        // the side a roof is low on, '+t' and so on, in the plan
        low(dir) {
          const flip = dir[1] === 's' ? flipS : flipT, sign = (dir[0] === '+') !== flip ? '+' : '-';
          return sign + axis(dir[1]);
        },
        // the world angle s or t points
        angle(w) { const a = P(...map(0, 0)), b = P(...(w === 's' ? map(1, 0) : map(0, 1))); return Math.atan2(b[1] - a[1], b[0] - a[0]); },
      };
    }

    // ---- the grid ----
    const gap = wallT / 2 + range(rng, 4, 7);
    const iu = hu - gap, iv = hv - gap;
    const inTown = (u, v) => psd(u, v) <= -gap + 0.3;
    // the town cut into thin wedges from its middle, each convex, to cut
    // things to its shape: up to the wall, and up to the street inside it
    const fanOf = R => R.map((p, i) => {
      const tri = [[0, 0], p, R[(i + 1) % R.length]];
      return { tri, bb: [Math.min(0, p[0], tri[2][0]), Math.min(0, p[1], tri[2][1]), Math.max(0, p[0], tri[2][0]), Math.max(0, p[1], tri[2][1])] };
    });
    const coarse = ring.filter((_, i) => i % 4 === 0);
    const outerFan = fanOf(coarse);
    const innerFan = fanOf(coarse.map(([u, v]) => {
      // along the ray from the middle to where the inner street begins
      let a = 0, b = 1;
      for (let it = 0; it < 14; it++) { const m = (a + b) / 2; if (psd(u * m, v * m) < -gap) a = m; else b = m; }
      return [u * a, v * a];
    }));
    function cut(poly, fan, limit) {
      if (poly.every(([u, v]) => psd(u, v) <= limit)) return [poly];
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], out = [];
      for (const f of fan) {
        if (f.bb[0] > bb[2] || f.bb[2] < bb[0] || f.bb[1] > bb[3] || f.bb[3] < bb[1]) continue;
        const c = clip(poly, f.tri);
        if (c.length >= 3 && Math.abs(area(c)) > 0.05) out.push(c);
      }
      return out;
    }
    const mainW = range(rng, 8, 11), minorW = range(rng, 4.5, 6.5);
    const bu = range(rng, 30, 46), bv = Math.min(75, bu * range(rng, 0.9, 1.9));
    const u0 = range(rng, -0.16, 0.16) * hu, v0 = range(rng, -0.16, 0.16) * hv;
    const axisSpans = (c, half, b) => {
      const left = spans(-(c - mainW / 2), half, b, minorW).map(([a, e]) => [-e, -a]).reverse();
      return [left, left.concat(spans(c + mainW / 2, half, b, minorW))];
    };
    const [leftCols, cols] = axisSpans(u0, iu, bu), [topRows, rows] = axisSpans(v0, iv, bv);
    const ic = leftCols.length, jc = topRows.length;

    for (const f of outerFan) G.push({ poly: f.tri.map(([u, v]) => P(u, v)), kind: 'street' });
    ground([u0 - mainW / 2, -hv - 2, u0 + mainW / 2, hv + 2], 'main-street', 'wall');
    ground([-hu - 2, v0 - mainW / 2, hu + 2, v0 + mainW / 2], 'main-street', 'wall');

    // lamps by the doors of taverns and shops along the main streets
    for (const [along, c] of [['v', u0], ['u', v0]]) {
      for (let t = -Math.max(hu, hv); t < Math.max(hu, hv); t += range(rng, 9, 26)) {
        const side = rng() < 0.5 ? -1 : 1, o = side * (mainW / 2 - 0.4);
        if (along === 'v') lamp(c + o, t, 2.6, 0.7, true); else lamp(t, c + o, 2.6, 0.7, true);
      }
    }
    const blocks = [];
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < cols.length; i++) {
      const r = [cols[i][0], rows[j][0], cols[i][1], rows[j][1]];
      const pieces = cut([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], innerFan, -gap + 0.3);
      const full = pieces.reduce((a, q) => a + Math.abs(area(q)), 0) / ((r[2] - r[0]) * (r[3] - r[1]));
      blocks.push({ i, j, r, full, kind: full < 0.02 ? 'none' : full < 0.35 ? 'open' : null });
    }
    const at = (i, j) => i < 0 || j < 0 || i >= cols.length || j >= rows.length ? null : blocks[j * cols.length + i];
    // public fountains at the crossings, a stone basin against a corner
    for (let i = 1; i < cols.length; i++) for (let j = 1; j < rows.length; j++) {
      if (rng() > 0.8) continue;
      const su = rng() < 0.5 ? -1 : 1, sv = rng() < 0.5 ? -1 : 1;
      const cu = su < 0 ? cols[i - 1][1] : cols[i][0], cv = sv < 0 ? rows[j - 1][1] : rows[j][0];
      const along = rng() < 0.5, u = cu + (along ? -su * 0.95 : su * 1.6), v = cv + (along ? sv * 1.6 : -sv * 0.95);
      const hw = along ? 0.8 : 1.25, hd = along ? 1.25 : 0.8;
      const r = [u - hw, v - hd, u + hw, v + hd];
      if (box(r, { use: 'fountain', mat: 'stone', h: 0.85, roof: 'court', pitch: 0, hole: [r[0] + 0.25, r[1] + 0.25, r[2] - 0.25, r[3] - 0.25] }, true))
        { ground([r[0] + 0.25, r[1] + 0.25, r[2] - 0.25, r[3] - 0.25], 'pool'); if (rng() < 0.4) lamp(u, v, 2.6, 0.8); }
    }
    const groups = [];
    function group(members, kind) {
      const r = [Math.min(...members.map(b => b.r[0])), Math.min(...members.map(b => b.r[1])), Math.max(...members.map(b => b.r[2])), Math.max(...members.map(b => b.r[3]))];
      const g = { members, r, poly: true, kind };
      for (const b of members) b.kind = kind;
      groups.push(g);
      return g;
    }
    const free = b => b && !b.kind && b.full > 0.97;
    const dims = r => [r[2] - r[0], r[3] - r[1]];
    const central = b => 1 - Math.max(Math.abs((b.r[0] + b.r[2]) / 2) / hu, Math.abs((b.r[1] + b.r[3]) / 2) / hv);
    const shuffled = a => { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [c[i], c[j]] = [c[j], c[i]]; } return c; };

    // the forum, by the crossing of the main streets, two blocks if one is small
    {
      const fi = ic - (rng() < 0.5 ? 1 : 0), fj = jc - (rng() < 0.5 ? 1 : 0), f = at(fi, fj);
      const members = [f];
      const [a, b] = dims(f.r);
      if (a * b < 3400) {
        const ni = at(fi + (fi === ic - 1 ? -1 : 1), fj), nj = at(fi, fj + (fj === jc - 1 ? -1 : 1));
        const score = n => { if (!free(n)) return Infinity; const [x, y] = dims(group0([f, n])); return Math.abs(Math.max(x, y) / Math.min(x, y) - 1.6); };
        const best = score(ni) <= score(nj) ? ni : nj;
        if (best && score(best) < Infinity) members.push(best);
      }
      forum(group(members, 'forum'));
    }
    function group0(members) { return [Math.min(...members.map(b => b.r[0])), Math.min(...members.map(b => b.r[1])), Math.max(...members.map(b => b.r[2])), Math.max(...members.map(b => b.r[3]))]; }

    // the theatre, two blocks away from the middle
    if (rng() < 0.7) {
      let done = false;
      for (const b of shuffled(blocks.filter(b => free(b) && central(b) < 0.6))) {
        for (const [di, dj] of shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
          const n = at(b.i + di, b.j + dj);
          if (!free(n)) continue;
          const [x, y] = dims(group0([b, n])), L = Math.max(x, y), S = Math.min(x, y);
          if (Math.min(L / 2 - 3, S - 17) >= 23) { theatre(group([b, n], 'theatre')); done = true; break; }
        }
        if (done) break;
      }
    }
    // the baths, on a main street
    {
      const c = blocks.filter(b => free(b) && (b.i === ic - 1 || b.i === ic || b.j === jc - 1 || b.j === jc));
      const b = shuffled(c).sort((p, q) => (dims(q.r)[0] * dims(q.r)[1] > 1400) - (dims(p.r)[0] * dims(p.r)[1] > 1400))[0];
      if (b) baths(group([b], 'baths'));
    }
    // a market, by the forum or anywhere
    if (rng() < 0.55) {
      const b = shuffled(blocks.filter(free)).sort((p, q) => central(q) - central(p))[0];
      if (b) market(group([b], 'market'));
    }
    // a temple or two in their precincts
    for (let k = 0, n = 1 + (rng() < 0.6); k < n; k++) {
      const b = shuffled(blocks.filter(free))[0];
      if (b) temple(group([b], 'temple'));
    }
    // the rest: houses, gardens near the walls
    for (const b of blocks) {
      if (b.kind === 'open') { ground(b.r, 'garden', true); orchard(b.r, true); continue; }
      if (b.kind) continue;
      if (rng() < 0.03 + 0.22 * (1 - central(b)) ** 2) { garden(group([b], 'garden')); continue; }
      houses(group([b], 'houses'), central(b));
    }

    // ---- the forum ----
    function forum(g) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v';
      const F = lf(g.r, along, rng() < 0.5, false), L = F.S, S = F.D;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      ground(g.r, 'paving', true);
      const pd = 5.5, shops = S > 46 ? 5 : 0;
      const bD = clamp(0.22 * L, 14, 26), a = bD * 0.26;
      // the basilica across one end: a high nave between lower aisles
      box(F.rect(L - bD + a, 0, L - a, S), { use: 'basilica', h: 13, z0, roof: 'gable', axis: F.axis('t') });
      box(F.rect(L - bD, 0, L - bD + a, S), { use: 'basilica', h: 8, z0, roof: 'shed', low: F.low('-s') });
      box(F.rect(L - a, 0, L, S), { use: 'basilica', h: 8, z0, roof: 'shed', low: F.low('+s') });
      // shops behind porticoes along both sides
      const e = L - bD - 2;
      for (const flip of [false, true]) {
        const t = (t1, t2) => flip ? [S - t2, S - t1] : [t1, t2];
        if (shops) { const [a1, a2] = t(0, shops); box(F.rect(0, a1, e, a2), { use: 'shop', h: 6.5, z0, roof: 'gable', axis: F.axis('s') }); }
        const [p1, p2] = t(shops, shops + pd);
        box(F.rect(0, p1, e, p2), { use: 'portico', h: 6, z0, roof: 'shed', low: F.low(flip ? '-t' : '+t') });
      }
      // the Capitolium at the other end, on its podium, facing down the square
      const tw = clamp(0.42 * (S - 2 * (shops + pd)), 10, 21), tl = Math.min(tw * 1.75, 0.38 * L);
      const tc = S / 2;
      box(F.rect(2, tc - tw / 2, 2 + tl, tc + tw / 2), { use: 'temple', h: 13, z0, roof: 'gable', axis: F.axis('s'), pitch: 0.36 });
      box(F.rect(2 + tl, tc - tw / 2 + 1, 2 + tl + 4, tc + tw / 2 - 1), { use: 'steps', h: 1.8, z0, mat: 'marble' });
      box(F.rect(2 + tl + 7, tc - 1.5, 2 + tl + 9, tc + 1.5), { use: 'altar', h: 1.3, z0, mat: 'marble' });
      lamp(...F.pt(2 + tl + 8, tc), 1.8, 1.4);
      for (const sg of [-1, 1]) lamp(...F.pt(2 + tl + 4.5, tc + sg * (tw / 2 - 1)), 2.5, 0.9);
      for (let s = 2 + tl + 12; s < e - 3; s += 11) for (const t of [shops + pd + 0.6, S - shops - pd - 0.6]) lamp(...F.pt(s, t), 3, 0.8);
      // statues about the square
      const ns = 4 + (rng() * 7 | 0);
      for (let k = 0; k < ns; k++) {
        const s = range(rng, 2 + tl + 12, e - 4), side = rng() < 0.5;
        const t = side ? shops + pd + 2.5 : S - shops - pd - 2.5;
        box(F.rect(s - 0.9, t - 0.7, s + 0.9, t + 0.7), { use: 'statue', h: range(rng, 2.5, 4), z0, mat: 'marble' });
      }
    }

    // ---- the theatre: its seats a half ring, its stage building across ----
    function theatre(g) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v';
      const F = lf(g.r, along, false, rng() < 0.5), L = F.S, S = F.D;
      const R = Math.min(L / 2 - 3, S - 17, 44);
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      ground(g.r, 'garden', true);
      // plane trees in the garden about the seats
      for (let k = 0; k < 40; k++) {
        const s2 = range(rng, 3, L - 3), t2 = range(rng, 11, S - 3);
        if (Math.hypot(s2 - L / 2, t2 - 13.5) < R + 5) continue;
        const [u, v] = F.pt(s2, t2);
        tree(u, v, rng() < 0.75 ? 'plane' : 'cypress', range(rng, 2.5, 4.5), range(rng, 9, 14), true);
      }
      box(F.rect(L / 2 - R - 3, 1, L / 2 + R + 3, 8), { use: 'scaena', h: 15, z0, roof: 'gable', axis: F.axis('s') });
      box(F.rect(L / 2 - R * 0.8, 8, L / 2 + R * 0.8, 13.5), { use: 'stage', h: 1.5, z0, mat: 'timber' });
      const [cx2, cy2] = P(...F.pt(L / 2, 13.5));
      B.push({ shape: 'cavea', use: 'theatre', mat: 'stone', x: cx2, y: cy2, angle: F.angle('t'), r0: R * 0.27, r1: R, z0, h: R * 0.42 });
    }

    // ---- the baths: halls in a row, and an exercise court with a pool ----
    function baths(g) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v';
      const F = lf(g.r, along, rng() < 0.5, rng() < 0.5), L = F.S, S = F.D;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      ground(g.r, 'paving', true);
      const Lb = clamp(0.52 * L, 16, 42), n = S > 34 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const t1 = k * S / n + 0.5, t2 = (k + 1) * S / n - 0.5;
        const b = box(F.rect(1, t1, Lb, t2), { use: 'baths', h: range(rng, 9, 12), z0, roof: k === n - 1 ? 'hip' : 'gable', axis: F.axis('s') }, true);
        if (b && k === 0 && rng() < 0.6) {
          const r = Math.min(t2 - t1, Lb) * 0.3, [ux, uy] = P(...F.pt(Lb / 2, (t1 + t2) / 2));
          B.push({ shape: 'round', use: 'baths', mat: 'tile', x: ux, y: uy, r, z0: z0 + b.h - 1, h: 0, roof: 'dome', pitch: 0.7 });
        }
      }
      const c = F.rect(Lb + 1, 1, L - 1, S - 1);
      box(c, { use: 'palaestra', h: 5.5, z0, roof: 'court', hole: F.rect(Lb + 5.5, 5.5, L - 5.5, S - 5.5) }, true);
      ground(F.rect(Lb + 5.5, 5.5, L - 5.5, S - 5.5), 'sand', true);
      const pl = (L - Lb - 11) * 0.5, pw = (S - 11) * 0.45, ps = (Lb + L) / 2, pt = S / 2;
      if (pl > 4 && pw > 3) ground(F.rect(ps - pl / 2, pt - pw / 2, ps + pl / 2, pt + pw / 2), 'pool', true);
    }

    // ---- the market: shops round a court, a round pavilion in the middle ----
    function market(g) {
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      const [x, y] = dims(g.r), k = Math.min(9, Math.min(x, y) * 0.28);
      ground(g.r, 'paving', true);
      box(g.r, { use: 'market', h: 6, z0, roof: 'court', hole: [g.r[0] + k, g.r[1] + k, g.r[2] - k, g.r[3] - k] }, true);
      const [mx, my] = P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2);
      B.push({ shape: 'round', use: 'tholos', mat: 'tile', x: mx, y: my, r: Math.min(5.5, Math.min(x, y) * 0.14), z0, h: 5, roof: 'cone', pitch: 0.55 });
    }

    // ---- a temple in its precinct, porticoes about it ----
    function temple(g) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v';
      const F = lf(g.r, along, rng() < 0.5, false), L = F.S, S = F.D;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      const k = 5;
      ground(g.r, 'paving', true);
      box(F.rect(0.5, 0.5, L - 0.5, S - 0.5), { use: 'portico', h: 5.5, z0, roof: 'court', hole: F.rect(k, k, L - k, S - k) }, true);
      if (rng() < 0.25) {
        const [mx, my] = P(...F.pt(L / 2, S / 2));
        B.push({ shape: 'round', use: 'temple', mat: 'tile', x: mx, y: my, r: Math.min(8, S * 0.2), z0, h: 9, roof: 'cone', pitch: 0.5 });
      } else {
        const tw = clamp(0.36 * S, 8, 16), tl = Math.min(tw * 1.7, L - 2 * k - 12), s0 = (L - tl) / 2 - 2;
        box(F.rect(s0, S / 2 - tw / 2, s0 + tl, S / 2 + tw / 2), { use: 'temple', h: 11, z0, roof: 'gable', axis: F.axis('s'), pitch: 0.36 });
        box(F.rect(s0 + tl, S / 2 - tw / 2 + 1, s0 + tl + 3, S / 2 + tw / 2 - 1), { use: 'steps', h: 1.6, z0, mat: 'marble' });
        box(F.rect(s0 + tl + 5, S / 2 - 1.2, s0 + tl + 6.6, S / 2 + 1.2), { use: 'altar', h: 1.2, z0, mat: 'marble' });
        lamp(...F.pt(s0 + tl + 5.8, S / 2), 1.7, 1.2);
      }
      if (rng() < 0.5) for (let n = 0; n < 6; n++) {
        const [u, v] = F.pt(range(rng, k + 3, L - k - 3), rng() < 0.5 ? range(rng, k + 2, k + 4) : range(rng, S - k - 4, S - k - 2));
        tree(u, v, rng() < 0.5 ? 'cypress' : 'plane', range(rng, 1.4, 3.5), range(rng, 7, 13), true);
      }
    }

    // ---- a garden inside the walls: an orchard, or vines, a shed ----
    function orchard(r, poly) {
      const sp = range(rng, 6, 8), kind = rng() < 0.3 ? 'olive' : 'fruit';
      for (let u = r[0] + sp / 2; u < r[2]; u += sp) for (let v = r[1] + sp / 2; v < r[3]; v += sp) {
        if (rng() < 0.85) tree(u + range(rng, -0.6, 0.6), v + range(rng, -0.6, 0.6), kind, range(rng, 2, 3.2), range(rng, 4, 6.5), poly);
      }
    }
    function garden(g) {
      ground(g.r, 'garden', true);
      if (rng() < 0.6) orchard(g.r, true);
      else ground(g.r, 'vines', true, { angle: th + (rng() < 0.5 ? 0 : Math.PI / 2) });
      const [x, y] = dims(g.r);
      box([g.r[0] + 2, g.r[1] + 2, g.r[0] + 2 + Math.min(10, x / 3), g.r[1] + 2 + Math.min(7, y / 3)], { use: 'shed', h: 4, roof: 'gable', axis: 'u' }, true);
    }

    // ---- houses: lots along both long sides of a block ----
    function houses(g, cen) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v', S = Math.min(x, y);
      ground(g.r, 'yard', true);
      let dA, dB;
      if (S <= 66) { dA = S * range(rng, 0.42, 0.58); dB = S - dA; }
      else { dA = range(rng, 24, 34); dB = range(rng, 24, 34); }
      const FA = lf(g.r, along, rng() < 0.5, false), FB = lf(g.r, along, rng() < 0.5, true);
      if (S > dA + dB + 2) {
        const mid = FA.rect(0, dA, FA.S, S - dB);
        ground(mid, 'garden', true);
        orchard(mid, true);
      }
      for (const [F, d] of [[FA, dA], [FB, dB]]) {
        let s = 0;
        while (s < F.S - 0.5) {
          const r = rng();
          let w = r < 0.5 ? range(rng, 7, 13) : r < 0.87 ? range(rng, 15, 24) : range(rng, 26, 36);
          if (F.S - s - w < 7) w = F.S - s;
          lot(F, s, w, d, cen, true);
          s += w;
        }
      }
    }
    function lot(F, s0, w, d, cen, within) {
      const R = (a, t1, b, t2) => F.rect(s0 + a, t1, s0 + b, t2);
      const [mx, my] = P(...F.pt(s0 + w / 2, d / 2)), z0 = hAt(mx, my);
      const sA = F.axis('s');
      const r = rng();
      if (w >= 15 && d >= 22 && r > 0.12 + 0.3 * cen) return domus(F, s0, w, d, z0, within);
      if (w >= 13 && d >= 15 && r < 0.12 + 0.3 * cen) {
        // an apartment block, four or five floors, a light well if it is big
        const D = Math.min(d, range(rng, 15, 22)), hole = w >= 18 && D >= 17;
        const h = range(rng, 11, 16);
        return box(R(0, 0, w, D), hole ? { use: 'insula', h, z0, roof: 'court', hole: R(w / 2 - 2.5, D / 2 - 2.5, w / 2 + 2.5, D / 2 + 2.5) } : { use: 'insula', h, z0, roof: 'hip' }, within);
      }
      if (r > 0.9 - 0.12 * (1 - cen)) {
        ground(R(0, 0, w, d), 'garden', within);
        for (let k = 0, n = 1 + (rng() * 3 | 0); k < n; k++) {
          const [u, v] = F.pt(s0 + range(rng, 2, w - 2), range(rng, 2, d - 2));
          tree(u, v, pick(rng, { fruit: 3, olive: 1, cypress: 1, shrub: 1 }), range(rng, 1.5, 3), range(rng, 4, 8), within);
        }
        return box(R(0.5, 0, w - 0.5, Math.min(d, 6)), { use: 'shop', h: range(rng, 4, 5.5), z0, roof: 'gable', axis: sA }, within);
      }
      // a house: front rooms on the street, maybe more behind a yard
      const D = Math.min(d, range(rng, 8, 14)), h = range(rng, 5, 8.5);
      box(R(0, 0, w, D), { use: 'house', h, z0, roof: rng() < 0.5 ? 'hip' : 'gable', axis: sA }, within);
      if (d - D > 6) {
        if (rng() < 0.45) box(R(0, D + 3, Math.min(w, range(rng, 5, 9)), d - 0.5), { use: 'house', h: h - 1.5, z0, roof: 'shed', low: F.low('+s') }, within);
        else if (rng() < 0.6) {
          ground(R(0, D, w, d), 'garden', within);
          if (rng() < 0.4) well(...F.pt(s0 + range(rng, 1.2, w - 1.2), D + 1.3), within);
          const [u, v] = F.pt(s0 + w / 2, (D + d) / 2);
          tree(u, v, pick(rng, { fruit: 3, olive: 2, cypress: 1, plane: 1 }), range(rng, 1.8, 3.5), range(rng, 5, 10), within);
        }
      }
    }
    // an atrium house: shops on the street either side of its door, the
    // atrium behind, its roof sloping in to the pool in the middle, rooms
    // about it, and at the back a garden in a colonnade
    function domus(F, s0, w, d, z0, within) {
      const R = (a, t1, b, t2) => F.rect(s0 + a, t1, s0 + b, t2);
      const h = range(rng, 5.5, 7.5), sA = F.axis('s'), tA = F.axis('t');
      const f = clamp(d * 0.18, 5, 7.5);
      box(R(0, 0, w, f), { use: 'domus', h, z0, roof: 'gable', axis: sA }, within);
      const A = clamp(Math.min(w - 2, (d - f) * 0.45), 8, 14), sA1 = clamp(w / 2 - A / 2 + range(rng, -2, 2), 0, w - A), sA2 = sA1 + A;
      const o = A * 0.32;
      box(R(sA1, f, sA2, f + A), { use: 'domus', h: h - 0.5, z0, roof: 'court', hole: R(sA1 + o, f + o, sA2 - o, f + A - o) }, within);
      ground(R(sA1 + o, f + o, sA2 - o, f + A - o), 'floor', within);
      ground(R(sA1 + o + 0.6, f + o + 0.6, sA2 - o - 0.6, f + A - o - 0.6), 'pool', within);
      if (rng() < 0.5) lamp(...F.pt(s0 + sA1 + o + 0.4, f + o + 0.4), 1.6, 0.6, within);
      if (sA1 > 2.5) box(R(0, f, sA1, f + A), { use: 'domus', h: h - 0.3, z0, roof: 'gable', axis: tA }, within);
      if (w - sA2 > 2.5) box(R(sA2, f, w, f + A), { use: 'domus', h: h - 0.3, z0, roof: 'gable', axis: tA }, within);
      let t = f + A;
      if (d - t < 6) return;
      box(R(0, t, w, t + 5), { use: 'domus', h, z0, roof: 'gable', axis: sA }, within);
      t += 5;
      const back = d - t > 22 ? 5 : 0, Pd = d - t - back;
      if (Pd >= 8) {
        // the peristyle, rooms down one side if it is wide
        const side = w > 22 ? 6 : 0, k = Math.min(3.2, Pd * 0.25);
        box(R(0, t, w - side, t + Pd), { use: 'peristyle', h: 4, z0, roof: 'court', hole: R(k, t + k, w - side - k, t + Pd - k) }, within);
        if (side) box(R(w - side, t, w, t + Pd), { use: 'domus', h: h - 0.5, z0, roof: 'gable', axis: tA }, within);
        ground(R(k, t + k, w - side - k, t + Pd - k), 'garden', within);
        const gw = w - side - 2 * k, gd = Pd - 2 * k;
        if (rng() < 0.4 && gw > 6 && gd > 5) ground(R(k + gw * 0.35, t + k + gd * 0.35, k + gw * 0.65, t + k + gd * 0.65), 'pool', within);
        else if (rng() < 0.5) well(...F.pt(s0 + k + 1.3, t + k + 1.3), within);
        for (let n = 0, m = 1 + (rng() * 4 | 0); n < m; n++) {
          const [u, v] = F.pt(s0 + k + range(rng, 1.2, gw - 1.2), t + k + range(rng, 1.2, gd - 1.2));
          tree(u, v, pick(rng, { fruit: 3, shrub: 3, cypress: 1, plane: 1 }), range(rng, 1, 2.6), range(rng, 3, 7), within);
        }
      } else if (Pd > 0) ground(R(0, t, w, t + Pd), 'garden', within);
      if (back) box(R(0, d - back, w, d), { use: 'domus', h: h - 1, z0, roof: 'gable', axis: sA }, within);
    }

    // ---- the walls, their towers and gates ----
    {
      const n = ring.length, gw = mainW + 3;
      // the gates where the main streets meet the wall
      const gates = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([nu, nv]) => {
        let a = 0, b = 2 * Math.hypot(hu, hv);
        for (let it = 0; it < 30; it++) { const m = (a + b) / 2; if (psd(u0 + nu * m, v0 + nv * m) < 0) a = m; else b = m; }
        return [u0 + nu * a, v0 + nv * a, nu, nv];
      });
      const inGate = ([u, v]) => gates.some(([gu, gv]) => Math.hypot(u - gu, v - gv) < gw / 2 + 0.5);
      const z = ([u, v]) => hAt(...P(u, v));
      // the curtain wall, in pieces of up to 8 m between the gates
      let run = [];
      const flush = () => {
        for (let k = 0; k + 1 < run.length; k += 8) {
          const a = run[k], b = run[Math.min(k + 8, run.length - 1)];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]), [x, y] = P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          B.push({ shape: 'box', use: 'wall', mat: 'stone', x, y, angle: th + Math.atan2(b[1] - a[1], b[0] - a[0]), w: L + wallT * 0.6, d: wallT, z0: Math.min(z(a), z(b)), h: wallH, roof: 'flat', pitch: 0 });
        }
        run = [];
      };
      let k0 = ring.findIndex(inGate);
      for (let k = 1; k <= n; k++) {
        const p = ring[(k0 + k) % n];
        if (inGate(p)) flush(); else run.push(p);
      }
      flush();
      // towers every forty metres or so, round at the corners
      const ts = range(rng, 5.5, 7.5), roofed = rng() < 0.6;
      const tower = (u, v, nu, nv, size, round) => {
        const [x, y] = P(u + nu * (size / 2 - wallT / 2 - 0.5), v + nv * (size / 2 - wallT / 2 - 0.5));
        const h = wallH + range(rng, 2.5, 4);
        if (round) B.push({ shape: 'round', use: 'tower', mat: roofed ? 'tile' : 'stone', x, y, r: size / 2, z0: hAt(x, y), h, roof: roofed ? 'cone' : 'flat', pitch: 0.55 });
        else B.push({ shape: 'box', use: 'tower', mat: roofed ? 'tile' : 'stone', x, y, angle: th + Math.atan2(nv, nu), w: size, d: size, z0: hAt(x, y), h, roof: roofed ? 'hip' : 'flat', pitch: 0.5 });
      };
      const step = range(rng, 34, 48);
      let acc = step / 2;
      for (let k = 0; k < n; k++) {
        const a = ring[k], b = ring[(k + 1) % n];
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc < step) continue;
        const nearGate = gates.some(([gu, gv]) => Math.hypot(a[0] - gu, a[1] - gv) < gw / 2 + 14);
        if (nearGate) continue;
        acc = 0;
        // facing out, square to the wall; round where it turns
        const p0 = ring[(k - 6 + n) % n], p1 = ring[(k + 6) % n], t = [p1[0] - p0[0], p1[1] - p0[1]], l = Math.hypot(...t);
        let nu = t[1] / l, nv = -t[0] / l;
        if (psd(a[0] + nu, a[1] + nv) < psd(a[0] - nu, a[1] - nv)) { nu = -nu; nv = -nv; }
        const q0 = ring[(k - 8 + n) % n], q1 = ring[(k + 8) % n];
        const turn = Math.abs(Math.atan2(cross(a[0] - q0[0], a[1] - q0[1], q1[0] - a[0], q1[1] - a[1]), (a[0] - q0[0]) * (q1[0] - a[0]) + (a[1] - q0[1]) * (q1[1] - a[1])));
        const corner = turn > 0.3;
        tower(a[0], a[1], nu, nv, corner ? ts * 1.2 : ts, corner);
      }
      // the gates: an arch over the street, a tower either side
      const roundG = rng() < 0.5;
      for (const [gu, gv, nu, nv] of gates) {
        const tu = -nv, tv = nu, half = gw / 2 + 1;
        const r = [gu - Math.abs(tu) * half - Math.abs(nu) * (wallT / 2 + 1.5), gv - Math.abs(tv) * half - Math.abs(nv) * (wallT / 2 + 1.5),
          gu + Math.abs(tu) * half + Math.abs(nu) * (wallT / 2 + 1.5), gv + Math.abs(tv) * half + Math.abs(nv) * (wallT / 2 + 1.5)];
        box(r, { use: 'gate', mat: 'stone', h: wallH + 1, roof: 'flat', pitch: 0 });
        for (const sg of [-1, 1]) for (const io of [-1, 1]) lamp(gu + tu * sg * (half - 0.8) + nu * io * (wallT / 2 + 2), gv + tv * sg * (half - 0.8) + nv * io * (wallT / 2 + 2), 3.5, 1);
        const gs = ts * 1.25;
        for (const sg of [-1, 1]) tower(gu + tu * sg * (half + gs / 2), gv + tv * sg * (half + gs / 2), nu, nv, gs, roundG);
        const [x, y] = P(gu, gv);
        out.gates.push({ x, y, angle: th + Math.atan2(nv, nu) });
      }
    }

    // ================= the country about =================
    const inWorld = (x, y, m = 0) => x >= -m && y >= -m && x <= W + m && y <= H + m;
    if (river) {
      const P2 = river.points;
      for (let k = 0; k + 1 < P2.length; k++) occ.seg(P2[k][0], P2[k][1], P2[k + 1][0], P2[k + 1][1], river.width / 2 + 3, 3);
    }

    // the roads out of the gates, paved, wandering a little
    const nRoad = perlin(rng);
    out.gates.forEach((g, gi) => {
      const pts = [[g.x, g.y]];
      let x = g.x, y = g.y;
      for (let s = 0; s < 2000; s += 6) {
        const a = g.angle + (s < 30 ? 0 : 0.5 * smooth(30, 160, s) * fbm(nRoad, s / 260 + gi * 7.7, gi * 3.1, 2));
        x += 6 * Math.cos(a); y += 6 * Math.sin(a);
        pts.push([x, y]);
        if (!inWorld(x, y, 30)) break;
      }
      const width = range(rng, 6, 7.5);
      out.roads.push({ points: pts, width, kind: 'via' });
      for (let k = 0; k + 1 < pts.length; k++) occ.seg(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], width / 2 + 1.5, 2);
      // a bridge where it crosses the river
      if (river) {
        const R2 = river.points;
        for (let k = 0; k + 1 < pts.length; k++) for (let q = 0; q + 1 < R2.length; q++) {
          const [a, b] = [pts[k], pts[k + 1]], [c, e] = [R2[q], R2[q + 1]];
          const rx = b[0] - a[0], ry = b[1] - a[1], sx = e[0] - c[0], sy = e[1] - c[1], den = cross(rx, ry, sx, sy);
          if (Math.abs(den) < 1e-9) continue;
          const t = cross(c[0] - a[0], c[1] - a[1], sx, sy) / den, u = cross(c[0] - a[0], c[1] - a[1], rx, ry) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const X = a[0] + t * rx, Y = a[1] + t * ry, sin = Math.abs(den) / (Math.hypot(rx, ry) * Math.hypot(sx, sy));
          const len = 2 * (river.width / 2 + 6) / Math.max(sin, 0.35);
          const lev = lerp(river.level[q], river.level[q + 1], u);
          B.push({ shape: 'box', use: 'bridge', mat: 'stone', x: X, y: Y, angle: Math.atan2(ry, rx), w: len, d: width + 1.5, z0: lev, h: 4.5, roof: 'flat', pitch: 0 });
        }
      }
    });

    // the amphitheatre, outside the walls between two roads
    if (rng() < 0.8) {
      const a = range(rng, 38, 50), b = a * range(rng, 0.75, 0.85);
      for (let tries = 0; tries < 40; tries++) {
        const dir = rng() * TAU, c = Math.cos(dir), s = Math.sin(dir);
        let r = 30;
        while (tsd(cx + c * r, cy + s * r) < 28 + a && r < 900) r += 4;
        const x = cx + c * r, y = cy + s * r;
        const ang = Math.abs(Math.cos(dir - th)) > Math.abs(Math.sin(dir - th)) ? th + Math.PI / 2 : th;
        if (!inWorld(x, y, -a - 8)) continue;
        let ok = true;
        for (let q = 0; q < 24 && ok; q++) {
          const t = q / 24 * TAU, ex = Math.cos(t) * (a + 8), ey = Math.sin(t) * (b + 8);
          const px = x + ex * Math.cos(ang) - ey * Math.sin(ang), py = y + ex * Math.sin(ang) + ey * Math.cos(ang);
          if (occ.get(px, py) !== 0) ok = false;
        }
        if (!ok || !occ.free(x, y, b * 0.9)) continue;
        B.push({ shape: 'arena', use: 'amphitheatre', mat: 'stone', x, y, angle: ang, a, b, a0: a * 0.55, b0: b * 0.48, z0: hAt(x, y), h: a * 0.32 });
        occ.disc(x, y, a + 8, 3);
        break;
      }
    }

    // farms: a courtyard house and a barn, out in the fields
    for (let n = 0, m = rng() * 3.5 | 0, tries = 0; n < m && tries < 60; tries++) {
      const x = range(rng, 40, W - 40), y = range(rng, 40, H - 40);
      if (tsd(x, y) < 110 || riverD(x, y) < 30 || !occ.free(x, y, 42)) continue;
      const [u, v] = T.loc(x, y), A = range(rng, 26, 40), Bd = A * range(rng, 0.75, 1), k = range(rng, 7, 9);
      const z0 = hAt(x, y);
      box([u - A / 2, v - Bd / 2, u + A / 2, v + Bd / 2], { use: 'villa', h: 6, z0, roof: 'court', hole: [u - A / 2 + k, v - Bd / 2 + k, u + A / 2 - k, v + Bd / 2 - k] });
      ground([u - A / 2 + k, v - Bd / 2 + k, u + A / 2 - k, v + Bd / 2 - k], 'yard');
      well(u + range(rng, -2, 2), v + range(rng, -2, 2));
      lamp(u - A / 2 + k + 0.8, v, 2.2, 0.8);
      const bx = u + A / 2 + 8;
      box([bx, v - Bd / 2, bx + 9, v - Bd / 2 + range(rng, 16, 26)], { use: 'barn', h: 6.5, z0: hAt(...P(bx + 4, v)), roof: 'gable', axis: 'v' });
      ground([u - A / 2 - 6, v + Bd / 2 + 2, u + A / 2, v + Bd / 2 + 16], 'garden');
      for (let q = 0; q < 6; q++) tree(u - A / 2 - 6 + range(rng, 2, A + 4), v + Bd / 2 + range(rng, 4, 14), 'fruit', range(rng, 2, 3), range(rng, 4, 6));
      if (rng() < 0.7) tree(u - A / 2 - 5, v - Bd / 2 - 5, 'pine', range(rng, 5, 7), range(rng, 12, 16));
      occ.disc(x, y, 38, 3);
      n++;
    }

    // tombs along the roads, a stretch out from the gates, and cypresses
    for (const road of out.roads) {
      const pts = road.points;
      let s = 0, next = range(rng, 22, 34);
      const end = range(rng, 140, 230);
      for (let k = 0; k + 1 < pts.length && s < end; k++) {
        const a = pts[k], b = pts[k + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
        while (next < s + l) {
          const t = next - s, px = a[0] + ux * t, py = a[1] + uy * t;
          for (const side of [-1, 1]) {
            if (rng() > 0.7 * (1 - next / end * 0.6)) continue;
            const kind = pick(rng, { house: 3, drum: 2, altar: 2, mound: 1 });
            const size = kind === 'drum' || kind === 'mound' ? range(rng, 2.5, 6) : range(rng, 2.5, 7);
            const off = road.width / 2 + 1.5 + size / 2 + rng() * 3;
            const x = px - uy * side * off, y = py + ux * side * off;
            if (!inWorld(x, y, -5) || tsd(x, y) < 22 || !occ.free(x, y, size * 0.75)) continue;
            const z0 = hAt(x, y), ang = Math.atan2(uy, ux);
            if (kind === 'drum') B.push({ shape: 'round', use: 'tomb', mat: rng() < 0.5 ? 'stone' : 'turf', x, y, r: size / 2 + 1, z0, h: range(rng, 2.5, 5), roof: 'cone', pitch: 0.45 });
            else if (kind === 'mound') B.push({ shape: 'round', use: 'tomb', mat: 'turf', x, y, r: size / 2 + 1.5, z0, h: 0.5, roof: 'dome', pitch: 0.5 });
            else B.push({ shape: 'box', use: 'tomb', mat: kind === 'house' ? 'tile' : 'marble', x, y, angle: ang, w: size, d: size * range(rng, 0.8, 1.2), z0, h: kind === 'house' ? range(rng, 3, 6) : range(rng, 1.5, 3), roof: kind === 'house' ? (rng() < 0.5 ? 'hip' : 'gable') : 'flat', axis: 'w', pitch: kind === 'house' ? 0.6 : 0 });
            occ.disc(x, y, size * 0.75 + 1, 3);
            if (rng() < 0.45) {
              const o2 = off + size / 2 + 2.5, tx = px - uy * side * o2 + ux * range(rng, -3, 3), ty = py + ux * side * o2 + uy * range(rng, -3, 3);
              if (occ.free(tx, ty, 1.5)) { out.trees.push({ x: tx, y: ty, z0: hAt(tx, ty), r: range(rng, 1.2, 1.9), h: range(rng, 10, 17), kind: 'cypress' }); occ.disc(tx, ty, 1.5, 3); }
            }
          }
          next += range(rng, 5, 14);
        }
        s += l;
      }
    }

    // the centuriation: earth tracks and fields on the town's own grid
    const Gu = range(rng, 60, 95), Gv = range(rng, 60, 95);
    const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => T.loc(x, y));
    const uMin = Math.min(...corners.map(c => c[0])), uMax = Math.max(...corners.map(c => c[0]));
    const vMin = Math.min(...corners.map(c => c[1])), vMax = Math.max(...corners.map(c => c[1]));
    const kU0 = Math.floor((uMin - u0) / Gu), kU1 = Math.ceil((uMax - u0) / Gu);
    const kV0 = Math.floor((vMin - v0) / Gv), kV1 = Math.ceil((vMax - v0) / Gv);
    const trackOk = (x, y) => inWorld(x, y, 15) && tsd(x, y) > 20 && riverD(x, y) > 3 && occ.get(x, y) < 3;
    const track = (a, b, fixed, alongU) => {
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          out.roads.push({ points: run, width: 3.4, kind: 'track' });
          for (let k = 0; k + 1 < run.length; k++) occ.seg(run[k][0], run[k][1], run[k + 1][0], run[k + 1][1], 2, 2);
        }
        run = [];
      };
      for (let t = a; t <= b; t += 5) {
        const p = alongU ? P(t, fixed) : P(fixed, t);
        if (trackOk(...p)) run.push(p); else flush();
      }
      flush();
    };
    for (let k = kU0; k <= kU1; k++) if (k !== 0 && rng() < 0.45) track(vMin, vMax, u0 + k * Gu, false);
    for (let k = kV0; k <= kV1; k++) if (k !== 0 && rng() < 0.45) track(uMin, uMax, v0 + k * Gv, true);

    const slopeAt = (x, y) => Math.hypot(hAt(x + 3, y) - hAt(x - 3, y), hAt(x, y + 3) - hAt(x, y - 3)) / 6;
    const nCrop = perlin(rng);
    for (let ku = kU0; ku < kU1; ku++) for (let kv = kV0; kv < kV1; kv++) {
      const cu1 = u0 + ku * Gu, cv1 = v0 + kv * Gv;
      // strips across the square, some of them halved
      const splitU = rng() < 0.5, n = 1 + (rng() * 3.3 | 0), parcels = [];
      for (let q = 0; q < n; q++) {
        const r = splitU ? [cu1 + q * Gu / n, cv1, cu1 + (q + 1) * Gu / n, cv1 + Gv] : [cu1, cv1 + q * Gv / n, cu1 + Gu, cv1 + (q + 1) * Gv / n];
        if (rng() < 0.5) {
          const m = range(rng, 0.35, 0.65);
          if (splitU) parcels.push([r[0], r[1], r[2], lerp(r[1], r[3], m)], [r[0], lerp(r[1], r[3], m), r[2], r[3]]);
          else parcels.push([r[0], r[1], lerp(r[0], r[2], m), r[3]], [lerp(r[0], r[2], m), r[1], r[2], r[3]]);
        } else parcels.push(r);
      }
      for (const r of parcels) parcel(r, 0);
    }
    // A parcel: tilled where it is level enough, grazed where it is steeper,
    // halved and halved again to fit round what is in its way.
    function parcel(r, depth) {
      const pr = [r[0] + 1.2, r[1] + 1.2, r[2] - 1.2, r[3] - 1.2];
      let hard = 0, steep = 0, seen = 0;
      for (const fu of [0.1, 0.5, 0.9]) for (const fv of [0.1, 0.5, 0.9]) {
        const [x, y] = P(lerp(pr[0], pr[2], fu), lerp(pr[1], pr[3], fv));
        if (!inWorld(x, y)) continue;
        seen++;
        const sl = slopeAt(x, y);
        if (tsd(x, y) < 20 || occ.get(x, y) === 3 || occ.get(x, y) === 1 || sl > 0.42) hard++;
        else if (sl > 0.2) steep++;
      }
      if (!seen) return;
      if (hard) {
        if (depth < 2 && Math.min(r[2] - r[0], r[3] - r[1]) > 22) {
          const mu = lerp(r[0], r[2], range(rng, 0.4, 0.6)), mv = lerp(r[1], r[3], range(rng, 0.4, 0.6));
          for (const q of [[r[0], r[1], mu, mv], [mu, r[1], r[2], mv], [r[0], mv, mu, r[3]], [mu, mv, r[2], r[3]]]) parcel(q, depth + 1);
        }
        return;
      }
      const [mx, my] = P((pr[0] + pr[2]) / 2, (pr[1] + pr[3]) / 2);
      // neighbouring fields alike more often than not
      const wild = fbm(nCrop, mx / 260, my / 260, 2);
      const crop = steep > 2 ? 'pasture' : pick(rng, {
        wheat: 3 + 3 * wild, stubble: 1.2, fallow: 1.4, meadow: 1.2 - wild, hay: 1.2, pasture: 1.3 - wild,
        vines: 2, olives: 2.2 - 2 * wild, orchard: 0.6,
      });
      const longU = pr[2] - pr[0] >= pr[3] - pr[1];
      const poly = rectPoly(pr);
      out.fields.push({ poly, crop, angle: th + (longU ? 0 : Math.PI / 2) });
      occ.poly(poly, 1);
      if (crop === 'olives' || crop === 'orchard') {
        const sp = crop === 'olives' ? range(rng, 8, 11) : range(rng, 5.5, 7);
        let row = 0;
        for (let v = pr[1] + sp / 2; v < pr[3] - 1; v += sp * 0.87, row++) for (let u = pr[0] + sp / 2 + (row % 2) * sp / 2; u < pr[2] - 1; u += sp) {
          if (rng() < 0.08) continue;
          const [x, y] = P(u + range(rng, -0.7, 0.7), v + range(rng, -0.7, 0.7));
          if (!inWorld(x, y, 10) || occ.get(x, y) > 1) continue;
          out.trees.push({ x, y, z0: hAt(x, y), r: crop === 'olives' ? range(rng, 2.2, 3.3) : range(rng, 1.8, 2.6), h: range(rng, 4, 6.5), kind: crop === 'olives' ? 'olive' : 'fruit' });
        }
      }
      if (crop === 'pasture') pasture(pr);
    }
    // a pasture: a dry-stone wall about it, a gap for a gate, a shade tree, a
    // trough's well maybe, and a flock or a herd
    function pasture(pr) {
      const [u1, v1, u2, v2] = pr, edges = [[u1, v1, u2, v1], [u2, v1, u2, v2], [u2, v2, u1, v2], [u1, v2, u1, v1]];
      const gateEdge = rng() * 4 | 0, gateAt = range(rng, 0.2, 0.8);
      edges.forEach(([a, b, c, d], e) => {
        const L = Math.hypot(c - a, d - b), n = Math.max(1, Math.ceil(L / 6));
        for (let k = 0; k < n; k++) {
          const t1 = k / n, t2 = (k + 1) / n;
          if (e === gateEdge && Math.abs((t1 + t2) / 2 - gateAt) < 2.5 / L) continue;
          const p1 = [lerp(a, c, t1), lerp(b, d, t1)], p2 = [lerp(a, c, t2), lerp(b, d, t2)];
          const [x1, y1] = P(...p1), [x2, y2] = P(...p2);
          if (!inWorld(x1, y1, 2) && !inWorld(x2, y2, 2)) continue;
          const [x, y] = P((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
          B.push({ shape: 'box', use: 'drystone', mat: 'stone', x, y, angle: th + Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), w: L / n + 0.6, d: 0.7, z0: Math.min(hAt(x1, y1), hAt(x2, y2)), h: range(rng, 0.9, 1.2), roof: 'flat', pitch: 0 });
        }
      });
      if (rng() < 0.5) tree(range(rng, u1 + 4, u2 - 4), range(rng, v1 + 4, v2 - 4), rng() < 0.6 ? 'oak' : 'pine', range(rng, 4, 6.5), range(rng, 9, 14));
      if (rng() < 0.35) well(range(rng, u1 + 3, u2 - 3), range(rng, v1 + 3, v2 - 3));
      if (!GRAZING || rng() < 0.25) return;
      const kind = pick(rng, { sheep: 4, goat: 1.5, cow: 2, horse: 0.7 });
      const herds = kind === 'sheep' || kind === 'goat' ? 1 + (rng() * 2 | 0) : 1;
      for (let hh = 0; hh < herds; hh++) {
        const n = kind === 'sheep' ? 8 + (rng() * 26 | 0) : kind === 'goat' ? 5 + (rng() * 12 | 0) : kind === 'cow' ? 3 + (rng() * 8 | 0) : 2 + (rng() * 5 | 0);
        const spread = kind === 'sheep' ? range(rng, 3, 7) : range(rng, 6, 14), heading = rng() * TAU;
        const cu = range(rng, u1 + spread, u2 - spread), cv = range(rng, v1 + spread, v2 - spread);
        for (let k = 0; k < n; k++) {
          const u = cu + gauss(rng) * spread, v = cv + gauss(rng) * spread * 0.7;
          if (u < u1 + 1 || u > u2 - 1 || v < v1 + 1 || v > v2 - 1) continue;
          const [x, y] = P(u, v);
          if (!inWorld(x, y)) continue;
          out.animals.push({ x, y, z0: hAt(x, y), angle: heading + gauss(rng) * (kind === 'sheep' ? 0.6 : 1.2), kind });
        }
      }
    }

    // and the wild: rocks where the hills are steep or the ground is stony,
    // woods on the hills, poplars by the water, pines and oaks about
    const nWood = perlin(rng), nRock = perlin(rng);
    for (let y = 0; y < H + 6; y += 6) for (let x = 0; x < W + 6; x += 6) {
      const px = x + range(rng, 0, 6), py = y + range(rng, 0, 6);
      if (occ.get(px, py) !== 0 || tsd(px, py) < 18) continue;
      const sl = slopeAt(px, py), stony = smooth(0.22, 0.45, sl) + 0.6 * smooth(0.4, 0.7, fbm(nRock, px / 180, py / 180, 3));
      if (riverD(px, py) > 4 && rng() < 0.045 * stony) {
        // an outcrop: a few boulders together, big and small
        for (let k = 0, n = 1 + (rng() * 6 | 0); k < n; k++) {
          const a = rng() * Math.PI * 2, d = k ? range(rng, 1, 4.5) : 0, bx = px + d * Math.cos(a), by = py + d * Math.sin(a);
          const r = k ? range(rng, 0.5, 1.8) : range(rng, 1.2, 3.2);
          if (occ.get(bx, by) !== 0) continue;
          out.rocks.push({ x: bx, y: by, z0: hAt(bx, by), r, h: r * range(rng, 0.45, 0.9), angle: rng() * Math.PI * 2 });
        }
        occ.disc(px, py, 4, 3);
        continue;
      }
      // bushes: broom, myrtle, juniper, on dry slopes and among the rocks
      if (rng() < 0.03 + 0.12 * smooth(0.1, 0.3, sl) + 0.08 * stony) {
        const r = range(rng, 0.8, 2), h = r * range(rng, 0.9, 1.4);
        if (occ.free(px, py, r * 0.5)) out.trees.push({ x: px, y: py, z0: hAt(px, py), r, h, kind: 'shrub' });
        continue;
      }
      const rd = riverD(px, py), wood = smooth(0.12, 0.5, fbm(nWood, px / 240, py / 240, 3));
      const steep = smooth(0.08, 0.24, slopeAt(px, py)), wet = rd > 1.5 && rd < 16 ? 0.55 : 0;
      const dens = 0.02 + 0.8 * wood + 0.12 * steep + wet;
      if (rng() > dens) continue;
      const kind = wet && rng() < 0.75 ? 'poplar' : pick(rng, { oak: 3 + 3 * wood, pine: 2.5, cypress: 0.6 });
      const r = kind === 'pine' ? range(rng, 4.5, 7) : kind === 'oak' ? range(rng, 3, 5.5) : kind === 'poplar' ? range(rng, 1.8, 2.8) : range(rng, 1.2, 1.9);
      const h = kind === 'pine' ? range(rng, 11, 17) : kind === 'oak' ? range(rng, 7, 12) : kind === 'poplar' ? range(rng, 14, 22) : range(rng, 9, 16);
      if (!occ.free(px, py, r * 0.5)) continue;
      out.trees.push({ x: px, y: py, z0: hAt(px, py), r, h, kind });
    }

    return out;
  }

  return { town, heightAt };
})();
