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
//                        the rise per metre; front, back: the sides its doors are on if they can be,
//                        open: a side without a wall, part: the house it is one part of (a number);
//                        and inside, if it has rooms:
//                        interior { floors: [[s1, t1, s2, t2, kind]], walls: [[s1, t1, s2, t2]],
//                        columns: [[s, t, r]] } all from its corner (s along w, t along d); floors
//                        mosaic, signinum, earth, marble, paving, pool; walls as lines, doorways
//                        and windows left out of them; doors: [[s, t, angle, width]] a leaf from its
//                        hinge; windows: [[s1, t1, s2, t2]]; furniture: [{ k, a, c, w, d } or
//                        { k, a, c, r }] k: bed, couch, table (round?), bench, chest, hearth,
//                        counter (jars), stall, plinth, statue, tribunal, hay, amphora, dolium, grain (a
//                        heap), sacks, woodpile (tall), baskets; goods: a storeroom's (grain, firewood,
//                        hay, jars, produce)
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
//   jets                 [{ x, y, sx, sy, z, h }] water falling into a basin: where it falls in (x, y),
//                        from a spout at (sx, sy) h above the water, its surface at z
//   places               [{ kind, poly, x, y, angle }] the town's public places, their ground: forum,
//                        market, baths, theatre, nymphaeum, temple, horreum
//   (a pasture its gateway too, gateway { a, b, z, inside } the posts the gate hangs between and a
//   point inside; a gate's box the width of its passage, passage; a door, [s, t, angle, width, shut] its
//   angle as it stands, shut its angle closed;
//   a box with rooms says too where it is gone into from outside, entrances [{ s, t, nx, ny, w,
//   kind }] from its corner, nx, ny pointing out, kind front, back or open; its interior, every
//   doorway in its walls, gaps [[s, t, w, ux, uy]], ux, uy along the wall; a pasture its gate,
//   gate [x, y], where the gap is left in its wall)
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
  // whether a point stands on a building, within m of it: a box but not its
  // open court, a round, a theatre's half ring, an amphitheatre
  function onBuilding(b, x, y, m) {
    const dx = x - b.x, dy = y - b.y;
    if (b.shape === 'round') return Math.hypot(dx, dy) < b.r + m;
    const c = Math.cos(b.angle), s = Math.sin(b.angle), a = dx * c + dy * s, d = -dx * s + dy * c;
    if (b.shape === 'box') {
      if (Math.abs(a) > b.w / 2 + m || Math.abs(d) > b.d / 2 + m) return false;
      if (!b.hole) return true;
      const p = a + b.w / 2, q = d + b.d / 2, [s1, t1, s2, t2] = b.hole;
      return !(p > s1 + m && p < s2 - m && q > t1 + m && q < t2 - m);
    }
    if (b.shape === 'cavea') return a > -m && Math.hypot(a, d) < b.r1 + m;
    if (b.shape === 'arena') return (a / (b.a + m)) ** 2 + (d / (b.b + m)) ** 2 < 1;
    return false;
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
    const out = { W, H, river: null, grounds: [], fields: [], roads: [], buildings: [], trees: [], animals: [], rocks: [], lamps: [], jets: [], gates: [], places: [] };

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
      // the side its door is on, if it can be, and another out the back; a
      // side left open; the house it is a part of
      const side = q => q[0] + (q[1] === 'u' ? 'w' : 'd');
      if (p.front) b.front = side(p.front);
      if (p.back) b.back = side(p.back);
      if (p.open) b.open = side(p.open);
      if (p.part) b.part = p.part;
      if (p.goods) b.goods = p.goods;
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
    // water falling from a spout h above it into a basin
    function jet(u, v, su, sv, h, z) {
      const [x, y] = P(u, v), [sx, sy] = P(su, sv);
      out.jets.push({ x, y, sx, sy, z: z ?? hAt(x, y), h });
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
        // the side a roof is low on, '+t' and so on, in the plan (or a door is on)
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
        {
          ground([r[0] + 0.25, r[1] + 0.25, r[2] - 0.25, r[3] - 0.25], 'pool');
          // the spout on the curb at the end by the corner, the water falling a little way in
          const e = along ? [0, -sv] : [-su, 0], L = along ? hd : hw;
          jet(u + e[0] * (L - 0.6), v + e[1] * (L - 0.6), u + e[0] * (L - 0.12), v + e[1] * (L - 0.12), 0.95);
          if (rng() < 0.4) lamp(u, v, 2.6, 0.8);
        }
    }
    const groups = [];
    let parts = 0;
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
    // a public place: its ground, in the world
    function place(kind, r, angle = th) {
      const [x, y] = P((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
      out.places.push({ kind, poly: rectPoly(r), x, y, angle });
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
    // a nymphaeum, on a main street near the middle
    if (rng() < 0.85) {
      const c = blocks.filter(b => free(b) && (b.i === ic - 1 || b.i === ic || b.j === jc - 1 || b.j === jc));
      const b = shuffled(c).sort((p, q) => central(q) - central(p))[0];
      if (b) nymphaeum(group([b], 'nymphaeum'), b);
    }
    // a storehouse, on a main street, the nearest it can be to a gate
    {
      const c = blocks.filter(b => free(b) && (b.i === ic - 1 || b.i === ic || b.j === jc - 1 || b.j === jc) && Math.min(...dims(b.r)) > 26);
      const b = c.sort((p, q) => central(p) - central(q))[0];
      if (b) horreum(group([b], 'horreum'), b);
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
      place('forum', g.r, F.angle('s'));
      const pd = 5.5, shops = S > 46 ? 5 : 0;
      const bD = clamp(0.22 * L, 14, 26), a = bD * 0.26;
      // the basilica across one end: a high nave between lower aisles
      box(F.rect(L - bD + a, 0, L - a, S), { use: 'basilica', h: 13, z0, roof: 'gable', axis: F.axis('t') });
      // (open to the nave, their doors on the square and on the street behind)
      box(F.rect(L - bD, 0, L - bD + a, S), { use: 'basilica', h: 8, z0, roof: 'shed', low: F.low('-s'), front: F.low('-s'), open: F.low('+s') });
      box(F.rect(L - a, 0, L, S), { use: 'basilica', h: 8, z0, roof: 'shed', low: F.low('+s'), front: F.low('+s'), open: F.low('-s') });
      // shops behind porticoes along both sides
      const e = L - bD - 2;
      for (const flip of [false, true]) {
        const t = (t1, t2) => flip ? [S - t2, S - t1] : [t1, t2];
        if (shops) { const [a1, a2] = t(0, shops); box(F.rect(0, a1, e, a2), { use: 'shop', h: 6.5, z0, roof: 'gable', axis: F.axis('s'), front: F.low(flip ? '-t' : '+t') }); }
        const [p1, p2] = t(shops, shops + pd);
        box(F.rect(0, p1, e, p2), { use: 'portico', h: 6, z0, roof: 'shed', low: F.low(flip ? '-t' : '+t') });
      }
      // the Capitolium at the other end, on its podium, facing down the square
      const tw = clamp(0.42 * (S - 2 * (shops + pd)), 10, 21), tl = Math.min(tw * 1.75, 0.38 * L);
      const tc = S / 2;
      box(F.rect(2, tc - tw / 2, 2 + tl, tc + tw / 2), { use: 'temple', h: 13, z0, roof: 'gable', axis: F.axis('s'), pitch: 0.36, front: F.low('+s') });
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
      place('theatre', g.r, F.angle('t'));
      // plane trees in the garden about the seats
      for (let k = 0; k < 40; k++) {
        const s2 = range(rng, 3, L - 3), t2 = range(rng, 11, S - 3);
        if (Math.hypot(s2 - L / 2, t2 - 13.5) < R + 5) continue;
        const [u, v] = F.pt(s2, t2);
        tree(u, v, rng() < 0.75 ? 'plane' : 'cypress', range(rng, 2.5, 4.5), range(rng, 9, 14), true);
      }
      box(F.rect(L / 2 - R - 3, 1, L / 2 + R + 3, 8), { use: 'scaena', h: 15, z0, roof: 'gable', axis: F.axis('s'), front: F.low('+t'), back: F.low('-t') });
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
      place('baths', g.r, F.angle('s'));
      const Lb = clamp(0.52 * L, 16, 42), n = S > 34 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const t1 = k * S / n + 0.5, t2 = (k + 1) * S / n - 0.5;
        const b = box(F.rect(1, t1, Lb, t2), { use: 'baths', h: range(rng, 9, 12), z0, roof: k === n - 1 ? 'hip' : 'gable', axis: F.axis('s'), front: F.low('+s'), back: F.low('-s') }, true);
        if (b && k === 0 && rng() < 0.6) {
          const r = Math.min(t2 - t1, Lb) * 0.3, [ux, uy] = P(...F.pt(Lb / 2, (t1 + t2) / 2));
          B.push({ shape: 'round', use: 'baths', mat: 'tile', x: ux, y: uy, r, z0: z0 + b.h - 1, h: 0, roof: 'dome', pitch: 0.7 });
        }
      }
      const c = F.rect(Lb + 1, 1, L - 1, S - 1);
      box(c, { use: 'palaestra', h: 5.5, z0, roof: 'court', hole: F.rect(Lb + 5.5, 5.5, L - 5.5, S - 5.5), front: F.low('-s'), back: F.low('+s') }, true);
      ground(F.rect(Lb + 5.5, 5.5, L - 5.5, S - 5.5), 'sand', true);
      const pl = (L - Lb - 11) * 0.5, pw = (S - 11) * 0.45, ps = (Lb + L) / 2, pt = S / 2;
      if (pl > 4 && pw > 3) ground(F.rect(ps - pl / 2, pt - pw / 2, ps + pl / 2, pt + pw / 2), 'pool', true);
    }

    // ---- the market: shops round a court, a round pavilion in the middle ----
    function market(g) {
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      const [x, y] = dims(g.r), k = Math.min(9, Math.min(x, y) * 0.28);
      ground(g.r, 'paving', true);
      place('market', g.r);
      const ways = x >= y ? ['-u', '+u'] : ['-v', '+v'];
      box(g.r, { use: 'market', h: 6, z0, roof: 'court', hole: [g.r[0] + k, g.r[1] + k, g.r[2] - k, g.r[3] - k], front: ways[0], back: ways[1] }, true);
      const [mx, my] = P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2);
      B.push({ shape: 'round', use: 'tholos', mat: 'tile', x: mx, y: my, r: Math.min(5.5, Math.min(x, y) * 0.14), z0, h: 5, roof: 'cone', pitch: 0.55 });
    }

    // ---- a storehouse (horreum): storerooms all round a paved court, a
    // way in from the main street wide enough for a cart; each room its
    // one kind of goods, its door on the court: grain, firewood, hay, oil
    // and wine in their jars, the market's produce ----
    function horreum(g, blk) {
      const faces = [];
      if (blk.i === ic - 1) faces.push(['v', true]); if (blk.i === ic) faces.push(['v', false]);
      if (blk.j === jc - 1) faces.push(['u', true]); if (blk.j === jc) faces.push(['u', false]);
      const [along, flipT] = faces[0];
      const F = lf(g.r, along, false, flipT), S = F.S, D = F.D, k = 5.5, gw = 5.5, cw = 4.2, h = 5;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      ground(g.r, 'yard', true);
      place('horreum', g.r, F.angle('t'));
      ground(F.rect(k, k, S - k, D - k), 'paving', true);
      ground(F.rect(S / 2 - gw / 2, 0, S / 2 + gw / 2, k), 'paving', true);
      const GOODS = ['grain', 'firewood', 'hay', 'grain', 'jars', 'produce', 'firewood', 'grain', 'hay', 'produce'];
      let n = 0;
      // a row of rooms between a and b along s (or t), each about cw wide,
      // the end ones wider round the court's corners
      const row = (a, b, room) => { if (b - a < 2.6) return; const m = Math.max(1, Math.round((b - a) / cw)); for (let q = 0; q < m; q++) room(a + (b - a) * q / m, a + (b - a) * (q + 1) / m); };
      const cell = (r, front, low) => box(r, { use: 'horreum', mat: 'tile', h, z0, roof: 'shed', low: F.low(low), front: F.low(front), goods: GOODS[n++ % GOODS.length] }, true);
      // the back: the corners in its end rooms
      const ends = (a, b, t1, t2, front) => {
        cell(F.rect(a, t1, k + 3.4, t2), front, front);
        row(k + 3.4, S - k - 3.4, (s1, s2) => cell(F.rect(s1, t1, s2, t2), front, front));
        cell(F.rect(S - k - 3.4, t1, b, t2), front, front);
      };
      ends(0, S, D - k, D, '-t');
      // the front, either side of the way in
      cell(F.rect(0, 0, k + 3.4, k), '+t', '+t');
      row(k + 3.4, S / 2 - gw / 2, (s1, s2) => cell(F.rect(s1, 0, s2, k), '+t', '+t'));
      row(S / 2 + gw / 2, S - k - 3.4, (s1, s2) => cell(F.rect(s1, 0, s2, k), '+t', '+t'));
      cell(F.rect(S - k - 3.4, 0, S, k), '+t', '+t');
      // the sides
      row(k, D - k, (t1, t2) => { cell(F.rect(0, t1, k, t2), '+s', '+s'); cell(F.rect(S - k, t1, S, t2), '-s', '-s'); });
      lamp(...F.pt(S / 2, k + 0.6), 2.4, 0.9, true);
    }

    // ---- a nymphaeum: the town's grand fountain, a little square open to
    // the main street, at its back a tall apse of marble with wings, columns
    // standing round it in the water, statues in its niches, the water
    // falling into a pool in the apse and a long basin before it; cypresses
    // either side; behind, houses on the next street ----
    function nymphaeum(g, blk) {
      const faces = [];
      if (blk.i === ic - 1) faces.push(['v', true]); if (blk.i === ic) faces.push(['v', false]);
      if (blk.j === jc - 1) faces.push(['u', true]); if (blk.j === jc) faces.push(['u', false]);
      const [along, flipT] = faces[rng() * faces.length | 0];
      const F = lf(g.r, along, false, flipT), S = F.S, D = F.D;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      const Dn = Math.min(D, clamp(S * 0.6, 20, 28)), R = clamp(S * 0.17, 5, 8), sc = S / 2, tA = Dn - R - 2.6;
      const wl = clamp((S - 2 * R) / 2 - 4, 1.5, 5), Wb = 2 * R + 1.4 * wl;
      const W2 = (s, t) => P(...F.pt(s, t));
      ground(F.rect(0, 0, S, Dn), 'paving', true);
      place('nymphaeum', F.rect(0, 0, S, Dn), F.angle('t'));
      // the apse: a half ring of wall, in pieces
      const Rw = R + 0.6, n = Math.ceil(Math.PI * Rw / 2);
      for (let k = 0; k < n; k++) {
        const a1 = Math.PI * k / n, a2 = Math.PI * (k + 1) / n;
        const p1 = W2(sc + Rw * Math.cos(a1), tA + Rw * Math.sin(a1)), p2 = W2(sc + Rw * Math.cos(a2), tA + Rw * Math.sin(a2));
        const [x, y] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        B.push({ shape: 'box', use: 'nymphaeum', mat: 'marble', x, y, angle: Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), w: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + 0.5, d: 1.2, z0, h: 9, roof: 'flat', pitch: 0 });
      }
      // its wings, straight, either side
      for (const sg of [-1, 1]) {
        const s1 = sc + sg * R, s2 = sc + sg * (R + 1.2 + wl);
        box(F.rect(Math.min(s1, s2), tA - 0.2, Math.max(s1, s2), tA + 1.2), { use: 'nymphaeum', mat: 'marble', h: 8, z0 }, true);
      }
      // columns round the apse, in the water, and along the wings
      const column = (s, t) => { const [x, y] = W2(s, t); B.push({ shape: 'round', use: 'column', mat: 'marble', x, y, r: 0.36, z0, h: 7, roof: 'flat', pitch: 0 }); };
      const Rc = R - 1.5, nc = Math.max(4, Math.round(Math.PI * Rc / 2.4));
      for (let k = 0; k <= nc; k++) { const a = Math.PI * k / nc; column(sc + Rc * Math.cos(a), tA + Rc * Math.sin(a)); }
      for (const sg of [-1, 1]) for (let q = 1; R + q * 2.3 < R + 1.2 + wl; q++) column(sc + sg * (R + q * 2.3), tA - 1.2);
      // statues in the niches, between the columns
      for (let k = 0; k < nc; k++) {
        if (k % 2 === 0 && rng() < 0.85) {
          const a = Math.PI * (k + 0.5) / nc, s = sc + (R - 0.5) * Math.cos(a), t = tA + (R - 0.5) * Math.sin(a);
          box(F.rect(s - 0.45, t - 0.45, s + 0.45, t + 0.45), { use: 'statue', h: range(rng, 2.2, 2.8), z0, mat: 'marble' }, true);
        }
      }
      // the water: a pool in the apse, a long basin in front with a curb
      ground(Array.from({ length: 13 }, (_, k) => { const a = Math.PI * k / 12; return F.pt(sc + (R - 0.2) * Math.cos(a), tA + (R - 0.2) * Math.sin(a)); }), 'pool', true);
      const bas = F.rect(sc - Wb / 2, tA - 5.5, sc + Wb / 2, tA - 0.3), hole = [bas[0] + 0.4, bas[1] + 0.4, bas[2] - 0.4, bas[3] - 0.4];
      box(bas, { use: 'fountain', mat: 'marble', h: 0.9, z0, roof: 'court', pitch: 0, hole }, true);
      ground(hole, 'pool', true);
      // the water spouting from the apse's wall between the niches into the
      // pool, and over the basin's back curb into it
      for (let k = 1; k < nc; k += 2) {
        const a = Math.PI * (k + 0.5) / nc, c = Math.cos(a), s = Math.sin(a);
        jet(...F.pt(sc + (R - 1.0) * c, tA + (R - 1.0) * s), ...F.pt(sc + (R - 0.1) * c, tA + (R - 0.1) * s), 2.2, z0);
      }
      for (const f of [-0.3, 0, 0.3]) jet(...F.pt(sc + f * Wb, tA - 1.3), ...F.pt(sc + f * Wb, tA - 0.65), 1.0, z0);
      for (const sg of [-1, 1]) lamp(...F.pt(sc + sg * (Wb / 2 + 0.8), tA - 5.8), 2.4, 1);
      // cypresses either side, and benches of the square
      for (const sg of [-1, 1]) {
        const [u, v] = F.pt(sc + sg * (R + 1.2 + wl + 2.2), tA + 0.6);
        tree(u, v, 'cypress', range(rng, 1.3, 1.7), range(rng, 10, 14), true);
        const s = sc + sg * (Wb / 2 + 3);
        box(F.rect(Math.min(s, s + sg * 0.6), tA - 7, Math.max(s, s + sg * 0.6), tA - 4.4), { use: 'steps', h: 0.45, z0, mat: 'marble' }, true);
      }
      // behind: houses on the next street, or a garden
      const back = F.rect(0, Dn, S, D);
      if (D - Dn < 10) { if (D - Dn > 1) ground(back, 'garden', true); return; }
      ground(back, 'yard', true);
      const FB = lf(back, along, rng() < 0.5, !flipT);
      for (let s = 0; s < FB.S - 0.5;) {
        let w = rng() < 0.6 ? range(rng, 7, 13) : range(rng, 15, 24);
        if (FB.S - s - w < 7) w = FB.S - s;
        lot(FB, s, w, FB.D, central(blk), true);
        s += w;
      }
    }

    // ---- a temple in its precinct, porticoes about it ----
    function temple(g) {
      const [x, y] = dims(g.r), along = x >= y ? 'u' : 'v';
      const F = lf(g.r, along, rng() < 0.5, false), L = F.S, S = F.D;
      const z0 = hAt(...P((g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2));
      const k = 5;
      ground(g.r, 'paving', true);
      place('temple', g.r, F.angle('s'));
      box(F.rect(0.5, 0.5, L - 0.5, S - 0.5), { use: 'portico', h: 5.5, z0, roof: 'court', hole: F.rect(k, k, L - k, S - k), front: F.low('+s') }, true);
      if (rng() < 0.25) {
        const [mx, my] = P(...F.pt(L / 2, S / 2));
        B.push({ shape: 'round', use: 'temple', mat: 'tile', x: mx, y: my, r: Math.min(8, S * 0.2), z0, h: 9, roof: 'cone', pitch: 0.5 });
      } else {
        const tw = clamp(0.36 * S, 8, 16), tl = Math.min(tw * 1.7, L - 2 * k - 12), s0 = (L - tl) / 2 - 2;
        box(F.rect(s0, S / 2 - tw / 2, s0 + tl, S / 2 + tw / 2), { use: 'temple', h: 11, z0, roof: 'gable', axis: F.axis('s'), pitch: 0.36, front: F.low('+s') });
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
    // (none within 2 m of the rectangle kept clear, if there is one)
    function orchard(r, poly, clear) {
      const sp = range(rng, 6, 8), kind = rng() < 0.3 ? 'olive' : 'fruit';
      for (let u = r[0] + sp / 2; u < r[2]; u += sp) for (let v = r[1] + sp / 2; v < r[3]; v += sp) {
        if (rng() >= 0.85) continue;
        const tu = u + range(rng, -0.6, 0.6), tv = v + range(rng, -0.6, 0.6);
        if (clear && tu > clear[0] - 2 && tu < clear[2] + 2 && tv > clear[1] - 2 && tv < clear[3] + 2) continue;
        tree(tu, tv, kind, range(rng, 2, 3.2), range(rng, 4, 6.5), poly);
      }
    }
    function garden(g) {
      const [x, y] = dims(g.r), shed = [g.r[0] + 2, g.r[1] + 2, g.r[0] + 2 + Math.min(10, x / 3), g.r[1] + 2 + Math.min(7, y / 3)];
      ground(g.r, 'garden', true);
      if (rng() < 0.6) orchard(g.r, true, shed);
      else ground(g.r, 'vines', true, { angle: th + (rng() < 0.5 ? 0 : Math.PI / 2) });
      box(shed, { use: 'shed', h: 4, roof: 'gable', axis: 'u' }, true);
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
        return box(R(0, 0, w, D), hole ? { use: 'insula', h, z0, roof: 'court', hole: R(w / 2 - 2.5, D / 2 - 2.5, w / 2 + 2.5, D / 2 + 2.5), front: F.low('-t') } : { use: 'insula', h, z0, roof: 'hip', front: F.low('-t') }, within);
      }
      if (r > 0.9 - 0.12 * (1 - cen)) {
        // a shop on the street, its garden behind it
        const sd = Math.min(d, 6);
        ground(R(0, 0, w, d), 'garden', within);
        if (d - sd > 4) for (let k = 0, n = 1 + (rng() * 3 | 0); k < n; k++) {
          const [u, v] = F.pt(s0 + range(rng, 2, w - 2), range(rng, sd + 2, d - 2));
          tree(u, v, pick(rng, { fruit: 3, olive: 1, cypress: 1, shrub: 1 }), range(rng, 1.5, 3), range(rng, 4, 8), within);
        }
        return box(R(0.5, 0, w - 0.5, sd), { use: 'shop', h: range(rng, 4, 5.5), z0, roof: 'gable', axis: sA, front: F.low('-t') }, within);
      }
      // a house: front rooms on the street, maybe more behind a yard
      // (a door out the back to what is behind it, a house across a yard or a garden)
      const D = Math.min(d, range(rng, 8, 14)), h = range(rng, 5, 8.5), roof = rng() < 0.5 ? 'hip' : 'gable';
      const behind = d - D > 6 ? (rng() < 0.45 ? 'house' : rng() < 0.6 ? 'garden' : null) : null;
      box(R(0, 0, w, D), { use: 'house', h, z0, roof, axis: sA, front: F.low('-t'), back: behind ? F.low('+t') : null }, within);
      if (behind) {
        if (behind === 'house') box(R(0, D + 3, Math.min(w, range(rng, 5, 9)), d - 0.5), { use: 'house', h: h - 1.5, z0, roof: 'shed', low: F.low('+s'), front: F.low('-t') }, within);
        else {
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
      const h = range(rng, 5.5, 7.5), sA = F.axis('s'), tA = F.axis('t'), part = ++parts;
      const f = clamp(d * 0.18, 5, 7.5);
      box(R(0, 0, w, f), { use: 'domus', h, z0, roof: 'gable', axis: sA, front: F.low('-t'), part }, within);
      const A = clamp(Math.min(w - 2, (d - f) * 0.45), 8, 14), sA1 = clamp(w / 2 - A / 2 + range(rng, -2, 2), 0, w - A), sA2 = sA1 + A;
      const o = A * 0.32;
      box(R(sA1, f, sA2, f + A), { use: 'domus', h: h - 0.5, z0, roof: 'court', hole: R(sA1 + o, f + o, sA2 - o, f + A - o), part }, within);
      ground(R(sA1 + o, f + o, sA2 - o, f + A - o), 'floor', within);
      ground(R(sA1 + o + 0.6, f + o + 0.6, sA2 - o - 0.6, f + A - o - 0.6), 'pool', within);
      if (rng() < 0.5) lamp(...F.pt(s0 + sA1 + o + 0.4, f + o + 0.4), 1.6, 0.6, within);
      if (sA1 > 2.5) box(R(0, f, sA1, f + A), { use: 'domus', h: h - 0.3, z0, roof: 'gable', axis: tA, part }, within);
      if (w - sA2 > 2.5) box(R(sA2, f, w, f + A), { use: 'domus', h: h - 0.3, z0, roof: 'gable', axis: tA, part }, within);
      let t = f + A;
      if (d - t < 6) return;
      box(R(0, t, w, t + 5), { use: 'domus', h, z0, roof: 'gable', axis: sA, part }, within);
      t += 5;
      const back = d - t > 22 ? 5 : 0, Pd = d - t - back;
      if (Pd >= 8) {
        // the peristyle, rooms down one side if it is wide
        const side = w > 22 ? 6 : 0, k = Math.min(3.2, Pd * 0.25);
        box(R(0, t, w - side, t + Pd), { use: 'peristyle', h: 4, z0, roof: 'court', hole: R(k, t + k, w - side - k, t + Pd - k), part }, within);
        if (side) box(R(w - side, t, w, t + Pd), { use: 'domus', h: h - 0.5, z0, roof: 'gable', axis: tA, part }, within);
        ground(R(k, t + k, w - side - k, t + Pd - k), 'garden', within);
        const gw = w - side - 2 * k, gd = Pd - 2 * k;
        if (rng() < 0.4 && gw > 6 && gd > 5) ground(R(k + gw * 0.35, t + k + gd * 0.35, k + gw * 0.65, t + k + gd * 0.65), 'pool', within);
        else if (rng() < 0.5) well(...F.pt(s0 + k + 1.3, t + k + 1.3), within);
        for (let n = 0, m = 1 + (rng() * 4 | 0); n < m; n++) {
          const [u, v] = F.pt(s0 + k + range(rng, 1.2, gw - 1.2), t + k + range(rng, 1.2, gd - 1.2));
          tree(u, v, pick(rng, { fruit: 3, shrub: 3, cypress: 1, plane: 1 }), range(rng, 1, 2.6), range(rng, 3, 7), within);
        }
      } else if (Pd > 0) ground(R(0, t, w, t + Pd), 'garden', within);
      if (back) box(R(0, d - back, w, d), { use: 'domus', h: h - 1, z0, roof: 'gable', axis: sA, part }, within);
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
      // each set along the wall where it is: the wall's way there, and out
      const ts = range(rng, 5.5, 7.5), roofed = rng() < 0.6, half = gw / 2 + 1, gs = ts * 1.25, towerD = half + gs / 2 - 0.7;
      const along = gates.map(([gu, gv]) => {
        let kg = 0, bd = Infinity;
        ring.forEach(([u, v], k) => { const d = Math.hypot(u - gu, v - gv); if (d < bd) { bd = d; kg = k; } });
        const p0 = ring[(kg - 4 + n) % n], p1 = ring[(kg + 4) % n], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const tu = (p1[0] - p0[0]) / l, tv = (p1[1] - p0[1]) / l;
        let ou = tv, ov = -tu;
        if (psd(gu + ou, gv + ov) < psd(gu - ou, gv - ov)) { ou = -ou; ov = -ov; }
        return { tu, tv, ou, ov };
      });
      // (the wall running right into the towers either side of a gate)
      const inGate = ([u, v]) => gates.some(([gu, gv]) => Math.hypot(u - gu, v - gv) < towerD);
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
        const nearGate = gates.some(([gu, gv]) => Math.hypot(a[0] - gu, a[1] - gv) < towerD + gs / 2 + 8);
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
      // the gates: an arch over the street, set along the wall, the passage
      // under it as wide as the street, a tower either side against it
      const roundG = rng() < 0.5;
      gates.forEach(([gu, gv, nu, nv], gi) => {
        const { tu, tv, ou, ov } = along[gi], [x, y] = P(gu, gv);
        B.push({ shape: 'box', use: 'gate', mat: 'stone', x, y, angle: th + Math.atan2(tv, tu), w: 2 * half, d: wallT + 3, z0: hAt(x, y), h: wallH + 1, roof: 'flat', pitch: 0, passage: mainW + 1 });
        for (const sg of [-1, 1]) for (const io of [-1, 1]) lamp(gu + tu * sg * (half - 0.8) + ou * io * (wallT / 2 + 2), gv + tv * sg * (half - 0.8) + ov * io * (wallT / 2 + 2), 3.5, 1);
        for (const sg of [-1, 1]) tower(gu + tu * sg * towerD, gv + tv * sg * towerD, ou, ov, gs, roundG);
        out.gates.push({ x, y, angle: th + Math.atan2(nv, nu) });
      });
    }

    // ================= the country about =================
    const inWorld = (x, y, m = 0) => x >= -m && y >= -m && x <= W + m && y <= H + m;
    // where the country's tracks are to go: the farms, the pastures' gates (the fields are added later)
    const reach = [];
    if (river) {
      const P2 = river.points;
      for (let k = 0; k + 1 < P2.length; k++) occ.seg(P2[k][0], P2[k][1], P2[k + 1][0], P2[k + 1][1], river.width / 2 + 3, 3);
    }

    // the roads out of the gates, paved, wandering a little
    const nRoad = perlin(rng), viaOcc = occupancy(W, H);
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
      for (let k = 0; k + 1 < pts.length; k++) {
        occ.seg(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], width / 2 + 1.5, 2);
        viaOcc.seg(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], width / 2 + 1.5, 1);
      }
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
      box([u - A / 2, v - Bd / 2, u + A / 2, v + Bd / 2], { use: 'villa', h: 6, z0, roof: 'court', hole: [u - A / 2 + k, v - Bd / 2 + k, u + A / 2 - k, v + Bd / 2 - k], front: '+u' });
      ground([u - A / 2 + k, v - Bd / 2 + k, u + A / 2 - k, v + Bd / 2 - k], 'yard');
      well(u + range(rng, -2, 2), v + range(rng, -2, 2));
      lamp(u - A / 2 + k + 0.8, v, 2.2, 0.8);
      const bx = u + A / 2 + 8, barn = [bx, v - Bd / 2, bx + 9, v - Bd / 2 + range(rng, 16, 26)];
      box(barn, { use: 'barn', h: 6.5, z0: hAt(...P(bx + 4, v)), roof: 'gable', axis: 'v', front: '-u' });
      reach.push({ at: [P(u + A / 2 + 4, v)], kind: 'farm' });
      // the hay stacked by the barn
      for (let q = 0, n = rng() * 4 | 0; q < n; q++) haystack(...P(bx + 9 + 4.5 + q * range(rng, 5.5, 7), barn[1] + range(rng, 3, barn[3] - barn[1] - 3)));
      const orch = [u - A / 2 - 6, v + Bd / 2 + 2, u + A / 2, v + Bd / 2 + 16];
      ground(orch, 'garden');
      for (let q = 0; q < 6; q++) tree(u - A / 2 - 6 + range(rng, 2, A + 4), v + Bd / 2 + range(rng, 4, 14), 'fruit', range(rng, 2, 3), range(rng, 4, 6));
      if (rng() < 0.7) tree(u - A / 2 - 5, v - Bd / 2 - 5, 'pine', range(rng, 5, 7), range(rng, 12, 16));
      occ.disc(x, y, 38, 3);
      for (const r of [barn, orch]) occ.poly(rectPoly([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3]), 3);
      occ.disc(...P(u - A / 2 - 5, v - Bd / 2 - 5), 5, 3);
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

    // a haystack, a beehive of hay on the ground
    function haystack(x, y) {
      const r = range(rng, 1.7, 2.6);
      B.push({ shape: 'round', use: 'haystack', mat: 'hay', x, y, r, z0: hAt(x, y) - 0.15, h: 0.45, roof: 'dome', pitch: range(rng, 1.15, 1.55) });
      occ.disc(x, y, r + 0.5, 3);
    }

    // the centuriation: fields on the town's own grid
    const Gu = range(rng, 60, 95), Gv = range(rng, 60, 95);
    const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => T.loc(x, y));
    const uMin = Math.min(...corners.map(c => c[0])), uMax = Math.max(...corners.map(c => c[0]));
    const vMin = Math.min(...corners.map(c => c[1])), vMax = Math.max(...corners.map(c => c[1]));
    const kU0 = Math.floor((uMin - u0) / Gu), kU1 = Math.ceil((uMax - u0) / Gu);
    const kV0 = Math.floor((vMin - v0) / Gv), kV1 = Math.ceil((vMax - v0) / Gv);

    const slopeAt = (x, y) => Math.hypot(hAt(x + 3, y) - hAt(x - 3, y), hAt(x, y + 3) - hAt(x, y - 3)) / 6;
    const nCrop = perlin(rng), pastureList = [];
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
      for (const r of parcels) parcel(r, 0, [cu1, cv1, cu1 + Gu, cv1 + Gv]);
    }
    // the pastures walled once all the fields are laid out, so each gate
    // can face open ground or a road, not the next field
    for (const [pr, f] of pastureList) pasture(pr, f);
    // A parcel: tilled where it is level enough, grazed where it is steeper,
    // halved and halved again to fit round what is in its way. Set back
    // further from the square's own edges: lanes along the surveyor's lines,
    // wide enough for a cart between two walls
    function parcel(r, depth, sq) {
      const m = (a, b) => Math.abs(a - b) < 0.01 ? 3.2 : 1.2;
      const pr = [r[0] + m(r[0], sq[0]), r[1] + m(r[1], sq[1]), r[2] - m(r[2], sq[2]), r[3] - m(r[3], sq[3])];
      let hard = 0, steep = 0, seen = 0;
      for (const fu of [0.1, 0.5, 0.9]) for (const fv of [0.1, 0.5, 0.9]) {
        const [x, y] = P(lerp(pr[0], pr[2], fu), lerp(pr[1], pr[3], fv));
        if (!inWorld(x, y)) continue;
        seen++;
        const sl = slopeAt(x, y);
        if (tsd(x, y) < 20 || sl > 0.42) hard++;
        else if (sl > 0.2) steep++;
      }
      if (!seen) return;
      // anything already there, a tomb, a cypress, a farm, another field, a
      // road, looked for every few metres, not to be walled or ploughed over
      if (!hard) {
        const nu = Math.ceil((pr[2] - pr[0]) / 3), nv = Math.ceil((pr[3] - pr[1]) / 3);
        for (let i = 0; i <= nu && !hard; i++) for (let j = 0; j <= nv; j++) {
          const p = P(lerp(pr[0], pr[2], i / nu), lerp(pr[1], pr[3], j / nv)), o = occ.get(...p);
          if (o === 3 || o === 1 || viaOcc.get(...p) === 1) { hard++; break; }
        }
      }
      if (hard) {
        if (depth < 2 && Math.min(r[2] - r[0], r[3] - r[1]) > 22) {
          const mu = lerp(r[0], r[2], range(rng, 0.4, 0.6)), mv = lerp(r[1], r[3], range(rng, 0.4, 0.6));
          for (const q of [[r[0], r[1], mu, mv], [mu, r[1], r[2], mv], [r[0], mv, mu, r[3]], [mu, mv, r[2], r[3]]]) parcel(q, depth + 1, sq);
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
      // haystacks: the hay where it was mown, in a loose row down the field;
      // one or a few in a meadow, the straw in a stubble field, the winter's
      // feed in a pasture now and then
      const stacks = crop === 'hay' ? 3 + (rng() * 6 | 0) : (crop === 'meadow' || crop === 'stubble') && rng() < 0.6 ? 1 + (rng() * 3 | 0)
        : crop === 'pasture' && rng() < 0.25 ? 1 + (rng() * 2 | 0) : 0;
      if (stacks && Math.min(pr[2] - pr[0], pr[3] - pr[1]) > 9) {
        const S = longU ? pr[3] - pr[1] : pr[2] - pr[0], row = range(rng, 0.3, 0.7) * S, put = [];
        for (let q = 0, tries = 0; q < stacks && tries < 40; tries++) {
          let u = range(rng, pr[0] + 4, pr[2] - 4), v = range(rng, pr[1] + 4, pr[3] - 4);
          if (crop === 'hay') { if (longU) v = pr[1] + row + range(rng, -2, 2); else u = pr[0] + row + range(rng, -2, 2); }
          const [x, y] = P(u, v);
          if (!inWorld(x, y, -3) || !occ.free(x, y, 3, 1) || put.some(([a, b]) => Math.hypot(a - x, b - y) < 8)) continue;
          haystack(x, y);
          put.push([x, y]);
          q++;
        }
      }
      if (crop === 'pasture') pastureList.push([pr, out.fields[out.fields.length - 1]]);
    }
    // a pasture: a dry-stone wall about it, a gap for a gate, a shade tree, a
    // trough's well maybe, and a flock or a herd
    function pasture(pr, field) {
      const [u1, v1, u2, v2] = pr, edges = [[u1, v1, u2, v1], [u2, v1, u2, v2], [u2, v2, u1, v2], [u1, v2, u1, v1]];
      // its gate on a side open to the country or a road, not on the next field, if it can be
      // how far out from where the gate would be it is clear of fields and walls
      const first = rng() * 4 | 0, gateAt = range(rng, 0.2, 0.8);
      const clear = e => {
        const [a, b, c, d] = edges[e], n = e % 2 === 0 ? [0, e === 0 ? -1 : 1] : [e === 1 ? 1 : -1, 0], gu = lerp(a, c, gateAt), gv = lerp(b, d, gateAt);
        let o = 1.5;
        for (; o <= 12; o += 1.5) { const q = occ.get(...P(gu + n[0] * o, gv + n[1] * o)); if (q === 1 || q === 3) break; }
        return o;
      };
      const order = [0, 1, 2, 3].map(k => (first + k) % 4);
      const gateEdge = order.find(e => clear(e) > 12) ?? order.reduce((p, q) => clear(q) > clear(p) ? q : p);
      // the gate in the middle of the stretch of wall it falls in, that stretch left out
      const gL = Math.hypot(edges[gateEdge][2] - edges[gateEdge][0], edges[gateEdge][3] - edges[gateEdge][1]), gn = Math.max(1, Math.ceil(gL / 6));
      const gk = Math.min(gn - 1, Math.floor(gateAt * gn)), gateMid = (gk + 0.5) / gn;
      {
        // a track to the gate, from outside it
        const [a, b, c, d] = edges[gateEdge], gu = lerp(a, c, gateMid), gv = lerp(b, d, gateMid);
        const mu = (u1 + u2) / 2, mv = (v1 + v2) / 2;
        const n = gateEdge % 2 === 0 ? [0, Math.sign(gv - mv)] : [Math.sign(gu - mu), 0];
        reach.push({ at: [1.5, 2.5, 3.5].map(o => P(gu + n[0] * o, gv + n[1] * o)), end: P(gu, gv), kind: 'gate' });
        field.gate = P(gu, gv);
      }
      let gap = null;
      edges.forEach(([a, b, c, d], e) => {
        const L = Math.hypot(c - a, d - b), n = Math.max(1, Math.ceil(L / 6));
        for (let k = 0; k < n; k++) {
          const t1 = k / n, t2 = (k + 1) / n;
          if (e === gateEdge && k === gk) {
            // (the gap left for the gate)
            gap = gap ? [Math.min(gap[0], t1), Math.max(gap[1], t2), e] : [t1, t2, e];
            continue;
          }
          const p1 = [lerp(a, c, t1), lerp(b, d, t1)], p2 = [lerp(a, c, t2), lerp(b, d, t2)];
          const [x1, y1] = P(...p1), [x2, y2] = P(...p2);
          if (!inWorld(x1, y1, 2) && !inWorld(x2, y2, 2)) continue;
          const [x, y] = P((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
          B.push({ shape: 'box', use: 'drystone', mat: 'stone', x, y, angle: th + Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), w: L / n + 0.6, d: 0.7, z0: Math.min(hAt(x1, y1), hAt(x2, y2)), h: range(rng, 0.9, 1.2), roof: 'flat', pitch: 0 });
          // nothing wild to grow up through the wall
          occ.seg(x1, y1, x2, y2, 1.5, 2);
        }
      });
      // the gate: two wooden posts either side of the gap, the gate between,
      // a leaf, or two if it is wide, hung on them
      if (gap) {
        const [a, b, c, d] = edges[gap[2]], g1 = P(lerp(a, c, gap[0]), lerp(b, d, gap[0])), g2 = P(lerp(a, c, gap[1]), lerp(b, d, gap[1]));
        const ang = Math.atan2(g2[1] - g1[1], g2[0] - g1[0]);
        for (const [x, y] of [g1, g2]) B.push({ shape: 'box', use: 'gatepost', mat: 'timber', x, y, angle: ang, w: 0.28, d: 0.28, z0: hAt(x, y), h: 1.35, roof: 'flat', pitch: 0 });
        const [mu, mv] = [(u1 + u2) / 2, (v1 + v2) / 2];
        field.gateway = { a: g1, b: g2, z: Math.min(hAt(...g1), hAt(...g2)), inside: P(mu, mv) };
      }
      // the shade tree well inside, on open grass, and the well clear of it
      let shade = null;
      if (rng() < 0.5) {
        const u = range(rng, u1 + 6, u2 - 6), v = range(rng, v1 + 6, v2 - 6), r = range(rng, 4, 6.5), kind = rng() < 0.6 ? 'oak' : 'pine';
        if (u1 + 6 < u2 - 6 && v1 + 6 < v2 - 6 && occ.free(...P(u, v), 2, 1)) { tree(u, v, kind, r, range(rng, 9, 14)); shade = [u, v]; }
      }
      if (rng() < 0.35) {
        const u = range(rng, u1 + 3, u2 - 3), v = range(rng, v1 + 3, v2 - 3);
        if ((!shade || Math.hypot(u - shade[0], v - shade[1]) > 5) && occ.free(...P(u, v), 2, 1)) well(u, v);
      }
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

    // ---- the tracks: earth, worn from the roads out to the farms, the
    // pastures' gates and the fields, the cheapest way over the ground: along
    // the strips between the fields rather than over them, round the hills
    // rather than up them, round the walls and the tombs, never over the
    // river but by the bridges; wandering a little where nothing steers
    // them, and joining one another where they can ----
    {
      const C = 1, nx = Math.ceil(W / C), ny = Math.ceil(H / C), N = nx * ny;
      const cost = new Float32Array(N), nTrack = perlin(rng);
      const cx2 = i => (i + 0.5) * C;
      // the lie of the ground, and what steers a track, a few metres a cell
      const G = 4, gx = Math.ceil(W / G) + 1, gy = Math.ceil(H / G) + 1, lie = new Float32Array(gx * gy);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const x = (i + 0.5) * G, y = (j + 0.5) * G;
        lie[j * gx + i] = 1 + 14 * slopeAt(x, y) + 1.2 * Math.max(0, fbm(nTrack, x / 70, y / 70, 2) + 0.5);
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = cx2(i), y = cx2(j), k = j * nx + i;
        if (tsd(x, y) < 14) { cost[k] = Infinity; continue; }
        cost[k] = lie[Math.floor(y / G) * gx + Math.floor(x / G)];
      }
      // a field dear to cross, and its edge (a track keeps off the crop)
      for (const f of out.fields) {
        const xs = f.poly.map(p => p[0]), ys = f.poly.map(p => p[1]), n = f.poly.length;
        const ccw = Math.sign(area(f.poly)) || 1;
        for (let j = Math.max(0, Math.floor((Math.min(...ys) - 1) / C)); j <= Math.min(ny - 1, (Math.max(...ys) + 1) / C); j++)
          for (let i = Math.max(0, Math.floor((Math.min(...xs) - 1) / C)); i <= Math.min(nx - 1, (Math.max(...xs) + 1) / C); i++) {
            const x = cx2(i), y = cx2(j);
            let out2 = -Infinity;
            for (let q = 0; q < n; q++) {
              const a = f.poly[q], b = f.poly[(q + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
              out2 = Math.max(out2, ccw * ((x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])) / L);
            }
            const k = j * nx + i;
            // (no track over a pasture's wall or across it)
            if (f.crop === 'pasture' && out2 < 0.6) cost[k] = Infinity;
            else if (out2 < 1 && cost[k] !== Infinity && !(cost[k] > 8)) cost[k] *= 9;
          }
      }
      // the river, and whatever is built out here (a field's wall too, but for its gate)
      if (river) for (let q = 0; q + 1 < river.points.length; q++) {
        const [a, e] = [river.points[q], river.points[q + 1]], m = river.width / 2 + 2;
        for (let j = Math.max(0, Math.floor((Math.min(a[1], e[1]) - m) / C)); j <= Math.min(ny - 1, (Math.max(a[1], e[1]) + m) / C); j++)
          for (let i = Math.max(0, Math.floor((Math.min(a[0], e[0]) - m) / C)); i <= Math.min(nx - 1, (Math.max(a[0], e[0]) + m) / C); i++)
            if (distSeg(cx2(i), cx2(j), a[0], a[1], e[0], e[1])[0] < m) cost[j * nx + i] = Infinity;
      }
      for (const b of B) {
        if (b.shape === 'box' && b.use === 'bridge') continue;
        const R = b.shape === 'box' ? Math.hypot(b.w, b.d) / 2 : b.shape === 'round' ? b.r : b.shape === 'cavea' ? b.r1 : Math.max(b.a, b.b);
        if (tsd(b.x, b.y) < -R) continue;
        for (let j = Math.max(0, Math.floor((b.y - R - 1) / C)); j <= Math.min(ny - 1, (b.y + R + 1) / C); j++)
          for (let i = Math.max(0, Math.floor((b.x - R - 1) / C)); i <= Math.min(nx - 1, (b.x + R + 1) / C); i++)
            if (onBuilding(b, cx2(i), cx2(j), b.use === 'drystone' ? 2 : 1.6)) cost[j * nx + i] = Infinity;
      }
      // from the paved roads outwards, and from every track once it is made
      const dist = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
      // the cells still to go on from, in buckets by how far they are, half a step each
      const BW = 0.5, buckets = [];
      let cur = 0, queued = 0;
      const push = (k, d) => { const b = (d / BW) | 0; (buckets[b] || (buckets[b] = [])).push(k); queued++; if (b < cur) cur = b; };
      const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
      const DK = DI.map((di, q) => di + DJ[q] * nx);
      // (the world's edge not to be gone past)
      for (let i = 0; i < nx; i++) cost[i] = cost[(ny - 1) * nx + i] = Infinity;
      for (let j = 0; j < ny; j++) cost[j * nx] = cost[j * nx + nx - 1] = Infinity;
      // outwards from the sources; but no further than reach from them, if given
      const spread = (reach = Infinity) => {
        while (queued) {
          while (!buckets[cur] || !buckets[cur].length) cur++;
          const k = buckets[cur].pop(), d = dist[k];
          queued--;
          if (((d / BW) | 0) !== cur) continue;
          const ck = cost[k];
          for (let q = 0; q < 8; q++) {
            const k2 = k + DK[q], c = cost[k2];
            if (c === Infinity) continue;
            // not between two corners
            if (q >= 4 && (cost[k + DI[q]] === Infinity || cost[k + DJ[q] * nx] === Infinity)) continue;
            const d2 = d + DL[q] * C * (ck + c) / 2;
            if (d2 < dist[k2] && d2 < reach) { dist[k2] = d2; from[k2] = k; push(k2, d2); }
          }
        }
      };
      const source = k => { if (cost[k] !== Infinity) { dist[k] = 0; from[k] = -1; push(k, 0); } };
      for (const road of out.roads) for (let q = 0; q + 1 < road.points.length; q++) {
        const [a, b] = [road.points[q], road.points[q + 1]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / C);
        for (let m = 0; m <= n; m++) {
          const x = lerp(a[0], b[0], m / n), y = lerp(a[1], b[1], m / n), i = Math.floor(x / C), j = Math.floor(y / C);
          if (i >= 0 && j >= 0 && i < nx && j < ny && tsd(x, y) > 14) source(j * nx + i);
        }
      }
      spread();
      // the fields too, from wherever along their edges is nearest
      for (const f of out.fields) {
        if (f.crop === 'pasture') continue;
        const mx = f.poly.reduce((a, p) => a + p[0], 0) / f.poly.length, my = f.poly.reduce((a, p) => a + p[1], 0) / f.poly.length, at = [];
        f.poly.forEach((p, q) => {
          const e = f.poly[(q + 1) % f.poly.length], L = Math.hypot(e[0] - p[0], e[1] - p[1]);
          let nxv = -(e[1] - p[1]) / L, nyv = (e[0] - p[0]) / L;
          if (nxv * ((p[0] + e[0]) / 2 - mx) + nyv * ((p[1] + e[1]) / 2 - my) < 0) { nxv = -nxv; nyv = -nyv; }
          for (let t = 3; t < L - 3; t += 3) for (const o of [1.6, 2.6, 3.4]) at.push([lerp(p[0], e[0], t / L) + nxv * o, lerp(p[1], e[1], t / L) + nyv * o]);
        });
        reach.push({ at, kind: 'field' });
      }
      const cellAt = ([x, y]) => { const i = Math.floor(x / C), j = Math.floor(y / C); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
      const best = r => {
        let k0 = -1;
        for (const p of r.at) {
          const k = cellAt(p);
          if (k >= 0 && dist[k] < (k0 < 0 ? Infinity : dist[k0])) k0 = k;
        }
        return k0;
      };
      const tracks = [], onTrack = new Uint8Array(N);
      for (const r of reach.map(r => [r, dist[best(r)] ?? Infinity]).sort((p, q) => p[1] - q[1]).map(p => p[0])) {
        const k0 = best(r);
        if (k0 < 0 || dist[k0] === Infinity) continue;
        // a field by a track already, or a road, needs none of its own
        if (dist[k0] < (r.kind === 'field' ? 40 : 3)) continue;
        const path = [];
        for (let k = k0; k >= 0; k = from[k]) path.push(k);
        if (path.length < 3) continue;
        // the ground about it now nearer a track than it was: the next ones near it join it
        for (const k of path) { onTrack[k] = 1; source(k); }
        spread(90);
        tracks.push({ path: path.reverse(), kind: r.kind, end: r.end });
      }
      // each a line through its cells, rounded off, a little narrower out to a field
      for (const t of tracks) {
        let pts = t.path.filter((_, q) => q % 3 === 0 || q === t.path.length - 1).map(k => [cx2(k % nx), cx2((k / nx) | 0)]);
        for (let it = 0; it < 2; it++) {
          const sm = [pts[0]];
          for (let q = 0; q + 1 < pts.length; q++) {
            const [a, b] = [pts[q], pts[q + 1]];
            sm.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)], [lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
          }
          sm.push(pts[pts.length - 1]);
          pts = sm;
        }
        // on through the gate
        if (t.end) pts.push(t.end);
        const width = t.kind === 'field' ? range(rng, 2.4, 2.8) : range(rng, 2.8, 3.2);
        out.roads.push({ points: pts, width, kind: 'track' });
        for (let q = 0; q + 1 < pts.length; q++) occ.seg(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], width / 2 + 0.5, 2);
      }
      // nothing left growing in a track
      out.trees = out.trees.filter(t => {
        const k = cellAt([t.x, t.y]);
        if (k < 0) return true;
        const i = k % nx, j = (k / nx) | 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const i2 = i + di, j2 = j + dj;
          if (i2 >= 0 && j2 >= 0 && i2 < nx && j2 < ny && onTrack[j2 * nx + i2]) return false;
        }
        return true;
      });
    }

    // and the wild: rocks where the hills are steep or the ground is stony,
    // woods on the hills, poplars by the water, pines and oaks about
    const nWood = perlin(rng), nRock = perlin(rng);
    for (let y = 0; y < H + 6; y += 6) for (let x = 0; x < W + 6; x += 6) {
      const px = x + range(rng, 0, 6), py = y + range(rng, 0, 6);
      if (occ.get(px, py) !== 0 || tsd(px, py) < 18) continue;
      const sl = slopeAt(px, py), stony = smooth(0.22, 0.45, sl) + 0.6 * smooth(0.4, 0.7, fbm(nRock, px / 180, py / 180, 3));
      if (riverD(px, py) > 4 && rng() < 0.012 * stony) {
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

    // no tree growing up through a roof, a wall, a well or a tomb, whatever
    // set it there: a trunk wants a metre clear about it (or half that, a bush's)
    {
      const cell = 24, grid = new Map(), key = (i, j) => i * 4096 + j;
      for (const b of B) {
        const R = b.shape === 'round' ? b.r : b.shape === 'box' ? Math.hypot(b.w, b.d) / 2 : b.shape === 'cavea' ? b.r1 : Math.max(b.a, b.b);
        for (let i = Math.floor((b.x - R - 1) / cell); i <= Math.floor((b.x + R + 1) / cell); i++)
          for (let j = Math.floor((b.y - R - 1) / cell); j <= Math.floor((b.y + R + 1) / cell); j++) {
            const k = key(i, j);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(b);
          }
      }
      out.trees = out.trees.filter(t => {
        const m = t.kind === 'shrub' ? 0.5 : 1;
        return !(grid.get(key(Math.floor(t.x / cell), Math.floor(t.y / cell))) || []).some(b => onBuilding(b, t.x, t.y, m));
      });
    }

    // and inside every building with rooms: its rooms, its doors, its furniture
    inhabit(rng, B, out.lamps);

    return out;
  }

  // ---- inside the buildings: rooms, their floors, the walls between with
  // doors through them, columns where roofs stood on them ----
  // (how big a room is, about, and its floor)
  const ROOMS = {
    house: [24, 'signinum'], domus: [26, 'mosaic'], shop: [40, 'earth'], insula: [22, 'signinum'], villa: [30, 'earth'],
    barn: [70, 'earth'], shed: [30, 'earth'], baths: [55, 'mosaic'], scaena: [45, 'marble'],
    basilica: [0, 'marble'], temple: [0, 'marble'],
    portico: [0, 'paving'], peristyle: [0, 'mosaic'], palaestra: [0, 'paving'], market: [0, 'paving'], horreum: [0, 'signinum'],
  };
  const DOOR = 1.1;
  // what a door can't open onto: anything walled and higher than a man (an
  // open colonnade, a temple's, a stage, steps, a field wall can be walked
  // past or up onto)
  const OPEN = new Set(['stage', 'steps', 'altar', 'statue', 'fountain', 'drystone', 'well', 'bridge', 'temple']);
  const solid = b => b.h >= 2.5 && !OPEN.has(b.use) && !(b.use === 'portico' && !b.hole) && !(b.use === 'basilica' && b.roof === 'gable');
  // a box's four sides: '-d' along its corner's edge (t = 0), '+w' (s = w),
  // '+d' (t = d), '-w' (s = 0); each by its own coordinate along it, s or t
  const SIDES = ['-d', '+w', '+d', '-w'];
  const sideLen = (b, side) => side[1] === 'd' ? b.w : b.d;
  const sidePt = (b, side, p, off) => side === '-d' ? [p, -off] : side === '+d' ? [p, b.d + off] : side === '-w' ? [-off, p] : [b.w + off, p];
  const sideLine = (b, side) => side === '-d' ? [0, 0, b.w, 0] : side === '+d' ? [0, b.d, b.w, b.d] : side === '-w' ? [0, 0, 0, b.d] : [b.w, 0, b.w, b.d];
  // a room's stretch of a side, if it is on it
  const onSide = (b, r, side) => side === '-d' ? (r[1] === 0 ? [r[0], r[2]] : null) : side === '+d' ? (r[3] === b.d ? [r[0], r[2]] : null)
    : side === '-w' ? (r[0] === 0 ? [r[1], r[3]] : null) : (r[2] === b.w ? [r[1], r[3]] : null);
  const toWorld = (b, s, t) => {
    const c = Math.cos(b.angle), sn = Math.sin(b.angle);
    return [b.x + (s - b.w / 2) * c - (t - b.d / 2) * sn, b.y + (s - b.w / 2) * sn + (t - b.d / 2) * c];
  };

  // the rooms of a building: its floor halved and halved again, and where
  // each split runs (s or t its line, lo to hi along it); a court's ring, a
  // hall, one room; bare, what has no walls round it to go in through
  function plan(rng, b) {
    const spec = ROOMS[b.use], W = b.w, D = b.d;
    const P = { leaves: [[0, 0, W, D]], splits: [], open: { '-d': [], '+w': [], '+d': [], '-w': [] }, free: {} };
    P.bare = b.use === 'temple' || (b.use === 'portico' && !b.hole) || (b.use === 'basilica' && b.roof === 'gable');
    if (P.bare || (b.roof === 'court' && b.hole) || !spec[0]) return P;
    P.leaves = [];
    const stack = [[0, 0, W, D]];
    while (stack.length) {
      const r = stack.pop(), w = r[2] - r[0], d = r[3] - r[1];
      if (w * d <= spec[0] * range(rng, 0.7, 1.4) || Math.max(w, d) < 4.5) { P.leaves.push(r); continue; }
      if (w >= d) {
        const x = r[0] + w * range(rng, 0.35, 0.65);
        stack.push([r[0], r[1], x, r[3]], [x, r[1], r[2], r[3]]);
        P.splits.push({ s: x, lo: r[1], hi: r[3] });
      } else {
        const y = r[1] + d * range(rng, 0.35, 0.65);
        stack.push([r[0], r[1], r[2], y], [r[0], y, r[2], r[3]]);
        P.splits.push({ t: y, lo: r[0], hi: r[2] });
      }
    }
    return P;
  }
  // the rooms either side of a split, and the stretch of it each two share
  function across(P, sp) {
    const v = sp.s !== undefined, at = v ? sp.s : sp.t, out = [];
    const lo = r => v ? r[1] : r[0], hi = r => v ? r[3] : r[2];
    const on = r => lo(r) < sp.hi && hi(r) > sp.lo;
    const A = P.leaves.filter(r => (v ? r[2] : r[3]) === at && on(r)), C = P.leaves.filter(r => (v ? r[0] : r[1]) === at && on(r));
    for (const a of A) for (const c of C) {
      const l = Math.max(lo(a), lo(c), sp.lo), h = Math.min(hi(a), hi(c), sp.hi);
      if (h - l > 0.05) out.push({ sp, lo: l, hi: h, a, c });
    }
    return out;
  }
  // where along a side a door can go: within one room's stretch of it, m
  // clear of the walls at its ends; and, going out, where it is clear outside
  const segs = (b, P, side, m) => P.leaves.map(r => onSide(b, r, side)).filter(q => q && q[1] - q[0] > 2 * m).map(q => [q[0] + m, q[1] - m]);
  function clearSegs(b, P, side, m) {
    const out = [];
    for (const [a, c] of segs(b, P, side, m)) for (const [f1, f2] of P.free[side]) {
      const lo = Math.max(a, f1 + 0.15), hi = Math.min(c, f2 - 0.15);
      if (hi > lo) out.push([lo, hi]);
    }
    return out;
  }
  // somewhere along [lo, hi] for an opening w wide, about the middle
  const within = (rng, lo, hi, w) => (lo + hi) / 2 + (rng() - 0.5) * Math.max(0, hi - lo - w) * 0.7;
  const shuffle = (rng, a) => { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [c[i], c[j]] = [c[j], c[i]]; } return c; };

  // every building with rooms: first its rooms; then what is outside each
  // wall, open ground or another building; the doors between the parts of
  // one house, through the walls they share, enough to go all through it;
  // a way in from outside for each house, its front door where it should
  // be if it can be, another out the back; last its walls, windows and
  // furniture
  function inhabit(rng, B, lamps) {
    const plans = new Map();
    for (const b of B) if (b.shape === 'box' && ROOMS[b.use]) plans.set(b, plan(rng, b));
    const walled = [...plans].filter(([, P]) => !P.bare);
    // what stands about, by cells
    const cell = 16, grid = new Map(), key = (i, j) => i * 4099 + j;
    for (const o of B) {
      if (!solid(o) && o.use !== 'fountain' && o.use !== 'well') continue; // (nor a door onto a fountain or a well)
      const R = o.shape === 'box' ? Math.hypot(o.w, o.d) / 2 : o.shape === 'round' ? o.r : o.shape === 'cavea' ? o.r1 : Math.max(o.a, o.b);
      for (let i = Math.floor((o.x - R - 1) / cell); i <= Math.floor((o.x + R + 1) / cell); i++)
        for (let j = Math.floor((o.y - R - 1) / cell); j <= Math.floor((o.y + R + 1) / cell); j++) {
          const k = key(i, j);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(o);
        }
    }
    for (const [b] of walled) b.entrances = [];
    // a way in, from its corner: where, which way out, how wide
    const NRM = { '-d': [0, -1], '+d': [0, 1], '-w': [-1, 0], '+w': [1, 0] };
    const entrance = (b, side, p, w, kind) => {
      const [s, t] = sidePt(b, side, p, 0);
      b.entrances.push({ s, t, nx: NRM[side][0], ny: NRM[side][1], w, kind });
    };
    // (a fountain or a well whole, its basin too)
    const whole = o => o.use === 'fountain' || o.use === 'well' ? { ...o, hole: null } : o;
    const blocked = (self, x, y) => (grid.get(key(Math.floor(x / cell), Math.floor(y / cell))) || []).some(o => o !== self && onBuilding(whole(o), x, y, 0.2));
    // along each side, where it is clear just outside
    for (const [b, P] of walled) for (const side of SIDES) {
      const L = sideLen(b, side), iv = [];
      let start = null, end = null;
      for (let p = 0.1; p <= L - 0.1 + 1e-9; p += 0.25) {
        if (!blocked(b, ...toWorld(b, ...sidePt(b, side, p, 0.6)))) { if (start === null) start = p; end = p; }
        else if (start !== null) { iv.push([start, end]); start = null; }
      }
      if (start !== null) iv.push([start, end]);
      P.free[side] = iv;
    }

    // the parts of a house that share a wall, and where a door can go through it
    function shared(b1, b2) {
      if (Math.abs(b1.angle - b2.angle) > 1e-6) return null;
      const c = Math.cos(b1.angle), sn = Math.sin(b1.angle), dx = b2.x - b1.x, dy = b2.y - b1.y;
      const os = dx * c + dy * sn + b1.w / 2 - b2.w / 2, ot = -dx * sn + dy * c + b1.d / 2 - b2.d / 2;
      let side1, side2, off;
      if (Math.abs(ot + b2.d) < 0.3) [side1, side2, off] = ['-d', '+d', os];
      else if (Math.abs(ot - b1.d) < 0.3) [side1, side2, off] = ['+d', '-d', os];
      else if (Math.abs(os + b2.w) < 0.3) [side1, side2, off] = ['-w', '+w', ot];
      else if (Math.abs(os - b1.w) < 0.3) [side1, side2, off] = ['+w', '-w', ot];
      else return null;
      const ok = [];
      for (const [a1, c1] of segs(b1, plans.get(b1), side1, 0.35)) for (const [a2, c2] of segs(b2, plans.get(b2), side2, 0.35)) {
        const lo = Math.max(a1, a2 + off), hi = Math.min(c1, c2 + off);
        if (hi - lo >= DOOR) ok.push([lo, hi]);
      }
      if (!ok.length) return null;
      const [lo, hi] = ok[rng() * ok.length | 0], p = within(rng, lo, hi, DOOR);
      return { b1, b2, side1, side2, p1: p, p2: p - off };
    }
    const comp = new Map([...plans.keys()].map(b => [b, b]));
    const find = b => comp.get(b) === b ? b : find(comp.get(b));
    const parts = new Map();
    for (const [b] of walled) if (b.part) { if (!parts.has(b.part)) parts.set(b.part, []); parts.get(b.part).push(b); }
    for (const members of parts.values()) {
      const pairs = [];
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        const sh = shared(members[i], members[j]);
        if (sh) pairs.push([sh, (sh.b1.hole || sh.b2.hole ? 0 : 1) + rng()]);
      }
      // from the atrium and the peristyle first
      for (const [sh] of pairs.sort((x, y) => x[1] - y[1])) {
        const r1 = find(sh.b1), r2 = find(sh.b2);
        if (r1 === r2 && rng() > 0.25) continue;
        comp.set(r1, r2);
        plans.get(sh.b1).open[sh.side1].push([sh.p1, DOOR, 1]);
        plans.get(sh.b2).open[sh.side2].push([sh.p2, DOOR, 0]);
      }
    }

    // a way in from outside: on its front if that is clear, or any side
    // that is, its door mostly shut; a shop's every room open on it; a
    // hall's doors wide
    function enter(b, P) {
      const sides = SIDES.filter(s => s !== b.open && s !== b.front);
      for (const side of b.front ? [b.front, ...shuffle(rng, sides)] : shuffle(rng, sides)) {
        const st = clearSegs(b, P, side, 0.35);
        if (b.use === 'shop') {
          const fronts = st.filter(([lo, hi]) => hi - lo > 1.8);
          for (const [lo, hi] of fronts) { P.open[side].push([(lo + hi) / 2, (hi - lo) * 0.85, 0]); entrance(b, side, (lo + hi) / 2, (hi - lo) * 0.85, 'front'); }
          if (fronts.length) return side;
          continue;
        }
        const w = b.use === 'basilica' ? Math.max(DOOR + 0.3, sideLen(b, side) * 0.3) : DOOR + 0.3;
        const fit = st.filter(([lo, hi]) => hi - lo >= DOOR + 0.3);
        if (!fit.length) continue;
        const [lo, hi] = fit[rng() * fit.length | 0], ww = Math.min(w, hi - lo), p = within(rng, lo, hi, ww);
        P.open[side].push([p, ww, b.use === 'basilica' ? 0 : 2]);
        entrance(b, side, p, ww, 'front');
        return side;
      }
      return null;
    }
    const inside = new Set();
    const order = walled.map(([b]) => b).sort((p, q) => !!q.front - !!p.front);
    for (const b of order) {
      const P = plans.get(b);
      // a part of a house is gone into through the house, if it can be
      if (b.part && !b.front) continue;
      const side = enter(b, P);
      if (side) inside.add(find(b));
      // and out the back
      if (b.back && b.back !== side && b.use !== 'shop') {
        const fit = clearSegs(b, P, b.back, 0.35).filter(([lo, hi]) => hi - lo >= DOOR);
        if (fit.length) { const [lo, hi] = fit[rng() * fit.length | 0], p = within(rng, lo, hi, DOOR); P.open[b.back].push([p, DOOR, 1]); entrance(b, b.back, p, DOOR, 'back'); }
      }
    }
    // a part its house's doors don't reach: a door of its own
    for (const b of order) if (b.part && !inside.has(find(b)) && enter(b, plans.get(b))) inside.add(find(b));

    // a side left open: gone into all along it
    for (const [b] of walled) if (b.open) entrance(b, b.open, sideLen(b, b.open) / 2, sideLen(b, b.open) - 1, 'open');
    for (const [b, P] of plans) b.interior = finish(rng, b, P, lamps);
  }

  // a building's walls, its doors and windows, its floors and columns, and
  // what is in each room
  function finish(rng, b, P, lamps) {
    const spec = ROOMS[b.use];
    const W = b.w, D = b.d, floors = [], walls = [], columns = [], doors = [], windows = [], furniture = [];
    const gaps = []; // every doorway's middle and width, to keep furniture out of the way
    const windowed = { house: 1, domus: 1, insula: 1, villa: 1, baths: 1, basilica: 1, shed: 0.4, barn: 0.4 }[b.use] || 0;
    // a straight wall, gaps left in it: doors [where along it, how wide, leaf?
    // (0 none, 1 inside, 2 street)], windows [where, how wide], cut down to a sill
    function wall(a1, c1, a2, c2, gapsIn = [], wins = []) {
      const L = Math.abs(a2 - a1) + Math.abs(c2 - c1);
      if (L < 0.3) return;
      const ux = (a2 - a1) / L, uy = (c2 - c1) / L, at = t => [a1 + ux * t, c1 + uy * t];
      const all = gapsIn.map(([t, w, leaf = 1]) => [t, w, 'door', leaf]).concat(wins.map(([t, w]) => [t, w, 'window']));
      let t0 = 0;
      for (const [t, w, what, leaf] of all.sort((p, q) => p[0] - q[0])) {
        if (what === 'window' && (t - w / 2 < t0 + 0.3 || t + w / 2 > L - 0.3)) continue;
        if (t - w / 2 > t0 + 0.05) walls.push([...at(t0), ...at(t - w / 2)]);
        const [g1, g2] = [at(t - w / 2), at(t + w / 2)];
        if (what === 'window') windows.push([...g1, ...g2]);
        else {
          gaps.push([(g1[0] + g2[0]) / 2, (g1[1] + g2[1]) / 2, w, ux, uy]);
          // its leaf, hinged at one jamb, standing ajar or shut
          if (leaf) {
            const flip = rng() < 0.5, hinge = flip ? g2 : g1, dir = Math.atan2(uy, ux) + (flip ? Math.PI : 0);
            const open = (rng() < 0.5 ? 1 : -1) * (leaf === 2 ? (rng() < 0.7 ? 0 : range(rng, 0.3, 1.2)) : range(rng, 0.3, 1.6));
            doors.push([hinge[0], hinge[1], dir + open, w, dir]);
          }
        }
        t0 = Math.max(t0, t + w / 2);
      }
      if (L - t0 > 0.05) walls.push([...at(t0), ...at(L)]);
    }
    // the outside walls, with the ways in and through to the next part, and
    // windows, small and few, where it is clear outside (none on a side left open)
    function outline() {
      for (const side of SIDES) {
        if (side === b.open) continue;
        const ops = P.open[side], wins = [];
        if (windowed && rng() < windowed) for (const [lo, hi] of clearSegs(b, P, side, 0.6)) {
          for (let t = lo + range(rng, 0.6, 1.8); t < hi - 0.5; t += range(rng, 2.8, 4.5)) {
            if (ops.some(([p, w]) => Math.abs(t - p) < w / 2 + 1)) continue;
            wins.push([t, range(rng, 0.7, 1.1)]);
          }
        }
        const [a1, c1, a2, c2] = sideLine(b, side);
        wall(a1, c1, a2, c2, ops, wins);
      }
    }
    const colRow = (a1, c1, a2, c2, step, r) => {
      const L = Math.hypot(a2 - a1, c2 - c1), n = Math.max(1, Math.round(L / step));
      for (let k = 0; k <= n; k++) columns.push([a1 + (a2 - a1) * k / n, c1 + (c2 - c1) * k / n, r]);
    };

    // ---- furniture: pieces against the walls or in the middle, clear of the doors ----
    function furnish(room) {
      const [x1, y1, x2, y2] = room, m = 0.35, placed = [];
      const clear = ([a1, c1, a2, c2]) => {
        if (a1 < x1 + m || c1 < y1 + m || a2 > x2 - m || c2 > y2 - m) return false;
        if (placed.some(p => a1 < p[2] && a2 > p[0] && c1 < p[3] && c2 > p[1])) return false;
        return gaps.every(([ga, gc, gw]) => {
          const dx = Math.max(a1 - ga, 0, ga - a2), dy = Math.max(c1 - gc, 0, gc - c2);
          return Math.hypot(dx, dy) > gw / 2 + 0.55;
        });
      };
      const put = (k, r, extra = {}) => { placed.push(r); furniture.push({ k, a: (r[0] + r[2]) / 2, c: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1], ...extra }); return r; };
      // a piece len along a wall, dep out from it
      function against(k, len, dep, extra) {
        for (let tries = 0; tries < 20; tries++) {
          const side = rng() * 4 | 0, along = side % 2 === 0;
          const span = along ? x2 - x1 - 2 * m - len : y2 - y1 - 2 * m - len;
          if (span < 0) continue;
          const o = (along ? x1 : y1) + m + rng() * span;
          const r = side === 0 ? [o, y1 + m, o + len, y1 + m + dep] : side === 2 ? [o, y2 - m - dep, o + len, y2 - m]
            : side === 1 ? [x2 - m - dep, o, x2 - m, o + len] : [x1 + m, o, x1 + m + dep, o + len];
          if (clear(r)) return put(k, r, { side, ...extra });
        }
        return null;
      }
      function middle(k, w, d, extra) {
        for (let tries = 0; tries < 10; tries++) {
          const cx = (x1 + x2) / 2 + range(rng, -0.6, 0.6), cy = (y1 + y2) / 2 + range(rng, -0.6, 0.6);
          const r = [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2];
          if (clear(r)) return put(k, r, extra);
        }
        return null;
      }
      // a store: amphorae in rows, or the big jars
      function store(big) {
        const r = against('store', range(rng, 1.6, 3.4), big ? 1.2 : 0.95);
        if (!r) return;
        furniture.pop();
        const step = big ? 1.15 : 0.48, rad = big ? 0.5 : 0.2;
        for (let a = r[0] + step / 2; a <= r[2] - rad; a += step) for (let c = r[1] + step / 2; c <= r[3] - rad; c += step) {
          if (rng() < 0.12) continue;
          furniture.push({ k: big ? 'dolium' : 'amphora', a: a + range(rng, -0.04, 0.04), c: c + range(rng, -0.04, 0.04), r: rad * range(rng, 0.9, 1.1) });
        }
      }
      return { against, middle, store, clear, put, area: (x2 - x1) * (y2 - y1), room };
    }
    // a storeroom's goods: grain heaped on the floor and in sacks along the
    // walls; firewood stacked to the roof along them; hay in heaps; oil and
    // wine in their jars; baskets of the market's produce
    const stock = (r, goods) => {
      const [x1, y1, x2, y2] = r.room, long = x2 - x1 >= y2 - y1, L = (long ? x2 - x1 : y2 - y1) - 1.2;
      if (goods === 'grain') { r.middle('grain', (x2 - x1) * 0.45, (y2 - y1) * 0.4); for (let k = 0; k < 3; k++) r.against('sacks', range(rng, 1.2, 2.2), 0.8); }
      else if (goods === 'firewood') { for (let k = 0; k < 4; k++) r.against('woodpile', range(rng, 1.4, 2.6), 0.9, { tall: range(rng, 1.2, 1.9) }); }
      else if (goods === 'hay') { r.middle('hay', (x2 - x1) * 0.6, (y2 - y1) * 0.55); r.against('hay', Math.max(1.5, L * 0.5), 1.4); }
      else if (goods === 'jars') { r.store(true); r.store(false); r.store(false); }
      else { for (let k = 0; k < 4; k++) r.against('baskets', range(rng, 1.2, 2.2), 0.65); }
    };
    const hearth = r => {
      const h = r.against('hearth', 1.2, 0.8);
      if (h) { const [x, y] = toWorld(b, (h[0] + h[2]) / 2, (h[1] + h[3]) / 2); lamps.push({ x, y, z: b.z0 + 0.6, power: 0.5, hearth: true }); }
    };
    const bedroom = r => { r.against('bed', 2.0, range(rng, 0.9, 1.2)); if (rng() < 0.7) r.against('chest', range(rng, 0.8, 1.1), 0.5); };
    const dining = r => {
      // three couches round three sides of a small table, the fourth open
      // (towards a door, if one is near), none across a doorway
      const [x1, y1, x2, y2] = r.room, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, L = 1.9, Wd = 0.85, g = 0.85;
      if (!r.middle('table', 0.8, 0.8, { round: true })) return;
      const couch = [[cx - L / 2, cy - g - Wd, cx + L / 2, cy - g], [cx + g, cy - L / 2, cx + g + Wd, cy + L / 2], [cx - L / 2, cy + g, cx + L / 2, cy + g + Wd], [cx - g - Wd, cy - L / 2, cx - g, cy + L / 2]];
      const open = rng() * 4 | 0;
      couch.forEach((c, k) => { if (k !== open && r.clear(c)) r.put('couch', c, { side: k }); });
    };
    const study = r => { r.middle('table', range(rng, 1.3, 1.8), range(rng, 0.8, 1)); r.against('chest', 1, 0.55); if (rng() < 0.6) r.against('bench', range(rng, 1.4, 2.2), 0.45); };
    const kitchen = r => { hearth(r); r.middle('table', range(rng, 1.1, 1.6), 0.8); r.against('bench', range(rng, 1.4, 2), 0.42); if (rng() < 0.6) r.store(false); };

    if (b.roof === 'court' && b.hole) {
      const [s1, t1, s2, t2] = b.hole;
      const kind = b.use === 'domus' && rng() < 0.4 ? 'signinum' : spec[1];
      floors.push([0, 0, W, t1, kind], [0, t2, W, D, kind], [0, t1, s1, t2, kind], [s2, t1, W, t2, kind]);
      outline();
      if (b.use === 'domus') {
        // the atrium's four columns at the corners of its opening; a strongbox
        for (const [a, c] of [[s1, t1], [s2, t1], [s2, t2], [s1, t2]]) columns.push([a, c, 0.32]);
        furnish([0, 0, W, t1]).against('chest', 1.2, 0.7);
      } else if (b.use === 'insula' || b.use === 'villa') {
        const L = s2 - s1;
        wall(s1, t1, s2, t1, [[L / 2, DOOR]]); wall(s2, t1, s2, t2); wall(s2, t2, s1, t2); wall(s1, t2, s1, t1);
        // a farm's wine and oil, in its big jars, down one side
        if (b.use === 'villa') for (let k = 0; k < 3; k++) furnish([0, t2, W, D]).store(true);
      } else {
        // a colonnade round the court
        const r = b.use === 'peristyle' ? 0.22 : 0.32, step = b.use === 'peristyle' ? 2.2 : 2.8;
        colRow(s1, t1, s2, t1, step, r); colRow(s2, t1, s2, t2, step, r); colRow(s2, t2, s1, t2, step, r); colRow(s1, t2, s1, t1, step, r);
        if (b.use === 'market') for (let k = 0; k < 6; k++) furnish([0, 0, W, t1]).against('stall', range(rng, 1.4, 2.2), 0.8);
      }
      return { floors, walls, columns, doors, windows, furniture, gaps };
    }
    if (b.use === 'temple') {
      // columns all round, the cella within, its door at the front, the god at the back
      const k = Math.min(1, Math.min(W, D) * 0.08);
      floors.push([0, 0, W, D, 'marble']);
      colRow(k, k, W - k, k, 2.2, 0.4); colRow(W - k, k, W - k, D - k, 2.2, 0.4); colRow(W - k, D - k, k, D - k, 2.2, 0.4); colRow(k, D - k, k, k, 2.2, 0.4);
      const m = Math.min(W, D) * 0.2, front = b.front || (W >= D ? '+w' : '+d'), M = m * 2.5;
      const c = front === '+w' ? [m, m, W - M, D - m] : front === '-w' ? [M, m, W - m, D - m] : front === '+d' ? [m, m, W - m, D - M] : [m, M, W - m, D - m];
      const L = front[1] === 'w' ? c[3] - c[1] : c[2] - c[0];
      const lines = { '-d': [c[0], c[1], c[2], c[1]], '+d': [c[0], c[3], c[2], c[3]], '-w': [c[0], c[1], c[0], c[3]], '+w': [c[2], c[1], c[2], c[3]] };
      for (const side of SIDES) wall(...lines[side], side === front ? [[L / 2, 2, 1]] : []);
      const back = { '+w': [c[0] + 1.4, (c[1] + c[3]) / 2], '-w': [c[2] - 1.4, (c[1] + c[3]) / 2], '+d': [(c[0] + c[2]) / 2, c[1] + 1.4], '-d': [(c[0] + c[2]) / 2, c[3] - 1.4] }[front];
      furniture.push({ k: 'plinth', a: back[0], c: back[1], w: 1.6, d: 1.6 }, { k: 'statue', a: back[0], c: back[1], r: 0.45 });
      return { floors, walls, columns, doors, windows, furniture, gaps };
    }
    if (b.use === 'basilica') {
      floors.push([0, 0, W, D, 'marble']);
      if (b.roof === 'gable') {
        // the nave: columns down both long sides, the aisles beyond; the
        // magistrates' platform at one end
        if (W >= D) { colRow(0.6, 0.6, W - 0.6, 0.6, 3, 0.4); colRow(0.6, D - 0.6, W - 0.6, D - 0.6, 3, 0.4); furniture.push({ k: 'tribunal', a: W - 2.2, c: D / 2, w: 3.4, d: D * 0.5 }); }
        else { colRow(0.6, 0.6, 0.6, D - 0.6, 3, 0.4); colRow(W - 0.6, 0.6, W - 0.6, D - 0.6, 3, 0.4); furniture.push({ k: 'tribunal', a: W / 2, c: D - 2.2, w: W * 0.5, d: 3.4 }); }
      } else outline();
      return { floors, walls, columns, doors, windows, furniture, gaps };
    }
    if (b.use === 'portico') {
      floors.push([0, 0, W, D, 'paving']);
      if (W >= D) colRow(0.5, D / 2, W - 0.5, D / 2, 2.8, 0.32); else colRow(W / 2, 0.5, W / 2, D - 0.5, 2.8, 0.32);
      return { floors, walls, columns, doors, windows, furniture, gaps };
    }
    // rooms: a door through the walls between, enough to reach them all,
    // through the widest stretches first, and here and there one more
    const leaves = P.leaves, idx = new Map(leaves.map((r, i) => [r, i])), root = leaves.map((_, i) => i);
    const find = i => root[i] === i ? i : (root[i] = find(root[i]));
    const through = new Map(P.splits.map(sp => [sp, []]));
    const pairs = P.splits.flatMap(sp => across(P, sp)).map(e => [e, (e.hi - e.lo >= DOOR + 0.7 ? 0 : 2) + rng()]).sort((x, y) => x[1] - y[1]);
    for (const [e] of pairs) {
      const i = find(idx.get(e.a)), j = find(idx.get(e.c)), len = e.hi - e.lo;
      if (i === j && (len < DOOR + 0.7 || rng() > 0.15)) continue;
      root[i] = j;
      const w = Math.min(DOOR, Math.max(0.6, len - 0.5)), m = Math.min(0.25, Math.max(0, (len - w) / 2));
      through.get(e.sp).push([within(rng, e.lo + m, e.hi - m, w) - e.sp.lo, w]);
    }
    for (const sp of P.splits) {
      if (sp.s !== undefined) wall(sp.s, sp.lo, sp.s, sp.hi, through.get(sp));
      else wall(sp.lo, sp.t, sp.hi, sp.t, through.get(sp));
    }
    let pool = b.use === 'baths';
    const pools = new Set();
    for (const r of leaves) {
      let kind = spec[1];
      if (b.use === 'house') kind = rng() < 0.5 ? 'signinum' : 'earth';
      if (b.use === 'domus' && rng() < 0.35) kind = 'signinum';
      floors.push([...r, kind]);
      // a warm pool in the baths
      if (pool && (r[2] - r[0]) > 5 && (r[3] - r[1]) > 5) { floors.push([r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1, 'pool']); pool = false; pools.add(r); }
    }
    outline();
    // and what is in each room, by the house and the room
    const byArea = leaves.slice().sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
    byArea.forEach((room, i) => {
      const r = furnish(room), a = r.area;
      switch (b.use) {
        case 'domus':
          if (i === 0 && a > 12) dining(r);
          else if (a < 11) bedroom(r);
          else if (rng() < 0.5) study(r); else if (rng() < 0.5) kitchen(r); else { r.store(false); r.store(false); }
          break;
        case 'house': case 'insula':
          if (i === 0) kitchen(r); else if (rng() < 0.7) bedroom(r); else r.store(false);
          break;
        case 'shop': {
          // a counter across the front, jars set in it; stores behind
          const c = r.against('counter', Math.min(room[2] - room[0], room[3] - room[1]) * 0.55, 0.75, { jars: 2 + (rng() * 2 | 0) });
          r.store(rng() < 0.4);
          if (!c) r.store(false);
          break;
        }
        case 'baths': if (!pools.has(room)) for (let k = 0; k < 3; k++) r.against('bench', range(rng, 2, 3.5), 0.5); break;
        case 'barn': for (let k = 0, n = 2 + (rng() * 3 | 0); k < n; k++) r.middle('hay', range(rng, 2, 3.5), range(rng, 2, 3.5)); r.store(true); break;
        case 'shed': r.store(false); r.against('chest', 1, 0.6); break;
        case 'horreum': stock(r, b.goods); break;
        case 'scaena': if (rng() < 0.5) r.against('chest', 1.2, 0.7); break;
      }
    });
    return { floors, walls, columns, doors, windows, furniture, gaps };
  }

  return { town, heightAt, onBuilding };
})();
