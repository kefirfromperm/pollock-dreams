// Soap Bubble — a soap film stretched over the torus, flat and transparent,
// on black, set trembling at random once and left to tremble forever.
//
// The film is a membrane: its tension pulls it flat, and a small transverse
// displacement h(x, y) runs as waves, h_tt = c²∇²h, every wavelength at the
// one speed c, nothing losing them. On the torus the waves are its modes,
// k = 2π(m/Lx, n/Ly), each a wave running one way, a_k·e^{i(k·x − ωt)},
// ω = c|k|; their sum is the film at any time exactly, found by FFT, so it
// trembles as long as one looks, its energy never changing.
//
// What shows is the film's slope, ∇h, and its thickness. Seen from in front
// (the viewer's side all dark), a flat film reflects only that darkness
// and is not seen; tilted, it reflects the light about it, soft all round
// and a few lamps (its glares), coloured as thin films are: light reflected
// off its front and its back interferes, some wavelengths strengthened,
// others put out, by the film's optical thickness, n·d·cos θt. The film's
// material only moves to and fro across it, never along it, so where it is
// stretched, by 1/cos of its tilt, it is thinned as much.
const SoapBubble = (() => {
  const TAU = Math.PI * 2;

  // in-place radix-2 complex FFT of length n (a power of two), the sum
  // Σ X_k e^{+2πi jk/n} (the inverse, unnormalised)
  function fftPlan(n) {
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const wr = new Float64Array(n / 2), wi = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { wr[i] = Math.cos(TAU * i / n); wi[i] = Math.sin(TAU * i / n); }
    return (re, im) => {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let s = 0; s < n; s += size) {
          for (let k = 0; k < half; k++) {
            const a = s + k, b = a + half, c = wr[k * step], d = wi[k * step];
            const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    };
  }

  // the 2D inverse FFT of an NX × NY grid, rows of NX
  function fft2(NX, NY) {
    const fx = fftPlan(NX), fy = fftPlan(NY);
    const cr = new Float64Array(NY), ci = new Float64Array(NY);
    return (re, im) => {
      for (let j = 0; j < NY; j++) fx(re.subarray(j * NX, (j + 1) * NX), im.subarray(j * NX, (j + 1) * NX));
      for (let i = 0; i < NX; i++) {
        for (let j = 0; j < NY; j++) { cr[j] = re[j * NX + i]; ci[j] = im[j * NX + i]; }
        fy(cr, ci);
        for (let j = 0; j < NY; j++) { re[j * NX + i] = cr[j]; im[j * NX + i] = ci[j]; }
      }
    };
  }

  function gauss(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  }

  // The film, Lx × Ly (Ly = 1), on an NX × NY grid: its waves, of speed c
  // (√(T/μ), its tension T over its mass per area μ: the tauter, the faster),
  // their slopes S (rms), most of it in wavelengths about PEAK, none shorter
  // than four cells; its thickness at rest, D nm on average, varying by a
  // factor of e^(±SPREAD) over lengths of DLEN and more.
  function film(rng, { Lx, Ly, NX, NY, c = 0.09, S = 0.34, PEAK = 0.2, D = 420, SPREAD = 0.3, DLEN = 0.3 }) {
    const ifft = fft2(NX, NY), size = NX * NY;
    const re = new Float64Array(size), im = new Float64Array(size);
    const kOf = (i, j) => [TAU * (i < NX / 2 ? i : i - NX) / Lx, TAU * (j < NY / 2 ? j : j - NY) / Ly];
    const kMax = TAU / (4 * Math.max(Lx / NX, Ly / NY));

    // the waves: each mode's amplitude random (Gaussian, of random phase),
    // its slope's share by its wavelength, (k/kp)²/(1 + (k/kp)⁶) per octave
    const kp = TAU / PEAK, modes = [];
    let slope2 = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const [kx, ky] = kOf(i, j), k = Math.hypot(kx, ky);
      if (k === 0 || k > kMax) continue;
      const q = k / kp, band = q * q / (1 + q ** 6), A = Math.sqrt(band) / (k * k);
      const ar = A * gauss(rng), ai = A * gauss(rng);
      modes.push({ i: j * NX + i, m: ((NY - j) % NY) * NX + (NX - i) % NX, kx, ky, w: c * k, ar, ai });
      slope2 += 2 * k * k * (ar * ar + ai * ai);
    }
    const norm = S / Math.sqrt(slope2);
    for (const md of modes) { md.ar *= norm; md.ai *= norm; }

    // its thickness at rest, d0: a smooth random field, as the film was blown
    const thick = new Float32Array(size);
    {
      re.fill(0); im.fill(0);
      const kd = TAU / DLEN;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const [kx, ky] = kOf(i, j), k = Math.hypot(kx, ky);
        if (k === 0 || k > kMax) continue;
        const A = Math.exp(-0.5 * (k / kd) ** 2) / Math.max(k, TAU), zr = A * gauss(rng), zi = A * gauss(rng);
        const n = j * NX + i, m = ((NY - j) % NY) * NX + (NX - i) % NX;
        re[n] += zr; im[n] += zi; re[m] += zr; im[m] -= zi;
      }
      ifft(re, im);
      let s2 = 0;
      for (let n = 0; n < size; n++) s2 += re[n] * re[n];
      const sd = Math.sqrt(s2 / size) || 1;
      for (let n = 0; n < size; n++) thick[n] = D * Math.exp(SPREAD * re[n] / sd);
    }

    let t = 0;
    return {
      Lx, Ly, NX, NY, c, modes: modes.length, thickness: thick,
      get time() { return t; },
      step(dt) { t += dt; },
      // the slope, ∇h, now: (∂h/∂x, ∂h/∂y) at each grid point, interleaved
      // into out (NX × NY × 2); the gradient's spectrum is (i·kx − ky)·H,
      // whose transform is ∂h/∂x + i·∂h/∂y (both being real)
      slope(out) {
        re.fill(0); im.fill(0);
        for (const md of modes) {
          const cs = Math.cos(md.w * t), sn = Math.sin(md.w * t);
          // z = a·e^{−iωt}, at k; its conjugate at −k
          const zr = md.ar * cs + md.ai * sn, zi = md.ai * cs - md.ar * sn;
          re[md.i] += -md.ky * zr - md.kx * zi; im[md.i] += md.kx * zr - md.ky * zi;
          re[md.m] += md.ky * zr - md.kx * zi; im[md.m] += -md.kx * zr - md.ky * zi;
        }
        ifft(re, im);
        for (let n = 0; n < size; n++) { out[2 * n] = re[n]; out[2 * n + 1] = im[n]; }
      },
    };
  }

  // The light a thin film reflects, as a fraction of what falls on it, in
  // linear sRGB: a table over its optical thickness u = n·d·cos θt, 0 to
  // U_MAX nm (NU of them), and the cosine of the angle of incidence (NC),
  // the light white (a body at 6500 K), the film of index n in air. Each
  // wavelength's reflectance is Airy's, front and back interfering,
  //   R = 2r²(1 − cos δ)/(1 − 2r²cos δ + r⁴),  δ = 4πu/λ,
  // r Fresnel's, for s and for p, the two averaged; the colour, as the eye
  // sees it, after the CIE 1931 observer (Wyman, Sloan & Shirley's fit).
  function filmColours(NU, NC, U_MAX, n = 1.33) {
    const g = (x, m, s1, s2) => { const t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t); };
    const cmf = l => [
      1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
      0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
      1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
    ];
    const planck = l => { const m = l * 1e-9; return 1 / (m ** 5 * (Math.exp(1.4388e-2 / (m * 6500)) - 1)); };
    const toRGB = ([X, Y, Z]) => [
      3.2406 * X - 1.5372 * Y - 0.4986 * Z,
      -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
      0.0557 * X - 0.2040 * Y + 1.0570 * Z,
    ];
    const L = [], W = [];
    for (let l = 380; l <= 780; l += 4) { L.push(l); const s = planck(l), c = cmf(l); W.push([s * c[0], s * c[1], s * c[2]]); }
    const Yw = W.reduce((a, w) => a + w[1], 0);
    const white = toRGB([0, 1, 2].map(k => W.reduce((a, w) => a + w[k], 0) / Yw));
    const out = new Float32Array(NU * NC * 4);
    for (let jc = 0; jc < NC; jc++) {
      const ci = Math.max(jc / (NC - 1), 1e-4), ct = Math.sqrt(1 - (1 - ci * ci) / (n * n));
      const rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct);
      const rr = [rs * rs, rp * rp];
      for (let iu = 0; iu < NU; iu++) {
        const u = iu / (NU - 1) * U_MAX, xyz = [0, 0, 0];
        L.forEach((l, k) => {
          const cd = Math.cos(4 * Math.PI * u / l);
          let R = 0;
          for (const r2 of rr) R += 0.5 * 2 * r2 * (1 - cd) / (1 - 2 * r2 * cd + r2 * r2);
          for (let q = 0; q < 3; q++) xyz[q] += W[k][q] * R;
        });
        const rgb = toRGB(xyz.map(v => v / Yw)), o = (jc * NU + iu) * 4;
        for (let q = 0; q < 3; q++) out[o + q] = rgb[q] / white[q];
        out[o + 3] = 1;
      }
    }
    return out;
  }

  return { film, filmColours };
})();
