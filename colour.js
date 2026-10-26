// Colour harmony in OKLCH, shared by the endless paintings that walk the
// colour wheel (rectangle-dreams.html, pour-dreams.html).
const Colours = (() => {
  const TAU = Math.PI * 2;

  // ---- OKLCH, so lightness, chroma and hue match how colours look ----
  const DEG = Math.PI / 180;
  const gam = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  function toLinear([L, A, B]) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    return [4.0767416621 * l - 3.3077085724 * m + 0.2309667107 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const toRgb = lab => toLinear(lab).map(v => Math.max(0, Math.min(255, gam(Math.max(0, v)))));
  const lch = (L, C, h) => [L, C * Math.cos(h * DEG), C * Math.sin(h * DEG)];
  const hueOf = lab => (Math.atan2(lab[2], lab[1]) / DEG + 360) % 360;
  const chromaOf = lab => Math.hypot(lab[1], lab[2]);
  const hueDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const inGamut = lab => toLinear(lab).every(v => v >= -1e-4 && v <= 1 + 1e-4);
  // the colour at L and h with as much of chroma C as sRGB can show
  function fit(L, C, h) {
    if (inGamut(lch(L, C, h))) return lch(L, C, h);
    let lo = 0, hi = C;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      inGamut(lch(L, mid, h)) ? lo = mid : hi = mid;
    }
    return lch(L, lo, h);
  }

  // Classic harmonies: hue offsets from the key hue. The key hue itself is
  // listed more than once where it should dominate.
  const SCHEMES = [
    { name: 'analogous', hues: [0, 0, -30, 30] },
    { name: 'complementary', hues: [0, 0, 18, 180] },
    { name: 'split complementary', hues: [0, 0, 150, 210] },
    { name: 'triadic', hues: [0, 120, 240] },
    { name: 'monochrome', hues: [0, 0, 10] },
  ];
  const HUE_NAMES = [[0, 'rose'], [29, 'red'], [55, 'orange'], [80, 'ochre'], [105, 'yellow'], [125, 'lime'],
    [145, 'green'], [180, 'teal'], [205, 'cyan'], [240, 'azure'], [264, 'blue'], [290, 'violet'],
    [310, 'purple'], [335, 'magenta']];
  const hueName = h => HUE_NAMES.reduce((a, b) => hueDist(h, b[0]) < hueDist(h, a[0]) ? b : a)[1];

  // The colour mind: a key hue that keeps walking all the way round the
  // colour wheel, and a harmony around it that changes now and then. Every
  // new colour belongs to the current harmony, and colours in play that no
  // longer fit it are let go, so whatever is being poured right now always
  // goes together, while over time every hue gets its turn.
  function colourMind(rng) {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
    const MAX_OTHERS = 5, FIT_DEG = 32;
    let key = rng() * 360, vel = (rng() < 0.5 ? -1 : 1) * (2 + rng() * 3); // degrees per new colour
    let scheme = SCHEMES[(rng() * SCHEMES.length) | 0], schemeLeft = 10 + (rng() * 14 | 0);
    let mood = rng(); // 0: muted, 1: rich
    const cur = { dark: null, light: null, others: [] };
    const all = () => [cur.dark, cur.light, ...cur.others].filter(Boolean);

    // greys and near-greys go with anything; a colour fits when its hue is
    // near one of the harmony's hues
    const fits = lab => chromaOf(lab) < 0.035 || scheme.hues.some(o => hueDist(hueOf(lab), key + o) < FIT_DEG);
    function step() {
      vel += gauss() * 0.7;
      if (rng() < 0.02) vel = -vel; // now and then the walk turns back
      vel = Math.sign(vel || 1) * Math.min(7, Math.max(1.5, Math.abs(vel)));
      key = (key + vel + 360) % 360;
      mood = Math.min(1, Math.max(0, mood + gauss() * 0.07));
      if (--schemeLeft <= 0) {
        scheme = SCHEMES.filter(s => s !== scheme)[(rng() * (SCHEMES.length - 1)) | 0];
        schemeLeft = 10 + (rng() * 14 | 0);
      }
      const keep = cur.others.filter(fits);
      cur.others = keep.length ? keep : cur.others.slice(-1);
    }
    function other() {
      const off = scheme.hues[(rng() * scheme.hues.length) | 0];
      const accent = Math.abs(off) > 40; // far from the key: lighter and quieter, so it sets off rather than fights
      const L = accent ? 0.62 + rng() * 0.2 : 0.42 + rng() * 0.42;
      const C = (0.05 + mood * 0.12) * (accent ? 0.7 : 1) * (0.75 + rng() * 0.5);
      return fit(L, C, key + off + gauss() * 6);
    }

    // the next colour for role: 'dark' | 'light' | 'other'
    function next(role) {
      step();
      if (role === 'dark') return cur.dark = fit(0.16 + rng() * 0.1, 0.015 + mood * 0.035, key + gauss() * 25);
      if (role === 'light') return cur.light = fit(0.9 + rng() * 0.06, 0.01 + rng() * 0.02, key + gauss() * 25);
      const lab = other();
      cur.others.push(lab);
      if (cur.others.length > MAX_OTHERS) cur.others.shift();
      return lab;
    }
    // a quiet ground, mostly a pale primed canvas, sometimes a dark one
    function ground() {
      return rng() < 0.75 ? fit(0.86 + rng() * 0.06, 0.015 + rng() * 0.025, key + 40 + gauss() * 30)
        : fit(0.22 + rng() * 0.06, 0.01 + rng() * 0.02, key + gauss() * 30);
    }
    function nearest() { return `${scheme.name} ${hueName(key)}`; }
    cur.dark = next('dark');
    cur.light = next('light');
    next('other');

    // a colour already in play for role
    function inPlay(role) {
      return role === 'dark' ? cur.dark : role === 'light' ? cur.light : cur.others[(rng() * cur.others.length) | 0];
    }
    return { next, inPlay, ground, nearest, palette: () => all().map(toRgb), others: () => cur.others };
  }

  return { toRgb, fit, lch, hueName, colourMind };
})();
