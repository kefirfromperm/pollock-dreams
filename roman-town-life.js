// Roman Town — its life: the people of the town and the country about it,
// their beasts and their things, and what they do from moment to moment as
// the day goes by the visitor's clock, on and on.
//
// Like the view, it knows only what the model (roman-town.js) says is
// there: the houses and how their rooms go, the beds, hearths and tables in
// them, the doors, the streets, the forum, the fields and the pastures. From
// that, once, it peoples the town: a household in every house, a family and
// its slaves in every atrium house, more upstairs in the apartment blocks,
// farm folk at the farms; flocks and herds in the pastures, dogs, hens,
// travellers on the roads, boats on the river. Then, moment by moment, each
// does what is done at that hour of the Roman day, the hours counted from
// sunrise as the Romans counted them, twelve to the day and twelve to the
// night whatever their length: up before dawn, water from the fountain, the
// fields, the shop, the forum, school under a portico; a meal at noon and a
// rest; the baths in the afternoon, dinner on couches; home before dark, the
// watch going round with torches, sleep. Each goes where it is going as one
// would walk: out through the doors of its house, along the streets, the
// roads and the tracks, round whatever stands in the way.
//
//   const life = RomanTownLife.create(town, { seed, date })
//   life.step(dt, date)  on by dt seconds, at the hour date is
//   life.figures         what is to be seen: { kind, x, y, z, a, pose, ... } each, kind a person,
//                        a beast (sheep, goat, cow, ox, horse, donkey, dog, hen), a rider, a cart, a boat,
//                        a basket; a its heading, pose what it is doing (stand, walk, run, sit, lie,
//                        recline, bend, kneel, squat, swim, graze), ph how far through its stride or its
//                        work, anim the work, carry what it carries, seat how high it sits
//   life.lights          the torches carried at night, { x, y, z, power }
const RomanTownLife = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const turn = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - a[1] * b[0]; } return s / 2; };
  function insideConvex(poly, x, y) {
    const sg = Math.sign(area(poly));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (sg * ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) < -1e-6) return false;
    }
    return true;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  // a box's own frame: s along w, t along d, from its corner
  const toWorld = (b, s, t) => {
    const c = Math.cos(b.angle), sn = Math.sin(b.angle);
    return [b.x + (s - b.w / 2) * c - (t - b.d / 2) * sn, b.y + (s - b.w / 2) * sn + (t - b.d / 2) * c];
  };
  const inBox = (b, x, y, m = 0) => {
    const dx = x - b.x, dy = y - b.y, c = Math.cos(b.angle), s = Math.sin(b.angle);
    return Math.abs(dx * c + dy * s) < b.w / 2 + m && Math.abs(-dx * s + dy * c) < b.d / 2 + m;
  };
  const reach = b => b.shape === 'box' ? Math.hypot(b.w, b.d) / 2 : b.shape === 'round' ? b.r : b.shape === 'cavea' ? b.r1 + 2.5 : Math.max(b.a, b.b);
  // what can be walked over or through: steps, a gate's arch, a bridge, a
  // colonnade with no walls, the basilica's nave
  const WALK = new Set(['steps', 'gate', 'bridge']);
  const walkable = b => WALK.has(b.use) || (b.use === 'portico' && !b.hole) || (b.use === 'basilica' && b.roof === 'gable');

  // ================= the hour, as the Romans told it =================
  // sunrise and sunset on a day, from the sky (the sun's top on the horizon)
  const H0 = -0.833 * Math.PI / 180, days = new Map();
  function sunDay(y, m, d) {
    const key = y * 400 + m * 32 + d;
    if (days.has(key)) return days.get(key);
    const t0 = new Date(y, m, d).getTime(), step = 600e3, el = t => RomanTownSky.local(new Date(t)).sun.el;
    let rise = t0 + 6 * 3600e3, set = t0 + 18 * 3600e3, prev = el(t0), up = false, down = false;
    for (let t = t0 + step; t <= t0 + 24 * 3600e3 + 1; t += step) {
      const e = el(t);
      if (!up && prev < H0 && e >= H0) { rise = t - step * (e - H0) / (e - prev); up = true; }
      else if (up && !down && prev >= H0 && e < H0) { set = t - step * (e - H0) / (e - prev); down = true; }
      prev = e;
    }
    const v = { rise, set };
    days.set(key, v);
    return v;
  }
  // The hour: 0 at sunrise, 6 at noon, 12 at sunset, the night's hours on
  // from 12 to 24 at the next sunrise. A day's plans run from the middle of
  // one night to the middle of the next: R from −6 (the night's sixth hour)
  // to 18. And how long an hour of the day and of the night is, in seconds;
  // the day (a number, one more each day), and the month.
  function hour(date) {
    const t = date.getTime(), y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const today = sunDay(y, m, d), ds = (a, k) => { const q = new Date(a.getFullYear(), a.getMonth(), a.getDate() + k); return sunDay(q.getFullYear(), q.getMonth(), q.getDate()); };
    let R, dayH = (today.set - today.rise) / 12e3, nightH, day = Math.floor(Date.UTC(y, m, d) / 86400e3);
    if (t < today.rise) {
      const prev = ds(date, -1), nh = (today.rise - prev.set) / 12;
      R = 12 + (t - prev.set) / nh; nightH = nh / 1e3;
      if (R < 18) day--;
    } else {
      const next = ds(date, 1), nh = (next.rise - today.set) / 12;
      nightH = nh / 1e3;
      R = t < today.set ? (t - today.rise) / (dayH * 1e3) : 12 + (t - today.set) / nh;
      if (R >= 18) day++;
    }
    return { R: R >= 18 ? R - 24 : R, dayH, nightH, day, month: m };
  }
  // seconds from one hour of a day's plan to a later one
  function secs(h, from, to) {
    if (to <= from) return 0;
    let s = 0;
    const seg = (a, b, len) => { const lo = Math.max(a, from), hi = Math.min(b, to); if (hi > lo) s += (hi - lo) * len; };
    seg(-6, 0, h.nightH); seg(0, 12, h.dayH); seg(12, 18, h.nightH);
    return s;
  }

  // ================= the ways: where one can walk, and how =================
  // The world a metre a cell, what each costs to cross (Infinity where it
  // can't be): the streets and the roads cheapest, a yard or a garden dearer,
  // the rough country dearer still and the steeper the dearer, a field of
  // crops dearest (it is walked round, not over); buildings, the river, the
  // pools, the walls not at all.
  function ways(town) {
    const W = town.W, H = town.H, nx = Math.ceil(W), ny = Math.ceil(H), N = nx * ny;
    const cost = new Float32Array(N);
    const hAt = (x, y) => RomanTown.heightAt(town.terrain, x, y);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i + 0.5, y = j + 0.5;
      const sl = Math.hypot(hAt(x + 2, y) - hAt(x - 2, y), hAt(x, y + 2) - hAt(x, y - 2)) / 4;
      cost[j * nx + i] = 1.4 + Math.min(6, 8 * sl);
    }
    const cells = (x0, y0, x1, y1, f) => {
      const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(nx - 1, Math.floor(x1)), j0 = Math.max(0, Math.floor(y0)), j1 = Math.min(ny - 1, Math.floor(y1));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i, i + 0.5, j + 0.5);
    };
    const fillPoly = (poly, v) => {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      cells(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (k, x, y) => { if (insideConvex(poly, x, y)) cost[k] = v; });
    };
    const fillLine = (pts, half, v) => {
      for (let q = 0; q + 1 < pts.length; q++) {
        const [a, b] = [pts[q], pts[q + 1]];
        cells(Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half,
          (k, x, y) => { if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= half) cost[k] = Math.min(cost[k] === Infinity ? v : cost[k], v); });
      }
    };
    const FC = { pasture: 2.4, olives: 2.6, orchard: 2.6, vines: 4.5, wheat: 6, hay: 3.5, meadow: 3.5, stubble: 2.8, fallow: 3.2 };
    for (const f of town.fields) fillPoly(f.poly, FC[f.crop] || 3);
    for (const r of town.roads) fillLine(r.points, r.width / 2, r.kind === 'via' ? 1 : 1.05);
    const GC = { street: 1, 'main-street': 1, paving: 1, yard: 1.3, garden: 1.7, sand: 1.2, floor: 1.1, vines: 4, pool: Infinity, well: Infinity };
    for (const g of town.grounds) fillPoly(g.poly, GC[g.kind] ?? 1.3);
    if (town.river) fillLine(town.river.points, town.river.width / 2 + 0.4, Infinity);
    // (the ground as it is without what is built on it, to look at closer)
    const base = cost.slice();
    for (const b of town.buildings) {
      if (walkable(b)) continue;
      const R = reach(b) + 1;
      const c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
      cells(b.x - R, b.y - R, b.x + R, b.y + R, (k, x, y) => {
        const dx = x - b.x, dy = y - b.y, a = dx * c + dy * s, d = -dx * s + dy * c;
        if (b.shape === 'arena') {
          // the sand, and the four ways in under the seats
          const rho = Math.hypot(a / b.a, d / b.b);
          if (rho < 1 + 0.4 / b.a && !(rho < b.a0 / b.a - 0.02 || Math.abs(d) < 1.6 || Math.abs(a) < 1.6)) cost[k] = Infinity;
        } else if (b.shape === 'cavea') {
          // the seats, not the orchestra, nor the ways in at either end (the parodoi)
          const r = Math.hypot(a, d);
          if (a > 1.8 && r < b.r1 + 2.8 && r > b.r0 - 0.3) cost[k] = Infinity;
        } else if (RomanTown.onBuilding(b, x, y, 0.3)) cost[k] = Infinity;
      });
    }
    for (const b of town.buildings) if (b.use === 'bridge') { const R = reach(b); cells(b.x - R, b.y - R, b.x + R, b.y + R, (k, x, y) => { if (inBox(b, x, y)) cost[k] = 1; }); }
    for (const r of town.rocks || []) cells(r.x - r.r, r.y - r.r, r.x + r.r, r.y + r.r, (k, x, y) => { if (Math.hypot(x - r.x, y - r.y) < r.r * 0.75) cost[k] = Infinity; });
    for (let i = 0; i < nx; i++) cost[i] = cost[(ny - 1) * nx + i] = Infinity;
    for (let j = 0; j < ny; j++) cost[j * nx] = cost[j * nx + nx - 1] = Infinity;

    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    const DK = DI.map((di, q) => di + DJ[q] * nx);
    const pass = (k, q) => q < 4 || (cost[k + DI[q]] !== Infinity && cost[k + DJ[q] * nx] !== Infinity);
    // which ground joins which: the parts that can be walked between
    const comp = new Int32Array(N).fill(-1);
    {
      const queue = new Int32Array(N);
      let label = 0;
      for (let k0 = 0; k0 < N; k0++) {
        if (comp[k0] >= 0 || cost[k0] === Infinity) continue;
        let h = 0, t = 0;
        queue[t++] = k0; comp[k0] = label;
        while (h < t) {
          const k = queue[h++];
          for (let q = 0; q < 8; q++) {
            const k2 = k + DK[q];
            if (comp[k2] >= 0 || cost[k2] === Infinity || !pass(k, q)) continue;
            comp[k2] = label; queue[t++] = k2;
          }
        }
        label++;
      }
    }
    const cellOf = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1 ? -1 : j * nx + i; };
    const costAt = (x, y) => { const k = cellOf(x, y); return k < 0 ? Infinity : cost[k]; };
    // the nearest cell that can be walked on, within r metres (and on the
    // same ground as another, if given)
    function snap(x, y, r = 3, on = -1) {
      const k0 = cellOf(x, y);
      if (k0 >= 0 && cost[k0] !== Infinity && (on < 0 || comp[k0] === on)) return k0;
      const i0 = Math.floor(x), j0 = Math.floor(y);
      let best = -1, bd = Infinity;
      for (let rr = 1; rr <= r && best < 0; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue;
        const k = cellOf(i0 + di + 0.5, j0 + dj + 0.5);
        if (k < 0 || cost[k] === Infinity || (on >= 0 && comp[k] !== on)) continue;
        const d = Math.hypot(i0 + di + 0.5 - x, j0 + dj + 0.5 - y);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    // whether a straight line can be walked, no dearer anywhere than its ends
    function los(p, q) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.ceil(L / 0.4);
      const top = Math.max(costAt(...p) === Infinity ? 1 : costAt(...p), costAt(...q) === Infinity ? 1 : costAt(...q)) * 1.12 + 0.12;
      for (let m = 1; m < n; m++) {
        const c = costAt(lerp(p[0], q[0], m / n), lerp(p[1], q[1], m / n));
        if (!(c <= top)) return false;
      }
      return true;
    }
    // a line through the cells pulled straight wherever it can be
    function pull(pts, ok) {
      const out = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = Math.min(pts.length - 1, i + 48);
        while (j > i + 1 && !ok(pts[i], pts[j])) j--;
        out.push(pts[j]);
        i = j;
      }
      return out;
    }
    // the cheapest way from a to b, near enough (a weighted A*)
    const g = new Float32Array(N), seen = new Uint32Array(N), done = new Uint32Array(N), from = new Int32Array(N);
    let stamp = 0, hk = new Int32Array(4096), hf = new Float64Array(4096), hn = 0;
    const hpush = (k, f) => {
      if (hn === hk.length) { const k2 = new Int32Array(hn * 2), f2 = new Float64Array(hn * 2); k2.set(hk); f2.set(hf); hk = k2; hf = f2; }
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; }
      hk[i] = k; hf[i] = f;
    };
    const hpop = () => {
      const top = hk[0], k = hk[--hn], f = hf[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hk[i] = hk[c]; hf[i] = hf[c]; i = c;
      }
      hk[i] = k; hf[i] = f;
      return top;
    };
    function path(ax, ay, bx, by) {
      const t = snap(bx, by), s = t < 0 ? -1 : snap(ax, ay, 3, comp[t]);
      if (s < 0 || t < 0) return null;
      if (s === t) return [[ax, ay], [bx, by]];
      stamp++; hn = 0;
      const ti = t % nx, tj = (t / nx) | 0;
      const h = k => { const dx = Math.abs(k % nx - ti), dy = Math.abs(((k / nx) | 0) - tj); return 1.45 * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)); };
      g[s] = 0; seen[s] = stamp; from[s] = -1; hpush(s, h(s));
      let n = 0;
      while (hn) {
        const k = hpop();
        if (done[k] === stamp) continue;
        done[k] = stamp;
        if (k === t || ++n > 250000) break;
        const gk = g[k], ck = cost[k];
        for (let q = 0; q < 8; q++) {
          const k2 = k + DK[q], c = cost[k2];
          if (c === Infinity || done[k2] === stamp || !pass(k, q)) continue;
          const g2 = gk + DL[q] * (ck + c) / 2;
          if (seen[k2] !== stamp || g2 < g[k2]) { seen[k2] = stamp; g[k2] = g2; from[k2] = k; hpush(k2, g2 + h(k2)); }
        }
      }
      if (done[t] !== stamp) return null;
      const cs = [];
      for (let k = t; k >= 0; k = from[k]) cs.push(k);
      cs.reverse();
      const pts = cs.map(k => [k % nx + 0.5, ((k / nx) | 0) + 0.5]);
      pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by];
      return pull(pts, los);
    }
    const baseAt = (x, y) => { const k = cellOf(x, y); return k < 0 ? Infinity : base[k]; };
    return { nx, ny, cost, comp, cellOf, costAt, baseAt, snap, path, los, pull, hAt, cells };
  }

  // ---- a building or a house of several, close up: a quarter of a metre a
  // cell, its rooms, the walls between them, the doorways through them, what
  // stands in the rooms, and the ground just about it as the world is ----
  function room(town, way, near) {
    return function build(C) {
      const b0 = C.bs[0], c = Math.cos(b0.angle), s = Math.sin(b0.angle), M = 2.5, R = 0.25;
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const b of C.bs) for (const [p, q] of [[0, 0], [b.w, 0], [b.w, b.d], [0, b.d]]) {
        const [x, y] = toWorld(b, p, q), u = x * c + y * s, v = -x * s + y * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      u0 -= M; v0 -= M; u1 += M; v1 += M;
      const gx = Math.ceil((u1 - u0) / R), gy = Math.ceil((v1 - v0) / R), free = new Uint8Array(gx * gy);
      const wx = (i, j) => { const u = u0 + (i + 0.5) * R, v = v0 + (j + 0.5) * R; return [u * c - v * s, u * s + v * c]; };
      const loc = (x, y) => [(x * c + y * s - u0) / R - 0.5, (-x * s + y * c - v0) / R - 0.5];
      const inside = new Uint8Array(gx * gy), walled = new Uint8Array(gx * gy), doorways = [];
      // what else stands about, close enough to matter (not what is up on a roof: a dome)
      const others = [...near(b0.x, b0.y, Math.max(u1 - u0, v1 - v0))].filter(o => !C.bs.includes(o) && !walkable(o) && o.z0 <= b0.z0 + 2);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const [x, y] = wx(i, j), k = j * gx + i;
        if (C.bs.some(b => inBox(b, x, y))) { inside[k] = 1; free[k] = 1; }
        // outside, the ground close up: clear of anything built by a hand's breadth
        else free[k] = way.baseAt(x, y) < Infinity && !others.some(o => Math.abs(o.x - x) < reach(o) + 0.5 && Math.abs(o.y - y) < reach(o) + 0.5 && RomanTown.onBuilding(o, x, y, 0.15)) ? 1 : 0;
      }
      // a shape's cells, by a test in the world, over its box in the world
      const mark = (x0, y0, x1, y1, test, v) => {
        let a0 = Infinity, b0_ = Infinity, a1 = -Infinity, b1 = -Infinity;
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const [i, j] = loc(x, y); a0 = Math.min(a0, i); a1 = Math.max(a1, i); b0_ = Math.min(b0_, j); b1 = Math.max(b1, j); }
        for (let j = Math.max(0, Math.floor(b0_) - 1); j <= Math.min(gy - 1, Math.ceil(b1) + 1); j++)
          for (let i = Math.max(0, Math.floor(a0) - 1); i <= Math.min(gx - 1, Math.ceil(a1) + 1); i++) {
            const [x, y] = wx(i, j);
            if (test(x, y, j * gx + i)) free[j * gx + i] = v;
          }
      };
      // whatever else stands inside: a temple in its precinct, a pavilion, a well
      for (const o of others) {
        const r = reach(o) + 0.5;
        mark(o.x - r, o.y - r, o.x + r, o.y + r, (x, y, k) => inside[k] && RomanTown.onBuilding(o, x, y, 0.15), 0);
      }
      for (const g of town.grounds) {
        if (g.kind !== 'pool') continue;
        const [gx0, gy0] = g.poly[0];
        if (Math.hypot(gx0 - b0.x, gy0 - b0.y) > Math.max(u1 - u0, v1 - v0)) continue;
        const xs = g.poly.map(p => p[0]), ys = g.poly.map(p => p[1]);
        mark(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => insideConvex(g.poly, x, y), 0);
      }
      for (const b of C.bs) {
        const I = b.interior;
        if (!I) continue;
        const box = (a1, c1, a2, c2, m, v) => {
          const corners = [toWorld(b, a1 - m, c1 - m), toWorld(b, a2 + m, c2 + m), toWorld(b, a1 - m, c2 + m), toWorld(b, a2 + m, c1 - m)];
          const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
          const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
          mark(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y, k) => {
            if (v === 2 && free[k] !== 1) return false;
            const dx = x - b.x, dy = y - b.y, p = dx * cb + dy * sb + b.w / 2, q = -dx * sb + dy * cb + b.d / 2;
            return p > a1 - m && p < a2 + m && q > c1 - m && q < c2 + m;
          }, v);
        };
        for (const f of I.floors) if (f[4] === 'pool') box(f[0], f[1], f[2], f[3], 0.05, 0);
        for (const [a, cc, r] of I.columns) box(a - r, cc - r, a + r, cc + r, 0.1, 0);
        for (const f of I.furniture) {
          if (f.r !== undefined) box(f.a - f.r, f.c - f.r, f.a + f.r, f.c + f.r, 0.05, 2);
          else box(f.a - f.w / 2, f.c - f.d / 2, f.a + f.w / 2, f.c + f.d / 2, 0.05, 2);
        }
        for (const [a1, c1, a2, c2] of I.walls.concat(I.windows || [])) {
          const p = toWorld(b, a1, c1), q = toWorld(b, a2, c2), m = 0.36;
          mark(Math.min(p[0], q[0]) - m, Math.min(p[1], q[1]) - m, Math.max(p[0], q[0]) + m, Math.max(p[1], q[1]) + m,
            (x, y, k) => distSeg(x, y, p[0], p[1], q[0], q[1]) < m && (walled[k] = 1), 0);
        }
        // the doorways cleared again, and outside the doors
        const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
        // (as narrow as the opening is drawn, its jambs a quarter metre into it, a body's half-breadth clear of them)
        const carve = (a, cc, ux, uy, w, back, out) => {
          const [x0, y0] = toWorld(b, a, cc), wx_ = ux * cb - uy * sb, wy_ = ux * sb + uy * cb, nx_ = -wy_, ny_ = wx_, hw = Math.max(0.16, w / 2 - 0.4);
          doorways.push({ x: x0, y: y0, ux: wx_, uy: wy_, nx: nx_, ny: ny_, hw: w / 2 });
          const r = hw + Math.max(back, out) + 0.5;
          mark(x0 - r, y0 - r, x0 + r, y0 + r, (x, y) => {
            const al = (x - x0) * wx_ + (y - y0) * wy_, ac = (x - x0) * nx_ + (y - y0) * ny_;
            return Math.abs(al) < hw && ac > -back && ac < out;
          }, 1);
        };
        for (const [a, cc, w, ux, uy] of I.gaps || []) carve(a, cc, ux, uy, w, 0.6, 0.6);
        for (const e of b.entrances || []) carve(e.s, e.t, -e.ny, e.nx, e.w, 0.7, 1.8);
      }
      // free: 1 open floor; 2 furniture, squeezed past only if there is no other way
      for (let k = 0; k < walled.length; k++) if (free[k]) walled[k] = 0;
      return { gx, gy, free, walled, wx, loc, R, doorways };
    };
  }

  // ================= the people and the beasts =================
  function create(town, { seed = 1, date = new Date() } = {}) {
    const rng = mulberry32((seed ^ 0x5eed1e) >>> 0);
    const range = (a, b) => a + (b - a) * rng();
    const chance = p => rng() < p;
    const choice = a => a[rng() * a.length | 0];
    const gauss = () => { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng()); };
    const wpick = w => { let s = 0; for (const k in w) s += w[k]; let r = rng() * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
    const way = ways(town), hAt = way.hAt;
    const B = town.buildings;
    let now = 0, clock = hour(date), deadline = Infinity;
    const timeNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // what stands where, 16 m a cell
    const index = new Map(), ikey = (i, j) => i * 8192 + j;
    for (const b of B) {
      const r = reach(b);
      for (let i = Math.floor((b.x - r) / 16); i <= Math.floor((b.x + r) / 16); i++)
        for (let j = Math.floor((b.y - r) / 16); j <= Math.floor((b.y + r) / 16); j++) {
          const k = ikey(i, j);
          if (!index.has(k)) index.set(k, []);
          index.get(k).push(b);
        }
    }
    function near(x, y, r) {
      const out = new Set();
      for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++)
        for (let j = Math.floor((y - r) / 16); j <= Math.floor((y + r) / 16); j++) for (const b of index.get(ikey(i, j)) || []) out.add(b);
      return out;
    }

    // ---- houses and halls close up: one for each building with rooms, or
    // for all the parts of a house together ----
    const buildRoom = room(town, way, near);
    const clusters = new Map(), parts = new Map();
    const mainComp = (() => { const g = town.gates[0]; const k = g ? way.snap(g.x, g.y, 6) : -1; return k >= 0 ? way.comp[k] : 0; })();
    for (const b of B) if (b.interior && b.entrances && b.part) { if (!parts.has(b.part)) parts.set(b.part, []); parts.get(b.part).push(b); }
    function clusterOf(b) {
      if (!b || !b.interior || !b.entrances) return null;
      if (clusters.has(b)) return clusters.get(b);
      const bs = b.part ? parts.get(b.part) : [b];
      const C = { bs, grid: null, ents: [] };
      for (const o of bs) for (const e of o.entrances) {
        // a step outside the door, or to one side if something stands there (a fountain)
        let out = toWorld(o, e.s + e.nx * 1.4, e.t + e.ny * 1.4);
        const inn = toWorld(o, e.s - e.nx * 0.7, e.t - e.ny * 0.7);
        search: for (const d of [1.4, 2.2, 3]) for (const l of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
          const p = toWorld(o, e.s + e.nx * d - e.ny * l, e.t + e.ny * d + e.nx * l), kc = way.cellOf(...p);
          if (kc >= 0 && way.cost[kc] < Infinity && way.comp[kc] === mainComp) { out = p; break search; }
        }
        const k = way.snap(...out, 2);
        C.ents.push({ b: o, kind: e.kind, out, inn, ok: k >= 0 && way.comp[k] === mainComp });
      }
      for (const o of bs) clusters.set(o, C);
      return C;
    }
    // a house's plan close up, made when first wanted; and each door's step
    // outside found from the door itself: the nearest open ground of the
    // streets that can be walked to out through it
    function gridOf(C) {
      const G = C.grid = buildRoom(C), { gx, gy, free } = G;
      for (const e of C.ents) {
        const [fi, fj] = G.loc(...e.inn), s0 = Math.round(fj) * gx + Math.round(fi);
        if (s0 < 0 || s0 >= free.length || !free[s0]) continue;
        const seen = new Map([[s0, 0]]), q = [s0];
        let best = null, bd = Infinity;
        for (let h = 0; h < q.length && q.length < 3000; h++) {
          const k = q[h], i = k % gx, j = (k / gx) | 0, [x, y] = G.wx(i, j), steps = seen.get(k);
          if (!C.bs.some(b => inBox(b, x, y, 0.3))) {
            const kc = way.cellOf(x, y);
            if (kc >= 0 && way.cost[kc] < Infinity && way.comp[kc] === mainComp) {
              const d = Math.hypot(x - e.out[0], y - e.out[1]) + steps * 0.05;
              if (d < bd) { bd = d; best = [x, y]; }
            }
          }
          if (steps > 24) continue;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const i2 = i + di, j2 = j + dj, k2 = j2 * gx + i2;
            if (i2 < 0 || j2 < 0 || i2 >= gx || j2 >= gy || seen.has(k2) || free[k2] !== 1) continue;
            seen.set(k2, steps + 1); q.push(k2);
          }
        }
        if (best) { e.out = best; e.ok = true; } else e.ok = false;
      }
      return G;
    }
    // the building with rooms at a point, if there is one
    // whether a point of open ground can be walked to from the gates
    const reachable = (x, y) => { const k = way.snap(x, y, 2); return k >= 0 && way.comp[k] === mainComp; };
    const clusterAt = (x, y) => { for (const b of near(x, y, 1)) if (b.shape === 'box' && b.interior && b.entrances && inBox(b, x, y)) return clusterOf(b); return null; };
    const floorAt = (C, x, y) => { for (const b of C.bs) if (inBox(b, x, y)) return b.z0 + 0.08; return NaN; };
    // the way from a to b in it, through its doors
    let bfsSeen = new Uint32Array(1), bfsPrev = new Int32Array(1), bfsQ = new Int32Array(1), bfsStamp = 0;
    function inside(C, A, Bp) {
      if (!C.grid) gridOf(C);
      return search(C.grid, A, Bp, 1) || search(C.grid, A, Bp, 2);
    }
    function search(G, A, Bp, worst) {
      const { gx, gy } = G, free = G.view || (G.view = new Uint8Array(gx * gy)), F = G.free;
      for (let k = 0; k < F.length; k++) free[k] = F[k] && F[k] <= worst ? 1 : 0;
      // the nearest free cell to a point, on its side of any wall (what
      // stands between, the bed or the bench it is on, no matter)
      const seesIt = (i, j, fi, fj) => {
        const L = Math.hypot(i - fi, j - fj), m = Math.ceil(L * 2.5);
        for (let k = 1; k < m; k++) {
          const f = k / m;
          if ((1 - f) * L * G.R < 0.15) break;
          const a = Math.round(lerp(i, fi, f)), b = Math.round(lerp(j, fj, f));
          if (a < 0 || b < 0 || a >= gx || b >= gy || G.walled[b * gx + a]) return false;
        }
        return true;
      };
      const snapC = (x, y) => {
        const [fi, fj] = G.loc(x, y), i0 = Math.round(fi), j0 = Math.round(fj);
        let any = -1;
        for (let r = 0; r <= 28; r++) {
          let best = -1, bd = Infinity;
          for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            const i = i0 + di, j = j0 + dj;
            if (i < 0 || j < 0 || i >= gx || j >= gy || !free[j * gx + i]) continue;
            const d = Math.hypot(i - fi, j - fj);
            if (any < 0) any = j * gx + i;
            if (d < bd && seesIt(i, j, fi, fj)) { bd = d; best = j * gx + i; }
          }
          if (best >= 0) return best;
        }
        return any;
      };
      const s = snapC(...A), t = snapC(...Bp);
      if (s < 0 || t < 0) return null;
      const n = gx * gy;
      if (bfsSeen.length < n) { bfsSeen = new Uint32Array(n); bfsPrev = new Int32Array(n); bfsQ = new Int32Array(n); }
      const st = ++bfsStamp;
      let h = 0, tl = 0;
      bfsQ[tl++] = s; bfsSeen[s] = st; bfsPrev[s] = -1;
      const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
      while (h < tl && bfsSeen[t] !== st) {
        const k = bfsQ[h++], i = k % gx, j = (k / gx) | 0;
        for (let q = 0; q < 8; q++) {
          const i2 = i + DI[q], j2 = j + DJ[q];
          if (i2 < 0 || j2 < 0 || i2 >= gx || j2 >= gy) continue;
          const k2 = j2 * gx + i2;
          if (bfsSeen[k2] === st || !free[k2]) continue;
          if (q >= 4 && (!free[j * gx + i2] || !free[j2 * gx + i])) continue;
          bfsSeen[k2] = st; bfsPrev[k2] = k; bfsQ[tl++] = k2;
        }
      }
      if (bfsSeen[t] !== st) return null;
      const cs = [];
      for (let k = t; k >= 0; k = bfsPrev[k]) cs.push(k);
      cs.reverse();
      const pts = cs.map(k => G.wx(k % gx, (k / gx) | 0));
      pts[0] = A.slice(); pts[pts.length - 1] = Bp.slice();
      const ok = (p, q) => {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(L / 0.1);
        for (let k = 0; k <= m; k++) {
          const f = k / m;
          if (f * L < 0.3 || (1 - f) * L < 0.3) continue;
          const [fi, fj] = G.loc(lerp(p[0], q[0], f), lerp(p[1], q[1], f)), i = Math.round(fi), j = Math.round(fj);
          if (i < 0 || j < 0 || i >= gx || j >= gy || !free[j * gx + i]) return false;
        }
        return true;
      };
      return thread(G, way.pull(pts, ok));
    }
    // through every doorway on the way squarely, by its middle (or, a wide
    // one, away from its sides): a step before it, a step after
    function thread(G, pts) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = out[out.length - 1], b = pts[i], hits = [];
        for (const D of G.doorways) {
          const da = (a[0] - D.x) * D.nx + (a[1] - D.y) * D.ny, db = (b[0] - D.x) * D.nx + (b[1] - D.y) * D.ny;
          if (da * db >= 0 || Math.abs(da) < 0.05 && Math.abs(db) < 0.05) continue;
          const t = da / (da - db), px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, al = (px - D.x) * D.ux + (py - D.y) * D.uy;
          if (Math.abs(al) > D.hw + 0.35) continue;
          hits.push([t, D, Math.sign(db - da), al]);
        }
        hits.sort((p, q) => p[0] - q[0]);
        for (const [, D, sg, al] of hits) {
          const keep = D.hw > 0.9 ? clamp(al, -(D.hw - 0.55), D.hw - 0.55) : 0, cx = D.x + D.ux * keep, cy = D.y + D.uy * keep;
          out.push([cx - D.nx * sg * 0.45, cy - D.ny * sg * 0.45], [cx + D.nx * sg * 0.45, cy + D.ny * sg * 0.45]);
        }
        out.push(b);
      }
      return out;
    }
    // the doors of a house to go out by, towards somewhere, the likeliest
    // first (the front door, the nearest; none that has led nowhere)
    function doors(C, to) {
      return C.ents.filter(e => e.ok && (e.bad || 0) < 3).map(e => [e, Math.hypot(e.out[0] - to[0], e.out[1] - to[1]) - (e.kind === 'front' ? 8 : 0)]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
    }
    const door = (C, to) => doors(C, to)[0] || null;
    // out of a house (or in, backwards), through the first door that goes anywhere
    // (a door is blamed only if another goes where it did not)
    function through(C, at, to, out) {
      const failed = [];
      for (const e of doors(C, to)) {
        const p = out ? inside(C, at, e.out) : inside(C, e.out, at);
        if (p) { e.bad = 0; for (const f of failed) f.bad = (f.bad || 0) + 1; return { e, p }; }
        failed.push(e);
      }
      return null;
    }
    // the whole way from where one is to a spot: out of the house one is in,
    // through the streets, into the one the spot is in; each point [x, y, z],
    // z NaN on the open ground
    function route(x, y, cl, sp) {
      const zs = (C, pts) => pts.map(p => [p[0], p[1], C ? floorAt(C, p[0], p[1]) : NaN, C]);
      if (cl && cl === sp.cl) { const p = inside(cl, [x, y], [sp.x, sp.y]); return p && zs(cl, p); }
      let A = [x, y], Bp = [sp.x, sp.y], pre = [], post = [];
      if (cl) { const t = through(cl, A, Bp, true); if (t) { pre = zs(cl, t.p); A = t.e.out; } }
      if (sp.cl) { const t = through(sp.cl, Bp, A, false); if (t) { post = zs(sp.cl, t.p); Bp = t.e.out; } }
      const mid = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) < 0.5 ? [A, Bp] : way.path(A[0], A[1], Bp[0], Bp[1]);
      if (!mid) return null;
      return pre.slice(0, -1).concat(zs(null, mid), post.slice(1));
    }

    // ---- spots: where one is to be, and how ----
    const spot = (x, y, z, a, pose, o = {}) => ({ x, y, z, a, pose, cl: o.cl !== undefined ? o.cl : clusterAt(x, y), ...o });
    const fz = b => b.z0 + 0.08;
    const ang = (b, la) => b.angle + la;
    // a point of a room, clear of what is in it
    function roomPoint(b, r) {
      for (let k = 0; k < 12; k++) {
        const a = range(r[0] + 0.6, r[2] - 0.6), c = range(r[1] + 0.6, r[3] - 0.6);
        if (r[2] - r[0] < 1.3 || r[3] - r[1] < 1.3) return null;
        if (b.interior.furniture.some(f => f.r !== undefined ? Math.hypot(f.a - a, f.c - c) < f.r + 0.5 : Math.abs(f.a - a) < f.w / 2 + 0.45 && Math.abs(f.c - c) < f.d / 2 + 0.45)) continue;
        if (b.interior.columns.some(([p, q, rr]) => Math.hypot(p - a, q - c) < rr + 0.5)) continue;
        if (b.interior.floors.some(f => f[4] === 'pool' && a > f[0] - 0.4 && a < f[2] + 0.4 && c > f[1] - 0.4 && c < f[3] + 0.4)) continue;
        return [a, c];
      }
      return null;
    }
    // a table, as the view is to lay it: where, how big, its top's height; laid, till when
    const tables = new Map();
    function tableOf(b, f, x, y) {
      const key = b.x * 1e4 + b.y + f.a * 7 + f.c * 13;
      if (!tables.has(key)) tables.set(key, { kind: 'meal', id: tables.size + 1, x, y, z: b.z0 + (f.round ? 0.72 : 0.75), a: b.angle, w: f.w, d: f.d, round: !!f.round, rich: b.use === 'domus', vis: true, laid: 0, n: 0 });
      return tables.get(key);
    }
    // where to stand, sit or lie at a piece of furniture
    function furnitureSpots(b) {
      const S = { beds: [], couches: [], seats: [], benches: [], hearths: [], counters: [], stalls: [], stores: [], tribunal: null, rooms: [], tables: [] };
      const I = b.interior, z = fz(b);
      for (const f of I.furniture) {
        const longW = (f.w || 0) >= (f.d || 0);
        const facing = { 0: Math.PI / 2, 2: -Math.PI / 2, 1: Math.PI, 3: 0 }[f.side];
        if (f.k === 'bed' || f.k === 'couch') {
          // lying the length of it, the head on the pillow
          const la = longW ? 0 : Math.PI / 2, [x, y] = toWorld(b, f.a, f.c), lat = longW ? f.d : f.w;
          const list = f.k === 'bed' ? S.beds : S.couches;
          list.push({ b, x, y, z: b.z0 + 0.58, a: ang(b, la), lat, side: f.side, used: 0 });
        } else if (f.k === 'table') {
          // the table, to be laid when someone eats at it
          const [x0, y0] = toWorld(b, f.a, f.c), T = tableOf(b, f, x0, y0);
          S.tables.push(T);
          for (const [da, dc, la] of [[f.w / 2 + 0.38, 0, Math.PI], [-f.w / 2 - 0.38, 0, 0], [0, f.d / 2 + 0.38, -Math.PI / 2], [0, -f.d / 2 - 0.38, Math.PI / 2]]) {
            const [x, y] = toWorld(b, f.a + da, f.c + dc);
            S.seats.push({ b, x, y, z, a: ang(b, la), table: T });
          }
        } else if (f.k === 'bench' && facing !== undefined) {
          const L = longW ? f.w : f.d, n = Math.max(1, Math.floor(L / 0.65));
          for (let q = 0; q < n; q++) {
            const o = (q + 0.5) / n * L - L / 2, [x, y] = toWorld(b, f.a + (longW ? o : 0), f.c + (longW ? 0 : o));
            S.benches.push({ b, x, y, z, a: ang(b, facing), seat: 0.37 });
          }
        } else if ((f.k === 'hearth' || f.k === 'counter' || f.k === 'stall' || f.k === 'chest') && facing !== undefined) {
          // standing before it, facing it (away from the wall it is against)
          const out = f.k === 'counter' ? 0.5 : 0.55, ux = Math.cos(facing), uy = Math.sin(facing);
          const half = Math.abs(ux) > 0.5 ? f.w / 2 : f.d / 2;
          const [x, y] = toWorld(b, f.a + ux * (half + out), f.c + uy * (half + out));
          const sp = { b, x, y, z, a: ang(b, facing + Math.PI) };
          if (f.k === 'hearth') S.hearths.push(sp);
          else if (f.k === 'counter' || f.k === 'stall') {
            // the one who sells by its end, the one who buys before it
            const L = Math.abs(ux) > 0.5 ? f.d : f.w, ex = Math.abs(ux) > 0.5 ? 0 : 1, ey = 1 - ex;
            const [sx, sy] = toWorld(b, f.a + ex * (L / 2 + 0.45) + ux * 0.1, f.c + ey * (L / 2 + 0.45) + uy * 0.1);
            const [bx2, by2] = toWorld(b, f.a + ux * (half + 1.1), f.c + uy * (half + 1.1));
            (f.k === 'counter' ? S.counters : S.stalls).push({ b, sell: { x: sx, y: sy, z, a: ang(b, facing) }, buy: { x: bx2, y: by2, z, a: ang(b, facing + Math.PI) } });
          } else S.stores.push(sp);
        } else if (f.k === 'tribunal') {
          const [x, y] = toWorld(b, f.a, f.c), toward = Math.atan2(b.y - y, b.x - x);
          S.tribunal = { b, x, y, z: b.z0 + 1.1, a: toward };
        }
      }
      for (const f of I.floors) if (f[4] !== 'pool') S.rooms.push(f);
      // the couches round the table they are about
      for (const c of S.couches) { let best = null, bd = 4; for (const T of S.tables) { const d = Math.hypot(T.x - c.x, T.y - c.y); if (d < bd) { bd = d; best = T; } } c.table = best; }
      return S;
    }
    const roomSpot = (b, r, pose = 'stand') => { const p = roomPoint(b, r); if (!p) return null; const [x, y] = toWorld(b, ...p); return spot(x, y, fz(b), range(0, TAU), pose, { cl: clusterOf(b) }); };

    // ================= the town's places =================
    const places = {};
    for (const p of town.places || []) (places[p.kind] || (places[p.kind] = [])).push(p);
    const byUse = u => B.filter(b => b.use === u);
    // points of open ground in a polygon that can be stood on, clear about
    function groundPoints(poly, n, maxCost = 1.25, clear = 1) {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), out = [];
      for (let k = 0; k < n * 12 && out.length < n; k++) {
        const x = range(Math.min(...xs), Math.max(...xs)), y = range(Math.min(...ys), Math.max(...ys));
        if (!insideConvex(poly, x, y)) continue;
        let ok = true;
        for (let dy = -clear; dy <= clear && ok; dy += clear) for (let dx = -clear; dx <= clear; dx += clear) if (!(way.costAt(x + dx, y + dy) <= maxCost)) { ok = false; break; }
        if (ok && way.comp[way.cellOf(x, y)] === mainComp) out.push([x, y]);
      }
      return out;
    }
    const forum = (places.forum || [])[0];
    const forumPts = forum ? groundPoints(forum.poly, 160) : [];
    const nymph = (places.nymphaeum || [])[0];
    const nymphPts = nymph ? groundPoints(nymph.poly, 30) : [];
    // the basilica's nave, its crowd facing the magistrates' platform
    const nave = B.find(b => b.use === 'basilica' && b.roof === 'gable');
    const naveSpots = nave ? furnitureSpots(nave) : null;
    // shops and stalls: their counters
    const counters = [], stalls = [];
    for (const b of B) if (b.interior && b.entrances && (b.use === 'shop' || b.use === 'market')) {
      const S = furnitureSpots(b);
      for (const c of S.counters) counters.push(c);
      for (const c of S.stalls) stalls.push(c);
    }
    // the fountains: room to stand at each side of the basin
    const fountains = byUse('fountain').map(b => ({ b, spots: [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([u, v]) => {
      const o = 0.55, [x, y] = toWorld(b, b.w / 2 + u * (b.w / 2 + o), b.d / 2 + v * (b.d / 2 + o));
      return way.costAt(x, y) < Infinity ? { x, y, a: Math.atan2(b.y - y, b.x - x) } : null;
    }).filter(Boolean) })).filter(f => f.spots.length);
    // the altars: the priest beyond, the worshippers before, all facing the temple
    const altars = byUse('altar').map(al => {
      let t = null, td = Infinity;
      for (const o of near(al.x, al.y, 30)) if (o.use === 'temple' && Math.hypot(o.x - al.x, o.y - al.y) < td) { td = Math.hypot(o.x - al.x, o.y - al.y); t = o; }
      const out = t ? Math.atan2(al.y - t.y, al.x - t.x) : al.angle, ux = Math.cos(out), uy = Math.sin(out);
      return { b: al, out, priest: { x: al.x + ux * 1.4, y: al.y + uy * 1.4, a: out + Math.PI }, ux, uy };
    });
    // the baths: the exercise court, its pool, the halls' benches and warm pools
    const bath = (() => {
      const pal = byUse('palaestra')[0];
      if (!pal) return null;
      const C = clusterOf(pal), [s1, t1, s2, t2] = pal.hole, court = [];
      for (let k = 0; k < 60; k++) {
        const s = range(s1 + 1, s2 - 1), t = range(t1 + 1, t2 - 1), [x, y] = toWorld(pal, s, t);
        if (town.grounds.some(g => g.kind === 'pool' && insideConvex(g.poly, x, y)) || town.grounds.some(g => g.kind === 'pool' && insideConvex(g.poly, x + 1, y) )) continue;
        court.push([x, y]);
      }
      const pool = town.grounds.find(g => g.kind === 'pool' && insideConvex([toWorld(pal, s1, t1), toWorld(pal, s2, t1), toWorld(pal, s2, t2), toWorld(pal, s1, t2)], ...g.poly[0]));
      const halls = byUse('baths').filter(b => b.shape === 'box' && b.interior), benches = [], pools = [];
      for (const h of halls) {
        const S = furnitureSpots(h);
        benches.push(...S.benches.map(s => spot(s.x, s.y, s.z, s.a, 'sit', { seat: s.seat, cl: clusterOf(h) })));
        for (const f of h.interior.floors) if (f[4] === 'pool') for (let k = 0; k < 6; k++) {
          const [x, y] = toWorld(h, range(f[0] + 0.5, f[2] - 0.5), range(f[1] + 0.5, f[3] - 0.5));
          pools.push(spot(x, y, h.z0 + 0.1, range(0, TAU), 'swim', { cl: clusterOf(h) }));
        }
      }
      return { pal, C, court, pool, benches, pools };
    })();
    // the market: its court, about the pavilion
    const market = (() => {
      const m = byUse('market')[0];
      if (!m) return null;
      const [s1, t1, s2, t2] = m.hole, pts = [];
      for (let k = 0; k < 40; k++) {
        const [x, y] = toWorld(m, range(s1 + 0.8, s2 - 0.8), range(t1 + 0.8, t2 - 0.8));
        if (![...near(x, y, 8)].some(o => o.use === 'tholos' && Math.hypot(o.x - x, o.y - y) < o.r + 1.2)) pts.push([x, y]);
      }
      return { b: m, C: clusterOf(m), pts };
    })();
    // the theatre's seats and stage, the amphitheatre's seats and sand
    const cavea = byUse('theatre').find(b => b.shape === 'cavea');
    const stage = byUse('stage')[0], scaena = byUse('scaena')[0];
    const amph = B.find(b => b.shape === 'arena');
    // the gates: a guard either side, outside; and where each is on the wall
    const gates = town.gates.map(g => {
      const ux = Math.cos(g.angle), uy = Math.sin(g.angle), wt = town.town.wall.thickness;
      const gb = [...near(g.x, g.y, 4)].find(b => b.use === 'gate');
      const half = gb ? Math.min(gb.w, gb.d) / 2 : 6, lat = gb ? Math.max(gb.w, gb.d) / 2 - 1.2 : 5;
      const at = d => [g.x + ux * d, g.y + uy * d];
      return {
        g, ux, uy, inner: at(-wt / 2 - 4), outer: at(wt / 2 + 4),
        guards: [-1, 1].map(sg => { const [x, y] = at(half + 1.5); return { x: x - uy * sg * lat, y: y + ux * sg * lat, a: g.angle }; }),
      };
    });
    // the walk along the top of the wall, and how high it is there
    const wallWalk = (() => {
      const pts = town.town.outline.map(([x, y]) => {
        let z = -Infinity;
        for (const b of near(x, y, 2)) if ((b.use === 'wall' || b.use === 'gate') && RomanTown.onBuilding(b, x, y, 0.6)) z = Math.max(z, b.z0 + b.h);
        return [x, y, z];
      });
      for (let i = 0; i < pts.length; i++) if (pts[i][2] === -Infinity) { const p = pts[(i + pts.length - 1) % pts.length]; pts[i][2] = p[2] === -Infinity ? hAt(pts[i][0], pts[i][1]) + town.town.wall.height : p[2]; }
      const atGate = gates.map(G => { let best = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p[0] - G.g.x, p[1] - G.g.y); if (d < bd) { bd = d; best = i; } }); return best; });
      // the towers along it (a point of the walk in each)
      const towerAt = new Set();
      for (const t of byUse('tower')) {
        let best = -1, bd = 7;
        pts.forEach((p, i) => { const d = Math.hypot(p[0] - t.x, p[1] - t.y); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) towerAt.add(best);
      }
      return { pts, atGate, towerAt };
    })();
    // the river's banks, a step from the water
    const banks = [];
    if (town.river) {
      const R = town.river, P = R.points;
      for (let k = 2; k + 2 < P.length; k += 2) {
        const [a, b] = [P[k], P[k + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        for (const sg of [-1, 1]) {
          const o = R.width / 2 + 0.9, x = a[0] + nx * sg * o, y = a[1] + ny * sg * o;
          const kc = way.cellOf(x, y);
          if (kc < 0 || way.cost[kc] === Infinity || way.comp[kc] !== mainComp) continue;
          banks.push({ x, y, z: R.level[k] + 0.4, a: Math.atan2(-ny * sg, -nx * sg), k });
        }
      }
    }
    const tombs = byUse('tomb').map(t => {
      let best = null, bd = Infinity;
      for (const r of town.roads) if (r.kind === 'via') for (const p of r.points) { const d = Math.hypot(p[0] - t.x, p[1] - t.y); if (d < bd) { bd = d; best = p; } }
      const a = best ? Math.atan2(best[1] - t.y, best[0] - t.x) : 0, o = reach(t) * 0.75 + 1.4;
      return { b: t, x: t.x + Math.cos(a) * o, y: t.y + Math.sin(a) * o, a: a + Math.PI };
    }).filter(t => way.costAt(t.x, t.y) < Infinity);
    // a tree's shade, the side away from the sun
    const shadeTrees = town.trees.filter(t => t.kind !== 'shrub' && t.r > 2);
    const treeIndex = new Map();
    for (const t of shadeTrees) { const k = ikey(Math.floor(t.x / 16), Math.floor(t.y / 16)); if (!treeIndex.has(k)) treeIndex.set(k, []); treeIndex.get(k).push(t); }
    function shadeNear(x, y, r) {
      let best = null, bd = r;
      for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) for (let j = Math.floor((y - r) / 16); j <= Math.floor((y + r) / 16); j++)
        for (const t of treeIndex.get(ikey(i, j)) || []) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    let sunAz = Math.PI;
    const shadeOf = (t, k = 0) => {
      const a = sunAz + Math.PI + range(-0.6, 0.6), d = t.r * range(0.3, 0.75);
      // (north up, y down: the sun's azimuth from north clockwise)
      const x = t.x + Math.sin(a) * d, y = t.y - Math.cos(a) * d;
      return way.costAt(x, y) < Infinity ? [x, y] : null;
    };

    // ================= the households =================
    const homes = [];
    const centre = [town.town.x, town.town.y], townR = Math.hypot(town.town.hu, town.town.hv);
    {
      const seen = new Set();
      for (const b of B) {
        if (!b.interior || seen.has(b) || !['house', 'domus', 'insula', 'shop', 'villa'].includes(b.use)) continue;
        const C = clusterOf(b);
        if (!C) continue;
        for (const o of C.bs) seen.add(o);
        const S = { beds: [], couches: [], seats: [], benches: [], hearths: [], counters: [], stalls: [], stores: [], rooms: [], tables: [] };
        for (const o of C.bs) {
          const s = furnitureSpots(o);
          for (const k in S) S[k].push(...s[k].map(v => Array.isArray(v) ? { b: o, r: v } : v));
        }
        const front = C.ents.find(e => e.kind === 'front' && e.ok) || C.ents.find(e => e.ok) || C.ents[0];
        if (!front) continue;
        const kind = b.use === 'domus' ? 'domus' : b.use;
        const outer = Math.hypot(b.x - centre[0], b.y - centre[1]) / townR;
        homes.push({ kind, C, S, front, outer, people: [], b });
      }
    }
    // the farms' barns, by their farm
    const barns = byUse('barn').map(b => ({ b, C: clusterOf(b), S: b.interior ? furnitureSpots(b) : null }));
    for (const h of homes) if (h.kind === 'villa') {
      let best = null, bd = 60;
      for (const br of barns) { const d = Math.hypot(br.b.x - h.b.x, br.b.y - h.b.y); if (d < bd) { bd = d; best = br; } }
      h.barn = best;
    }

    // ================= everyone =================
    const all = [];
    let ids = 1;
    function being(kind, o = {}) {
      const ag = { id: ids++, kind, x: 0, y: 0, z: 0, a: rng() * TAU, pose: 'stand', anim: null, ph: rng(), seat: 0, carry: null, vis: true, torch: false,
        legs: [], leg: null, cl: null, speed: 1.25, ...o };
      all.push(ag);
      return ag;
    }
    const person = (home, sex, age, o = {}) => {
      const ag = being('person', { home, sex, age, dress: o.dress || (sex === 'f' ? 'stola' : 'tunic'), speed: age === 'old' ? range(0.8, 1) : age === 'child' ? range(1.05, 1.25) : range(1.15, 1.4), plan: null, planDay: -1, torchy: chance(0.65), ...o });
      if (home) home.people.push(ag);
      return ag;
    };
    // whom the jobs go to
    const men = [];
    for (const h of homes.slice()) {
      // more families upstairs: in an apartment block two to four, over a house now and then
      const upstairs = h.kind === 'insula' ? 2 + (rng() * 3 | 0) : h.kind === 'house' && chance(0.4) ? 1 : 0;
      const fams = [h, ...Array.from({ length: upstairs }, () => ({ ...h, upstairs: true, people: [] }))];
      if (h.kind === 'shop') h.upstairs = true;
      for (const f of fams) {
        if (f !== h) homes.push(f);
        if (f.kind === 'villa') {
          const m = person(f, 'm', 'adult', { job: 'farmer' }), w = person(f, 'f', 'adult', { job: 'wife' });
          for (let k = 0, n = 2 + (rng() * 3 | 0); k < n; k++) person(f, 'm', 'adult', { job: 'farmer', dress: 'work' });
          for (let k = 0, n = rng() * 3 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
          f.master = m; f.mistress = w;
          continue;
        }
        if (f.kind === 'domus') {
          const m = person(f, 'm', 'adult', { job: 'patron', dress: 'toga' }), w = person(f, 'f', 'adult', { job: 'domina' });
          f.master = m; f.mistress = w;
          for (let k = 0, n = rng() * 4 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
          for (let k = 0, n = 2 + (rng() * 4 | 0); k < n; k++) person(f, chance(0.55) ? 'm' : 'f', 'adult', { job: 'slave', dress: 'slave' });
          if (chance(0.25)) person(f, chance(0.5) ? 'm' : 'f', 'old', { job: 'old' });
          continue;
        }
        // a house, a shop, an apartment
        const single = chance(0.15);
        const m = !single || chance(0.6) ? person(f, 'm', 'adult', { job: null }) : null;
        const w = !single || !m ? person(f, 'f', 'adult', { job: f.kind === 'shop' && !m ? 'shopkeeper' : 'wife' }) : null;
        if (m) men.push(m);
        f.master = m; f.mistress = w;
        if (!single) for (let k = 0, n = rng() * 3.4 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
        if (chance(0.2)) person(f, chance(0.5) ? 'm' : 'f', 'old', { job: 'old' });
      }
    }
    // the trades: the shopkeepers in the shops; farmers more the further out
    // they live; the town's servants; and the rest, craftsmen and porters
    const pastures = town.fields.filter(f => f.crop === 'pasture' && f.gate && f.poly.every(([x, y]) => x > 2 && y > 2 && x < town.W - 2 && y < town.H - 2));
    const crops = town.fields.filter(f => f.crop !== 'pasture' && f.poly.every(([x, y]) => x > 1 && y > 1 && x < town.W - 1 && y < town.H - 1));
    {
      const free = men.filter(m => m.home.kind !== 'shop').sort(() => rng() - 0.5);
      for (const m of men) if (m.home.kind === 'shop') m.job = 'shopkeeper';
      const take = (n, job, pref) => {
        const pool = pref ? free.slice().sort((a, b) => pref(b) - pref(a)) : free.slice();
        for (const m of pool.slice(0, n)) { m.job = job; free.splice(free.indexOf(m), 1); }
      };
      take(gates.length * 2, 'guard');
      take(wallWalk.pts.length ? gates.length * 2 : 0, 'sentry');
      take(2, 'watch');
      for (const al of altars.slice(0, 2)) take(1, 'priest', m => -m.home.outer);
      if (forum) take(1, 'teacher');
      if (bath) take(1, 'attendant');
      if (town.river && banks.length) take(1 + (rng() * 2 | 0), 'fisher', m => m.home.outer);
      take(Math.round(free.length * 0.35), 'farmer', m => m.home.outer + rng() * 0.3);
      for (const m of free) m.job = chance(0.55) ? 'craftsman' : 'porter';
    }
    // the players, on the days there is a play
    if (cavea && stage) all.filter(a => a.job === 'craftsman' && a.sex === 'm').slice(0, 4).forEach(a => a.actor = true);
    // the patrons: two of them magistrates; and their clients
    const patrons = all.filter(a => a.job === 'patron');
    patrons.slice(0, 2).forEach(p => p.magistrate = true);
    for (const a of all) if (a.kind === 'person' && a.age === 'adult' && a.sex === 'm' && a.job !== 'patron' && a.job !== 'slave' && patrons.length && chance(0.3)) a.patron = choice(patrons);
    // the teacher's pupils; the farmers' fields
    for (const a of all) if (a.job === 'child') a.pupil = a.sex === 'm' && chance(0.6);
    const farmers = all.filter(a => a.job === 'farmer');
    for (const f of farmers) {
      // a field near home, or near the farm
      const hx = f.home.b.x, hy = f.home.b.y, list = f.home.kind === 'villa' ? crops.slice().sort((p, q) => Math.hypot(p.poly[0][0] - hx, p.poly[0][1] - hy) - Math.hypot(q.poly[0][0] - hx, q.poly[0][1] - hy)).slice(0, 6) : crops;
      f.field = list.length ? choice(list) : null;
      if (!f.field) f.job = 'craftsman';
    }

    // ================= the beasts =================
    const herds = [];
    {
      let budget = 520;
      for (const f of pastures.slice().sort(() => rng() - 0.5)) {
        if (budget <= 0 || chance(0.45)) continue;
        const kind = wpick({ sheep: 4, goat: 1.6, cow: 2, horse: 0.8 });
        const n = Math.min(budget, kind === 'sheep' ? 8 + (rng() * 22 | 0) : kind === 'goat' ? 5 + (rng() * 10 | 0) : kind === 'cow' ? 3 + (rng() * 7 | 0) : 2 + (rng() * 5 | 0));
        const xs = f.poly.map(p => p[0]), ys = f.poly.map(p => p[1]), c = Math.cos(f.angle), s = Math.sin(f.angle);
        const cx = xs.reduce((a, b) => a + b) / 4, cy = ys.reduce((a, b) => a + b) / 4;
        const loc = f.poly.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
        const hu = Math.max(...loc.map(p => Math.abs(p[0]))) - 1.6, hv = Math.max(...loc.map(p => Math.abs(p[1]))) - 1.6;
        if (hu < 4 || hv < 4) continue;
        const H = { f, kind, cx, cy, c, s, hu, hv, mx: 0, my: 0, spread: kind === 'sheep' ? range(3, 6) : range(5, 10), beasts: [], shade: shadeNear(cx, cy, Math.max(hu, hv)) };
        H.pt = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
        H.clampU = (u, v) => [clamp(u, -hu, hu), clamp(v, -hv, hv)];
        H.mx = range(-hu, hu) * 0.5; H.my = range(-hv, hv) * 0.5;
        for (let k = 0; k < n; k++) {
          const [u, v] = H.clampU(H.mx + gauss() * H.spread, H.my + gauss() * H.spread * 0.7), [x, y] = H.pt(u, v);
          H.beasts.push(being(kind, { herd: H, u, v, x, y, z: hAt(x, y), speed: kind === 'horse' ? 1.3 : kind === 'cow' ? 0.7 : 0.6, look: rng() }));
        }
        budget -= n;
        herds.push(H);
      }
      // a shepherd for a flock, if there is anyone to spare, and his dog
      const spare = all.filter(a => a.job === 'craftsman' || a.job === 'porter').sort(() => rng() - 0.5);
      spare.length = Math.round(spare.length * 0.3);
      for (const H of herds) if ((H.kind === 'sheep' || H.kind === 'goat') && spare.length) {
        const m = spare.pop();
        m.job = 'shepherd'; m.herd = H; H.shepherd = m;
        if (chance(0.8)) H.dog = being('dog', { master: m, speed: 1.8, look: rng() });
      }
    }
    // the farms' beasts: a yoke of oxen, a donkey, a dog or two, hens
    for (const h of homes) if (h.kind === 'villa') {
      const b = h.b, [s1, t1, s2, t2] = b.hole;
      h.yard = [s1 + 1, t1 + 1, s2 - 1, t2 - 1];
      const [fx, fy] = h.front.out, at = { x: fx, y: fy, z: hAt(fx, fy) };
      h.oxen = [being('ox', { farm: h, speed: 0.85, look: rng(), ...at }), being('ox', { farm: h, speed: 0.85, look: rng(), ...at })];
      if (chance(0.7)) being('donkey', { farm: h, speed: 1, look: rng(), ...at });
      for (let k = 0, n = 1 + (rng() * 2 | 0); k < n; k++) being('dog', { farm: h, speed: 1.8, look: rng(), ...at });
      for (let k = 0, n = 5 + (rng() * 8 | 0); k < n; k++) being('hen', { farm: h, speed: 0.4, look: rng(), ...at });
      const ploughers = h.people.filter(p => p.job === 'farmer');
      if (ploughers.length) h.oxen.forEach(o => o.driver = ploughers[0]);
      ploughers[0] && (ploughers[0].team = h.oxen);
    }
    // hens behind some houses, in the yard by the back door
    for (const h of homes) if ((h.kind === 'house') && chance(0.25)) {
      const e = h.C.ents.find(e => e.kind === 'back');
      if (!e) continue;
      h.coop = e;
      for (let k = 0, n = 2 + (rng() * 4 | 0); k < n; k++) being('hen', { coop: e, speed: 0.4, look: rng() });
    }
    // dogs and cats about the streets
    const streetPts = (() => {
      const out = [], p = town.town, poly = town.town.outline;
      for (let k = 0; k < 4000 && out.length < 400; k++) {
        const x = range(p.x - p.hu * 1.2, p.x + p.hu * 1.2), y = range(p.y - p.hu * 1.2, p.y + p.hu * 1.2), kc = way.cellOf(x, y);
        if (kc < 0 || way.cost[kc] > 1.01 || way.comp[kc] !== mainComp) continue;
        // (inside the walls)
        let inn = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y) !== (poly[j][1] > y) && x < (poly[j][0] - poly[i][0]) * (y - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) inn = !inn;
        if (inn) out.push([x, y]);
      }
      return out;
    })();
    if (streetPts.length) {
      for (let k = 0, n = 5 + (rng() * 8 | 0); k < n; k++) { const [x, y] = choice(streetPts); being('dog', { stray: true, x, y, z: hAt(x, y), speed: 1.6, look: rng() }); }
      for (let k = 0, n = 3 + (rng() * 5 | 0); k < n; k++) { const [x, y] = choice(streetPts); being('cat', { stray: true, x, y, z: hAt(x, y), speed: 1.1, look: rng() }); }
    }
    // the roads' far ends, where travellers come from and go
    const ends = [];
    for (const r of town.roads) if (r.kind === 'via') {
      for (let q = r.points.length - 1; q > 0; q--) {
        const [x, y] = r.points[q];
        if (x > 4 && y > 4 && x < town.W - 4 && y < town.H - 4) {
          const k = way.snap(x, y, 4);
          if (k >= 0 && way.comp[k] === mainComp) { ends.push({ x, y, road: r, q }); break; }
        }
      }
    }
    // travellers: on foot, on horseback, with donkeys, with carts
    const travellers = [];
    // (country folk come in by day to the market, the forum, the shops, the temples)
    if (ends.length) for (let k = 0, n = 34 + (rng() * 16 | 0); k < n; k++) {
      const type = wpick({ walker: 9, rider: 2, donkeys: 2.5, cart: 1.6 });
      const t = type === 'rider' ? being('rider', { speed: range(1.5, 1.9), look: rng(), dress: 'tunic', sex: 'm', age: 'adult' })
        : person(null, chance(0.85) ? 'm' : 'f', 'adult', { job: 'traveller', dress: chance(0.3) ? 'cloak' : 'tunic' });
      t.traveller = type; t.vis = false; t.torchy = true;
      if (type === 'rider') t.man = person(null, 'm', 'adult', { ride: t, dress: chance(0.4) ? 'cloak' : 'tunic', vis: false, job: 'rider' });
      if (type === 'donkeys') t.train = Array.from({ length: 1 + (rng() * 3 | 0) }, () => being('donkey', { follow: t, speed: 1.1, look: rng(), laden: true, vis: false }));
      if (type === 'cart') {
        t.train = [being('ox', { follow: t, speed: 0.9, look: rng(), yoke: -1, vis: false }), being('ox', { follow: t, speed: 0.9, look: rng(), yoke: 1, vis: false })];
        t.cart = being('cart', { follow: t, look: rng(), load: choice(['amphorae', 'sacks', 'hay', 'stone', 'logs']), vis: false });
        t.speed = 0.85;
      }
      if (type === 'walker') t.carry = chance(0.6) ? 'bundle' : null;
      travellers.push(t);
    }
    // boats on the river
    const boats = [];
    if (town.river && town.river.points.length > 10) {
      const R = town.river, L = [0];
      for (let k = 1; k < R.points.length; k++) L.push(L[k - 1] + Math.hypot(R.points[k][0] - R.points[k - 1][0], R.points[k][1] - R.points[k - 1][1]));
      R.len = L;
      for (let k = 0, n = 1 + (rng() * 3 | 0); k < n; k++) boats.push(being('boat', { s: range(0.15, 0.85) * L[L.length - 1], dir: chance(0.5) ? 1 : -1, lane: range(0.15, 0.32) * R.width, speed: range(0.6, 1.1), look: rng(), load: choice(['amphorae', 'sacks', null]) }));
    }

    // ================= what each does at each hour =================
    // A day's plan, hour by hour: when each thing begins, from the night's
    // sixth hour before to the sixth after; the last thing goes on to the next
    const isMarket = day => (day + seed) % 8 === 0;             // the nundinae, every eighth day
    const isShow = day => ((day * 7 + seed) % 5) === 0;            // a play at the theatre
    const isGames = day => ((day * 11 + seed) % 9) === 0;          // games at the amphitheatre
    function plan(ag) {
      const P = [], at = (h, act, o = {}) => P.push({ at: h, act, ...o });
      const wake = range(-0.9, -0.3), bed = range(13, 14.6), day = clock.day, m = clock.month;
      const show = (isShow(day) && cavea) ? 'theatre' : (isGames(day) && amph) ? 'arena' : null;
      const goesToShow = show && chance(ag.age === 'child' ? 0.5 : 0.6);
      const winter = m === 11 || m === 0 || m === 1;
      at(-6, 'sleep');
      const afternoon = (alt) => {
        if (show === 'theatre' && ag.actor) at(7.3, 'perform'), at(10.7, 'home');
        else if (goesToShow) at(7.6, 'show', { where: show }), at(10.6, 'home');
        else alt();
      };
      switch (ag.job) {
        case 'farmer': {
          at(wake, 'eat');
          const market = isMarket(day) && chance(0.4);
          if (market) { at(wake + 0.4, 'sell'); at(5.5, 'home'); at(6, 'eat'); at(6.5, 'rest'); afternoon(() => at(8, 'baths')); at(9.8, 'home'); }
          else {
            at(wake + 0.3, 'field');
            if (!winter) { at(5.6, 'lunch'); at(6.7, 'field'); }
            at(winter ? 9 : 10.6, 'home');
          }
          at(11, 'eat'); at(12.2, 'home'); at(bed, 'sleep');
          break;
        }
        case 'shepherd': at(wake, 'eat'); at(wake + 0.3, 'pasture'); at(11, 'home'); at(11.3, 'eat'); at(12.2, 'home'); at(bed, 'sleep'); break;
        case 'fisher': at(wake - 0.3, 'river', { how: 'fish' }); at(3.5, 'sell'); at(6, 'eat'); at(6.5, 'rest'); at(8, 'river', { how: 'fish' }); at(10.6, 'home'); at(11.2, 'eat'); at(bed, 'sleep'); break;
        case 'craftsman': case 'porter': case 'shopkeeper': {
          if (ag.patron && chance(0.6)) at(wake, 'salutatio'); else at(wake, 'eat');
          const work = ag.job === 'craftsman' ? 'craft' : ag.job === 'porter' ? 'porter' : 'shopkeep';
          at(0.6, work);
          if (ag.job !== 'shopkeeper' && chance(0.7)) { at(range(2.2, 3.4), wpick({ forum: 2, temple: 1, market: 1, stroll: 1 })); at(4.2, work); }
          at(5.7, chance(0.4) && ag.job !== 'shopkeeper' ? 'eatout' : 'eat'); at(6.5, 'rest');
          afternoon(() => { at(7.4, ag.job === 'shopkeeper' ? 'shopkeep' : work); if (chance(0.8)) at(8.6, 'baths'); });
          at(10, 'home'); at(10.3, 'eat'); if (chance(0.25)) at(11.2, 'stroll'); at(12.2, 'home'); at(bed, 'sleep');
          break;
        }
        case 'patron': {
          at(wake, 'receive'); at(1.4, ag.magistrate ? 'tribunal' : 'forum'); at(5.8, 'eat'); at(6.4, 'rest');
          afternoon(() => at(7.6, 'baths'));
          at(9.6, 'cena', { guest: chance(0.3) ? choice(patrons.filter(p => p !== ag)) : null }); at(12.6, 'home'); at(bed, 'sleep');
          break;
        }
        case 'domina': {
          at(wake, 'home'); at(0.8, 'home'); at(1.6, wpick({ temple: 1, baths: 1.2, market: 1, home: 1 })); at(4, 'home'); at(5.8, 'eat'); at(6.4, 'rest');
          afternoon(() => at(7.6, 'home')); at(9.6, 'cena'); at(12.6, 'home'); at(bed, 'sleep');
          break;
        }
        case 'slave': {
          at(wake - 0.3, 'cook'); at(wake + 0.3, 'water'); at(1, 'chores'); at(2, chance(0.5) ? 'market' : 'water'); at(3.5, 'chores');
          at(5.2, 'cook'); at(6, 'chores'); at(7, 'water'); at(8, 'chores'); at(8.8, 'cook'); at(9.6, 'serve'); at(12, 'chores'); at(bed + 0.4, 'sleep');
          break;
        }
        case 'wife': {
          at(wake - 0.2, 'cook'); at(wake + 0.4, 'water');
          if (ag.home.coop || ag.home.kind === 'villa') { at(0.9, 'feed'); at(1.3, 'chores'); } else at(1.2, 'chores');
          at(2.4, wpick({ market: 2, temple: 0.7, river: town.river && banks.length ? 0.8 : 0, home: 1.2, forum: 0.4 }), { how: 'wash' });
          at(4.4, 'chores'); at(5.2, 'cook'); at(6, 'eat'); at(6.6, 'rest');
          afternoon(() => at(7.5, chance(0.35) ? 'baths' : 'chores'));
          at(8.8, 'cook'); at(9.6, 'eat'); if (ag.home.coop || ag.home.kind === 'villa') at(10.4, 'feed'); else if (chance(0.5)) at(10.5, 'water'); at(11.2, 'home'); at(bed, 'sleep');
          break;
        }
        case 'child': {
          const big = ag.pupil;
          at(wake + 0.2, 'eat');
          if (big && forum) at(0.4, 'school'); else at(0.4, 'play');
          at(5.8, 'eat'); at(6.5, ag.pupil ? 'play' : 'rest');
          afternoon(() => at(7.6, 'play'));
          at(10.4, 'home'); at(10.8, 'eat'); at(11.6, 'home'); at(bed - 1.2, 'sleep');
          break;
        }
        case 'old': at(wake + 0.2, 'eat'); at(1, 'door'); at(3.5, chance(0.4) ? 'temple' : 'door'); at(5.6, 'eat'); at(6.2, 'rest'); at(8, 'door'); at(10.2, 'home'); at(10.6, 'eat'); at(bed - 1, 'sleep'); break;
        case 'priest': at(wake, 'eat'); at(wake + 0.2, 'sacrifice'); at(2.2, 'precinct'); at(5.6, 'eat'); at(6.4, 'rest'); at(8, 'precinct'); at(10.5, 'home'); at(11, 'eat'); at(bed, 'sleep'); break;
        case 'teacher': at(wake, 'eat'); at(0.3, 'teach'); at(5.8, 'eat'); at(6.4, 'rest'); afternoon(() => at(7.8, 'baths')); at(10.2, 'home'); at(10.5, 'eat'); at(bed, 'sleep'); break;
        case 'attendant': at(wake, 'eat'); at(0.2, 'attend'); at(11, 'home'); at(11.3, 'eat'); at(bed, 'sleep'); break;
        case 'guard': at(wake, 'eat'); at(0, 'guard'); at(12, 'home'); at(12.3, 'eat'); at(bed, 'sleep'); break;
        case 'sentry':
          // half of them on the walls by day, half by night
          if (all.filter(a => a.job === 'sentry').indexOf(ag) % 2 === 0) { at(wake, 'eat'); at(0, 'sentry'); at(12, 'home'); at(12.3, 'eat'); at(bed, 'sleep'); break; }
          // falls through
        case 'watch':
          P.length = 0;
          at(-6, ag.job === 'watch' ? 'patrol' : 'sentry'); at(-0.3, 'home'); at(0.2, 'sleep'); at(7.5, 'home'); at(9.5, 'eat'); at(11, 'home');
          at(12.3, ag.job === 'watch' ? 'patrol' : 'sentry');
          break;
        case 'traveller': at(-6, 'travel'); break;
        default: at(wake, 'eat'); at(1, 'chores'); at(5.8, 'eat'); at(6.4, 'rest'); at(7.6, 'chores'); at(10, 'eat'); at(bed, 'sleep');
      }
      return P.sort((p, q) => p.at - q.at);
    }

    // ---- the legs of what one does: going, staying, out of sight ----
    let warm = false;
    const place = (ag, sp) => { ag.x = sp.x; ag.y = sp.y; ag.z = Number.isFinite(sp.z) ? sp.z : groundZ(sp.x, sp.y); ag.a = sp.a ?? ag.a; ag.cl = sp.cl || null; };
    // there: walking (on a warm start, already there)
    function go(ag, sp, o = {}) {
      if (warm && !ag.placed) { place(ag, sp); ag.placed = true; if (o.carry !== undefined) ag.carry = o.carry; return; }
      ag.legs.push({ k: 'go', sp, ...o });
    }
    function stay(ag, sp, until, o = {}) {
      if (warm && !ag.placed) { place(ag, sp); ag.placed = true; }
      ag.legs.push({ k: 'stay', sp, until, ...o });
    }
    const hide = (ag, until) => ag.legs.push({ k: 'hide', until });
    const call = (ag, fn) => ag.legs.push({ k: 'call', fn });
    const short = (until, a, b) => Math.min(until, now + range(a, b));

    // ---- the home: its spots ----
    const H = ag => ag.home;
    const homeIn = h => spot(...h.front.inn, NaN, 0, 'stand', { cl: h.C });
    const bedOf = ag => {
      const h = H(ag);
      if (!ag.bed) {
        if (h.upstairs || !h.S) ag.bed = 'up';
        else {
          const free = h.S.beds.filter(b => b.used < (ag.age === 'adult' || ag.age === 'old' ? 2 : 1));
          const bb = ag.job !== 'slave' && free.length ? free[0] : null;
          if (bb) {
            const o = bb.used++ ? 0.22 : bb.lat > 1.1 ? -0.22 : 0;
            ag.bed = spot(bb.x - Math.sin(bb.a) * o, bb.y + Math.cos(bb.a) * o, bb.z, bb.a, 'lie', { cl: h.C });
          } else {
            const r = h.S.rooms.length ? choice(h.S.rooms) : null, s = r && roomSpot(r.b, r.r, 'lie');
            ag.bed = s ? { ...s, z: s.z + 0.04 } : 'up';
          }
        }
      }
      return ag.bed;
    };
    // a place nobody else has taken (for as long as one is to be there)
    function take(list, ag, till = now + 900) {
      const ok = list.filter(s => !s.by || s.by === ag || now > s.till);
      if (!ok.length) return null;
      const s = choice(ok);
      s.by = ag; s.till = till;
      return s;
    }
    const homeSpot = (ag, what, till) => {
      const h = H(ag), S = h.S;
      if (h.upstairs || !S) return null;
      const C = h.C;
      if (what === 'seat') { const s = take(S.seats, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'sit', { seat: 0.42, stool: true, cl: C, table: s.table }); }
      if (what === 'bench') { const s = take(S.benches, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'sit', { seat: s.seat, cl: C }); }
      if (what === 'hearth') { const s = take(S.hearths, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'stand', { anim: 'cook', cl: C }); }
      if (what === 'room' && S.rooms.length) { const r = choice(S.rooms); return roomSpot(r.b, r.r); }
      if (what === 'store' && S.stores.length) { const s = choice(S.stores); return spot(s.x, s.y, s.z, s.a, 'stand', { cl: C }); }
      return null;
    };
    // by the front door, outside, on a stool
    const doorSpot = h => {
      const e = h.front, [ox, oy] = e.out, [ix, iy] = e.inn, a = Math.atan2(oy - iy, ox - ix), side = chance(0.5) ? 1 : -1;
      // (either side of the door, whichever is free)
      for (const sg of [side, -side, side * 2, -side * 2]) {
        const x = ox - Math.cos(a) * 0.5 - Math.sin(a) * sg * 1.1, y = oy - Math.sin(a) * 0.5 + Math.cos(a) * sg * 1.1;
        let busy = false;
        around(x, y, 1, o => { if (o.kind === 'person' && Math.hypot(o.x - x, o.y - y) < 0.7) busy = true; });
        if (!busy && way.costAt(x, y) < Infinity) return spot(x, y, NaN, a, 'sit', { seat: 0.4, stool: true, cl: null });
      }
      return spot(ox, oy, NaN, a, 'stand', { cl: null });
    };
    function atHome(ag, until, what) {
      const h = H(ag);
      if (h.upstairs || !h.S) { go(ag, homeIn(h)); hide(ag, until); return; }
      const sp = homeSpot(ag, what, until) || homeSpot(ag, 'room') || homeSpot(ag, 'seat', until) || homeSpot(ag, 'bench', until);
      if (!sp) { go(ag, homeIn(h)); hide(ag, until); return; }
      go(ag, sp); stay(ag, sp, until);
    }
    // a place's spot: a group to talk in, at the forum, the nymphaeum, the market
    const groups = new Map();
    function talkSpot(key, pts, maxN = 5) {
      if (!pts.length) return null;
      let list = groups.get(key);
      if (!list) groups.set(key, list = []);
      const open = list.filter(g => g.n < maxN);
      let G = open.length && chance(0.75) ? choice(open) : null;
      if (!G) { const [x, y] = choice(pts); G = { x, y, n: 0, key }; list.push(G); }
      G.n++;
      const t = rng() * TAU, r = range(0.55, 0.85), x = G.x + Math.cos(t) * r, y = G.y + Math.sin(t) * r;
      return spot(x, y, NaN, t + Math.PI + range(-0.3, 0.3), 'stand', { anim: 'talk', group: G, cl: null });
    }
    const leaveGroup = ag => { const G = ag.group; if (G) { G.n--; if (G.n <= 0) { const l = groups.get(G.key); l.splice(l.indexOf(G), 1); } ag.group = null; } };

    // ---- the acts ----
    // the long things people do that they break off from now and then
    const BREAKS = new Set(['craft', 'shopkeep', 'field', 'chores', 'home', 'attend', 'precinct', 'door', 'porter', 'river']);
    // over to someone, to talk a while; they turn to whoever comes
    function meet(ag, o, dur, then = []) {
      const C = ag.cl;
      const ch = o.chat && now < o.chat.until && o.chat.n < 5 ? o.chat : null;
      let x, y;
      if (ch) { const a = rng() * TAU; x = ch.x + Math.cos(a) * 0.8; y = ch.y + Math.sin(a) * 0.8; }
      else { const d = Math.hypot(ag.x - o.x, ag.y - o.y) || 1, r = o.pose === 'sit' ? 0.95 : 0.8; x = o.x + (ag.x - o.x) / d * r; y = o.y + (ag.y - o.y) / d * r; }
      const OC = o.cl || null;
      if (!(OC ? standable({ cl: OC }, x, y) : way.costAt(x, y) < Infinity)) return false;
      const until = now + dur, chat = ch || { x: (x + o.x) / 2, y: (y + o.y) / 2, n: 1, until };
      chat.n++;
      ag.chat = o.chat = chat;
      const t = spot(x, y, OC ? floorAt(OC, x, y) : NaN, Math.atan2(o.y - y, o.x - x), 'stand', { cl: OC });
      if (o.leg && o.leg.k === 'stay') { o.leg.talk = { until: Math.max(o.leg.talk && o.leg.talk.until || 0, until + 60), with: ag }; o.leg.idle = 0; o.leg.until = Math.max(o.leg.until, now + 30); }
      drop(ag);
      ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until, talk: { until, with: o } }, ...then);
      void C;
      return true;
    }
    const ACT = {
      interlude(ag, e, until) {
        // a break: a word with someone about, a bite at a counter, a drink at
        // the fountain, a turn about; in the fields, a rest in the shade
        const dur = until - now;
        if (e.act === 'field' && ag.field) return ACT.lunch(ag, e, until);
        const r = rng();
        if (r < 0.45) {
          const o = personNear(ag, 40, o => o.vis && o.leg && o.leg.k === 'stay' && o.leg.sp && (o.pose === 'stand' || o.pose === 'sit') && (!o.anim || o.anim === 'craft' || o.anim === 'talk')
            && !o.leg.drift && !o.leg.run && !o.leg.play && (o.age === 'child') === (ag.age === 'child') && Math.abs(o.z - ag.z) < 1.5 && (!o.cl || o.cl === ag.cl || (o.home && o.cl === o.home.C && chance(0.5))));
          if (o && meet(ag, o, dur)) return;
        }
        if (r < 0.7 && counters.length) {
          const near = counters.filter(c => Math.hypot(c.buy.x - ag.x, c.buy.y - ag.y) < 150), c = near.length ? choice(near) : null;
          if (c) { const sp = spot(c.buy.x + range(-0.4, 0.4), c.buy.y + range(-0.4, 0.4), c.buy.z, c.buy.a, 'stand', { anim: 'eat', cl: clusterOf(c.b) }); go(ag, sp); stay(ag, sp, until, { atCounter: c }); return; }
        }
        if (r < 0.85 && fountains.length) {
          const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y))[0], s = choice(f.spots);
          const sp = spot(s.x, s.y, NaN, s.a, 'bend', { anim: 'fill', cl: null });
          go(ag, sp); stay(ag, sp, now + range(20, 50));
          const a = rng() * TAU, x = s.x + Math.cos(a) * 1.5, y = s.y + Math.sin(a) * 1.5;
          if (way.costAt(x, y) < Infinity) { const t = spot(x, y, NaN, Math.atan2(s.y - y, s.x - x), 'stand', { cl: null }); go(ag, t); stay(ag, t, until); }
          return;
        }
        ACT.stroll(ag, e, until);
      },
      sleep(ag, e, until) {
        const b = bedOf(ag);
        if (b === 'up') { go(ag, homeIn(H(ag))); hide(ag, until); return; }
        go(ag, b); stay(ag, b, until);
      },
      home(ag, e, until) { atHome(ag, short(until, 300, 1500), choice(['seat', 'bench', 'room', 'room', 'seat'])); },
      chores(ag, e, until) {
        const what = ag.sex === 'f' ? choice(['hearth', 'room', 'room', 'store', 'bench', 'seat']) : choice(['room', 'store', 'room', 'seat']);
        // (sweeping, now and then)
        const sw = ag.age !== 'child' && chance(0.25) && homeSpot(ag, 'room');
        if (sw) { sw.pose = 'bend'; sw.anim = 'sweep'; go(ag, sw); stay(ag, sw, short(until, 60, 240)); return; }
        atHome(ag, short(until, 120, 700), what);
      },
      eat(ag, e, until) { atHome(ag, until, H(ag).S && H(ag).S.seats.length ? 'seat' : 'bench'); },
      cook(ag, e, until) { atHome(ag, until, 'hearth'); },
      rest(ag, e, until) {
        const b = bedOf(ag);
        if (b !== 'up' && chance(0.7)) { go(ag, b); stay(ag, b, until); return; }
        atHome(ag, until, 'bench');
      },
      door(ag, e, until) { const sp = doorSpot(H(ag)); go(ag, sp); stay(ag, sp, until); },
      water(ag, e, until) {
        if (ag.watered === e || !fountains.length) return atHome(ag, until, 'room');
        ag.watered = e;
        const h = H(ag), [hx, hy] = h.front.out;
        const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - hx, p.b.y - hy) - Math.hypot(q.b.x - hx, q.b.y - hy))[rng() < 0.8 ? 0 : 1] || fountains[0];
        const s = choice(f.spots), sp = spot(s.x, s.y, NaN, s.a, 'bend', { anim: 'fill', cl: null });
        go(ag, sp, { carry: 'jar' }); stay(ag, sp, now + range(40, 120));
        call(ag, () => { ag.carry = 'jar-full'; });
        // a word with the neighbours at the fountain, now and then
        if (chance(0.35)) { const a = rng() * TAU, x = s.x + Math.cos(a) * 1.4, y = s.y + Math.sin(a) * 1.4; if (way.costAt(x, y) < Infinity) { const t = spot(x, y, NaN, a + Math.PI, 'stand', { anim: 'talk', cl: null }); stay(ag, t, now + range(90, 400)); } }
        const back = homeSpot(ag, 'hearth') || homeSpot(ag, 'store') || homeIn(h);
        go(ag, back); stay(ag, back, now + 20);
        call(ag, () => { ag.carry = null; });
      },
      market(ag, e, until) {
        if (ag.shopped === e) return atHome(ag, short(until, 300, 900), 'room');
        ag.shopped = e;
        const n = 1 + (rng() * 3 | 0);
        ag.carry = 'basket';
        for (let k = 0; k < n; k++) {
          const c = market && stalls.length && chance(0.6) ? choice(stalls) : counters.length ? choice(counters) : null;
          if (!c) break;
          const sp = spot(c.buy.x + range(-0.3, 0.3), c.buy.y + range(-0.3, 0.3), c.buy.z, c.buy.a, 'stand', { anim: 'talk', cl: clusterOf(c.b) });
          go(ag, sp); stay(ag, sp, now + range(60, 240), { atCounter: c });
        }
        const back = homeSpot(ag, 'store') || homeIn(H(ag));
        go(ag, back); stay(ag, back, now + 15); call(ag, () => { ag.carry = null; });
      },
      forum(ag, e, until) {
        leaveGroup(ag);
        const r = rng();
        if (r < 0.2 && naveSpots && naveSpots.tribunal) {
          const t = naveSpots.tribunal, d = range(4, 10), o = range(-4, 4);
          const x = t.x + Math.cos(t.a) * d - Math.sin(t.a) * o, y = t.y + Math.sin(t.a) * d + Math.cos(t.a) * o;
          if (way.costAt(x, y) < Infinity) { const sp = spot(x, y, NaN, t.a + Math.PI + range(-0.3, 0.3), 'stand', { cl: null }); go(ag, sp); stay(ag, sp, short(until, 300, 1200)); return; }
        }
        if (r < 0.3 && counters.length) { const c = choice(counters), sp = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { anim: 'talk', cl: clusterOf(c.b) }); go(ag, sp); stay(ag, sp, short(until, 60, 300), { atCounter: c }); return; }
        const sp = talkSpot('forum', forumPts);
        if (!sp) return atHome(ag, until, 'seat');
        ag.group = sp.group;
        go(ag, sp); stay(ag, sp, short(until, 300, 1500)); call(ag, () => leaveGroup(ag));
      },
      stroll(ag, e, until) {
        const sp = nymph && chance(0.5) ? talkSpot('nymph', nymphPts, 4) : talkSpot('forum', forumPts);
        if (!sp) return atHome(ag, until, 'seat');
        ag.group = sp.group;
        go(ag, sp); stay(ag, sp, short(until, 600, 1800)); call(ag, () => leaveGroup(ag));
      },
      tribunal(ag, e, until) {
        if (!naveSpots || !naveSpots.tribunal) return ACT.forum(ag, e, until);
        const t = naveSpots.tribunal, o = (ag.id % 2 ? -0.7 : 0.7);
        const sp = spot(t.x - Math.sin(t.a) * o, t.y + Math.cos(t.a) * o, t.z, t.a, 'sit', { seat: 0.45, cl: null });
        go(ag, sp); stay(ag, sp, until);
      },
      receive(ag, e, until) {
        // in his chair in his atrium, beyond the pool, facing the door the clients come in by
        const sp = atriumSpot(H(ag), true);
        if (!sp) return atHome(ag, until, 'seat');
        sp.pose = 'sit'; sp.seat = 0.45; sp.stool = true;
        go(ag, sp); stay(ag, sp, until);
      },
      salutatio(ag, e, until) {
        const sp = atriumSpot(ag.patron.home, false);
        if (!sp) return ACT.eat(ag, e, until);
        go(ag, sp); stay(ag, sp, short(until, 600, 1800));
      },
      cena(ag, e, until) {
        const host = e.guest || ag, h = host.home;
        const couches = h.S ? h.S.couches : [];
        if (!couches.length) return ACT.eat(ag, e, until);
        // three to a couch, side by side, all lying the same way along it,
        // slanting, the heads towards the table; the host first
        let c = null, slot = -1;
        for (const q of couches) {
          q.slots = q.slots || [null, null, null];
          for (let k = 0; k < 3 && slot < 0; k++) { const o = q.slots[k]; if (!o || o.by === ag || now > o.till) { c = q; slot = k; } }
          if (c) break;
        }
        if (!c) return ACT.eat(ag, e, until);
        c.slots[slot] = { by: ag, till: until };
        if (c.end === undefined) c.end = chance(0.5) ? 0 : Math.PI;
        const o = (slot - 1) * 0.58, toward = c.a + Math.PI / 2 * (c.side === 0 || c.side === 1 ? 1 : -1);
        const sp = spot(c.x + Math.cos(c.a) * o, c.y + Math.sin(c.a) * o, c.z, c.a + c.end + turn(c.a + c.end, toward) * 0.42, 'recline', { cl: h.C, table: c.table });
        go(ag, sp); stay(ag, sp, until);
      },
      serve(ag, e, until) {
        const S = H(ag).S, c = S && S.couches[0];
        if (!c) return ACT.chores(ag, e, until);
        const x = c.x + Math.cos(c.a + Math.PI / 2) * 1.2, y = c.y + Math.sin(c.a + Math.PI / 2) * 1.2;
        const sp = spot(x, y, c.z - 0.5, c.a - Math.PI / 2, 'stand', { cl: H(ag).C });
        go(ag, sp); stay(ag, sp, short(until, 200, 600));
        const k = homeSpot(ag, 'hearth');
        if (k) { go(ag, k); stay(ag, k, now + range(60, 200)); }
      },
      craft(ag, e, until) {
        const h = H(ag);
        if (chance(0.65) || h.upstairs) { const sp = doorSpot(h); sp.anim = 'craft'; go(ag, sp); stay(ag, sp, until); }
        else atHome(ag, until, 'seat');
        if (ag.legs.length) ag.legs[ag.legs.length - 1].sp.anim = 'craft';
      },
      shopkeep(ag, e, until) {
        // on a stool by the counter, up to serve whoever comes to it
        const h = H(ag), c = counters.find(c => c.b === h.b);
        if (!c) return ACT.craft(ag, e, until);
        const sp = spot(c.sell.x, c.sell.y, c.sell.z, c.sell.a, 'sit', { seat: 0.42, stool: true, cl: h.C });
        c.keeper = ag;
        go(ag, sp); stay(ag, sp, until, { counter: c });
      },
      eatout(ag, e, until) {
        if (!counters.length) return ACT.eat(ag, e, until);
        const c = choice(counters), sp = spot(c.buy.x + range(-0.4, 0.4), c.buy.y + range(-0.4, 0.4), c.buy.z, c.buy.a, 'stand', { anim: 'eat', cl: clusterOf(c.b) });
        go(ag, sp); stay(ag, sp, short(until, 600, 1500), { atCounter: c });
      },
      porter(ag, e, until) {
        // from a gate to a shop, the market or the forum, a jar on his shoulder, and back
        if (!gates.length || !counters.length) return ACT.craft(ag, e, until);
        const G = choice(gates), [ix, iy] = G.inner;
        const pick = spot(ix + range(-2, 2), iy + range(-2, 2), NaN, Math.atan2(G.uy, G.ux), 'bend', { cl: null });
        go(ag, pick, { carry: null }); stay(ag, pick, now + range(30, 90));
        call(ag, () => { ag.carry = 'amphora'; ag.speed *= 0.85; });
        const c = choice(counters), drop = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'bend', { cl: clusterOf(c.b) });
        go(ag, drop); stay(ag, drop, now + range(15, 40));
        call(ag, () => { ag.carry = null; ag.speed /= 0.85; });
      },
      field(ag, e, until) {
        const f = ag.field;
        if (!f) return ACT.craft(ag, e, until);
        const W = fieldWork(f, ag);
        if (W.sp.anim === 'plough') {
          // the oxen led out to the field, and home again after
          call(ag, () => { ag.train = ag.team; ag.team.forEach((o, k) => { o.follow = ag; o.yoke = k ? 1 : -1; o.legs.length = 0; o.leg = null; }); });
          if (warm && !ag.placed) ag.train = ag.team, ag.team.forEach((o, k) => { o.follow = ag; o.yoke = k ? 1 : -1; });
        }
        go(ag, W.sp, { carry: W.tool }); stay(ag, W.sp, until, { drift: W });
        if (W.sp.anim === 'plough') call(ag, () => { ag.train = null; ag.trail = null; ag.team.forEach(o => { o.follow = null; o.ploughing = false; o.yoke = 0; }); });
      },
      lunch(ag, e, until) {
        const f = ag.field;
        if (!f) return ACT.eat(ag, e, until);
        const [cx, cy] = f.poly.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
        const t = shadeNear(cx, cy, 70), p = t && shadeOf(t);
        const [x, y] = p || [ag.x, ag.y];
        const sp = spot(x, y, NaN, range(0, TAU), chance(0.3) ? 'lie' : 'sit', { seat: 0, cl: null });
        go(ag, sp); stay(ag, sp, until);
      },
      pasture(ag, e, until) {
        // out to the flock; then sitting by it, or in the shade, watching it,
        // and now and then round to a stray, from beyond it, to turn it back
        const Hd = ag.herd;
        if (!Hd) return ACT.craft(ag, e, until);
        const [cx, cy] = Hd.pt(Hd.mx, Hd.my), local = (x, y) => [(x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c];
        const [au, av] = local(ag.x, ag.y), there = !ag.cl && Math.abs(au) < Hd.hu + 1 && Math.abs(av) < Hd.hv + 1;
        const seat = () => {
          const t = clock.R > 5 && clock.R < 8 && Hd.shade && shadeOf(Hd.shade);
          let p = t && Math.abs(local(...t)[0]) < Hd.hu && Math.abs(local(...t)[1]) < Hd.hv ? t : null;
          if (!p) { const a = rng() * TAU, r = Hd.spread * 1.6 + 2; p = Hd.pt(...Hd.clampU(...local(cx + Math.cos(a) * r, cy + Math.sin(a) * r))); }
          return spot(p[0], p[1], NaN, Math.atan2(cy - p[1], cx - p[0]), 'sit', { seat: 0, cl: null });
        };
        ag.carry = 'staff';
        if (!there || warm) { const sp = seat(); go(ag, sp, { carry: 'staff' }); stay(ag, sp, short(until, 300, 900)); return; }
        let far = null, fd = 0;
        for (const b of Hd.beasts) { const d = Math.hypot(b.x - cx, b.y - cy); if (d > fd) { fd = d; far = b; } }
        if (far && fd > Hd.spread * 1.4 && chance(0.6)) {
          const [x, y] = Hd.pt(...Hd.clampU(...local(far.x + (far.x - cx) / fd * 2, far.y + (far.y - cy) / fd * 2)));
          ag.legs.push({ k: 'trot', x, y, speed: 1.15, pose: 'walk' });
          ag.legs.push({ k: 'stay', sp: spot(x, y, NaN, Math.atan2(cy - y, cx - x), 'stand', { anim: 'shoo', cl: null }), until: now + range(6, 15) });
          return;
        }
        const sp = seat();
        ag.legs.push({ k: 'trot', x: sp.x, y: sp.y, speed: 1, pose: 'walk' });
        stay(ag, sp, short(until, 240, 900));
      },
      feed(ag, e, until) {
        // the hens fed, grain scattered from a basket; they come running
        const h = H(ag);
        let sp;
        if (h.kind === 'villa' && h.yard) { const [s1, t1, s2, t2] = h.yard, [x, y] = toWorld(h.b, (s1 + s2) / 2 + range(-2, 2), (t1 + t2) / 2 + range(-2, 2)); sp = spot(x, y, fz(h.b), range(0, TAU), 'stand', { anim: 'scatter', cl: h.C }); }
        else if (h.coop) { const [x, y] = h.coop.out; sp = spot(x, y, NaN, range(0, TAU), 'stand', { anim: 'scatter', cl: null }); }
        else return ACT.chores(ag, e, until);
        go(ag, sp, { carry: 'basket' }); stay(ag, sp, short(until, 150, 360)); call(ag, () => { ag.carry = null; });
      },
      sell(ag, e, until) {
        // at a stall of the market, if one is free; or sitting on the ground
        // with a basket of what he grew or caught
        const st = stalls.find(c => !c.keeper);
        if (st) {
          st.keeper = ag;
          const sp = spot(st.sell.x, st.sell.y, st.sell.z, st.sell.a, 'sit', { seat: 0.42, stool: true, cl: clusterOf(st.b) });
          go(ag, sp, { carry: 'basket' }); call(ag, () => { ag.carry = null; }); stay(ag, sp, until, { counter: st });
          return;
        }
        const pts = market ? market.pts : forumPts;
        if (!pts.length) return ACT.craft(ag, e, until);
        const [x, y] = choice(pts), C = market ? market.C : null;
        const sp = spot(x, y, C ? fz(market.b) : NaN, range(0, TAU), 'sit', { seat: 0, cl: C, anim: 'sell' });
        go(ag, sp, { carry: 'basket' }); call(ag, () => { ag.carry = null; ag.prop = { kind: 'basket', x: ag.x + Math.cos(ag.a) * 0.6, y: ag.y + Math.sin(ag.a) * 0.6, z: ag.z }; });
        stay(ag, sp, until); call(ag, () => { ag.prop = null; });
      },
      school(ag, e, until) {
        const s = schoolSpot(false);
        if (!s) return ACT.play(ag, e, until);
        go(ag, s); stay(ag, s, until);
      },
      teach(ag, e, until) {
        const s = schoolSpot(true);
        if (!s) return ACT.forum(ag, e, until);
        go(ag, s); stay(ag, s, until);
      },
      play(ag, e, until) {
        // with the other children of the street: chasing one another, crouched together over a game
        const h = H(ag), [hx, hy] = h.front.out;
        let P = plays.find(p => p.kids.size < 7 && Math.hypot(p.x - hx, p.y - hy) < 35 && way.los([p.x, p.y], [hx, hy]));
        if (!P) { P = { x: hx, y: hy, kids: new Set() }; plays.push(P); }
        const sp = spot(P.x + range(-2, 2), P.y + range(-2, 2), NaN, 0, 'stand', { cl: null });
        go(ag, sp); stay(ag, sp, short(until, 600, 2400), { play: { x: P.x, y: P.y, r: 9, next: 0, P } });
      },
      baths(ag, e, until) {
        if (!bath) return ACT.home(ag, e, until);
        if (ag.bathed === e) return ACT.stroll(ag, e, until);
        ag.bathed = e;
        const r = rng(), [x, y] = choice(bath.court.length ? bath.court : [[bath.pal.x, bath.pal.y]]);
        const ex = spot(x, y, fz(bath.pal), range(0, TAU), 'stand', { cl: bath.C, anim: r < 0.4 ? 'exercise' : r < 0.7 ? 'ball' : 'talk' });
        go(ag, ex); stay(ag, ex, now + range(600, 1500), r < 0.4 ? { run: { x, y, r: range(2.2, 3.5) } } : {});
        const bench = take(bath.benches, ag, now + 1800);
        if (bench) { go(ag, bench); stay(ag, bench, now + range(300, 700)); }
        if (bath.pools.length) { const p = choice(bath.pools); go(ag, p); stay(ag, p, now + range(400, 900)); }
        if (bath.pool && chance(0.4)) {
          const [px, py] = bath.pool.poly.reduce((a, p) => [a[0] + p[0] / bath.pool.poly.length, a[1] + p[1] / bath.pool.poly.length], [0, 0]);
          const sp = spot(px + range(-1.5, 1.5), py + range(-1.5, 1.5), fz(bath.pal) - 0.05, range(0, TAU), 'swim', { cl: bath.C });
          go(ag, sp); stay(ag, sp, now + range(200, 500));
        }
      },
      attend(ag, e, until) {
        if (!bath) return ACT.craft(ag, e, until);
        const sp = (bath.pools.length && chance(0.6)) ? (() => { const p = choice(bath.pools); return spot(p.x + 1.4, p.y, p.z, range(0, TAU), 'stand', { cl: p.cl }); })() : spot(...choice(bath.court), fz(bath.pal), range(0, TAU), 'bend', { anim: 'sweep', cl: bath.C });
        go(ag, sp); stay(ag, sp, short(until, 600, 1800));
      },
      temple(ag, e, until) {
        if (!altars.length) return ACT.home(ag, e, until);
        if (ag.prayed === e) return atHome(ag, until, 'seat');
        ag.prayed = e;
        const A = choice(altars), d = range(2.5, 6), o = range(-3, 3);
        const x = A.b.x + A.ux * d - A.uy * o, y = A.b.y + A.uy * d + A.ux * o;
        const sp = spot(x, y, NaN, A.out + Math.PI + range(-0.2, 0.2), 'stand', { anim: 'pray' });
        go(ag, sp, { carry: chance(0.4) ? 'basket' : null }); stay(ag, sp, now + range(200, 700)); call(ag, () => { ag.carry = null; });
      },
      sacrifice(ag, e, until) {
        const A = altars[all.filter(a => a.job === 'priest').indexOf(ag) % Math.max(1, altars.length)];
        if (!A) return ACT.forum(ag, e, until);
        const sp = spot(A.priest.x, A.priest.y, NaN, A.priest.a, 'stand', { anim: 'pray' });
        go(ag, sp); stay(ag, sp, until);
      },
      precinct(ag, e, until) {
        const A = altars[all.filter(a => a.job === 'priest').indexOf(ag) % Math.max(1, altars.length)];
        if (!A) return ACT.forum(ag, e, until);
        const x = A.b.x + A.ux * range(1, 4) - A.uy * range(-5, 5), y = A.b.y + A.uy * range(1, 4) + A.ux * range(-5, 5);
        const sp = way.costAt(x, y) < Infinity || clusterAt(x, y) ? spot(x, y, NaN, range(0, TAU), 'stand') : spot(A.priest.x, A.priest.y, NaN, A.priest.a, 'stand');
        go(ag, sp); stay(ag, sp, short(until, 300, 1200));
      },
      guard(ag, e, until) {
        // two to a gate, by one side of it: talking as they watch the road, or sitting a while
        const idx = all.filter(a => a.job === 'guard').indexOf(ag), gi = (idx >> 1) % Math.max(1, gates.length), G = gates[gi];
        if (!G) return ACT.craft(ag, e, until);
        const g = G.guards[gi % 2], o = idx % 2 ? 0.45 : -0.45, x = g.x + G.ux * o, y = g.y + G.uy * o;
        ag.sitting = !ag.sitting;
        const sp = spot(x, y, NaN, g.a + (idx % 2 ? -0.9 : 0.9), ag.sitting ? 'sit' : 'stand', ag.sitting ? { seat: 0.42, stool: true, cl: null } : { anim: 'talk', cl: null });
        go(ag, sp, { carry: 'spear' }); stay(ag, sp, short(until, 480, 1200));
      },
      patrol(ag, e, until) {
        // the watch, two by two, from place to place with their torches
        const targets = [...gates.map(G => G.inner), ...fountains.map(f => [f.spots[0].x, f.spots[0].y]), ...forumPts.slice(0, 6)];
        if (!targets.length) return atHome(ag, until, 'room');
        const [x, y] = choice(targets), sp = spot(x + range(-1, 1), y + range(-1, 1), NaN, range(0, TAU), 'stand', { cl: null });
        go(ag, sp, { torch: true, carry: 'torch' }); stay(ag, sp, now + range(60, 240), { torch: true });
      },
      sentry(ag, e, until) {
        // up at a gate and along the wall walk to the next gate and back, a
        // spear on the shoulder (a torch by night), stopping at the towers to look out
        const idx = all.filter(a => a.job === 'sentry').indexOf(ag), n = gates.length;
        if (!n || !wallWalk.pts.length) return ACT.patrol(ag, e, until);
        const night = clock.R > 11.8 || clock.R < 0, i = (idx >> 1) % n, G = gates[i], [ix, iy] = G.inner;
        go(ag, spot(ix, iy, NaN, 0, 'stand', { cl: null }), night ? { torch: true, carry: 'torch' } : { carry: 'spear' });
        ag.legs.push({ k: 'wall', from: wallWalk.atGate[i], to: wallWalk.atGate[(i + 1) % n], until, night });
      },
      river(ag, e, until) {
        if (!banks.length) return ACT.chores(ag, e, until);
        const [hx, hy] = H(ag).front.out, list = banks.slice().sort((p, q) => Math.hypot(p.x - hx, p.y - hy) - Math.hypot(q.x - hx, q.y - hy)).slice(0, 12);
        const b = choice(list), fish = e.how === 'fish' || ag.job === 'fisher';
        const sp = spot(b.x, b.y, NaN, b.a, fish ? 'stand' : 'kneel', { anim: fish ? 'fish' : 'wash', cl: null });
        go(ag, sp, { carry: fish ? 'rod' : 'bundle' }); stay(ag, sp, fish ? until : short(until, 1800, 3600));
        call(ag, () => { ag.carry = null; });
      },
      show(ag, e, until) {
        const s = e.where === 'theatre' ? theatreSeat() : arenaSeat();
        if (!s) return ACT.stroll(ag, e, until);
        go(ag, s.foot); ag.legs.push({ k: 'climb', pts: s.climb });
        stay(ag, s.sp, until);
        ag.legs.push({ k: 'climb', pts: s.climb.slice().reverse() });
      },
      perform(ag, e, until) {
        // up from the orchestra onto the stage, and about it, declaiming
        const st = stage, c = cavea, top = st.z0 + st.h;
        const [x, y] = toWorld(st, range(1.5, st.w - 1.5), range(1, st.d - 1)), face = Math.atan2(c.y - y + Math.sin(c.angle) * 10, c.x - x + Math.cos(c.angle) * 10);
        const sp = spot(x, y, top, face, 'stand', { anim: 'talk', cl: null });
        if (ag.onStage === e) ag.legs.push({ k: 'climb', pts: [[ag.x, ag.y, top], [x, y, top]] });
        else {
          const fx = c.x + Math.cos(c.angle) * 1.5, fy = c.y + Math.sin(c.angle) * 1.5;
          go(ag, spot(fx, fy, NaN, 0, 'stand', { cl: null }));
          ag.legs.push({ k: 'climb', pts: [[fx, fy, hAt(fx, fy)], [c.x - Math.cos(c.angle) * 0.6, c.y - Math.sin(c.angle) * 0.6, top], [x, y, top]] });
          ag.onStage = e;
        }
        stay(ag, sp, short(until, 40, 160));
      },
      travel(ag) { travel(ag); },
    };
    // in an atrium: the master beyond its pool, the callers between it and the door
    function atriumSpot(h, master) {
      const atrium = h.C.bs.find(b => b.hole && b.use === 'domus');
      if (!atrium) return null;
      const [s1, t1, s2, t2] = atrium.hole, [hx, hy] = toWorld(atrium, (s1 + s2) / 2, (t1 + t2) / 2);
      const [ex, ey] = h.front.inn, d = Math.hypot(ex - hx, ey - hy) || 1, ux = (ex - hx) / d, uy = (ey - hy) / d;
      const r = Math.max(s2 - s1, t2 - t1) / 2 + 1.1, a = Math.atan2(uy, ux);
      if (master) return spot(hx - ux * r, hy - uy * r, fz(atrium), a, 'stand', { anim: 'talk', cl: h.C });
      const q = range(r, Math.max(r + 0.5, d - 1.5)), o = range(-1.6, 1.6);
      return spot(hx + ux * q - uy * o, hy + uy * q + ux * o, NaN, a + Math.PI + range(-0.3, 0.3), 'stand', { cl: h.C });
    }
    // the school: under a portico of the forum, the boys in rows on the
    // ground before the master
    let school = null;
    function schoolSpot(master) {
      if (!school) {
        const pc = B.find(b => b.use === 'portico' && !b.hole && forum && insideConvex(forum.poly, b.x, b.y));
        if (!pc) return null;
        const L = Math.max(pc.w, pc.d), along = pc.w >= pc.d, s0 = L * range(0.2, 0.6);
        school = { pc, along, s0, n: 0 };
      }
      const { pc, along, s0 } = school;
      const D = Math.min(pc.w, pc.d), at = (s, t) => toWorld(pc, along ? s : t, along ? t : s);
      if (master) { const [x, y] = at(s0 - 1.2, D * 0.5), [x2, y2] = at(s0 + 1, D * 0.5); return spot(x, y, NaN, Math.atan2(y2 - y, x2 - x), 'stand', { anim: 'talk', cl: null }); }
      const k = school.n++ % 15, row = k / 5 | 0, col = k % 5;
      const [x, y] = at(s0 + 0.6 + row * 0.85, D * 0.5 + (col - 2) * 0.75), [x2, y2] = at(s0 - 1.2, D * 0.5);
      return spot(x, y, NaN, Math.atan2(y2 - y, x2 - x), 'sit', { seat: 0, cl: null });
    }
    // a seat at the theatre: on a step of the half ring, facing the stage
    function theatreSeat() {
      const c = cavea, steps = Math.round((c.r1 - c.r0) / 0.8), rise = c.h / steps;
      const s = 1 + (rng() * (steps - 2) | 0), r = c.r0 + s * 0.8 + 0.5, t = range(-Math.PI / 2 + 0.12, Math.PI / 2 - 0.12);
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle), P = (rr, tt) => { const x = rr * Math.cos(tt), y = rr * Math.sin(tt); return [c.x + x * ca - y * sa, c.y + x * sa + y * ca]; };
      const [x, y] = P(r, t), z = c.z0 + 1 + s * rise, face = Math.atan2(c.y - y, c.x - x);
      // up from the orchestra, step by step
      const climb = [];
      for (let q = 0; q <= s; q++) { const [px, py] = P(c.r0 + q * 0.8 + 0.4, t); climb.push([px, py, c.z0 + 1 + q * rise]); }
      const [fx, fy] = P(c.r0 - 1.2, t);
      return { foot: spot(fx, fy, NaN, face, 'stand', { cl: null }), climb, sp: spot(x + Math.cos(face) * 0.25, y + Math.sin(face) * 0.25, z - rise, face, 'sit', { seat: rise, cl: null }) };
    }
    function arenaSeat() {
      const b = amph, steps = Math.round((b.a - b.a0) / 0.8), r0 = b.a0 / b.a;
      const s = 1 + (rng() * (steps - 2) | 0), rho = r0 + (1 - r0) * (s + 0.5) / steps, t = rng() * TAU;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), P = (rr, tt) => { const x = rr * b.a * Math.cos(tt), y = rr * b.b * Math.sin(tt); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca]; };
      const [x, y] = P(rho, t), z = b.z0 + 3.5 + s * b.h / steps, face = Math.atan2(b.y - y, b.x - x);
      // in under the seats by the nearest way, and up
      const g = Math.round(t / (Math.PI / 2)) * Math.PI / 2, climb = [];
      const [gx, gy] = P(r0 + (1 - r0) * 0.6, g);
      climb.push([gx, gy, b.z0]);
      for (let q = 0; q <= s; q++) { const [px, py] = P(r0 + (1 - r0) * (q + 0.5) / steps, t); climb.push([px, py, b.z0 + 3.5 + q * b.h / steps]); }
      const [fx, fy] = P(1 + 2 / b.a, g);
      return { foot: spot(fx, fy, NaN, face, 'stand', { cl: null }), climb, sp: spot(x, y, z - 0.4, face, 'sit', { seat: 0.4, cl: null }) };
    }
    // the work in a field, as the crop and the month have it: down its rows
    // and back, a step at a time
    function fieldWork(f, ag) {
      const m = clock.month, c = Math.cos(f.angle), s = Math.sin(f.angle);
      const cx = f.poly.reduce((a, p) => a + p[0], 0) / 4, cy = f.poly.reduce((a, p) => a + p[1], 0) / 4;
      const loc = f.poly.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
      const hu = Math.max(...loc.map(p => Math.abs(p[0]))) - 1.2, hv = Math.max(...loc.map(p => Math.abs(p[1]))) - 1.2;
      const crop = f.crop;
      let anim = 'hoe', pose = 'bend', tool = 'hoe', rate = 0.04;
      if (crop === 'wheat') { if (m >= 5 && m <= 6) { anim = 'reap'; tool = 'sickle'; rate = 0.08; } else if (m >= 9 && m <= 10) { anim = 'sow'; pose = 'walk'; tool = 'bag'; rate = 0.7; } }
      else if (crop === 'hay' || crop === 'meadow') { if (m >= 4 && m <= 6) { anim = 'scythe'; pose = 'stand'; tool = 'scythe'; rate = 0.12; } }
      else if (crop === 'vines') { if (m >= 8 && m <= 9) { anim = 'pick'; tool = 'basket'; } else if (m <= 2) { anim = 'prune'; pose = 'stand'; tool = 'knife'; } }
      else if (crop === 'olives' || crop === 'orchard') { if ((crop === 'olives' && (m >= 9 || m <= 0)) || (crop === 'orchard' && m >= 5 && m <= 8)) { anim = chance(0.5) ? 'beat' : 'gather'; pose = anim === 'beat' ? 'stand' : 'squat'; tool = anim === 'beat' ? 'pole' : 'basket'; rate = 0.02; } }
      else if (crop === 'fallow' || crop === 'stubble') { anim = 'dig'; tool = 'mattock'; if (ag.team && ((m >= 9 && m <= 10) || (m >= 1 && m <= 3))) { anim = 'plough'; pose = 'walk'; tool = null; rate = 0.75; } }
      const u = range(-hu, hu), v = range(-hv, hv), pt = (uu, vv) => [cx + uu * c - vv * s, cy + uu * s + vv * c];
      const [x, y] = pt(u, v);
      const sp = spot(x, y, NaN, f.angle, pose, { anim, cl: null });
      return { sp, tool, rate, u, v, dir: chance(0.5) ? 1 : -1, hu, hv, pt, a: f.angle, step: anim === 'plough' ? 2.2 : 1.6 };
    }

    // ---- the travellers: in from the end of a road, to the town, about
    // it a while, and away by another road ----
    function travel(ag) {
      const R = clock.R, night = R > 12.3 || R < -0.4;
      const show = v => { ag.vis = v; for (const f of ag.train || []) f.vis = v; if (ag.cart) ag.cart.vis = v; };
      const T = ag.trip || (ag.trip = { stage: 'away' });
      if (T.stage === 'away') {
        T.from = choice(ends); T.to = choice(ends);
        if (warm && rng() < 0.6) {
          // already on the road in
          const pts = T.from.road.points, p = pts[Math.min(T.from.q, 3 + (rng() * Math.max(1, T.from.q - 3) | 0))];
          ag.x = p[0]; ag.y = p[1]; ag.z = groundZ(...p); ag.cl = null; ag.placed = true; show(true);
        } else {
          // a while before coming (fewer by night; a cart comes to wait for the dark)
          hide(ag, now + (warm ? range(0, 1500) : night && ag.traveller !== 'cart' ? range(900, 3600) : range(60, 900)));
          call(ag, () => { ag.x = T.from.x; ag.y = T.from.y; ag.z = groundZ(ag.x, ag.y); ag.cl = null; ag.trail = null; show(true); });
          T.stage = 'come';
          return;
        }
        T.stage = 'come';
      }
      if (T.stage === 'come') {
        const G = gates.length ? gates.slice().sort((p, q) => Math.hypot(p.g.x - T.from.x, p.g.y - T.from.y) - Math.hypot(q.g.x - T.from.x, q.g.y - T.from.y))[0] : null;
        if (G && ag.traveller === 'cart' && !night) {
          // carts wait outside by day: none may go through the streets till dark
          const [ox, oy] = G.outer, d = range(8, 16), o = (ag.id % 2 ? 1 : -1) * range(5.5, 8);
          let sp = spot(ox + G.ux * d - G.uy * o, oy + G.uy * d + G.ux * o, NaN, G.g.angle + Math.PI, 'sit', { seat: 0, cl: null });
          if (!reachable(sp.x, sp.y)) sp = spot(ox + G.ux * d, oy + G.uy * d, NaN, G.g.angle + Math.PI, 'sit', { seat: 0, cl: null });
          go(ag, sp); stay(ag, sp, now + range(900, 2400));
          return;
        }
        let dest = null;
        if (G && (ag.traveller === 'cart' || ag.traveller === 'donkeys' || ag.traveller === 'rider')) {
          // up the main street a way, to unload at the shops
          const [ix, iy] = G.inner;
          for (let k = 0; k < 6 && !dest; k++) { const d = range(10, 50); if (reachable(ix - G.ux * d, iy - G.uy * d)) dest = spot(ix - G.ux * d, iy - G.uy * d, NaN, G.g.angle + Math.PI, 'stand', { cl: null }); }
        } else if (G) {
          if (chance(0.5) && forumPts.length) { dest = talkSpot('forum', forumPts); ag.group = dest && dest.group; }
          else if (chance(0.3) && altars.length) { const A = choice(altars), d = range(2.5, 6), o = range(-3, 3); dest = spot(A.b.x + A.ux * d - A.uy * o, A.b.y + A.uy * d + A.ux * o, NaN, A.out + Math.PI, 'stand', { anim: 'pray' }); }
          else if ((counters.length || stalls.length)) { const c = stalls.length && chance(0.5) ? choice(stalls) : choice(counters.length ? counters : stalls); dest = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { cl: clusterOf(c.b), anim: 'talk' }); dest.counter = c; }
        }
        if (dest && ag.man) {
          // the horse tied up; the rider on foot to the forum, a shop or a stall, and back to it
          go(ag, dest);
          call(ag, () => {
            ag.kind = 'horse'; ag.tied = true;
            const m = ag.man, a = ag.a;
            m.x = ag.x - Math.sin(a) * 0.9; m.y = ag.y + Math.cos(a) * 0.9; m.z = groundZ(m.x, m.y); m.a = a; m.cl = null; m.vis = true; m.legs.length = 0; m.leg = null;
            const there = forumPts.length && chance(0.5) ? talkSpot('forum', forumPts) : counters.length ? (() => { const c = choice(counters); const s = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { cl: clusterOf(c.b), anim: 'talk' }); s.counter = c; return s; })() : null;
            if (there) { m.legs.push({ k: 'go', sp: there }, { k: 'stay', sp: there, until: now + range(400, 1500), atCounter: there.counter }); m.group = there.group; }
            const back = spot(m.x, m.y, NaN, a, 'stand', { cl: null });
            m.legs.push({ k: 'call', fn: () => leaveGroup(m) }, { k: 'go', sp: back }, { k: 'call', fn: () => { m.vis = false; ag.kind = 'rider'; ag.tied = false; if (ag.leg && ag.leg.k === 'stay') ag.leg.until = now; } });
          });
          ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 7200, tether: true });
        } else if (dest) { go(ag, dest); stay(ag, dest, now + range(400, 1800), dest.counter ? { atCounter: dest.counter } : {}); }
        // and maybe somewhere else before going
        if (dest && !dest.cl && forumPts.length && chance(0.4) && ag.traveller === 'walker') { const d2 = talkSpot('forum', forumPts); go(ag, d2); stay(ag, d2, now + range(300, 1200)); call(ag, () => { ag.group = d2.group; leaveGroup(ag); }); }
        T.stage = 'leave';
        return;
      }
      // away by another road, out of sight at its end
      leaveGroup(ag);
      go(ag, spot(T.to.x, T.to.y, NaN, 0, 'walk', { cl: null }));
      call(ag, () => show(false));
      T.stage = 'away';
    }

    // ================= the beasts, each its own way =================
    function beast(ag) {
      const R = clock.R, night = R > 12.6 || R < -0.3, noon = R > 5.2 && R < 7.8;
      if (ag.follow) return;
      if (ag.herd) {
        // grazing near the herd's middle, the middle drifting; lying down
        // in the heat of noon (in a tree's shade, if there is one) and at night
        const Hd = ag.herd;
        if (rng() < 0.04) { Hd.mx = clamp(Hd.mx + gauss() * 3, -Hd.hu * 0.8, Hd.hu * 0.8); Hd.my = clamp(Hd.my + gauss() * 3, -Hd.hv * 0.8, Hd.hv * 0.8); }
        let tx, ty;
        const lie = (night || (noon && chance(0.6))) && ag.kind !== 'horse';
        if (noon && Hd.shade && chance(0.7)) {
          const p = shadeOf(Hd.shade);
          if (p) { const u = (p[0] - Hd.cx) * Hd.c + (p[1] - Hd.cy) * Hd.s, v = -(p[0] - Hd.cx) * Hd.s + (p[1] - Hd.cy) * Hd.c; if (Math.abs(u) < Hd.hu && Math.abs(v) < Hd.hv) [tx, ty] = p; }
        }
        // (somewhere not taken by another of them)
        const room = ag.kind === 'sheep' || ag.kind === 'goat' ? 1.1 : 2.2;
        for (let k = 0; k < 5 && tx === undefined; k++) {
          const [u, v] = Hd.clampU(Hd.mx + gauss() * Hd.spread * (night ? 0.6 : 1), Hd.my + gauss() * Hd.spread * (night ? 0.4 : 0.7)), [x, y] = Hd.pt(u, v);
          // (open ground, got to straight, round a haystack, a tree, a well rather than through them)
          const ok = way.costAt(x, y) < Infinity && way.costAt(x + 0.7, y) < Infinity && way.costAt(x - 0.7, y) < Infinity && way.costAt(x, y + 0.7) < Infinity && way.costAt(x, y - 0.7) < Infinity && way.los([ag.x, ag.y], [x, y]);
          if (ok && (k === 4 || !Hd.beasts.some(b => b !== ag && Math.hypot(b.x - x, b.y - y) < room))) [tx, ty] = [x, y];
        }
        if (tx === undefined) [tx, ty] = [ag.x, ag.y];
        const d = Math.hypot(tx - ag.x, ty - ag.y);
        if (warm && !ag.placed) { ag.x = tx; ag.y = ty; ag.z = groundZ(tx, ty); ag.placed = true; }
        else if (d > 0.4) ag.legs.push({ k: 'trot', x: tx, y: ty, speed: d > 15 ? ag.speed * 1.6 : ag.speed * 0.6, pose: 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: lie ? 'lie' : (ag.kind === 'horse' && chance(0.3) ? 'stand' : 'graze'), until: now + (lie ? range(600, 2400) : range(8, 60)) });
        return;
      }
      if (ag.kind === 'dog' && ag.master) {
        // the shepherd's: lying by him, now and then running round the flock
        const m = ag.master;
        if (!m.vis) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + 30, pose: 'lie' }); return; }
        ag.vis = true;
        if (m.cl) {
          const [ox, oy] = m.home.front.out, sp = spot(ox + range(-1, 1), oy + range(-1, 1), NaN, range(0, TAU), 'lie', { cl: null });
          if (warm && !ag.placed) { place(ag, sp); ag.placed = true; } else if (Math.hypot(sp.x - ag.x, sp.y - ag.y) > 3) ag.legs.push({ k: 'go', sp });
          ag.legs.push({ k: 'stay', sp: null, pose: 'lie', until: now + range(20, 90) });
          return;
        }
        const Hd = m.herd, by = m.leg && m.leg.k === 'stay' && Hd && Math.hypot(m.x - Hd.pt(Hd.mx, Hd.my)[0], m.y - Hd.pt(Hd.mx, Hd.my)[1]) < 60;
        if (by && chance(0.15)) {
          const [cx, cy] = Hd.pt(Hd.mx, Hd.my), r = Hd.spread * 2 + 4, a0 = Math.atan2(ag.y - cy, ag.x - cx);
          for (let k = 1; k <= 8; k++) { const [u, v] = Hd.clampU(...(() => { const a = a0 + k * TAU / 8, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; return [(x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c]; })()); const [x, y] = Hd.pt(u, v); ag.legs.push({ k: 'trot', x, y, speed: 4, pose: 'run' }); }
        }
        const x = m.x + range(-2, 2), y = m.y + range(-2, 2);
        if (warm && !ag.placed) { ag.x = x; ag.y = y; ag.z = groundZ(x, y); ag.placed = true; }
        if (m.leg && m.leg.k !== 'stay') ag.legs.push({ k: 'chase', who: m, until: now + 6 });
        else { if (Math.hypot(x - ag.x, y - ag.y) > 1) ag.legs.push({ k: 'trot', x, y, speed: 1.8, pose: 'walk' }); ag.legs.push({ k: 'stay', sp: null, pose: chance(0.6) ? 'lie' : 'sit', until: now + range(10, 60) }); }
        return;
      }
      if (ag.farm) {
        // about the farm: hens in the yard, scratching, in for the night; the
        // dog at the gate; the oxen and the donkey in the barn by night
        const h = ag.farm, V = h.b;
        if (ag.kind === 'ox' && ag.ploughing) { ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 5 }); return; }
        const inBarn = ag.kind !== 'hen' && ag.kind !== 'dog' && h.barn && (night || ag.kind === 'ox');
        if (ag.kind === 'hen' && night) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + range(300, 900), pose: 'stand' }); return; }
        ag.vis = true;
        let x, y, z = NaN, cl = null;
        if (inBarn && h.barn.S && h.barn.S.rooms.length) { const r = choice(h.barn.S.rooms); const s = roomSpot(h.barn.b, r); if (s) { x = s.x; y = s.y; z = s.z; cl = s.cl; } }
        if (x === undefined) {
          if (ag.kind === 'dog' && chance(0.6)) { [x, y] = h.front.out; x += range(-1.5, 1.5); y += range(-1.5, 1.5); }
          else { const [s1, t1, s2, t2] = h.yard;[x, y] = toWorld(V, range(s1, s2), range(t1, t2)); z = fz(V); cl = h.C; }
        }
        // (the hens to whoever is scattering grain for them)
        if (ag.kind === 'hen' && !warm) { const f = feederNear(ag, 30); if (f) { const a = rng() * TAU, r = range(0.6, 2); x = f.x + Math.cos(a) * r; y = f.y + Math.sin(a) * r; z = f.cl ? fz(V) : NaN; cl = f.cl; } }
        // (the dog to anyone coming by)
        if (ag.kind === 'dog' && !warm && chance(0.5)) { const p = personNear(ag, 18, o => o.pose === 'walk' && !o.cl); if (p) { ag.legs.push({ k: 'chase', who: p, until: now + range(6, 14) }); ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(5, 20) }); return; } }
        const sp = spot(x, y, z, range(0, TAU), 'stand', { cl });
        if (warm && !ag.placed) { place(ag, sp); ag.placed = true; }
        else if (Math.hypot(x - ag.x, y - ag.y) > 0.5) {
          if (ag.kind === 'hen' && ag.cl === cl) ag.legs.push({ k: 'trot', x, y, speed: 0.5, pose: 'walk' });
          else ag.legs.push({ k: 'go', sp });
        }
        const pose = ag.kind === 'hen' ? 'graze' : ag.kind === 'dog' ? (chance(0.7) ? 'lie' : 'sit') : night || chance(0.4) ? 'lie' : 'stand';
        ag.legs.push({ k: 'stay', sp: null, pose, until: now + (ag.kind === 'hen' ? range(3, 20) : range(120, 900)) });
        return;
      }
      if (ag.coop) {
        // hens in a yard behind a house
        const e = ag.coop, [ox, oy] = e.out;
        if (night) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + 600, pose: 'stand' }); return; }
        ag.vis = true;
        let x = ox + range(-3, 3), y = oy + range(-3, 3), speed = 0.5;
        const f = !warm && feederNear(ag, 12);
        if (f) { const a = rng() * TAU, r = range(0.6, 1.8); x = f.x + Math.cos(a) * r; y = f.y + Math.sin(a) * r; speed = 1.3; }
        if (warm && !ag.placed) { ag.x = ox; ag.y = oy; ag.z = groundZ(ox, oy); ag.placed = true; }
        if (way.costAt(x, y) < Infinity && way.los([ag.x, ag.y], [x, y])) ag.legs.push({ k: 'trot', x, y, speed, pose: 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: 'graze', until: now + range(3, 20) });
        return;
      }
      if (ag.stray) {
        // a dog or a cat about the streets: off somewhere, then lying down a while
        const sleepy = ag.kind === 'dog' ? night : !night && chance(0.7);
        if (!sleepy && !warm && ag.kind === 'dog') {
          // up to someone about in the street, to be made a fuss of or to beg; or to another dog, to sniff
          if (chance(0.35)) { const p = personNear(ag, 22, o => !o.cl && o.pose !== 'lie'); if (p) { ag.legs.push({ k: 'chase', who: p, until: now + range(8, 25) }); ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(10, 40), face: p }); return; } }
          if (chance(0.25)) {
            let o = null, od = 25;
            around(ag.x, ag.y, 25, b => { if (b !== ag && b.kind === 'dog' && b.vis && !b.cl) { const d = Math.hypot(b.x - ag.x, b.y - ag.y); if (d < od) { od = d; o = b; } } });
            if (o) {
              ag.legs.push({ k: 'chase', who: o, until: now + 12, near: 0.9 });
              ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + range(6, 14), face: o });
              if (o.leg && o.leg.k === 'stay') { o.leg.pose = 'stand'; o.leg.face = ag; o.leg.until = Math.max(o.leg.until, now + 16); }
              return;
            }
          }
        }
        if (sleepy || chance(0.4)) { ag.legs.push({ k: 'stay', sp: null, pose: ag.kind === 'cat' ? (chance(0.5) ? 'sit' : 'lie') : 'lie', until: now + range(120, 1200) }); return; }
        const [x, y] = choice(streetPts.filter(p => Math.hypot(p[0] - ag.x, p[1] - ag.y) < 80).concat([choice(streetPts)]));
        ag.legs.push({ k: 'go', sp: spot(x, y, NaN, 0, 'stand', { cl: null }) });
        ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(5, 40) });
        return;
      }
      ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 60 });
    }

    // ================= each moment =================
    const groundZ = (x, y) => {
      for (const b of bridges) if (inBox(b, x, y)) return b.z0 + b.h;
      return hAt(x, y);
    };
    const bridges = byUse('bridge');
    function think(ag) {
      if (ag.ride) { ag.legs.push({ k: 'hide', until: now + 60 }); return; }
      if (ag.kind === 'person' || ag.kind === 'rider' || ag.traveller === 'rider') {
        if (ag.job === 'traveller' || ag.traveller) { travel(ag); return; }
        if (ag.planDay !== clock.day) { ag.plan = plan(ag); ag.planDay = clock.day; }
        const P = ag.plan, R = clock.R;
        let e = P[0], next = P[1];
        for (let q = 0; q < P.length; q++) if (P[q].at <= R) { e = P[q]; next = P[q + 1]; }
        let until = now + Math.max(20, secs(clock, R, next ? next.at : 18));
        leaveGroup(ag);
        // long work a stretch at a time, and between, now and then, a break
        if (BREAKS.has(e.act) && !warm) {
          if (until - now > 1500 && now - (ag.rested || -Infinity) > range(1500, 3600) && ag.lastAct === e && chance(0.6)) {
            ag.rested = now; ag.lastAct = e;
            ACT.interlude(ag, e, Math.min(until, now + range(300, 1000)));
            if (!ag.legs.length) ag.legs.push({ k: 'stay', sp: null, until: now + 30 });
            return;
          }
          until = Math.min(until, now + range(900, 2700));
        }
        ag.lastAct = e;
        ag.meal = e.act === 'eat' || e.act === 'cena';
        (ACT[e.act] || ACT.home)(ag, e, until);
        if (!ag.legs.length) ag.legs.push({ k: 'stay', sp: null, until: now + 30 });
        return;
      }
      if (ag.kind === 'boat') return;
      beast(ag);
    }
    // the way to a spot, and on along it
    function begin(ag, L) {
      if (L.k === 'go') {
        const sp = L.sp;
        let pts = route(ag.x, ag.y, ag.cl, sp);
        if (!pts) {
          // no way found: off out of sight a while, then there
          L.k = 'hide'; L.until = now + Math.min(300, Math.hypot(sp.x - ag.x, sp.y - ag.y) / ag.speed); L.then = sp;
          return;
        }
        if (Number.isFinite(sp.z)) pts[pts.length - 1][2] = sp.z;
        L.pts = pts; L.i = 0; L.d = 0;
        if (L.carry !== undefined) ag.carry = L.carry;
        ag.cl = null;
      } else if (L.k === 'climb') {
        L.pts = L.pts.map(p => [p[0], p[1], p[2]]); L.i = 0; L.d = 0;
      } else if (L.k === 'stay' && L.sp) place(ag, L.sp);
      else if (L.k === 'wall') {
        // up the stairs of a gate's tower and along the wall to the next and back
        const P = wallWalk.pts, n = P.length, pts = [];
        let i = L.from;
        const dir = ((L.to - L.from + n) % n) <= n / 2 ? 1 : -1;
        const cp = q => { const p = P[q].slice(); p.key = q; return p; };
        for (let k = 0; k < n && i !== L.to; k++, i = (i + dir + n) % n) pts.push(cp(i));
        pts.push(cp(L.to));
        L.pts = pts.concat(pts.slice().reverse()); L.i = 0; L.d = 0; L.k = 'climb'; L.loop = L.until; L.torch = L.night;
        // (where the towers are along it, to stop at)
        L.stops = new Set(L.pts.map((p, q) => wallWalk.towerAt.has(p.key) ? q : -1).filter(q => q >= 0));
      }
    }
    function walkAlong(ag, L, dt, speed) {
      let rem = speed * dt;
      const P = L.pts;
      while (rem > 0 && L.i < P.length - 1) {
        const a = P[L.i], b = P[L.i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L.d + rem < len) { L.d += rem; rem = 0; }
        else { rem -= len - L.d; L.i++; L.d = 0; }
      }
      if (L.i >= P.length - 1) { const p = P[P.length - 1]; ag.x = p[0]; ag.y = p[1]; ag.z = Number.isFinite(p[2]) ? p[2] : groundZ(p[0], p[1]); return true; }
      const a = P[L.i], b = P[L.i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, f = L.d / len;
      ag.x = lerp(a[0], b[0], f); ag.y = lerp(a[1], b[1], f);
      ag.inCl = Number.isFinite(a[2]) && Number.isFinite(b[2]) ? a[3] || b[3] || null : null;
      // (stepped aside for someone, back onto the line little by little)
      if (L.off) {
        const o = L.off, k = Math.exp(-dt * 0.7);
        o[0] *= k; o[1] *= k;
        if (standable(ag, ag.x + o[0], ag.y + o[1])) { ag.x += o[0]; ag.y += o[1]; } else o[0] = o[1] = 0;
      }
      ag.z = Number.isFinite(a[2]) && Number.isFinite(b[2]) ? lerp(a[2], b[2], f) : Number.isFinite(a[2]) && len < 2.6 ? a[2] : Number.isFinite(b[2]) && len < 2.6 ? b[2] : groundZ(ag.x, ag.y);
      const want = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ag.a += clamp(turn(ag.a, want), -7 * dt, 7 * dt);
      return false;
    }
    const STRIDE = { person: 1.4, rider: 2.2, sheep: 0.8, goat: 0.8, cow: 1.5, ox: 1.5, horse: 2, donkey: 1.2, dog: 1, cat: 0.7, hen: 0.25, cart: 3 };
    function update(ag, dt) {
      if (ag.follow) return;
      if (!ag.leg) {
        ag.leg = ag.legs.shift() || null;
        if (!ag.leg) {
          if (timeNow() > deadline) return;
          think(ag);
          ag.leg = ag.legs.shift() || null;
          if (!ag.leg) return;
        }
        begin(ag, ag.leg);
      }
      const L = ag.leg, night = clock.R > 12.4 || clock.R < -0.5;
      const stride = (STRIDE[ag.kind] || 1.4) * (ag.age === 'child' ? 0.75 : 1);
      switch (L.k) {
        case 'go': case 'climb': {
          ag.vis = true;
          // a sentry stopped at a tower, looking out over the country
          if (L.stops) {
            if (L.pause && now < L.pause) { ag.pose = 'stand'; ag.anim = 'watch'; ag.torch = !!L.torch; ag.a += clamp(turn(ag.a, Math.atan2(ag.y - town.town.y, ag.x - town.town.x)), -2 * dt, 2 * dt); break; }
            if (L.stops.has(L.i) && L.stopped !== L.i) { L.stopped = L.i; L.pause = now + range(20, 70); break; }
          }
          const sp = L.k === 'climb' ? 0.6 : ag.speed;
          ag.pose = L.k === 'climb' ? 'walk' : (ag.speed > 2 ? 'run' : 'walk'); ag.anim = null; ag.seat = 0;
          ag.torch = (L.torch || (night && ag.torchy && !ag.cl)) && ag.kind === 'person';
          if (ag.torch && !ag.carry) ag.carry = 'torch';
          if (!ag.torch && ag.carry === 'torch') ag.carry = null;
          const done = walkAlong(ag, L, dt, sp);
          ag.ph += sp * dt / stride;
          if (done) {
            if (L.loop && now < L.loop) { L.i = 0; L.d = 0; break; }
            if (L.k === 'go') ag.cl = L.sp.cl || null;
            ag.inCl = null;
            if (ag.carry === 'torch' && !L.torch) ag.carry = null;
            ag.torch = !!L.torch && ag.torch;
            ag.leg = null;
          }
          break;
        }
        case 'trot': {
          const d = Math.hypot(L.x - ag.x, L.y - ag.y), v = L.speed * dt;
          ag.pose = L.pose || 'walk';
          if (d > v && !standable(ag, ag.x + (L.x - ag.x) / d * v, ag.y + (L.y - ag.y) / d * v)) { ag.leg = null; break; }
          if (d <= v) { ag.x = L.x; ag.y = L.y; ag.leg = null; }
          else { ag.x += (L.x - ag.x) / d * v; ag.y += (L.y - ag.y) / d * v; ag.a += clamp(turn(ag.a, Math.atan2(L.y - ag.y, L.x - ag.x)), -(L.flee ? 9 : 5) * dt, (L.flee ? 9 : 5) * dt); }
          if (L.until && now > L.until) ag.leg = null;
          ag.z = ag.cl ? floorAt(ag.cl, ag.x, ag.y) : NaN;
          if (!Number.isFinite(ag.z)) ag.z = groundZ(ag.x, ag.y);
          ag.ph += v / stride;
          break;
        }
        case 'chase': {
          // after someone, straight, as long as the way is open
          const m = L.who, d = Math.hypot(m.x - ag.x, m.y - ag.y), near = L.near || 1.6;
          if (!m.vis || m.cl) { ag.leg = null; break; }
          if (d > near + 0.6) {
            const v = Math.min(d - near, (d > 8 ? 3.5 : Math.max(1.2, m.speed * 1.1)) * dt), nx = ag.x + (m.x - ag.x) / d * v, ny = ag.y + (m.y - ag.y) / d * v;
            if (!standable(ag, nx, ny)) { ag.leg = null; break; }
            ag.x = nx; ag.y = ny; ag.ph += v / stride; ag.pose = d > 8 ? 'run' : 'walk';
          } else ag.pose = 'stand';
          ag.a += clamp(turn(ag.a, Math.atan2(m.y - ag.y, m.x - ag.x)), -6 * dt, 6 * dt);
          ag.z = groundZ(ag.x, ag.y);
          if (now > L.until) ag.leg = null;
          break;
        }
        case 'stay': {
          const sp = L.sp;
          ag.vis = true;
          if (sp) { ag.pose = sp.pose; ag.anim = sp.anim || null; ag.seat = sp.seat || 0; ag.stool = !!sp.stool; }
          else { ag.pose = L.pose || 'stand'; ag.anim = null; ag.stool = false; }
          if (L.tether) ag.pose = Math.sin(now / 37 + ag.id) > 0.3 ? 'graze' : 'stand';
          if (sp && sp.table && ag.meal) { const T = sp.table; if (T.laid < now) T.n = 0; T.laid = now + 2; T.n = Math.min(6, Math.max(T.n, 1) + (L.atTable ? 0 : 1)); L.atTable = true; }
          // a customer at the counter: up from the stool to serve
          if (L.atCounter && !L.counted) { L.atCounter.busy = (L.atCounter.busy || 0) + 1; L.counted = true; }
          if (L.counter) {
            if (L.counter.busy > 0) { ag.pose = 'stand'; ag.anim = 'sell'; ag.seat = 0; ag.stool = false; }
            L.counter.keeper = ag;
          }
          if (L.play && !L.joined) { L.play.P.kids.add(ag); L.joined = true; }
          // talking with someone, turned to them
          if (L.talk && now < L.talk.until) {
            ag.anim = 'talk';
            const w = L.talk.with;
            if (w && w.vis && Math.hypot(w.x - ag.x, w.y - ag.y) < 4) ag.a += clamp(turn(ag.a, Math.atan2(w.y - ag.y, w.x - ag.x)), -3 * dt, 3 * dt);
          }
          if (L.face && L.face.vis) ag.a += clamp(turn(ag.a, Math.atan2(L.face.y - ag.y, L.face.x - ag.x)), -3 * dt, 3 * dt);
          // nobody stands about long alone
          if (ag.kind === 'person' && sp && ag.pose === 'stand' && !ag.anim && !ag.group && !L.run && !L.play && !L.drift && !L.counter && !warm) {
            L.idle = (L.idle || 0) + dt;
            if (L.idle > (L.patience || (L.patience = range(25, 60)))) { L.idle = 0; L.patience = range(40, 90); if (restless(ag, L)) break; }
          }
          ag.torch = !!L.torch;
          if (!ag.torch && ag.carry === 'torch') ag.carry = null;
          ag.ph += dt * (ag.anim ? 0.9 : 0.25);
          if (L.drift) drift(ag, L.drift, dt);
          if (L.play) play(ag, L.play, dt);
          if (L.run) { const r = L.run; r.t = (r.t || 0) + dt * ag.speed * 1.6 / r.r; ag.x = r.x + Math.cos(r.t) * r.r; ag.y = r.y + Math.sin(r.t) * r.r; ag.a = r.t + Math.PI / 2; ag.pose = 'run'; ag.ph += dt * ag.speed * 1.6 / 2.2; }
          if (now >= L.until) { if ((L.run || L.play) && sp) place(ag, sp); drop(ag); }
          break;
        }
        case 'hide':
          ag.vis = false; ag.torch = false;
          if (now >= L.until) { if (L.then) place(ag, L.then); ag.leg = null; }
          break;
        case 'call': L.fn(); ag.leg = null; break;
        default: ag.leg = null;
      }
    }
    // work down a field's rows: along a row a step at a time, at its end over to the next and back
    function drift(ag, D, dt) {
      if (warm) return;
      D.u += D.dir * D.rate * dt;
      if (Math.abs(D.u) > D.hu) { D.u = Math.sign(D.u) * D.hu; D.dir = -D.dir; D.v += D.step * (D.v > 0 ? -1 : 1) * (Math.abs(D.v) + D.step > D.hv ? 1 : -1); D.v = clamp(D.v, -D.hv, D.hv); }
      const [x, y] = D.pt(D.u, D.v);
      ag.x = x; ag.y = y; ag.z = groundZ(x, y);
      const want = D.a + (D.dir < 0 ? Math.PI : 0);
      ag.a += clamp(turn(ag.a, want), -2 * dt, 2 * dt);
      if (ag.pose === 'walk') ag.ph += D.rate * dt / 1.2;
      if (ag.anim === 'plough' && ag.team) ag.team.forEach((o, k) => { o.ploughing = true; o.vis = true; o.x = x + Math.cos(ag.a) * 3.4 - Math.sin(ag.a) * (k ? 0.65 : -0.65); o.y = y + Math.sin(ag.a) * 3.4 + Math.cos(ag.a) * (k ? 0.65 : -0.65); o.z = groundZ(o.x, o.y); o.a = ag.a; o.pose = 'walk'; o.ph = ag.ph; o.leg = null; o.legs.length = 0; });
    }
    // children at play in the street before their door: running to a spot,
    // crouching there a while over their game, off again
    function play(ag, P, dt) {
      if (warm) return;
      if (P.to) {
        const d = Math.hypot(P.to[0] - ag.x, P.to[1] - ag.y), v = 2.6 * dt;
        if (!standable(ag, ag.x + (P.to[0] - ag.x) / (d || 1) * v, ag.y + (P.to[1] - ag.y) / (d || 1) * v)) { P.to = null; P.next = now + 2; return; }
        if (d <= v) { P.to = null; P.next = now + range(4, 30); ag.pose = 'squat'; }
        else { ag.x += (P.to[0] - ag.x) / d * v; ag.y += (P.to[1] - ag.y) / d * v; ag.a = Math.atan2(P.to[1] - ag.y, P.to[0] - ag.x); ag.pose = 'run'; ag.ph += v / 1.6; }
        ag.z = groundZ(ag.x, ag.y);
      } else {
        ag.pose = P.pose || 'squat';
        // (crouched, turned to whoever is crouched by)
        const mate = [...P.P.kids].find(k => k !== ag && k.vis && Math.hypot(k.x - ag.x, k.y - ag.y) < 2);
        if (mate) ag.a += clamp(turn(ag.a, Math.atan2(mate.y - ag.y, mate.x - ag.x)), -3 * dt, 3 * dt);
        if (now > P.next) {
          // off after another of them, or somewhere about
          const kids = [...P.P.kids].filter(k => k !== ag && k.vis);
          let x, y;
          if (kids.length && chance(0.45)) { const k = choice(kids); x = k.x + range(-0.6, 0.6); y = k.y + range(-0.6, 0.6); }
          else { x = P.x + range(-P.r, P.r); y = P.y + range(-P.r, P.r); }
          if (way.costAt(x, y) <= 1.35 && way.los([ag.x, ag.y], [x, y])) P.to = [x, y];
          else P.next = now + 1;
          P.pose = chance(0.5) ? 'squat' : 'stand';
        }
      }
    }
    // a follower: where its leader was, a little way back (a cart's oxen
    // before it, side by side, the cart behind; a donkey on its rope)
    function follow(ag) {
      const m = ag.follow, T = m.trail;
      ag.vis = m.vis;
      if (ag.ploughing) return;
      const back = ag.kind === 'cart' ? 4.6 : ag.yoke ? 1.2 : 1.8 + 1.7 * Math.max(0, (m.train || []).indexOf(ag));
      const lat = ag.yoke ? ag.yoke * 0.65 - 1.1 : ag.kind === 'cart' ? -1.1 : 0;
      // back along the leader's trail
      let px = m.x, py = m.y, d = 0, k = T ? T.length - 1 : -1, head = m.a;
      while (k >= 0) {
        const q = T[k], l = Math.hypot(px - q[0], py - q[1]);
        if (l > 0.01) head = Math.atan2(py - q[1], px - q[0]);
        if (d + l >= back) { const f = (back - d) / l; px = lerp(px, q[0], f); py = lerp(py, q[1], f); break; }
        d += l; px = q[0]; py = q[1]; k--;
      }
      if (k < 0) { px = m.x - Math.cos(m.a) * back; py = m.y - Math.sin(m.a) * back; head = m.a; }
      const nx = px - Math.sin(head) * lat, ny = py + Math.cos(head) * lat;
      const moved = Math.hypot(nx - ag.x, ny - ag.y);
      ag.x = nx; ag.y = ny; ag.z = groundZ(nx, ny);
      ag.a += turn(ag.a, head) * 0.3;
      ag.pose = moved > 0.002 ? 'walk' : 'stand';
      ag.ph += moved / (STRIDE[ag.kind] || 1.4);
    }
    // a boat down the river and up again, moored at the bank by night
    function boat(ag, dt) {
      const R = town.river, L = R.len, total = L[L.length - 1], night = clock.R > 11.8 || clock.R < -0.2;
      if (!night) { ag.s += ag.dir * ag.speed * dt; if (ag.s > total - 20 || ag.s < 20) { ag.dir = -ag.dir; ag.s = clamp(ag.s, 20, total - 20); } }
      let k = 0;
      while (k < L.length - 2 && L[k + 1] < ag.s) k++;
      const f = (ag.s - L[k]) / (L[k + 1] - L[k] || 1), a = R.points[k], b = R.points[k + 1];
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0]), off = night ? R.width / 2 - 1.4 : ag.lane;
      const side = ag.dir > 0 ? 1 : -1;
      ag.x = lerp(a[0], b[0], f) - Math.sin(dir) * off * side; ag.y = lerp(a[1], b[1], f) + Math.cos(dir) * off * side;
      ag.z = lerp(R.level[k], R.level[k + 1], f);
      ag.a = dir + (ag.dir < 0 ? Math.PI : 0); ag.pose = night ? 'moored' : 'row'; ag.ph += night ? dt * 0.1 : dt * 0.5;
      ag.vis = true;
    }

    // ================= together =================
    // who is where, 2.5 m a cell, each moment
    const HC = 2.5, hash = new Map();
    function reindex() {
      hash.clear();
      for (const ag of all) {
        if (!ag.vis || ag.kind === 'boat') continue;
        const k = Math.floor(ag.x / HC) * 8192 + Math.floor(ag.y / HC);
        let l = hash.get(k);
        if (!l) hash.set(k, l = []);
        l.push(ag);
      }
    }
    function around(x, y, r, fn) {
      for (let i = Math.floor((x - r) / HC); i <= Math.floor((x + r) / HC); i++)
        for (let j = Math.floor((y - r) / HC); j <= Math.floor((y + r) / HC); j++) for (const o of hash.get(i * 8192 + j) || []) fn(o);
    }
    const spaceOf = ag => ag.cl || ag.inCl || null;
    function personNear(ag, r, ok) {
      let best = null, bd = r;
      around(ag.x, ag.y, r, o => { if (o.kind !== 'person' || !o.vis || o === ag || !ok(o)) return; const d = Math.hypot(o.x - ag.x, o.y - ag.y); if (d < bd) { bd = d; best = o; } });
      return best;
    }
    let feeders = [];
    const feederNear = (ag, r) => { let best = null, bd = r; for (const f of feeders) { const d = Math.hypot(f.x - ag.x, f.y - ag.y); if (d < bd) { bd = d; best = f; } } return best; };
    const plays = [];
    // whether one can stand at a point: on open ground, or on the floor of the house one is in
    function standable(ag, x, y) {
      const C = ag.cl || ag.inCl;
      if (C) {
        if (!C.grid) gridOf(C);
        const G = C.grid, [fi, fj] = G.loc(x, y), i = Math.round(fi), j = Math.round(fj);
        return i >= 0 && j >= 0 && i < G.gx && j < G.gy && G.free[j * G.gx + i] === 1;
      }
      if (ag.herd) {
        const Hd = ag.herd, u = (x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, v = -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c;
        if (Math.abs(u) > Hd.hu + 0.8 || Math.abs(v) > Hd.hv + 0.8) return false;
      }
      return way.costAt(x, y) < Infinity;
    }
    // the end of what one was about (a customer gone from the counter, a child from the game)
    function drop(ag) {
      const L = ag.leg;
      if (L) {
        if (L.counted) { L.atCounter.busy--; L.counted = false; }
        if (L.counter && L.counter.keeper === ag) L.counter.keeper = null;
        if (L.joined) { const P = L.play.P; P.kids.delete(ag); if (!P.kids.size && plays.includes(P)) plays.splice(plays.indexOf(P), 1); L.joined = false; }
      }
      ag.leg = null;
    }

    // ---- standing about alone a while: over to someone to talk to; or to
    // a dog or a cat to make a fuss of; or, at home, a seat or a job;
    // or a few steps elsewhere ----
    function restless(ag, L) {
      const rem = L.until - now;
      // (somewhere one can get to from here: in a house, through its rooms)
      const reach = (x, y) => standable(ag, x, y) && (ag.cl ? !!inside(ag.cl, [ag.x, ag.y], [x, y]) : true);
      if (rem < 25) return false;
      const sp = L.sp, back = [{ k: 'go', sp }, { k: 'stay', sp, until: L.until }];
      const C = ag.cl;
      // someone free to talk: standing about, or sitting at nothing in particular
      const o = personNear(ag, 10, o => spaceOf(o) === C && Math.abs(o.z - ag.z) < 1 && o.leg && o.leg.k === 'stay' && o.leg.sp && !o.leg.counter && !o.leg.drift && !o.leg.run && !o.leg.play
        && (o.pose === 'stand' || o.pose === 'sit') && (!o.anim || o.anim === 'talk' || o.anim === 'craft') && (o.age === 'child') === (ag.age === 'child'));
      if (o) {
        const dur = Math.min(rem - 10, o.leg.until - now - 5, range(60, 300));
        if (dur > 20) {
          // beside them, facing them; or into their circle, if they are talking already
          const ch = o.chat && now < o.chat.until && o.chat.n < 5 ? o.chat : null;
          let x, y;
          if (ch) { const a = rng() * TAU; x = ch.x + Math.cos(a) * 0.8; y = ch.y + Math.sin(a) * 0.8; }
          else { const d = Math.hypot(ag.x - o.x, ag.y - o.y) || 1, r = o.pose === 'sit' ? 0.95 : 0.8; x = o.x + (ag.x - o.x) / d * r; y = o.y + (ag.y - o.y) / d * r; }
          if (reach(x, y) && meet(ag, o, dur, back)) return true;
        }
      }
      // a dog or a cat close by
      let pet = null, pd = 7;
      around(ag.x, ag.y, 7, b => { if ((b.kind === 'dog' || b.kind === 'cat') && b.vis && b.leg && b.leg.k === 'stay' && spaceOf(b) === C) { const d = Math.hypot(b.x - ag.x, b.y - ag.y); if (d < pd) { pd = d; pet = b; } } });
      if (pet && chance(0.6) && ag.age !== 'old') {
        const d = pd || 1, x = pet.x + (ag.x - pet.x) / d * 0.55, y = pet.y + (ag.y - pet.y) / d * 0.55, dur = Math.min(rem - 10, range(15, 45));
        if (dur > 8 && reach(x, y)) {
          const t = spot(x, y, C ? floorAt(C, x, y) : NaN, Math.atan2(pet.y - y, pet.x - x), 'squat', { anim: 'pet', cl: C });
          pet.leg.pose = 'sit'; pet.leg.face = ag; pet.leg.until = Math.max(pet.leg.until, now + dur + 8);
          drop(ag);
          ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until: now + dur }, ...back);
          return true;
        }
      }
      // at home: sit down, or find something to do
      if (C && ag.home && C === ag.home.C) {
        const s = homeSpot(ag, chance(0.5) ? 'seat' : 'bench') || homeSpot(ag, 'hearth');
        if (s) { drop(ag); ag.legs.unshift({ k: 'go', sp: s }, { k: 'stay', sp: s, until: L.until }); return true; }
      }
      // a few steps elsewhere, and a look about
      for (let k = 0; k < 6; k++) {
        const a = rng() * TAU, r = range(3, 10), x = ag.x + Math.cos(a) * r, y = ag.y + Math.sin(a) * r;
        if (!standable(ag, x, y) || (!C && !way.los([ag.x, ag.y], [x, y])) || !reach(x, y)) continue;
        const t = spot(x, y, C ? floorAt(C, x, y) : NaN, a + range(-1, 1), 'stand', { cl: C });
        drop(ag);
        ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until: L.until });
        return true;
      }
      return false;
    }

    // ---- bodies keep out of one another: each a capsule along its
    // heading; where two overlap they are pushed apart, the lighter more,
    // what is sitting, lying or yoked not at all; walkers meeting step
    // aside to the right; and the timid get out of the way ----
    const SIZE = { sheep: [0.28, 0.3], goat: [0.28, 0.24], cow: [0.62, 0.42], ox: [0.62, 0.42], horse: [0.6, 0.36], donkey: [0.45, 0.28], dog: [0.2, 0.16], cat: [0.1, 0.1], hen: [0, 0.12], rider: [0.6, 0.4], cart: [1.3, 0.75] };
    const HEAVY = { person: 1, sheep: 0.8, goat: 0.7, dog: 0.5, cat: 0.3, hen: 0.2, cow: 4, ox: 4, horse: 4, donkey: 2.5, rider: 5 };
    const SETTLED = new Set(['sit', 'lie', 'recline', 'kneel', 'squat', 'swim']);
    const sizeOf = ag => ag.kind === 'person' ? (ag.pose === 'lie' || ag.pose === 'recline' ? [0.55, 0.25] : [0, ag.age === 'child' ? 0.17 : ag.pose === 'sit' ? 0.3 : 0.23]) : SIZE[ag.kind] || [0, 0.3];
    function weight(ag) {
      const L = ag.leg;
      if (ag.follow || ag.ploughing || ag.kind === 'cart' || ag.kind === 'boat') return Infinity;
      if (L && (L.k === 'climb' || L.drift || L.run || L.k === 'hide')) return Infinity;
      if (ag.kind === 'person' && L && L.k === 'stay' && SETTLED.has(ag.pose)) return Infinity;
      return (HEAVY[ag.kind] || 1) * (ag.pose === 'lie' ? 3 : 1);
    }
    function nudge(ag, dx, dy) {
      const x = ag.x + dx, y = ag.y + dy;
      if (!standable(ag, x, y)) return;
      ag.x = x; ag.y = y;
      const L = ag.leg;
      if (L && L.k === 'go' && L.pts) {
        const o = L.off || (L.off = [0, 0]);
        o[0] += dx; o[1] += dy;
        const m = Math.hypot(o[0], o[1]);
        if (m > 1.3) { o[0] *= 1.3 / m; o[1] *= 1.3 / m; }
      }
    }
    // pushed by a body met: one walking is never pushed back, only aside,
    // and held up long enough squeezes past
    function shove(ag, nx, ny, m, dt) {
      const L = ag.leg;
      if (L && L.k === 'go' && L.pts) {
        const ca = Math.cos(ag.a), sa = Math.sin(ag.a), back = nx * ca + ny * sa;
        if (back < 0) {
          const side = -nx * sa + ny * ca, sg = Math.abs(side) < 0.1 ? 1 : Math.sign(side);
          nx = -sa * sg; ny = ca * sg;
          ag.blockT = (ag.blockT || 0) + dt;
          if (ag.blockT > 1.8) { ag.ghost = now + 3; ag.blockT = 0; }
        }
      }
      nudge(ag, nx * m, ny * m);
    }
    // looking ahead as one walks: whatever is in the way, a step aside from it
    // in good time (meeting someone head on, each to the right)
    function steer(dt) {
      for (const ag of all) {
        const L = ag.leg;
        if (!ag.vis || !L || L.k !== 'go' || !L.pts || now < (ag.ghost || 0)) continue;
        const ca = Math.cos(ag.a), sa = Math.sin(ag.a), [, ra] = sizeOf(ag), sp = spaceOf(ag);
        let sx = 0, sy = 0;
        around(ag.x, ag.y, 2.8, o => {
          if (o === ag || !o.vis || o.kind === 'boat' || spaceOf(o) !== sp || Math.abs(o.z - ag.z) > 1.2 || together(ag, o)) return;
          const dx = o.x - ag.x, dy = o.y - ag.y, ahead = dx * ca + dy * sa, side = -dx * sa + dy * ca, [hb, rb] = sizeOf(o), r = ra + rb + hb * 0.5 + 0.15;
          if (ahead <= 0 || ahead > 2.6 || Math.abs(side) > r) return;
          const oncoming = o.leg && o.leg.k === 'go' && Math.cos(o.a) * ca + Math.sin(o.a) * sa < -0.3;
          const sg = oncoming || Math.abs(side) < 0.08 ? 1 : -Math.sign(side), k = (1 - ahead / 2.6) * (r - Math.abs(side) * (oncoming ? 0 : 1)) / r;
          sx += -sa * sg * k; sy += ca * sg * k;
        });
        if (sx || sy) { const m = Math.hypot(sx, sy), v = Math.min(1, m) * 0.9 * dt; nudge(ag, sx / m * v, sy / m * v); }
        else if (ag.blockT) ag.blockT = Math.max(0, ag.blockT - dt);
      }
    }
    // the nearest points of two segments
    function closest(ax, ay, bx, by, cx, cy, dx, dy) {
      const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy, rx = ax - cx, ry = ay - cy;
      const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
      let s = 0, t = 0;
      if (a < 1e-9 && e < 1e-9) { s = t = 0; }
      else if (a < 1e-9) t = clamp(f / e, 0, 1);
      else {
        const c = d1x * rx + d1y * ry;
        if (e < 1e-9) s = clamp(-c / a, 0, 1);
        else {
          const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
          s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
      }
      return [ax + d1x * s, ay + d1y * s, cx + d2x * t, cy + d2y * t];
    }
    const together = (a, b) => a.follow === b || b.follow === a || (a.follow && a.follow === b.follow) || (a.team && a.team.includes(b)) || (b.team && b.team.includes(a));
    function apart(dt) {
      // (only about what has moved: what stands still has been kept apart already)
      for (const ag of all) {
        if (!ag.vis || !ag.mv || ag.kind === 'boat') continue;
        const [ha, ra] = sizeOf(ag), wa = weight(ag), ca = Math.cos(ag.a), sa = Math.sin(ag.a), sp = spaceOf(ag);
        const walking = ag.leg && ag.leg.k === 'go' && ag.pose !== 'stand';
        around(ag.x, ag.y, walking ? 3.5 : 2.2, o => {
          if (o === ag || (o.mv && o.id < ag.id) || o.kind === 'boat' || Math.abs(o.z - ag.z) > 1.2 || spaceOf(o) !== sp || together(ag, o) || now < (o.ghost || 0) || now < (ag.ghost || 0)) return;
          const [hb, rb] = sizeOf(o), wb = weight(o);
          if (wa === Infinity && wb === Infinity) return;
          const cb = Math.cos(o.a), sb = Math.sin(o.a);
          const [px, py, qx, qy] = closest(ag.x - ca * ha, ag.y - sa * ha, ag.x + ca * ha, ag.y + sa * ha, o.x - cb * hb, o.y - sb * hb, o.x + cb * hb, o.y + sb * hb);
          let nx = px - qx, ny = py - qy, d = Math.hypot(nx, ny);
          const over = ra + rb - d;
          if (over <= 0) return;
          if (d < 1e-4) { const t = rng() * TAU; nx = Math.cos(t); ny = Math.sin(t); d = 1; }
          nx /= d; ny /= d;
          const fa = wa === Infinity ? 0 : wb === Infinity ? 1 : wb / (wa + wb), push = Math.min(over, 0.5) * 0.7;
          if (fa > 0) shove(ag, nx, ny, push * fa, dt);
          if (fa < 1) shove(o, -nx, -ny, push * (1 - fa), dt);
        });
      }
    }
    // the timid out of the way: sheep and goats of people on their feet and
    // of dogs, hens of everyone but whoever feeds them, cats of dogs; the
    // big beasts only of what comes right up to them
    const FLEE = { sheep: [2.6, 6, 2.4], goat: [2.2, 5, 2.8], hen: [1.6, 3.5, 1.8], cat: [1.8, 5, 3.4], cow: [1.2, 3, 1.4], ox: [1, 2.5, 1.2], horse: [1.3, 3, 2.6], donkey: [1.2, 3, 1.6] };
    function shy() {
      // what frightens, gathered from its side (a dog, someone on foot, a rider, a cart)
      const fear = new Map();
      for (const o of all) {
        if (!o.vis) continue;
        const k = o.kind, foot = k === 'person' && !SETTLED.has(o.pose) && o.anim !== 'scatter' && o.anim !== 'pet';
        if (!(k === 'dog' || k === 'cat' || k === 'rider' || k === 'cart' || foot)) continue;
        around(o.x, o.y, k === 'dog' ? 6 : k === 'cat' ? 3.5 : 4, ag => {
          const F = FLEE[ag.kind];
          if (!F || ag === o || !ag.vis || ag.follow || ag.ploughing || ag.tied || now < (ag.fleeT || 0) || spaceOf(o) !== spaceOf(ag)) return;
          const L = ag.leg;
          if (L && (L.flee || L.k === 'go' || L.k === 'hide')) return;
          let r = 0;
          if (k === 'dog') r = ag.kind === 'dog' ? 0 : F[1];
          else if (k === 'cat') r = ag.kind === 'hen' ? F[1] : 0;
          else if (k === 'person') r = ag.kind === 'cat' ? (o.pose === 'walk' || o.pose === 'run' ? F[0] : 0) : F[0];
          else r = F[0] * 1.5;
          const dx = ag.x - o.x, dy = ag.y - o.y, d = Math.hypot(dx, dy);
          if (!r || d > r || d < 1e-3) return;
          const f = fear.get(ag) || [0, 0];
          f[0] += dx / d * (r - d) / r; f[1] += dy / d * (r - d) / r;
          fear.set(ag, f);
        });
      }
      for (const [ag, [fx, fy]] of fear) {
        let ax = fx, ay = fy;
        // (a flock away to its middle as much as from what came)
        const Hd = ag.herd;
        if (Hd) { const [cx, cy] = Hd.pt(Hd.mx, Hd.my), d = Math.hypot(cx - ag.x, cy - ag.y) || 1; ax += (cx - ag.x) / d * 0.5; ay += (cy - ag.y) / d * 0.5; }
        const m = Math.hypot(ax, ay) || 1, dist = range(2, 4.5);
        let x = ag.x + ax / m * dist, y = ag.y + ay / m * dist;
        if (Hd) [x, y] = Hd.pt(...Hd.clampU((x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c));
        if (!standable(ag, x, y) || (!ag.cl && !Hd && !way.los([ag.x, ag.y], [x, y]))) { ag.fleeT = now + 1; continue; }
        ag.legs.length = 0;
        ag.leg = { k: 'trot', x, y, speed: FLEE[ag.kind][2], pose: 'run', flee: true, until: now + 4 };
        ag.fleeT = now + 1.5;
      }
    }

    // ================= on =================
    const figures = [], lights = [];
    let sunT = -1, clockT = -Infinity, tick = 0, acc = 0;
    function step(dt, d) {
      dt = Math.min(dt, 0.5);
      now += dt;
      // (the hour afresh every two seconds or so)
      if (Math.abs(d.getTime() - clockT) > 2000) { clock = hour(d); clockT = d.getTime(); }
      if (Math.abs(d.getTime() - sunT) > 60e3) { sunT = d.getTime(); sunAz = RomanTownSky.local(d).sun.az; }
      deadline = timeNow() + 8;
      if (!hash.size) reindex();
      for (const ag of all) {
        if (ag.kind === 'boat') { boat(ag, dt); continue; }
        // (nothing to do for one out of sight, or a beast standing, grazing or lying a while, till it is over)
        const Lq = ag.leg;
        if (Lq && now < Lq.until && (Lq.k === 'hide' || (Lq.k === 'stay' && ag.kind !== 'person' && !Lq.face && !Lq.tether && Lq.seen))) { ag.mv = false; continue; }
        if (Lq && Lq.k === 'stay') Lq.seen = true;
        const x0 = ag.x, y0 = ag.y, p0 = ag.pose;
        update(ag, dt);
        ag.mv = ag.x !== x0 || ag.y !== y0 || ag.pose !== p0;
        // the leaders' trails, for their followers
        if (ag.train || ag.cart) {
          const T = ag.trail || (ag.trail = []), last = T[T.length - 1];
          if (!last || Math.hypot(ag.x - last[0], ag.y - last[1]) > 0.3) { T.push([ag.x, ag.y]); if (T.length > 60) T.shift(); }
        }
      }
      for (const ag of all) if (ag.follow) { follow(ag); ag.mv = true; }
      reindex();
      feeders = all.filter(a => a.vis && a.anim === 'scatter');
      // (the frightened and the kept apart every other moment)
      if (dt > 0) { acc += dt; if (++tick % 2 === 0) { shy(); steer(acc); apart(acc); acc = 0; } }
      figures.length = 0; lights.length = 0;
      for (const T of tables.values()) if (T.laid > now) figures.push(T);
      for (const ag of all) {
        if (!ag.vis) continue;
        figures.push(ag);
        if (ag.prop) figures.push(ag.prop);
        if (ag.torch) {
          const c = Math.cos(ag.a), s = Math.sin(ag.a);
          lights.push({ x: ag.x + c * 0.3 - s * 0.32, y: ag.y + s * 0.3 + c * 0.32, z: ag.z + 2.1, power: 0.75 });
        }
      }
    }
    // a warm start: everyone already about what they are about at this hour
    warm = true;
    for (const ag of all) {
      if (ag.kind === 'boat') continue;
      if (ag.follow) continue;
      think(ag);
      if (!ag.placed && ag.legs.length) {
        // (if nothing put it anywhere, at the first spot it is going to)
        const L = ag.legs.find(l => l.sp);
        if (L) place(ag, L.sp);
      }
      ag.placed = true;
      // part way through what it is doing
      if (ag.traveller) continue;
      const L = ag.legs.find(l => l.k === 'stay' || l.k === 'hide');
      if (L) { const i = ag.legs.indexOf(L); ag.legs.splice(0, i); L.until = now + (L.until - now) * rng(); }
    }
    warm = false;
    for (const ag of all) if (ag.kind === 'boat') boat(ag, 0);
    step(0, date);
    return { step, figures, lights, people: all };
  }

  return { create, hour };
})();
