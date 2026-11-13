// Black Holes — a small universe on a torus: black holes and dust, nothing
// but gravity between them, its mass-energy and momentum kept constant.
//
// Gravity is the weak-field limit of general relativity, the only way two
// dimensions get any: in 2+1 dimensions Einstein's equations give no
// attraction at all. So space is a thin slice of a 3D one, where a mass
// pulls as −G·M/r, and one potential Φ curves both time and space,
//   ds² = −α²c²dt² + dx²/α²,  α = 1 + Φ/c²
// (Schwarzschild's, in isotropic coordinates, to first order): clocks run
// slow by α where Φ is deep, light moves at α²c there, and every body moves
// by its Hamiltonian in it,
//   H = α·S,  S = √(m²c⁴ + α²c²p²) (its energy, as measured where it is),
// so nothing outruns light, a fast body bends twice as much as a slow one,
// as light does, orbits precess, and a body falling in slows and reddens as
// it nears the horizon, where α is 0, r_h = GM/c². What comes within the
// hole's shadow, 2r_h, where α is ½ and nothing climbs back out, is the
// hole's. H, a body's energy as seen from afar, is what it keeps as it falls,
// and what it weighs: the mass that pulls is H/c² (Tolman's), not S/c²,
// which near a horizon grows without end.
//
// Φ on the torus is the particle–mesh way: the mass spread on a grid, its
// potential found by FFT (periodic, so the torus wraps by itself), only its
// long range there, smoothed over A; the short range of every pair with a
// hole in it added directly (the P³M way), so a hole is sharp to its shadow,
// the split measured off the grid itself, so the two add up to the torus's
// own 1/r. Dust pulls dust only through the grid: softened, as a cloud of
// dust is. Holes pull holes pair by pair, by one potential, alike and
// opposite, and no hole's α holds another's well.
//
// The mass-energy, E = Σ αS − W (W, all the pairs' binding, −G·m₁m₂/r, is
// in the α of both, so once comes off), with the waves' on their way, and
// the momentum, Σ p, never change. What happens:
//   a particle falls in: the hole takes what the two came to in E, and its
//     momentum; its rest mass, √(S² − α²c²p²)/c², grows by more than the
//     particle's, by its speed;
//   two holes merge, as one, the same way, a twentieth of it going off in a
//     gravitational wave; before they merge, a pair circling close loses its
//     orbit's energy to gravitational waves as two masses would (Peters);
//   a hole evaporates: Hawking radiation, at a power K/M², each quantum a
//     particle of the dust, leaving fast, about 0.7c, in pairs back to
//     back (as evenly every way as a hole radiates), each carrying its share
//     of the hole's motion, its share of E taken from the hole: a small hole,
//     hotter, sends them the more often, and its last bit bursts;
//   dust collapses: where its own well is deep enough that a horizon is all
//     but there, the dust nearly trapped is a hole, with all it came to;
//   dust rubs: where it crowds, it is pulled to move as the gas about it
//     does, the motion lost heat, the heat, a photon's worth at a time,
//     shone off as a fast particle that flies free a while;
//   a gravitational wave runs out at c from where it began, and gives its
//     energy, shell by shell, to the dust it passes, pushing it out.
// The weak field is pushed past what it keeps exactly where it is pushed
// hardest, a hole ploughing through relativistic dust, pairs of holes about
// to merge (not the integration: it loses as little with the step halved and
// halved again); what is lost is put back each step, to the dust, its
// momenta scaled and shifted by as little as makes the totals what they
// were: E holds to a few parts in a thousand.
const BlackHoles = (() => {
  const TAU = Math.PI * 2;
  const SQRT_PI = Math.sqrt(Math.PI);
  const hyp = (a, b) => Math.sqrt(a * a + b * b);
  // erfc for x ≥ 0 (Abramowitz & Stegun 7.1.26, to 1.5e−7), e^(−x²) given
  function erfc(x, ex2 = Math.exp(-x * x)) {
    const t = 1 / (1 + 0.3275911 * x);
    return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * ex2;
  }

  // in-place radix-2 complex FFT of length n (a power of two)
  function fftPlan(n) {
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(TAU * i / n); sin[i] = Math.sin(TAU * i / n); }
    return (re, im, inverse) => {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      const sg = inverse ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let s = 0; s < n; s += size) {
          for (let k = 0; k < half; k++) {
            const wr = cos[k * step], wi = sg * sin[k * step];
            const a = s + k, b = a + half;
            const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    };
  }

  // A universe Lx × Ly (Ly = 1 is the unit of length), of rest mass 1 at
  // first, G = 1. Time is in its own seconds.
  function universe(rng, {
    Lx = 1, Ly = 1, N = 16000, NY = 128,
    c = 3,
    HOLES = 3, HOLE_MASS = [0.1, 0.2], // the holes there at first
    WARM = 0.35, // the dust's first speeds, of c
    K = 0.6, // Hawking power: dE/dt = −K/M²
    GAMMA_Q = 1.4, // a Hawking quantum's γ, far off (about 0.7c), whatever the hole
    M_END = 0.02, // a hole this light bursts
    EMIT_RATE = 900, // Hawking particles from a hole a second, at most
    SWALLOW = 2, EMIT = 3, // radii, of r_h: what comes within its shadow (where α is ½) is the hole's; where its quanta leave
    GW_MERGE = 0.05, // the share of a merger going off in a wave
    PETERS = true, // close pairs losing their orbits to gravitational waves
    ALPHA_COLLAPSE = 0.5, // dust whose own well is this deep collapses
    CLEAR = 0.1, // (no nearer a hole than this: dust heaped about a hole is the hole's to take)
    FRICTION = 3, // how often dust collides, a second, where it is as dense as on the whole (the denser, the more often)
    DENSE_MAX = 40, // (no more often than at this many times as dense)
    E_PHOTON = 1, // what a photon carries off, of a particle's rest energy (it leaves at about 0.87c)
    PHOTON_LIFE = 0.4, // seconds a photon flies, untouched by friction, before it is dust again
  } = {}) {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
    const c2 = c * c, c4 = c2 * c2;
    const ALPHA_MIN = 0.02;
    // the grid: NX × NY cells, as square as powers of two allow
    const NX = 2 ** Math.round(Math.log2(NY * Lx / Ly));
    const dx = Lx / NX, dy = Ly / NY, cellA = dx * dy, NC = NX * NY;
    const A = 1.25 * Math.max(dx, dy), RCUT = 6 * A, RCUT2 = RCUT * RCUT; // the split, and how far its short range reaches
    const m = 1 / N; // a particle's rest mass

    // ---- the long range, by FFT ----
    const fftX = fftPlan(NX), fftY = fftPlan(NY);
    const re = new Float64Array(NC), im = new Float64Array(NC);
    const rowR = new Float64Array(NX), rowI = new Float64Array(NX), colR = new Float64Array(NY), colI = new Float64Array(NY);
    const green = new Float64Array(NC); // −2πG/k · e^(−k²A²): the transform of −G·erf(r/2A)/r
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const kx = TAU * (i <= NX / 2 ? i : i - NX) / Lx, ky = TAU * (j <= NY / 2 ? j : j - NY) / Ly, k = hyp(kx, ky);
      green[j * NX + i] = k === 0 ? 0 : -TAU / k * Math.exp(-k * k * A * A);
    }
    function fft2(inverse) {
      for (let j = 0; j < NY; j++) {
        const o = j * NX;
        for (let i = 0; i < NX; i++) { rowR[i] = re[o + i]; rowI[i] = im[o + i]; }
        fftX(rowR, rowI, inverse);
        for (let i = 0; i < NX; i++) { re[o + i] = rowR[i]; im[o + i] = rowI[i]; }
      }
      for (let i = 0; i < NX; i++) {
        for (let j = 0; j < NY; j++) { colR[j] = re[j * NX + i]; colI[j] = im[j * NX + i]; }
        fftY(colR, colI, inverse);
        for (let j = 0; j < NY; j++) { re[j * NX + i] = colR[j]; im[j * NX + i] = colI[j]; }
      }
    }
    // Φ is the torus's, its mean 0 (all there is to measure it from), so
    // that α is a little over 1 where space is emptiest
    const rho = new Float64Array(NC), rhoDust = new Float64Array(NC); // mass in each cell
    const phi = new Float64Array(NC), gx = new Float64Array(NC), gy = new Float64Array(NC);
    function solve() {
      for (let k = 0; k < NC; k++) { re[k] = rho[k] / cellA; im[k] = 0; }
      fft2(false);
      for (let k = 0; k < NC; k++) { re[k] *= green[k]; im[k] *= green[k]; }
      fft2(true);
      for (let k = 0; k < NC; k++) phi[k] = re[k] / NC;
      for (let j = 0; j < NY; j++) {
        const jn = (j + 1) % NY, jp = (j + NY - 1) % NY;
        for (let i = 0; i < NX; i++) {
          const inn = (i + 1) % NX, ip = (i + NX - 1) % NX, k = j * NX + i;
          gx[k] = (phi[j * NX + inn] - phi[j * NX + ip]) / (2 * dx);
          gy[k] = (phi[jn * NX + i] - phi[jp * NX + i]) / (2 * dy);
        }
      }
    }
    // cloud-in-cell: the four cells round x, y and their weights
    const cic = new Float64Array(4), cicK = new Int32Array(4);
    function weights(x, y) {
      const fx = x / dx - 0.5, fy = y / dy - 0.5;
      const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
      const i1 = (i0 + 1 + NX) % NX, j1 = (j0 + 1 + NY) % NY, ia = (i0 + NX) % NX, ja = (j0 + NY) % NY;
      cicK[0] = ja * NX + ia; cic[0] = (1 - tx) * (1 - ty);
      cicK[1] = ja * NX + i1; cic[1] = tx * (1 - ty);
      cicK[2] = j1 * NX + ia; cic[2] = (1 - tx) * ty;
      cicK[3] = j1 * NX + i1; cic[3] = tx * ty;
    }
    const sample = f => f[cicK[0]] * cic[0] + f[cicK[1]] * cic[1] + f[cicK[2]] * cic[2] + f[cicK[3]] * cic[3];
    // A body's own long-range potential and pull at itself, per unit mass:
    // they are in the grid's Φ there, and are no part of its energy, nor
    // pull it anywhere. They depend on where in its cell it is, so they are
    // found from the grid's answer to a unit mass in one cell, at the cells
    // next to it (KP, KX, KY, offsets −1–1 each way).
    const KP = new Float64Array(9), KX = new Float64Array(9), KY = new Float64Array(9);
    // The grid's pull of a unit mass, by how far (averaged round), GK; and
    // the short range, what it lacks of the torus's own, −1/r (and its
    // images, and the mean taken out: a constant so near, matched at RCUT),
    // TP, and its pull over r, TF. (Not erf and erfc: those split 1/r so in
    // three dimensions, not on a plane.)
    const NG = 2048, RG = 0.35, dG = RG / (NG - 1), GK = new Float64Array(NG);
    const NT = 1024, dT = RCUT / (NT - 1), TP = new Float64Array(NT), TF = new Float64Array(NT);
    const EPS2 = 0.0015 ** 2; // (softened within this, far inside any horizon that shows)
    {
      rho.fill(0); rho[0] = 1; solve();
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const k = ((b + NY) % NY) * NX + (a + NX) % NX, o = (b + 1) * 3 + a + 1;
        KP[o] = phi[k]; KX[o] = gx[k]; KY[o] = gy[k];
      }
      const x0 = 0.5 * dx, y0 = 0.5 * dy, ANG = 48;
      const at = r => {
        let s = 0;
        for (let k = 0; k < ANG; k++) {
          const th = TAU * (k + 0.5) / ANG;
          let x = x0 + r * Math.cos(th), y = y0 + r * Math.sin(th);
          x -= Lx * Math.floor(x / Lx); y -= Ly * Math.floor(y / Ly);
          weights(x, y); s += sample(phi);
        }
        return s / ANG;
      };
      for (let i = 0; i < NG; i++) GK[i] = at(i * dG);
      const C = at(RCUT) + 1 / RCUT;
      for (let i = 0; i < NT; i++) { const r = i * dT; TP[i] = -1 / Math.sqrt(r * r + EPS2) - at(r) + C; }
      for (let i = 1; i < NT - 1; i++) TF[i] = (TP[i + 1] - TP[i - 1]) / (2 * dT) / (i * dT);
      TF[0] = TF[1]; TF[NT - 1] = 0;
      const end = TP[NT - 1]; // (0, as matched; a hair off it, taken out so the short range ends smoothly)
      for (let i = 0; i < NT; i++) TP[i] -= end * i / (NT - 1);
    }
    // the grid's potential of a unit mass r away, and its pull over r
    const GF = new Float64Array(NG);
    for (let i = 1; i < NG - 1; i++) GF[i] = (GK[i + 1] - GK[i - 1]) / (2 * dG) / (i * dG);
    GF[0] = GF[1];
    const gridK = r => { const f = Math.min(r, RG) / dG, i = Math.min(NG - 2, f | 0), t = f - i; return GK[i] * (1 - t) + GK[i + 1] * t; };
    const gridF = r => { const f = Math.min(r, RG) / dG, i = Math.min(NG - 2, f | 0), t = f - i; return GF[i] * (1 - t) + GF[i + 1] * t; };
    // a pair's whole pull over r, the grid's and the short range, per unit mass of each
    const pairPull = r => { let f = gridF(r); if (r < RCUT) { short(r); f += shPull; } return f; };
    const OFF = [[0, 0], [1, 0], [0, 1], [1, 1]]; // the four cells of weights(), relative to the first
    let selfP = 0, selfX = 0, selfY = 0;
    function self(x, y) { // (leaves weights() as at x, y)
      weights(x, y);
      selfP = selfX = selfY = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const o = (OFF[a][1] - OFF[b][1] + 1) * 3 + OFF[a][0] - OFF[b][0] + 1, w = cic[a] * cic[b];
        selfP += w * KP[o]; selfX += w * KX[o]; selfY += w * KY[o];
      }
    }

    const wrap = (v, L) => v - L * Math.floor(v / L);
    const near = (d, L) => d - L * Math.round(d / L); // the nearest image's offset
    const lapse = P => Math.max(ALPHA_MIN, 1 + P / c2);

    // ---- the short range of a hole's pull ----
    // the potential, and the pull's size over r (so that times the offset it
    // is the pull), per unit mass of the source (see TP, TF)
    let shPhi = 0, shPull = 0;
    function short(r) {
      const f = Math.min(r / dT, NT - 1.000001), i = f | 0, t = f - i;
      shPhi = TP[i] * (1 - t) + TP[i + 1] * t;
      shPull = TF[i] * (1 - t) + TF[i + 1] * t;
    }
    // a pair's whole potential, the grid's and the short range, per unit mass of each
    const pairPot = r => { let p = gridK(r); if (r < RCUT) { short(r); p += shPhi; } return p; };
    // α at a point, as a particle there would have it (but for itself)
    function alphaAt(x, y) {
      weights(wrap(x, Lx), wrap(y, Ly));
      let P = sample(phi);
      for (const h of holes) {
        const r = hyp(near(h.x - x, Lx), near(h.y - y, Ly));
        if (r < RCUT) { short(r); P += h.Hg / c2 * shPhi; }
      }
      return lapse(P);
    }

    // ---- the dust ----
    const CAP = Math.ceil(N * 1.6);
    const px = new Float64Array(CAP), py = new Float64Array(CAP); // position
    const qx = new Float64Array(CAP), qy = new Float64Array(CAP); // momentum per unit rest mass
    const ox = new Float64Array(CAP), oy = new Float64Array(CAP); // where it was a step ago
    const al = new Float32Array(CAP), be = new Float32Array(CAP); // α there, and its speed there, of c
    const S = new Float64Array(CAP); // its energy there, per unit rest mass
    // Its weight, H = αS per unit rest mass, eased towards it over a few
    // steps: H is what it keeps as it falls, but not as the gravity about it
    // changes, and where dust crowds round a hole its weight and the depth
    // of the well it is in would chase one another, step by step.
    const Hg = new Float64Array(CAP);
    const EASE = 0.05;
    const born = new Uint8Array(CAP); // just made: no trail from where it was
    const ph = new Float32Array(CAP); // a photon (a Hawking quantum, or light from friction): how long it still flies free
    const ht = new Float64Array(CAP); // its heat, from friction, not yet shone (as seen from afar)
    // (for the step: the grid's pull and Φ at each, the way to the nearest horizon, the hole it is in)
    const tGx = new Float64Array(CAP), tGy = new Float64Array(CAP), tPl = new Float64Array(CAP), tGap = new Float64Array(CAP);
    const tInto = new Int16Array(CAP);
    let n = 0;
    function addParticle(x, y, ux, uy, alpha = 1, life = 0) {
      if (n >= CAP) return false;
      ph[n] = life; ht[n] = 0;
      px[n] = ox[n] = wrap(x, Lx); py[n] = oy[n] = wrap(y, Ly);
      qx[n] = ux; qy[n] = uy; al[n] = alpha; born[n] = 1;
      const u2 = ux * ux + uy * uy;
      S[n] = Math.sqrt(c4 + c2 * alpha * alpha * u2);
      be[n] = c * alpha * Math.sqrt(u2) / S[n];
      Hg[n] = alpha * S[n];
      n++;
      return true;
    }
    function removeParticle(i) {
      n--;
      px[i] = px[n]; py[i] = py[n]; qx[i] = qx[n]; qy[i] = qy[n]; ox[i] = ox[n]; oy[i] = oy[n];
      al[i] = al[n]; be[i] = be[n]; S[i] = S[n]; Hg[i] = Hg[n]; born[i] = born[n]; ph[i] = ph[n]; ht[i] = ht[n];
    }

    // ---- the holes ----
    // {x, y, M (rest mass), qx, qy (momentum per unit rest mass), al (α
    //  there, from all else), S (its energy there), Hg (its weight, as the
    //  dust's), rh (horizon), budget (energy radiated, not yet emitted),
    //  quantum (the next particle's energy at infinity), age}
    const holes = [];
    let nextId = 1;
    const rhOf = M => M / c2;
    // ---- spin ----
    // A hole spins, J (about the axis out of the plane; its sign, which
    // way), never past Kerr's bound, |J| ≤ χ_max·GM²/c. Near it space itself
    // is dragged round, at ω = 2GJ/(c²r³) (Lense and Thirring's, its far
    // field; softened within r_h, and let go of by DRAG_OUT r_h): a body there
    // moves by H = αS + ω·L, L its angular momentum about the hole, so it is
    // swept round, and every bit of that is in E. Its shadow shrinks as it
    // spins faster (Kerr's horizon, (1 + √(1 − χ²))/2 of Schwarzschild's),
    // and what goes round with it comes nearer before it is taken, what
    // goes against it is taken further off.
    const CHI_MAX = 0.998, DRAG_OUT = 10;
    const jMax = M => CHI_MAX * M * M / c;
    const chiOf = h => h.M > 0 ? h.J * c / (h.M * h.M) : 0;
    const capSpin = h => { const jm = jMax(h.M); h.J = Math.max(-jm, Math.min(jm, h.J)); };
    const shadowOf = h => { const x = Math.min(1, Math.abs(chiOf(h))); return SWALLOW * h.rh * (0.85 + 0.15 * Math.sqrt(1 - x * x)); };
    // how near a body is taken: its shadow, less as it goes round with the
    // spin (s, the sine of its way from the radial: +1 with, −1 against)
    const takenAt = (shadow, chi, s) => shadow * (1 - 0.3 * chi * s);
    let omg = 0, domg = 0; // ω there, and dω/dr
    function drag(J, rh, r) {
      const R = Math.max(DRAG_OUT * rh, 0.05);
      if (!J || r >= R) { omg = domg = 0; return; }
      const d2 = r * r + rh * rh, d = Math.sqrt(d2), base = 2 * J / (c2 * d2 * d), dbase = -3 * base * r / d2;
      const t = r / R;
      if (t < 0.6) { omg = base; domg = dbase; return; }
      const z = (1 - t) / 0.4, taper = z * z * (3 - 2 * z), dtaper = (6 * z - 6 * z * z) * (-1 / (0.4 * R));
      omg = base * taper; domg = dbase * taper + base * dtaper;
    }
    // The next Hawking particle's energy at infinity: always fast, far past
    // the speed it needs to get away, about GAMMA_Q (never more than a
    // fiftieth of the hole). A big hole, cooler, radiates less power, so
    // fewer of them; a small one, hotter, more: the same quanta, more often.
    function quantum(M) {
      const g = Math.max(1.3, GAMMA_Q * (1 + 0.12 * gauss()));
      return Math.min(m * c2 * g, Math.max(1.05 * m * c2, 0.02 * M * c2));
    }
    // a hole of energy S there and momentum P (totals)
    function makeHole(x, y, Stot, Px, Py, alpha) {
      const h = { id: nextId++, x: wrap(x, Lx), y: wrap(y, Ly), M: 0, qx: 0, qy: 0, al: alpha, S: 0, Hg: 0, rh: 0,
        J: 0, lx: 0, ly: 0, jx: 0, jy: 0, selfP: 0, longP: (alpha - 1) * c2, phiShort: 0, hp: 0, budget: 0, quantum: 0, age: 0, dying: false };
      refit(h, Stot, Px, Py);
      h.Hg = alpha * h.S;
      h.quantum = quantum(h.M);
      holes.push(h);
      return h;
    }
    // A hole's energy or momentum changed: its rest mass follows,
    // √(S² − α²c²P²)/c². (Never moving faster than γ = HOLE_GAMMA: a small
    // hole, kicked about by its own quanta, would; what more momentum
    // there is, the dust gets, see the fix.)
    const HOLE_GAMMA = 1.25;
    function refit(h, Stot, Px, Py) {
      h.S = Stot;
      const a2 = h.al * h.al, P2 = Px * Px + Py * Py;
      h.M = Math.sqrt(Math.max(Stot * Stot / (HOLE_GAMMA * HOLE_GAMMA), Stot * Stot - c2 * a2 * P2)) / c2;
      const keep = Math.sqrt(Math.max(0, Stot * Stot - h.M * h.M * c4) / (c2 * a2 * P2 || 1));
      h.qx = Px * keep / h.M; h.qy = Py * keep / h.M; h.rh = rhOf(h.M);
    }

    // ---- the waves ----
    // {x, y, R (how far it has run), E (energy not yet given), E0, age}
    const ripples = [];
    const R_MAX = hyp(Lx, Ly) / 2;
    const events = []; // what happened this step, for whoever listens

    // ---- the beginning: dust, warm and even, a few holes ----
    {
      const s = WARM * c / Math.SQRT2;
      for (let k = 0; k < N; k++) addParticle(rng() * Lx, rng() * Ly, gauss() * s, gauss() * s);
      for (let k = 0; k < HOLES; k++) {
        const M = HOLE_MASS[0] + rng() * (HOLE_MASS[1] - HOLE_MASS[0]);
        const h0 = makeHole(rng() * Lx, rng() * Ly, M * c2, 0, 0, 1);
        h0.J = (rng() * 2 - 1) * 0.6 * jMax(h0.M);
      }
      // the holes are made of dust: as much rest mass taken from it
      const taken = holes.reduce((s, h) => s + h.M, 0);
      for (let k = Math.round(taken / m); k > 0 && n; k--) removeParticle((rng() * n) | 0);
      // no momentum at all
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += qx[i]; sy += qy[i]; }
      for (let i = 0; i < n; i++) {
        qx[i] -= sx / n; qy[i] -= sy / n;
        S[i] = Hg[i] = Math.sqrt(c4 + c2 * (qx[i] ** 2 + qy[i] ** 2));
      }
    }

    let target = null, targetP = null; // the totals, as they were at first
    let energy = 0, momentum = [0, 0], time = 0;
    const stats = { swallowed: 0, emitted: 0, merged: 0, collapsed: 0, burst: 0, fixed: 0, photons: 0 };

    // ---- friction ----
    // Dust is gas: where it crowds, its particles collide, as often as it is
    // dense, and each is pulled towards how the gas about it moves (its
    // cell's mean, by the same cloud-in-cell weights as its mass on the
    // grid; so momentum, and near enough angular momentum, are kept: what
    // one gains another in the cell loses). Streams crossing one another
    // round a hole lose what they had of motion unalike, keep their spin,
    // and settle into a disk, going round together, the inner faster, and
    // rubbing on the outer, so the gas drifts in. What the friction takes
    // is heat, the particle's own, and goes where it goes (into a hole, if
    // it falls in); as soon as the particles in a cell have a photon's
    // worth of it between them, one of them shines it off: it leaves, fast,
    // any way, untouched by friction for PHOTON_LIFE, then is dust again.
    const cN = new Float64Array(NC), cQx = new Float64Array(NC), cQy = new Float64Array(NC), cF = new Float64Array(NC);
    const cH = new Float64Array(NC), cShone = new Int32Array(NC), tK = new Int32Array(CAP);
    function friction(dt) {
      if (!FRICTION) { for (let i = 0; i < n; i++) if (ph[i] > 0) ph[i] = Math.max(0, ph[i] - dt); return; }
      cN.fill(0); cQx.fill(0); cQy.fill(0);
      let nd = 0;
      for (let i = 0; i < n; i++) {
        if (ph[i] > 0) { ph[i] = Math.max(0, ph[i] - dt); if (ph[i] > 0) continue; }
        nd++;
        weights(px[i], py[i]);
        for (let q = 0; q < 4; q++) { const k = cicK[q], w = cic[q]; cN[k] += w; cQx[k] += w * qx[i]; cQy[k] += w * qy[i]; }
      }
      if (!nd) return;
      const mean = nd / NC;
      for (let k = 0; k < NC; k++) {
        if (cN[k] <= 0) { cF[k] = 0; continue; }
        cQx[k] /= cN[k]; cQy[k] /= cN[k];
        cF[k] = 1 - Math.exp(-FRICTION * Math.min(cN[k] / mean, DENSE_MAX) * dt);
      }
      const eph = E_PHOTON * m * c2;
      cH.fill(0); cShone.fill(0);
      for (let i = 0; i < n; i++) {
        if (ph[i] > 0) continue;
        weights(px[i], py[i]);
        let dqx = 0, dqy = 0;
        for (let q = 0; q < 4; q++) {
          const k = cicK[q], f = cic[q] * cF[k];
          dqx += f * (cQx[k] - qx[i]); dqy += f * (cQy[k] - qy[i]);
        }
        const S0 = S[i], a = al[i];
        qx[i] += dqx; qy[i] += dqy;
        S[i] = Math.sqrt(c4 + c2 * a * a * (qx[i] * qx[i] + qy[i] * qy[i]));
        ht[i] += a * m * (S0 - S[i]);
        const kc = Math.min(NY - 1, py[i] / dy | 0) * NX + Math.min(NX - 1, px[i] / dx | 0);
        tK[i] = kc; cH[kc] += ht[i];
      }
      // the cells with a photon's worth, or more, shine
      for (let i = 0; i < n; i++) {
        if (ph[i] > 0) continue;
        const kc = tK[i];
        if (cH[kc] - cShone[kc] * eph >= eph) {
          cShone[kc]++;
          const th = TAU * rng();
          kick(i, eph, Math.cos(th), Math.sin(th));
          ph[i] = -PHOTON_LIFE; // (marked: a photon just now; see below)
          events.push({ type: 'photon', x: px[i], y: py[i] });
          stats.photons++;
        }
      }
      // what is left of each such cell's heat, its particles share as they had it
      for (let i = 0; i < n; i++) {
        if (ph[i] > 0) continue;
        const kc = tK[i];
        if (cShone[kc]) ht[i] *= (cH[kc] - cShone[kc] * eph) / cH[kc];
        if (ph[i] < 0) ph[i] = -ph[i];
        be[i] = c * al[i] * Math.sqrt(qx[i] * qx[i] + qy[i] * qy[i]) / S[i];
      }
    }

    // One step of dt (its own seconds).
    function step(dt) {
      events.length = 0;
      time += dt;

      // ---- the weights on the grid ----
      rho.fill(0); rhoDust.fill(0);
      for (let i = 0; i < n; i++) {
        weights(px[i], py[i]);
        const w = m * Hg[i] / c2;
        for (let q = 0; q < 4; q++) { rho[cicK[q]] += cic[q] * w; rhoDust[cicK[q]] += cic[q] * w; }
      }
      for (const h of holes) {
        weights(h.x, h.y);
        for (let q = 0; q < 4; q++) rho[cicK[q]] += cic[q] * h.Hg / c2;
      }
      solve();

      // ---- the energy and momentum now; α at every body ----
      let E = 0, W = 0, Px = 0, Py = 0;
      const H = holes.length;
      for (const h of holes) {
        self(h.x, h.y);
        const w = h.Hg / c2;
        h.selfP = w * selfP;
        h.lx = -sample(gx) + w * selfX; h.ly = -sample(gy) + w * selfY;
        h.longP = sample(phi) - h.selfP;
        W += 0.5 * w * h.longP;
        h.phiShort = 0;
      }
      // Holes and holes: each pair by one potential V, counted once, and
      // pulling the two alike; a hole's α is the dust's, the other holes'
      // wells taken out of it. (With each α holding the other's well, two
      // holes alike deep in one another's would count their binding by
      // how deep, and pull one another unalike.)
      let VH = 0;
      for (let a = 0; a < H; a++) for (let b = a + 1; b < H; b++) {
        const ha = holes[a], hb = holes[b];
        const ddx = near(hb.x - ha.x, Lx), ddy = near(hb.y - ha.y, Ly), r = hyp(ddx, ddy);
        const wa = ha.Hg / c2, wb = hb.Hg / c2, gk = gridK(r), gf = gridF(r);
        ha.longP -= wb * gk; hb.longP -= wa * gk;
        ha.lx -= wb * gf * ddx; ha.ly -= wb * gf * ddy; hb.lx += wa * gf * ddx; hb.ly += wa * gf * ddy;
        let pp = gk;
        if (r < RCUT) { short(Math.max(r, 1e-6)); pp += shPhi; W += wa * wb * shPhi; }
        VH += wa * wb * pp;
      }
      const hx = holes.map(h => h.x), hy = holes.map(h => h.y), hw = holes.map(h => h.Hg / c2), hr = holes.map(h => h.rh);
      const hJ = holes.map(h => h.J), hChi = holes.map(h => Math.max(-1, Math.min(1, chiOf(h)))), hSh = holes.map(shadowOf);
      const hp = new Float64Array(H); // the dust's short range at each hole
      for (let i = 0; i < n; i++) {
        const w = m * Hg[i] / c2;
        let Pl;
        if (Hg[i] > 4 * c2) { // a heavy one (a hot Hawking particle): its own pull on the grid, else it would chase itself
          self(px[i], py[i]);
          Pl = sample(phi) - w * selfP; tGx[i] = sample(gx) - w * selfX; tGy[i] = sample(gy) - w * selfY;
        } else { // (its own on the grid: slight)
          weights(px[i], py[i]);
          Pl = sample(phi) - w * KP[4]; tGx[i] = sample(gx); tGy[i] = sample(gy);
        }
        tPl[i] = Pl;
        W += 0.5 * w * Pl;
        let P0 = Pl, gap = Infinity, into = -1;
        const qi = hyp(qx[i], qy[i]);
        for (let k = 0; k < H; k++) {
          const ddx = near(hx[k] - px[i], Lx), ddy = near(hy[k] - py[i], Ly), r = hyp(ddx, ddy);
          const L = -ddx * qy[i] + ddy * qx[i]; // its angular momentum about the hole, per unit mass
          if (r < takenAt(hSh[k], hChi[k], qi > 0 && r > 0 ? L / (r * qi) : 0)) into = k;
          if (hJ[k]) { drag(hJ[k], hr[k], r); E += m * omg * L; }
          if (r < RCUT) {
            short(Math.max(r, 1e-6));
            P0 += hw[k] * shPhi;
            W += w * hw[k] * shPhi;
            hp[k] += w * shPhi;
          }
          gap = Math.min(gap, Math.max(r - hr[k], 0.1 * hr[k]));
        }
        tGap[i] = gap; tInto[i] = into;
        const alpha = lapse(P0), u2 = qx[i] * qx[i] + qy[i] * qy[i];
        al[i] = alpha;
        S[i] = Math.sqrt(c4 + c2 * alpha * alpha * u2);
        E += alpha * m * S[i] + ht[i]; Px += m * qx[i]; Py += m * qy[i];
      }
      for (let k = 0; k < H; k++) {
        const h = holes[k];
        h.hp = hp[k];
        h.al = lapse(h.longP + hp[k]);
        h.S = h.M * Math.sqrt(c4 + c2 * h.al * h.al * (h.qx * h.qx + h.qy * h.qy));
        E += h.al * h.S; Px += h.M * h.qx; Py += h.M * h.qy;
      }
      energy = E - W + 2 * VH + ripples.reduce((a, w) => a + w.E, 0); momentum = [Px, Py]; // (W has the holes' pairs once, to come off; VH in no α: so twice back. And the waves', on their way, too)
      if (target === null) { target = energy; targetP = [Px, Py]; }

      // ---- the dust moves ----
      // (last first, so that one swallowed, the one put in its place has moved already)
      const hfx = new Float64Array(H), hfy = new Float64Array(H), jx = new Float64Array(H), jy = new Float64Array(H);
      let sumScale = 0; // for the fix: d(Σ αS)/dλ as the momenta scale by 1 + λ
      for (let i = n - 1; i >= 0; i--) {
        ox[i] = px[i]; oy[i] = py[i];
        if (tInto[i] >= 0) { swallow(holes[tInto[i]], i); continue; }
        const Gx = tGx[i], Gy = tGy[i], Pl = tPl[i];
        // substeps near a hole: a step no longer than a sixth of the way to it
        const sub = H ? Math.min(128, Math.max(1, Math.ceil(dt * c / (0.15 * tGap[i])))) : 1;
        const h = dt / sub;
        let x = px[i], y = py[i], ux = qx[i], uy = qy[i], swallowed = -1, alpha = al[i], u2 = 0;
        for (let s = 0; s < sub; s++) {
          // the pull and Φ here: the grid's (as at the step's start) and the holes' short range
          let fx = -Gx, fy = -Gy, P = Pl, vx = 0, vy = 0;
          for (let k = 0; k < H; k++) {
            const ddx = near(hx[k] - x, Lx), ddy = near(hy[k] - y, Ly), r2 = ddx * ddx + ddy * ddy;
            if (hJ[k]) {
              // dragged round: dx/dt += ω ẑ×r, dp/dt −= ∇(ωL), the hole taking the push back
              const r = Math.sqrt(r2);
              drag(hJ[k], hr[k], r);
              if (omg) {
                const L = -ddx * uy + ddy * ux, gxk = domg * L * -ddx / (r || 1) + omg * uy, gyk = domg * L * -ddy / (r || 1) - omg * ux;
                ux -= gxk * h; uy -= gyk * h;
                jx[k] += m * gxk * h; jy[k] += m * gyk * h;
                vx += omg * ddy; vy -= omg * ddx; // (ω·(−r_y, r_x), r from the hole)
              }
            }
            if (r2 < RCUT2 || hSh[k] * 1.3 > RCUT) {
              const r = Math.sqrt(r2), qq = hyp(ux, uy), L = -ddx * uy + ddy * ux;
              if (r < takenAt(hSh[k], hChi[k], qq > 0 && r > 0 ? L / (r * qq) : 0)) { swallowed = k; break; }
              if (r2 >= RCUT2) { hfx[k] = hfy[k] = 0; continue; }
              short(r);
              P += hw[k] * shPhi;
              const f = hw[k] * shPull;
              fx += f * ddx; fy += f * ddy;
              hfx[k] = f * ddx; hfy[k] = f * ddy;
            } else hfx[k] = hfy[k] = 0;
          }
          if (swallowed >= 0) break;
          // per unit mass: dp/dt = −(S + α²c²u²/S)·∇α, dx/dt = α³c²u/S
          alpha = lapse(P);
          const a2 = alpha * alpha;
          u2 = ux * ux + uy * uy;
          const Sl = Math.sqrt(c4 + c2 * a2 * u2), k1 = (Sl + c2 * a2 * u2 / Sl) / c2;
          ux += k1 * fx * h; uy += k1 * fy * h;
          // and as much the other way to each hole that pulled it
          for (let k = 0; k < H; k++) if (hfx[k] || hfy[k]) { jx[k] -= m * k1 * hfx[k] * h; jy[k] -= m * k1 * hfy[k] * h; }
          u2 = ux * ux + uy * uy;
          const k2 = a2 * alpha * c2 / Math.sqrt(c4 + c2 * a2 * u2);
          x += (k2 * ux + vx) * h; y += (k2 * uy + vy) * h;
        }
        px[i] = wrap(x, Lx); py[i] = wrap(y, Ly); qx[i] = ux; qy[i] = uy;
        if (born[i]) { ox[i] = px[i]; oy[i] = py[i]; born[i] = 0; }
        u2 = ux * ux + uy * uy;
        al[i] = alpha;
        S[i] = Math.sqrt(c4 + c2 * alpha * alpha * u2);
        if (swallowed >= 0) { swallow(holes[swallowed], i); continue; }
        be[i] = c * alpha * Math.sqrt(u2) / S[i];
        Hg[i] += EASE * (alpha * S[i] - Hg[i]);
        sumScale += alpha * m * c2 * alpha * alpha * u2 / S[i];
      }
      holes.forEach((h, k) => { h.jx = jx[k]; h.jy = jy[k]; }); // the dust's pull on the holes, as momentum, over the step

      // ---- the holes move ----
      moveHoles(dt);
      for (const h of holes) { h.age += dt; h.Hg += EASE * (h.al * h.S - h.Hg); }

      // ---- Hawking radiation ----
      for (let k = holes.length - 1; k >= 0; k--) {
        const h = holes[k];
        if (h.M < M_END || h.dying) { burst(h); holes.splice(k, 1); continue; }
        h.budget += K / (h.M * h.M) * dt;
        // (no more than EMIT_RATE·dt at a time: a hole near its end would put
        // hundreds at once on one spot, and they'd be bound to one another)
        const most = Math.max(1, Math.round(EMIT_RATE * Math.max(1, h.rh / A) * dt)); // (a wide horizon has room for more)
        // (in pairs, back to back: radiating evenly every way, as a hole does,
        // it isn't pushed about by its own quanta, as one at a time it would be)
        for (let k = 0; k < most && h.budget >= 2 * h.quantum && h.M >= M_END && !h.dying; k += 2) {
          h.budget -= 2 * h.quantum;
          const th = TAU * rng(), turn = (rng() - 0.5) * 1.6;
          radiate(h, h.quantum, th, turn);
          radiate(h, h.quantum, th + Math.PI, turn);
          h.quantum = quantum(h.M);
        }
      }

      // ---- the dust collapses ----
      collapse();

      // ---- the waves run on, giving their energy to the dust ----
      for (let k = ripples.length - 1; k >= 0; k--) {
        const w = ripples[k], R0 = w.R, R02 = R0 * R0;
        w.R += c * dt; w.age += dt;
        const R12 = w.R * w.R;
        let inShell = 0, beyond = 0;
        for (let i = 0; i < n; i++) {
          const ddx = near(px[i] - w.x, Lx), ddy = near(py[i] - w.y, Ly), d2 = ddx * ddx + ddy * ddy;
          if (d2 >= R02) { beyond++; if (d2 < R12) inShell++; }
        }
        if (beyond && inShell) {
          const e = w.E / beyond; // the same to each, so it is all given by the time it has passed them all
          for (let i = 0; i < n; i++) {
            const ddx = near(px[i] - w.x, Lx), ddy = near(py[i] - w.y, Ly), d2 = ddx * ddx + ddy * ddy;
            if (d2 < R02 || d2 >= R12) continue;
            const d = Math.sqrt(d2) || 1;
            kick(i, e, ddx / d, ddy / d);
            w.E -= e;
          }
        }
        if (w.R >= R_MAX || !beyond || w.E <= 1e-12) ripples.splice(k, 1); // (what is left, the fix puts back)
      }

      // ---- the dust rubs, and shines ----
      friction(dt);

      // ---- the totals put back ----
      fix(target - energy, targetP[0] - Px, targetP[1] - Py, sumScale);
    }

    // What the model doesn't keep goes to the dust, every step: every
    // particle's momentum scaled by 1 + λ and shifted alike, the least
    // change that puts the totals back (never more than 3% a step). The
    // integration loses next to nothing (dust alone, a part in 10⁵ a
    // second; as little with the step halved and halved again): what is
    // lost is the weak field's own, where it is pushed hardest, a hole
    // ploughing through relativistic dust, pairs of holes about to merge.
    function fix(dE, dPx, dPy, sumScale) {
      if (!n) return;
      const ddx = dPx / (n * m), ddy = dPy / (n * m);
      const lam = sumScale > 0 ? Math.max(-0.03, Math.min(0.03, dE / sumScale)) : 0;
      stats.fixed += lam * sumScale;
      for (let i = 0; i < n; i++) {
        qx[i] = qx[i] * (1 + lam) + ddx; qy[i] = qy[i] * (1 + lam) + ddy;
        S[i] = Math.sqrt(c4 + c2 * al[i] * al[i] * (qx[i] * qx[i] + qy[i] * qy[i]));
      }
    }

    // A hole takes particle i (as it is now: α, S), and its momentum: what
    // the two of them came to in the mass-energy, αS each, less their binding
    // (it is in both, and in W), is the hole's now, its α no longer holding
    // the particle's well.
    function swallow(h, i) {
      const r = hyp(near(px[i] - h.x, Lx), near(py[i] - h.y, Ly)), pp = pairPot(r), w = m * Hg[i] / c2;
      const a1 = Math.max(ALPHA_MIN, h.al - w * pp / c2);
      const rx = near(px[i] - h.x, Lx), ry = near(py[i] - h.y, Ly), L = rx * qy[i] - ry * qx[i];
      drag(h.J, h.rh, r);
      const before = al[i] * m * S[i] + ht[i] + h.al * h.S - h.Hg / c2 * w * pp + m * omg * L; // (and its being dragged round, gone into it, and its heat)
      // (its momentum as it is there: near the hole its own grows past what the hole felt pull it back)
      refit(h, before / a1, h.M * h.qx + al[i] * m * qx[i], h.M * h.qy + al[i] * m * qy[i]);
      h.al = a1;
      h.Hg += m * Hg[i]; // (its weight, from now on the hole's: the grid sees no jump)
      h.J += al[i] * m * L; // its angular momentum about the hole (as its momentum, as it is there), the hole's spin now
      capSpin(h);
      events.push({ type: 'swallow', x: h.x, y: h.y, hole: h.id, e: m * S[i] });
      stats.swallowed++;
      removeParticle(i);
    }

    // A Hawking particle of energy e at infinity, from just outside the
    // horizon, mostly outwards; the hole loses e (as seen from afar) and
    // recoils.
    function radiate(h, e, th, turn) {
      if (h.al * h.S < 2 * e) { h.dying = true; h.budget += e; return; } // all but gone: it bursts
      const r = Math.max(EMIT * h.rh, A); // (never within the grid's blur, where the dust is only soft)
      const ex = Math.cos(th), ey = Math.sin(th);
      const ae = Math.max(0.1, alphaAt(h.x + ex * r, h.y + ey * r)); // α there, as dust feels it, the hole's own well in it
      const Sp = e / (ae * m); // per unit mass
      const u = Math.sqrt(Math.max(0, Sp * Sp - c4) / c2) / ae;
      // mostly outwards, turned the way it spins the more, the faster it spins
      const spread = turn + 0.9 * Math.max(-1, Math.min(1, chiOf(h))), dxu = Math.cos(th + spread), dyu = Math.sin(th + spread);
      // and carried along with the hole, as much as its energy is of the hole's
      // (sent every way from a moving hole, they take its motion with them: else
      // the hole, lighter, its momentum all kept, would only go the faster)
      const gq = ae * Sp * h.M / (h.al * h.S), ux = dxu * u + gq * h.qx, uy = dyu * u + gq * h.qy;
      if (!addParticle(h.x + ex * r, h.y + ey * r, ux, uy, ae, PHOTON_LIFE)) { h.budget += e; return; }
      const ea = ae * m * S[n - 1]; // (what it took, as seen from afar: e, and its share of the hole's motion)
      // the hole keeps what it came to, less the quantum's αS, and their
      // binding, now counted in both and in W; its α deeper by the quantum's well
      const pp = pairPot(r), w = ea / c2, a1 = Math.max(ALPHA_MIN, h.al + w * pp / c2);
      const L = r * (ex * uy - ey * ux); // its angular momentum about the hole, per unit mass, from the hole's spin
      drag(h.J, h.rh, r);
      refit(h, (h.al * h.S - ea + h.Hg / c2 * w * pp - m * omg * L) / a1, h.M * h.qx - m * ux, h.M * h.qy - m * uy);
      h.J -= m * L;
      capSpin(h);
      h.al = a1;
      h.Hg -= ea; // (as much weight gone as the quantum has)
      events.push({ type: 'hawking', x: px[n - 1], y: py[n - 1], hole: h.id, e: ea, beta: be[n - 1] });
      stats.emitted++;
    }

    // The last of a hole, all at once: k particles, every way, its momentum
    // shared among them, as fast outwards as makes their energy, all told,
    // the hole's (fewer, if even at rest they'd be more). Their α is what
    // dust there feels, the grid's and the other holes'; the hole's own was
    // deeper by the dust close round it, which dust doesn't feel so near,
    // and that binding goes with the hole.
    function burst(h) {
      // its share of the mass-energy: αS, less its binding to that dust, counted in both it and W
      let V = 0;
      for (const o of holes) if (o !== h) V += h.Hg / c2 * o.Hg / c2 * pairPot(hyp(near(o.x - h.x, Lx), near(o.y - h.y, Ly)));
      const ae = lapse(h.longP);
      const H = Math.max(0, ae * h.S + h.hp * (h.S - h.Hg) / c2 + V); // (their α will hold the other holes' wells, as the hole's didn't)
      const P = [h.M * h.qx, h.M * h.qy];
      const k = Math.max(1, Math.floor(H / (m * c2 * 1.6)));
      // where: anywhere within the horizon, or the grid's blur if that is wider
      const turn = TAU * rng(), Rb = Math.max(h.rh, A);
      const at = Array.from({ length: k }, (_, j) => {
        const R = Rb * Math.sqrt((j + 0.5) / k), th = turn + j * 2.399963; // (a sunflower: evenly)
        return [h.x + Math.cos(th) * R, h.y + Math.sin(th) * R];
      });
      // Their binding to one another, by the grid, each as heavy as its share,
      // and the well each is in, of the others: their energy, all told,
      // Σ αS − W, is the hole's.
      const wEach = H / k / c2, ai = new Float64Array(k);
      let Wint = 0;
      for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
        const K = wEach * gridK(hyp(at[a][0] - at[b][0], at[a][1] - at[b][1]));
        ai[a] += K; ai[b] += K; Wint += wEach * K;
      }
      for (let a = 0; a < k; a++) {
        const r = hyp(at[a][0] - h.x, at[a][1] - h.y);
        ai[a] = lapse((alphaAt(at[a][0], at[a][1]) - 1) * c2 - h.Hg / c2 * pairPot(r) + ai[a]);
      }
      // its spin, as all of them going round: Σ m·d·u_t = J
      let sd = 0;
      for (const [x, y] of at) sd += hyp(x - h.x, y - h.y);
      const ut = sd > 0 ? h.J / (m * sd) : 0;
      const total = U => { // (each with its share of the momentum too)
        const sx = P[0] / (k * m), sy = P[1] / (k * m);
        let e = -Wint;
        for (let j = 0; j < k; j++) {
          const dxj = at[j][0] - h.x, dyj = at[j][1] - h.y, d = hyp(dxj, dyj) || 1;
          const ux = dxj / d * U - dyj / d * ut + sx, uy = dyj / d * U + dxj / d * ut + sy;
          e += ai[j] * m * Math.sqrt(c4 + c2 * ai[j] * ai[j] * (ux * ux + uy * uy));
        }
        return e;
      };
      let lo = 0, hi = 1;
      while (total(hi) < H && hi < 1e6) hi *= 2;
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; total(mid) < H ? lo = mid : hi = mid; }
      const sx = P[0] / (k * m), sy = P[1] / (k * m);
      for (let j = 0; j < k; j++) {
        // each flies straight out from where it starts, so they part at once
        const dxj = at[j][0] - h.x, dyj = at[j][1] - h.y, d = hyp(dxj, dyj) || 1;
        if (addParticle(at[j][0], at[j][1], dxj / d * lo - dyj / d * ut + sx, dyj / d * lo + dxj / d * ut + sy, ai[j], PHOTON_LIFE)) Hg[n - 1] = h.Hg / (k * m); // (the hole's weight, shared)
      }
      events.push({ type: 'burst', x: h.x, y: h.y, hole: h.id, e: H });
      stats.burst++;
    }

    // a particle given energy e (as seen from afar), pushed along (ex, ey)
    function kick(i, e, ex, ey) {
      const a2 = al[i] * al[i];
      const S1 = S[i] + e / (m * al[i]), u2 = qx[i] * qx[i] + qy[i] * qy[i];
      const u2n = (S1 * S1 - c4) / (c2 * a2), along = qx[i] * ex + qy[i] * ey;
      const lam = -along + Math.sqrt(Math.max(0, along * along - u2 + u2n));
      qx[i] += lam * ex; qy[i] += lam * ey;
      S[i] = Math.sqrt(c4 + c2 * a2 * (qx[i] * qx[i] + qy[i] * qy[i]));
    }

    function moveHoles(dt) {
      if (!holes.length) return;
      const sub = 8, h = dt / sub;
      for (let s = 0; s < sub; s++) {
        const H = holes.length;
        for (let a = 0; a < H; a++) {
          const ha = holes[a], w = ha.Hg / c2;
          // the grid's long range, the dust's (kept through the step)
          const fx = ha.lx, fy = ha.ly;
          const a2 = ha.al * ha.al, u2 = ha.qx * ha.qx + ha.qy * ha.qy, Sl = Math.sqrt(c4 + c2 * a2 * u2);
          const k1 = (Sl + c2 * a2 * u2 / Sl) / c2;
          ha.qx += k1 * fx * h + (ha.jx || 0) / (ha.M * sub); ha.qy += k1 * fy * h + (ha.jy || 0) / (ha.M * sub); // and the dust near it
        }
        // the holes, pair by pair, alike and opposite
        for (let a = 0; a < H; a++) for (let b = a + 1; b < H; b++) {
          const ha = holes[a], hb = holes[b], ddx = near(hb.x - ha.x, Lx), ddy = near(hb.y - ha.y, Ly);
          const f = ha.Hg / c2 * hb.Hg / c2 * pairPull(Math.max(hyp(ddx, ddy), 1e-6)) * h;
          ha.qx += f * ddx / ha.M; ha.qy += f * ddy / ha.M; hb.qx -= f * ddx / hb.M; hb.qy -= f * ddy / hb.M;
        }
        for (const ha of holes) {
          const a2 = ha.al * ha.al, most = c * Math.sqrt(HOLE_GAMMA * HOLE_GAMMA - 1) / ha.al; // (see refit)
          let u2 = ha.qx * ha.qx + ha.qy * ha.qy;
          if (u2 > most * most) { const k = most / Math.sqrt(u2); ha.qx *= k; ha.qy *= k; u2 = most * most; }
          const Sl = Math.sqrt(c4 + c2 * a2 * u2), k2 = a2 * ha.al * c2 / Sl;
          ha.x = wrap(ha.x + k2 * ha.qx * h, Lx); ha.y = wrap(ha.y + k2 * ha.qy * h, Ly);
          ha.S = ha.M * Sl;
        }
        // gravitational waves from every close pair, and mergers
        for (let a = 0; a < holes.length; a++) for (let b = a + 1; b < holes.length; b++) {
          const ha = holes[a], hb = holes[b];
          const ddx = near(hb.x - ha.x, Lx), ddy = near(hb.y - ha.y, Ly), r = hyp(ddx, ddy);
          if (r < SWALLOW * (ha.rh + hb.rh)) { merge(ha, hb, ddx, ddy, r); a = -1; break; }
          if (r > 30 * (ha.rh + hb.rh) || !PETERS) continue;
          // Peters: P = 32/5 · G⁴(m₁m₂)²(m₁ + m₂)/(c⁵r⁵), out of the pair's relative motion
          const m1 = ha.M, m2 = hb.M, mu = m1 * m2 / (m1 + m2);
          const P = 6.4 * (m1 * m2) ** 2 * (m1 + m2) / (c4 * c * r ** 5);
          const vx = hb.qx - ha.qx, vy = hb.qy - ha.qy, v2 = vx * vx + vy * vy;
          const kin = 0.5 * mu * v2, dE = Math.min(P * h, 0.2 * kin);
          if (v2 < 1e-12 || dE <= 0) continue;
          const f = Math.sqrt(1 - dE / kin) - 1; // the relative velocity shrinks by this
          ha.qx -= f * vx * m2 / (m1 + m2); ha.qy -= f * vy * m2 / (m1 + m2);
          hb.qx += f * vx * m1 / (m1 + m2); hb.qy += f * vy * m1 / (m1 + m2);
          wave(wrap(ha.x + ddx * m2 / (m1 + m2), Lx), wrap(ha.y + ddy * m2 / (m1 + m2), Ly), dE * (ha.al + hb.al) / 2, ha.id * 1e6 + hb.id, Math.atan2(ddy, ddx));
        }
      }
    }
    // a wave's energy: a pair's goes into the wave it is sending now, a new one every quarter second
    // (never more than MAX_WAVES at once: else a new one's energy goes to the youngest)
    const MAX_WAVES = 12;
    // (axis: the way the pair lay, as it went out: a wave from two masses
    // stretches space along one way and squeezes it across, by turns)
    function wave(x, y, e, from, axis = 0) {
      let w = ripples.find(w => w.from === from && w.age < 0.25);
      if (!w && ripples.length >= MAX_WAVES) w = ripples.reduce((a, b) => a.age < b.age ? a : b);
      if (w) { w.E += e; w.E0 += e; if (w.from === from) { w.x = x; w.y = y; w.axis = axis; } }
      else ripples.push({ x, y, R: 0, E: e, E0: e, age: 0, from, axis });
    }

    function merge(ha, hb, ddx, ddy, r) {
      // each one's α without the other's well in it, and their binding, counted once
      // what the two came to in the mass-energy, αS each (neither α holding the other's well), and V
      const pp = pairPot(r), aa = ha.al, ab = hb.al;
      const anew = (aa * ha.S + ab * hb.S) / (ha.S + hb.S);
      const Hnew = Math.max(0.5 * (aa * ha.S + ab * hb.S), aa * ha.S + ab * hb.S + ha.Hg * hb.Hg / c4 * pp);
      const Pxt = ha.M * ha.qx + hb.M * hb.qx, Pyt = ha.M * ha.qy + hb.M * hb.qy;
      const w = hb.S / (ha.S + hb.S), x = ha.x + ddx * w, y = ha.y + ddy * w;
      const gw = GW_MERGE * Hnew;
      holes.splice(holes.indexOf(ha), 1); holes.splice(holes.indexOf(hb), 1);
      const h = makeHole(x, y, (Hnew - gw) / anew, Pxt, Pyt, anew);
      h.Hg = ha.Hg + hb.Hg - gw; // (their weight, as the grid had it, but the wave's)
      // its spin: theirs, and their orbit's, about where they meet
      const rax = -ddx * w, ray = -ddy * w, rbx = ddx * (1 - w), rby = ddy * (1 - w);
      h.J = ha.J + hb.J + rax * ha.M * ha.qy - ray * ha.M * ha.qx + rbx * hb.M * hb.qy - rby * hb.M * hb.qx;
      capSpin(h);
      h.budget = ha.budget + hb.budget;
      h.lx = (ha.lx * ha.S + hb.lx * hb.S) / (ha.S + hb.S); h.ly = (ha.ly * ha.S + hb.ly * hb.S) / (ha.S + hb.S);
      h.jx = (ha.jx || 0) + (hb.jx || 0); h.jy = (ha.jy || 0) + (hb.jy || 0);
      wave(h.x, h.y, gw, -h.id, Math.atan2(ddy, ddx));
      events.push({ type: 'merge', x: h.x, y: h.y, hole: h.id, e: gw, M: h.M, axis: Math.atan2(ddy, ddx), apart: r });
      stats.merged++;
    }

    // A horizon forms where the lapse goes to 0: where the dust's own well
    // is deep enough, α < ALPHA_COLLAPSE (and no hole is near), all the dust
    // nearly trapped there, α < ALPHA_TRAPPED, is a hole.
    const ALPHA_TRAPPED = 0.7, GATHER = 0.2;
    let deepest = 1;
    function collapse() {
      let lo = Infinity, kmin = -1;
      for (let k = 0; k < NC; k++) if (phi[k] < lo) {
        const cx = (k % NX + 0.5) * dx, cy = ((k / NX | 0) + 0.5) * dy;
        if (holes.some(h => hyp(near(h.x - cx, Lx), near(h.y - cy, Ly)) < Math.max(4 * h.rh + RCUT, CLEAR))) continue;
        lo = phi[k]; kmin = k;
      }
      deepest = 1 + lo / c2;
      if (kmin < 0 || deepest > ALPHA_COLLAPSE) return;
      const cx = (kmin % NX + 0.5) * dx, cy = ((kmin / NX | 0) + 0.5) * dy;
      const take = [];
      for (let i = 0; i < n; i++)
        if (al[i] < ALPHA_TRAPPED && hyp(near(px[i] - cx, Lx), near(py[i] - cy, Ly)) <= GATHER) take.push(i);
      if (take.length < 10) return;
      let Ht = 0, Pxt = 0, Pyt = 0, wx = 0, wy = 0;
      for (const i of take) {
        const Hi = al[i] * m * S[i];
        Ht += Hi + ht[i]; Pxt += m * qx[i]; Pyt += m * qy[i];
        wx += Hi * near(px[i] - cx, Lx); wy += Hi * near(py[i] - cy, Ly);
      }
      // their binding to one another, as the grid had it (sampled, if they are many)
      let bind = 0;
      const pairs = take.length * (take.length - 1) / 2, tries = Math.min(pairs, 40000);
      for (let t = 0; t < tries; t++) {
        const a = take[(rng() * take.length) | 0], b = take[(rng() * take.length) | 0];
        if (a === b) { t--; continue; }
        bind += gridK(hyp(near(px[a] - px[b], Lx), near(py[a] - py[b], Ly))) * (m * Hg[a] / c2) * (m * Hg[b] / c2);
      }
      bind *= pairs / tries;
      // α at the hole: the grid's Φ there, less the clump's own long range
      let own = 0;
      for (const i of take) {
        const r = hyp(near(px[i] - cx, Lx), near(py[i] - cy, Ly));
        own += (m * Hg[i] / c2) * gridK(r);
      }
      let Hw = 0;
      for (const i of take) Hw += m * Hg[i];
      let other = 0, V = 0; // (the holes' wells there: no part of a hole's α; their binding, V's now)
      for (const o of holes) { const r = hyp(near(o.x - cx, Lx), near(o.y - cy, Ly)); other += o.Hg / c2 * gridK(r); V += Hw / c2 * o.Hg / c2 * pairPot(r); }
      const ac = Math.max(0.3, lapse(phi[kmin] - own - other)); // (were the dust about deeper still, it is near enough to be next)
      // its spin: the dust's angular momentum about where it is
      let Jc = 0;
      for (const i of take) {
        const rx = near(px[i] - cx, Lx) - wx / Ht, ry = near(py[i] - cy, Ly) - wy / Ht;
        Jc += m * (rx * qy[i] - ry * qx[i]);
      }
      take.sort((a, b) => b - a);
      for (const i of take) removeParticle(i);
      const h = makeHole(cx + wx / Ht, cy + wy / Ht, Math.max(0.5 * Ht, Ht - bind - V) / ac, Pxt, Pyt, ac);
      h.Hg = Hw; // (their weight, as the grid had it)
      h.J = Jc;
      capSpin(h);
      events.push({ type: 'collapse', x: h.x, y: h.y, hole: h.id, M: h.M });
      stats.collapsed++;
    }

    return {
      step, Lx, RCUT, SWALLOW, shadowOf, chiOf, shortTable: Float32Array.from(TP), Ly, c, NX, NY, A,
      get n() { return n; }, px, py, ox, oy, al, be, qx, qy, Hg, ph,
      heat() { let s = 0; for (let i = 0; i < n; i++) s += ht[i]; return s; },
      holes, ripples, events, stats, Sarr: S,
      // the grid's Φ, over c²
      potential(out) { for (let k = 0; k < NC; k++) out[k] = phi[k] / c2; return out; },
      get energy() { return energy; }, get target() { return target; },
      get momentum() { return momentum; }, get time() { return time; }, get deepest() { return deepest; },
      restMass() { return n * m + holes.reduce((s, h) => s + h.M, 0); },
    };
  }

  return { universe, erfc };
})();
