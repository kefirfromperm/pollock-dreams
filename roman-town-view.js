// Roman Town — a view of the model (roman-town.js) straight down from above,
// north up, drawn by the graphics card (WebGL2).
//
// It knows nothing of how the town was made, only what the model says is
// there. Once, it turns the model into geometry: the ground and every patch
// laid on it (fields, roads, streets, the river) as flat shapes coloured
// by what they are; every building as boxes with their roofs, walls and
// steps; trees, rocks and beasts as lumpy round bodies, still. Then for each frame, any
// rectangle of the world at any scale:
//   - the sun's (or the moon's) view of everything, for the shadows;
//   - from above, for each pixel, its height, which way it faces and its
//     colour, the patterns of tiles, stones and furrows worked out there;
//   - lit: the sun or the moon on whatever faces it unless something stands
//     in the way, the sky's light, less of it in hollows and narrow streets
//     (from the heights about, the whole world's, found once), lamps at night;
//     on water the sun, the moon and the lamps glittering off its ripples,
//     the sky mirrored in it, the light netted on a shallow pool's floor.
// The water rippled as it is at that moment: the wind's ripples running
// downwind, stronger under the gusts; the river running downstream, its
// roughness carried along; rings running out where a fountain's jet falls in.
//
// And the living (roman-town-life.js), drawn afresh each frame as they are
// at that moment: people, beasts and their things, each a few round bodies
// posed as it stands, walks, sits, lies or works, casting its own shadow;
// the torches they carry lit at night.
//
//   const view = RomanTownView.create(canvas, town, { seed })
//   view.draw([x0, y0, w, h], sky, t, life)   the canvas filled with that rectangle of
//     the world, lit as the sky is: { sun: { az, el }, moon: { az, el, lit } },
//     azimuths from north (up) clockwise, elevations, radians; lit, the
//     moon's lit part; t, seconds, for what moves: the wind in the grass,
//     the crops, the torches' flames; life, if any, { figures, lights }
const RomanTownView = (() => {
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  function hash(i, j, s) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2147483647) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  // ---- what the ground is, and the solids, by number ----
  const GROUND = {
    natural: 0, street: 1, 'main-street': 2, paving: 3, yard: 4, garden: 5, sand: 6, floor: 7, pool: 8, well: 9,
    wheat: 10, stubble: 11, fallow: 12, meadow: 13, hay: 14, pasture: 15, vines: 16, olives: 17, orchard: 18,
    via: 19, track: 20, river: 21, bank: 22, mud: 23, trodden: 24,
  };
  const SOLID = { tile: 0, stone: 1, marble: 2, timber: 3, turf: 4, steps: 5, sand: 6, paving: 7, passage: 8, wall: 9, mosaic: 10, signinum: 11, earth: 12, pool: 13, plaster: 14, column: 15, fabric: 16, cushion: 17, dark: 18, hay: 19, terracotta: 20, door: 21, bronze: 22, grain: 23, sacking: 24, logs: 25, wicker: 26, produce: 27, iron: 28, embers: 29, liquor: 30, cloth: 31, bread: 32 };
  const TREES = {
    // colour; the crown's depth as a part of the height (or metres, if over 1)
    cypress: [[44, 62, 38], 1], poplar: [[92, 118, 56], 0.95], pine: [[62, 84, 46], 2.4], oak: [[58, 76, 42], 0.6],
    olive: [[116, 126, 92], 0.6], fruit: [[82, 112, 50], 0.55], shrub: [[70, 96, 48], 1], plane: [[86, 112, 56], 0.55],
  };
  const BEASTS = {
    sheep: [1.3, 0.75, 0.85, [[230, 224, 208], [226, 220, 204], [70, 62, 56]]],
    goat: [1.2, 0.55, 0.8, [[150, 126, 100], [232, 226, 214], [64, 56, 50]]],
    cow: [2.3, 0.95, 1.4, [[128, 86, 58], [96, 66, 46], [40, 36, 34], [216, 206, 186]]],
    horse: [2.2, 0.7, 1.55, [[112, 74, 48], [70, 50, 38], [176, 160, 140]]],
  };

  // ---- shaders ----
  const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n';
  const NOISE = `
    const float TAU = 6.2831853;
    uint hsh(int x, int y, int s) {
      uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 2147483647u;
      h = (h ^ (h >> 13)) * 1274126177u;
      return h ^ (h >> 16);
    }
    float hf(ivec2 c, int s) { return float(hsh(c.x, c.y, s)) / 4294967296.0; }
    float vnoise(vec2 p, int s) {
      vec2 i = floor(p), f = p - i;
      ivec2 c = ivec2(i);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(hf(c, s), hf(c + ivec2(1, 0), s), u.x), mix(hf(c + ivec2(0, 1), s), hf(c + ivec2(1, 1), s), u.x), u.y);
    }
    float vnoise3(vec3 p, int s) {
      vec3 i = floor(p), f = p - i;
      ivec3 c = ivec3(i);
      vec3 u = f * f * (3.0 - 2.0 * f);
      int z0 = s + c.z * 7919, z1 = s + (c.z + 1) * 7919;
      float a = mix(mix(hf(c.xy, z0), hf(c.xy + ivec2(1, 0), z0), u.x), mix(hf(c.xy + ivec2(0, 1), z0), hf(c.xy + ivec2(1, 1), z0), u.x), u.y);
      float b = mix(mix(hf(c.xy, z1), hf(c.xy + ivec2(1, 0), z1), u.x), mix(hf(c.xy + ivec2(0, 1), z1), hf(c.xy + ivec2(1, 1), z1), u.x), u.y);
      return mix(a, b, u.z);
    }
    // (each octave turned, so the lattice does not show)
    float fnoise(vec2 p, int s) {
      return 0.5 * vnoise(p, s) + 0.3 * vnoise(mat2(1.62, 1.18, -1.18, 1.62) * p, s + 1) + 0.2 * vnoise(mat2(-1.4, -3.85, 3.85, -1.4) * p, s + 2);
    }
    // stones of a pavement: cells about random points, their joints dark
    float stones(vec2 p, float size, int s) {
      p /= size;
      vec2 i = floor(p);
      float f1 = 9.0, f2 = 9.0, id = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        ivec2 c = ivec2(i) + ivec2(x, y);
        float h = hf(c, s);
        vec2 d = p - vec2(c) - 0.15 - 0.7 * vec2(h, hf(c, s + 1));
        float q = dot(d, d);
        if (q < f1) { f2 = f1; f1 = q; id = h; } else if (q < f2) f2 = q;
      }
      return (sqrt(f2) - sqrt(f1) < 0.09 ? 0.62 : 1.0) * (0.84 + 0.3 * id);
    }
    // fractal: three octaves, each half the last
    float fbm3(vec3 p, int s) { return 0.55 * vnoise3(p, s) + 0.3 * vnoise3(p * 2.03, s + 1) + 0.15 * vnoise3(p * 4.1, s + 2); }
    vec3 rgb(float r, float g, float b) { return vec3(r, g, b) / 255.0; }
    // a crown's surface: rounded puffs of leaves, overlapping, of sizes
    // about one; the highest at each point
    float puffs(vec2 p, int s) {
      vec2 i = floor(p);
      float h = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        ivec2 c = ivec2(i) + ivec2(x, y);
        float a = hf(c, s);
        vec2 m = vec2(c) + 0.15 + 0.7 * vec2(a, hf(c, s + 1));
        float r = 0.6 + 0.45 * hf(c, s + 2), d = length(p - m) / r;
        h = max(h, sqrt(max(0.0, 1.0 - d * d)) * (0.75 + 0.25 * a));
      }
      return h;
    }
    // the wind in the grass and the crops, as it is on a field (honami): no
    // train of waves, but gusts sweeping down on it here and there, each
    // pressing a patch of it over, paler, the patch running downwind faster
    // than the wind down among the stalks blows, growing and dying away in a
    // few seconds, few at a time; behind it the stalks springing back,
    // overshooting and swinging back a little, at their own beat, and
    // between the gusts only quivering where they stand. Nothing slides.
    // How far it is pressed over: 0 standing, about 1 pressed flat
    uniform vec2 uWind; uniform float uTime;
    float pressed(vec2 q, float t, float c) {
      float x = q.x - c * t;
      float g = 0.65 * vnoise3(vec3(x / 7.0, q.y / 11.0, t / 2.5), 41) + 0.35 * vnoise3(vec3(x / 2.6, q.y / 4.0, t / 1.4), 42);
      return smoothstep(0.6, 0.82, g);
    }
    float sway(vec2 p) {
      float s = length(uWind), c = 4.0 * s; // (s 0.6 to 1.2, the gusts 2.4 to 4.8 m/s)
      vec2 w = uWind / s, q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
      // (the stalks' beat about 1.5 a second: pressed now, overshooting back
      // half a beat after, over again a beat after)
      float b = pressed(q, uTime, c) - 0.45 * pressed(q, uTime - 0.33, c) + 0.18 * pressed(q, uTime - 0.67, c);
      float quiver = vnoise3(vec3(p / 0.8, uTime * 1.5), 44) - 0.5;
      return b * (0.6 + 0.5 * s) + 0.12 * s * quiver;
    }

    // ---- water ----
    // value noise and its slopes
    vec3 vnoised(vec2 p, int s) {
      vec2 i = floor(p), f = p - i;
      ivec2 c = ivec2(i);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
      float a = hf(c, s), b = hf(c + ivec2(1, 0), s), d = hf(c + ivec2(0, 1), s), e = hf(c + ivec2(1, 1), s), k = a - b - d + e;
      return vec3(a + (b - a) * u.x + (d - a) * u.y + k * u.x * u.y, du * vec2(b - a + k * u.y, d - a + k * u.x));
    }
    // how much of a ripple so long (metres) can be drawn at this scale
    // without flickering; what cannot is left to roughen the water's sheen
    uniform float uPx; // metres a pixel
    float seen(float l) { return smoothstep(2.5, 6.0, l / uPx); }
    // 3d value noise, and its slopes across the first two
    vec3 vnoise3d(vec3 p, int s) {
      vec3 i = floor(p), f = p - i;
      ivec3 c = ivec3(i);
      vec3 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
      int z0 = s + c.z * 7919, z1 = s + (c.z + 1) * 7919;
      float a0 = hf(c.xy, z0), b0 = hf(c.xy + ivec2(1, 0), z0), d0 = hf(c.xy + ivec2(0, 1), z0), e0 = hf(c.xy + ivec2(1, 1), z0), k0 = a0 - b0 - d0 + e0;
      float a1 = hf(c.xy, z1), b1 = hf(c.xy + ivec2(1, 0), z1), d1 = hf(c.xy + ivec2(0, 1), z1), e1 = hf(c.xy + ivec2(1, 1), z1), k1 = a1 - b1 - d1 + e1;
      vec3 v0 = vec3(a0 + (b0 - a0) * u.x + (d0 - a0) * u.y + k0 * u.x * u.y, du.xy * vec2(b0 - a0 + k0 * u.y, d0 - a0 + k0 * u.x));
      vec3 v1 = vec3(a1 + (b1 - a1) * u.x + (d1 - a1) * u.y + k1 * u.x * u.y, du.xy * vec2(b1 - a1 + k1 * u.y, d1 - a1 + k1 * u.x));
      return mix(v0, v1, u.z);
    }
    // the wind on still water: short-crested ripples, their crests across
    // it, running downwind, each length at its own speed (on water the
    // short ones are the slower, down to the shortest, held up by the
    // water's skin), changing as they go; stronger where a gust comes down
    // on it, the same gusts as on the grass about (a cat's paw running
    // over it), less of all where it is sheltered. Its slopes, and the
    // spread of the slopes too fine to draw
    vec3 windRipples(vec2 p, float t, float shelter) {
      float s = length(uWind);
      vec2 w = uWind / s, x = vec2(-w.y, w.x), q = vec2(dot(p, w), dot(p, x));
      float gust = pressed(q, t, 4.0 * s);
      float amp = shelter * (0.25 + 1.0 * gust) * (0.5 + 0.6 * s) * (0.6 + 0.8 * vnoise(p / 3.0, 60));
      vec2 g = vec2(0.0);
      float fine = 0.0;
      for (int o = 0; o < 4; o++) {
        float l = 0.6 * pow(0.5, float(o)), c = sqrt(9.81 * l / TAU + 4.6e-4 / l);
        vec3 nd = vnoise3d(vec3((q.x - c * t) / l + float(o) * 3.1, q.y / (2.4 * l), t * (0.5 + 0.5 * float(o))), 61 + o);
        // (ridged, so the crests are sharp)
        vec2 dn = (nd.x > 0.5 ? -2.0 : 2.0) * nd.yz;
        float st = 0.3 * amp, v = seen(l * 0.5);
        g += st * v * (w * dn.x + x * dn.y / 2.4);
        fine += 0.6 * st * st * (1.0 - v);
      }
      return vec3(g, fine);
    }
    // the light on a shallow floor, gathered by the ripples over it into a
    // net of bright lines, wavering
    float caustics(vec2 p, float t) {
      float c = 0.0;
      for (int L = 0; L < 2; L++) {
        vec2 q = p / (L == 0 ? 0.42 : 0.3) + float(L) * 3.7, i = floor(q);
        float f1 = 9.0, f2 = 9.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          ivec2 cc = ivec2(i) + ivec2(x, y);
          float h1 = hf(cc, 81 + L), h2 = hf(cc, 83 + L);
          vec2 m = vec2(cc) + 0.5 + 0.36 * vec2(sin(t * (0.7 + 0.6 * h1) + TAU * h1), cos(t * (0.6 + 0.7 * h2) + TAU * h2));
          float d = length(q - m);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        c += exp(-(f2 - f1) * 6.5);
      }
      return 0.5 * c * seen(0.3);
    }
  `;
  const OUT = 'layout(location = 0) out vec4 oAlb;\nlayout(location = 1) out vec4 oNrm;\nlayout(location = 2) out float oH;\n';

  // the ground and what is laid on it
  const GROUND_VS = `
    layout(location = 0) in vec2 aPos;
    layout(location = 1) in vec4 aA; // what it is, an angle (a river's, downstream), across a road (-1…1), the water's level
    layout(location = 2) in float aTint;
    uniform mat4 uMVP; uniform float uZmid;
    out vec2 vP; out float vT, vLevel, vAngle; flat out float vMat, vTint;
    void main() {
      vP = aPos; vMat = aA.x; vAngle = aA.y; vT = aA.z; vLevel = aA.w; vTint = aTint;
      gl_Position = uMVP * vec4(aPos, uZmid, 1.0);
    }`;
  const GROUND_FS = NOISE + OUT + `
    in vec2 vP; in float vT, vLevel, vAngle; flat in float vMat, vTint;
    uniform sampler2D uTer; uniform vec3 uTerDim; // the ground's heights and slopes; nx, ny, its cell
    uniform sampler2D uGrass; // how much grass is left on each pasture
    uniform int uSeed; uniform float uTA, uZmin, uZmax, uRelief;
    // where water falls into the pools about: where it strikes, the spout; how far it falls
    uniform vec4 uJets[32]; uniform float uJetH[32]; uniform int uNJ;
    // rings running out from where it strikes, uneven, dying away as they
    // go; the water broken white there, churning; and the stream itself,
    // seen from above as it falls from the spout. Slopes, the spread of
    // those too fine to draw, and the foam
    vec4 jetRipples(vec2 p, float t) {
      vec2 g = vec2(0.0);
      float fine = 0.0, foam = 0.0;
      for (int j = 0; j < uNJ; j++) {
        vec4 J = uJets[j];
        float h = uJetH[j], fj = float(j) * 7.7;
        vec2 d = p - J.xy;
        float r = length(d);
        if (r > 3.0) continue;
        const float lam = 0.13, c = 0.3;
        float u = r - c * t, env = 0.3 + 0.7 * vnoise(vec2(u / 0.4, fj), 67);
        float st = (0.45 + 0.1 * h) * env * exp(-r / (0.55 + 0.25 * h)) * smoothstep(0.02, 0.15, r), v = seen(lam);
        g += d / max(r, 1e-4) * (st * v * cos(TAU / lam * u));
        fine += 0.5 * st * st * (1.0 - v);
        float rs = 0.1 + 0.04 * h, boil = smoothstep(rs * 2.6, rs * 0.5, r);
        vec3 ch = vnoised(d / 0.045 + vec2(fj, t * 5.0), 69);
        g += boil * 0.25 * ch.yz * seen(0.09);
        fine += boil * 0.08 * (1.0 - seen(0.09));
        foam += smoothstep(rs, rs * 0.3, r + 0.05 * (vnoise(d / 0.035 + vec2(fj, t * 7.0), 70) - 0.5)) * 0.85;
        // (the stream: from the spout to where it strikes, a few fingers wide)
        vec2 sp = J.zw - J.xy;
        float tt = clamp(dot(d, sp) / max(dot(sp, sp), 1e-4), 0.0, 1.0), ds = length(d - sp * tt), sw = max(0.03, 0.7 * uPx);
        foam = max(foam, smoothstep(sw, sw * 0.4, ds) * (0.7 + 0.3 * sin(tt * 40.0 - t * 30.0 + fj)));
      }
      return vec4(g, fine, clamp(foam, 0.0, 1.0));
    }
    vec3 terrain(vec2 p) {
      vec2 f = clamp(p / uTerDim.z, vec2(0.0), uTerDim.xy - 1.001);
      ivec2 i = ivec2(floor(f));
      vec2 a = f - vec2(i);
      return mix(mix(texelFetch(uTer, i, 0).xyz, texelFetch(uTer, i + ivec2(1, 0), 0).xyz, a.x),
                 mix(texelFetch(uTer, i + ivec2(0, 1), 0).xyz, texelFetch(uTer, i + ivec2(1, 1), 0).xyz, a.x), a.y);
    }
    float across(vec2 p, float a) { return -p.x * sin(a) + p.y * cos(a); }
    float along(vec2 p, float a) { return p.x * cos(a) + p.y * sin(a); }
    void main() {
      vec2 p = vP;
      vec3 t = terrain(p);
      float z = t.x, flag = 0.0, fine = 0.0;
      vec2 g = uRelief * t.yz; // (its slopes shaded as if steeper, as relief maps do, so the hills show)
      vec3 n = normalize(vec3(-g, 1.0));
      int m = int(vMat + 0.5);
      float tint = 0.9 + 0.2 * vTint, nz = fnoise(p / 3.0, uSeed + 3), f = 1.0, grass = 0.0, tallG = 0.12;
      vec3 c = rgb(156.0, 134.0, 104.0);
      float pu = along(p, uTA), pv = across(p, uTA);
      if (m == 0) {
        // grass, drier up the hills, scrub and rock where it is steep
        float sl = length(t.yz), up = (z - uZmin) / (uZmax - uZmin + 1e-6);
        float mm = fnoise(p / 40.0, uSeed), ff = fnoise(p / 6.0, uSeed + 7);
        c = mix(rgb(118.0, 124.0, 68.0), rgb(160.0, 146.0, 96.0), clamp(0.25 + 0.6 * up + 0.5 * (mm - 0.5), 0.0, 1.0));
        float scrub = clamp((sl - 0.12) * 5.0 + (ff - 0.5), 0.0, 1.0);
        c = mix(c, rgb(104.0, 100.0, 70.0), scrub * 0.8);
        grass = 1.0 - scrub;
        c = mix(c, rgb(150.0, 140.0, 120.0), clamp((sl - 0.3) * 4.0, 0.0, 0.7));
        f = 0.88 + 0.24 * ff;
      } else if (m == 1) { c = rgb(112.0, 108.0, 102.0); f = 1.08 * stones(p, 0.75, uSeed + 11) * (0.92 + 0.16 * nz); }
      else if (m == 2) { c = rgb(112.0, 108.0, 102.0); f = stones(p, 0.85, uSeed + 11) * (0.92 + 0.16 * nz); }
      else if (m == 3) {
        vec2 q = vec2(pu / 1.8, pv / 1.2);
        f = (fract(q.x) < 0.05 || fract(q.y) < 0.07 ? 0.86 : 1.0) * (0.94 + 0.12 * hf(ivec2(floor(q)), uSeed));
        c = rgb(208.0, 200.0, 182.0);
      }
      else if (m == 4) { f = 0.88 + 0.24 * nz; }
      else if (m == 5) { c = rgb(92.0, 112.0, 58.0); f = (fract(pv / 1.6) < 0.35 ? 0.86 : 1.04) * (0.85 + 0.3 * nz); }
      else if (m == 6) { c = rgb(214.0, 194.0, 152.0); f = 0.94 + 0.12 * nz; }
      else if (m == 7) { c = rgb(196.0, 180.0, 156.0); f = 0.95 + 0.1 * nz; }
      else if (m == 8) {
        // a pool, a basin: shallow, clear, its floor seen through the
        // water; rippled by what wind gets in, and where water falls in
        vec3 wr = windRipples(p, uTime, 0.4);
        vec4 jr = jetRipples(p, uTime);
        vec2 sl = wr.xy + jr.xy;
        fine = wr.z + jr.z;
        n = normalize(vec3(-sl, 1.0));
        c = mix(rgb(62.0, 130.0, 142.0) * (0.95 + 0.1 * nz), rgb(232.0, 240.0, 240.0), jr.w);
        // (the light gathered on its floor the more, the more it is rippled)
        flag = 0.5 + 0.5 * clamp(caustics(p, uTime) * (0.3 + 2.5 * length(sl)) * (1.0 - jr.w), 0.0, 1.0);
      }
      else if (m == 9) { c = rgb(22.0, 34.0, 36.0); }
      else if (m == 10) { c = rgb(212.0, 186.0, 110.0); f = tint * (0.93 + 0.1 * sin(fract(across(p, vAngle) / 0.7) * TAU)) * (0.9 + 0.2 * fnoise(p / 15.0, uSeed + 5)); }
      else if (m == 11) { c = rgb(196.0, 176.0, 128.0); f = tint * (0.95 + 0.07 * sin(across(p, vAngle) / 0.5 * TAU)); }
      else if (m == 12) { c = rgb(128.0, 98.0, 72.0); f = tint * (0.86 + 0.18 * (0.5 + 0.5 * sin(across(p, vAngle) / 0.9 * TAU)) + 0.1 * nz); }
      else if (m == 13) { c = rgb(122.0, 142.0, 66.0); f = tint * (0.85 + 0.3 * fnoise(p / 8.0, uSeed + 9)); }
      else if (m == 14) {
        // cut, and raked into windrows
        c = fract(across(p, vAngle) / 4.5) < 0.22 ? rgb(196.0, 176.0, 104.0) : rgb(150.0, 152.0, 84.0);
        f = tint * (0.88 + 0.22 * fnoise(p / 1.2, uSeed + 29));
      }
      else if (m == 15) {
        // a pasture, as much grass on it as the beasts have left: long and
        // deep green, grazed short, down to tufts with the bare dusty earth
        // between, the bare spreading in patches
        float gr = texelFetch(uGrass, ivec2(int(vLevel), 0), 0).r;
        float patchy = fnoise(p / 2.6, uSeed + 81) * 0.55 + fnoise(p / 0.7, uSeed + 83) * 0.3 + fnoise(p / 0.2, uSeed + 85) * 0.15;
        float cover = smoothstep(-0.08, 0.08, gr * 1.15 - patchy);
        vec3 green = mix(rgb(124.0, 128.0, 66.0), rgb(92.0, 128.0, 50.0), smoothstep(0.4, 1.0, gr));
        c = mix(mix(rgb(176.0, 156.0, 116.0), rgb(140.0, 122.0, 88.0), fnoise(p / 1.7, uSeed + 87)), green, cover);
        f = tint * (0.78 + 0.3 * fnoise(p / 1.3, uSeed + 19)) * (0.9 + 0.2 * fnoise(p / 14.0, uSeed + 23));
        grass = cover; tallG = 0.08 + 0.7 * gr * gr;
      }
      else if (m == 16) {
        float r = fract(across(p, vAngle) / 2.2);
        c = r < 0.38 ? mix(rgb(82.0, 112.0, 50.0), rgb(128.0, 108.0, 80.0), 0.25 + 0.3 * vnoise(vec2(along(p, vAngle) / 0.8, r), uSeed)) : rgb(128.0, 108.0, 80.0);
        f = 0.9 + 0.15 * nz;
      }
      else if (m == 17) { c = rgb(150.0, 136.0, 100.0); f = tint * (0.9 + 0.2 * nz); }
      else if (m == 18) { c = rgb(112.0, 124.0, 70.0); f = tint * (0.9 + 0.2 * nz); }
      else if (m == 19) { c = rgb(116.0, 110.0, 102.0); f = abs(vT) > 0.8 ? 1.25 : stones(p, 0.8, uSeed + 11); }
      else if (m == 20) {
        float a = abs(vT);
        c = rgb(168.0, 146.0, 112.0);
        f = (abs(a - 0.5) < 0.12 ? 0.86 : 1.0) * (0.9 + 0.2 * fnoise(p / 2.0, uSeed + 13)) * (a > 0.85 ? 0.97 : 1.0);
      }
      else if (m == 21) {
        // the river: water at its level, running downstream, fastest in the
        // middle, slow by the banks; its own roughness swept along with it,
        // drawn out along the current; seen as two layers each carried a
        // little way and faded out as the other comes in, so it never
        // stretches; the wind's ripples on it too
        z = vLevel; flag = 0.5;
        vec2 fd = vec2(cos(vAngle), sin(vAngle)), fn = vec2(-fd.y, fd.x);
        float sp = 0.75 * (1.0 - 0.8 * vT * vT);
        vec2 g = vec2(0.0);
        for (int k = 0; k < 2; k++) {
          float ph = fract(uTime / 3.5 + 0.5 * float(k)), wk = 1.0 - abs(2.0 * ph - 1.0);
          vec2 q = p - fd * (sp * (ph - 0.5) * 3.5) + float(k) * vec2(17.3, 5.1);
          float a = dot(q, fd), b = dot(q, fn);
          for (int o = 0; o < 3; o++) {
            float sa = o == 0 ? 2.6 : o == 1 ? 1.1 : 0.45, sb = sa * 0.36;
            vec3 nd = vnoised(vec2(a / sa, b / sb), 71 + 3 * o + 11 * k);
            float v = seen(sb * 2.0), A = 0.1 * sb;
            g += wk * A * (fd * nd.y / sa + fn * nd.z / sb) * v;
            fine += wk * 0.5 * pow(A / sb, 2.0) * (1.0 - v);
          }
        }
        vec3 wr = windRipples(p, uTime, 0.75);
        g += wr.xy; fine += wr.z;
        n = normalize(vec3(-g, 1.0));
        c = mix(rgb(40.0, 68.0, 64.0), rgb(92.0, 100.0, 80.0), 0.55 * smoothstep(0.65, 1.0, abs(vT))) * (0.92 + 0.12 * fnoise(p / 9.0, uSeed + 17));
      }
      else if (m == 22) { f = 0.75; }
      else if (m == 23) {
        // a pigs' wallow: dark wet mud, trodden and rooted, puddles in its
        // hollows mirroring the sky, drier and paler at its edge
        float h = fnoise(p / 1.1, uSeed + 61) * 0.7 + fnoise(p / 0.35, uSeed + 63) * 0.3;
        c = mix(rgb(62.0, 48.0, 36.0), rgb(92.0, 74.0, 54.0), smoothstep(0.55, 0.85, fnoise(p / 2.5, uSeed + 65)));
        f = 0.85 + 0.25 * fnoise(p / 0.18, uSeed + 67);
        if (h < 0.36) { flag = 0.5; c = rgb(60.0, 56.0, 44.0); vec3 wr = windRipples(p, uTime, 0.15); n = normalize(vec3(-wr.xy, 1.0)); fine = wr.z; f = 1.0; }
        else n = normalize(n + vec3(fnoise(p / 0.25, uSeed + 69) - 0.5, fnoise(p / 0.25, uSeed + 71) - 0.5, 0.0) * 0.6);
      }
      else if (m == 24) {
        // grass trodden about a wallow: bare earth showing through in patches, splashed with mud
        float b = fnoise(p / 0.9, uSeed + 73) * 0.6 + fnoise(p / 0.3, uSeed + 75) * 0.4, th = 0.72 - 0.4 * vAngle, e = smoothstep(th, th + 0.12, b);
        c = mix(rgb(112.0, 126.0, 60.0), rgb(96.0, 78.0, 56.0), e);
        f = tint * (0.78 + 0.3 * fnoise(p / 1.3, uSeed + 19)) * (0.9 + 0.2 * fnoise(p / 14.0, uSeed + 23));
        grass = 1.0 - e;
      }
      // and how tall it stands, so how much the wind shows on it: wheat most,
      // a meadow's long grass, the hills' rough grass; a pasture, grazed
      // short, and a garden's, hardly
      float tall = 0.55 * grass;
      if (m == 13) { grass = 1.0; tall = 1.0; }
      if (m == 15) tall = tallG;
      if (m == 24) tall = 0.1;
      if (m == 10) { grass = 1.4; tall = 1.4; }
      if (m == 5) { grass = 0.4; tall = 0.1; }
      if (grass > 0.0) {
        // its blades, fine, fractal, staying put; it bent over by the wind
        float bend = tall * sway(p);
        n = normalize(n + vec3(uWind * bend * 1.1, 0.0));
        f *= 1.0 + 0.32 * bend;
        f *= 1.0 + min(grass, 1.0) * 0.14 * (fnoise(p / 0.35, uSeed + 47) - 0.5 + 0.5 * (fnoise(p / 0.12, uSeed + 49) - 0.5));
      }
      oAlb = vec4(clamp(c * f, 0.0, 1.0), flag);
      oNrm = vec4(n, fine);
      oH = z;
    }`;

  // buildings: boxes and their roofs, round ones, seats
  const SOLID_VS = `
    layout(location = 0) in vec3 aPos;
    layout(location = 1) in vec3 aNrm;
    layout(location = 2) in vec4 aMat; // what it is made of, two tints
    uniform mat4 uMVP;
    out vec3 vW, vN; flat out vec4 vMat;
    void main() { vW = aPos; vN = aNrm; vMat = aMat; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const SOLID_FS = NOISE + OUT + `
    in vec3 vW, vN; flat in vec4 vMat;
    uniform int uSeed; uniform float uTA;
    void main() {
      vec3 n = normalize(vN);
      vec2 p = vW.xy;
      int m = int(vMat.x + 0.5);
      vec3 c = rgb(182.0, 172.0, 152.0);
      float f = 0.94 + 0.1 * vMat.y;
      float along = p.x * cos(uTA) + p.y * sin(uTA);
      if (m == 0) {
        // tiles: some newer and redder, some old and brown; the rows of cover
        // tiles running down the slope, the courses across
        c = mix(rgb(176.0, 92.0, 60.0), rgb(150.0, 104.0, 78.0), vMat.y * 0.6);
        f = 0.88 + 0.22 * vMat.z;
        if (length(n.xy) > 0.05) {
          vec2 s = normalize(n.xy);
          float al = dot(p, vec2(-s.y, s.x)), dn = dot(p, s);
          f *= (fract(al / 0.55) < 0.3 ? 1.1 : 0.94) * (fract(dn / 0.42) < 0.1 ? 0.93 : 1.0);
        }
        f *= 0.9 + 0.2 * fnoise(p / 2.5, uSeed + 23);
      } else if (m == 1) { f *= 0.92 + 0.12 * vnoise(p * 2.0, uSeed + 31); }
      else if (m == 2) { c = rgb(228.0, 224.0, 214.0); f *= 0.92 + 0.12 * vnoise(p * 2.0, uSeed + 31); }
      else if (m == 3) { c = rgb(130.0, 96.0, 64.0); f = fract(along / 0.3) < 0.15 ? 0.8 : 1.0; }
      else if (m == 4) { c = rgb(104.0, 122.0, 62.0); f = 0.85 + 0.3 * fnoise(p / 1.5, uSeed + 37); }
      else if (m == 5) { c = rgb(228.0, 224.0, 214.0); f = fract(along / 0.4) < 0.25 ? 0.85 : 1.03; }
      else if (m == 6) { c = rgb(214.0, 194.0, 152.0); f = 0.95 + 0.1 * fnoise(p / 2.0, uSeed); }
      else if (m == 7) { c = rgb(208.0, 200.0, 182.0); f = 0.95 + 0.08 * vnoise(p * 2.0, uSeed); }
      else if (m == 8) { c = rgb(156.0, 134.0, 104.0); f = 0.7; }
      else if (m == 9) { f *= 0.9 + 0.2 * vnoise(p * 1.5, uSeed + 29); }
      float water = 0.0, fine = 0.0;
      vec2 pl = vec2(along, p.y * cos(uTA) - p.x * sin(uTA)); // (in the town's own frame)
      if (m == 10) {
        // a mosaic: tesserae, white, black and a red, laid in a pattern of
        // squares, diamonds or rings, a border about each
        vec2 tq = pl / 0.11, ti = floor(tq);
        float tess = (fract(tq.x) < 0.12 || fract(tq.y) < 0.12) ? 0.8 : 0.95 + 0.1 * hf(ivec2(ti), uSeed + 101);
        vec2 q = pl / 0.9, fq = fract(q) - 0.5;
        int pat = int(vMat.y * 3.0);
        float ink = pat == 0 ? step(abs(fq.x) + abs(fq.y), 0.28) : pat == 1 ? step(abs(length(fq) - 0.3), 0.06) : step(max(abs(fq.x), abs(fq.y)), 0.2) * step(mod(floor(q.x) + floor(q.y), 2.0), 0.5);
        float band = step(abs(fq.x), 0.03) + step(abs(fq.y), 0.03);
        c = mix(rgb(226.0, 218.0, 198.0), vMat.z < 0.4 ? rgb(150.0, 62.0, 40.0) : rgb(38.0, 34.0, 32.0), clamp(ink + band * 0.6, 0.0, 1.0));
        f = tess;
      }
      else if (m == 11) {
        // opus signinum: crushed tile in lime, white chips set in it
        c = rgb(170.0, 104.0, 82.0); f = 0.9 + 0.16 * fnoise(p * 2.0, uSeed + 103);
        if (hf(ivec2(floor(pl / 0.07)), uSeed + 105) > 0.95) c = mix(c, rgb(228.0, 222.0, 208.0), 0.6);
      }
      else if (m == 12) { c = rgb(142.0, 116.0, 86.0); f = 0.82 + 0.3 * fnoise(p * 1.5, uSeed + 107); }
      else if (m == 13) {
        // a bath's pool, indoors: hardly a ripple
        c = rgb(70.0, 142.0, 150.0); f = 0.95 + 0.08 * fnoise(p, uSeed + 109);
        vec3 wr = windRipples(p, uTime, 0.12);
        n = normalize(vec3(-wr.xy, 1.0)); fine = wr.z;
        water = 0.5 + 0.5 * clamp(caustics(p, uTime) * (0.4 + 4.0 * length(wr.xy)), 0.0, 1.0);
      }
      else if (m == 23) { c = rgb(206.0, 168.0, 92.0); f = 0.8 + 0.25 * vnoise(p * 9.0, uSeed + 125) + 0.1 * (hf(ivec2(floor(pl / 0.02)), uSeed + 127) - 0.5); }
      else if (m == 24) {
        // sacking: coarse, its weave, each sack a little its own colour
        c = rgb(192.0, 174.0, 136.0) * (0.9 + 0.15 * vMat.y);
        f = (0.9 + 0.08 * sin(pl.x * 220.0) * sin(pl.y * 220.0)) * (0.85 + 0.2 * vnoise(p * 4.0, uSeed + 129));
      }
      else if (m == 25) {
        // a woodpile from above: the top logs lying side by side, each its own
        // bark, some split and pale; on its sides their ends
        float q = vMat.w < 0.5 ? pl.x : pl.y, r = vMat.w < 0.5 ? pl.y : pl.x, li = floor(q / 0.15), fr = fract(q / 0.15);
        float h1 = hf(ivec2(int(li), 3), uSeed + 131), h2 = hf(ivec2(int(li), 5), uSeed + 133);
        c = h2 < 0.25 ? rgb(204.0, 168.0, 118.0) : mix(rgb(104.0, 88.0, 72.0), rgb(136.0, 116.0, 92.0), h1);
        f = (0.55 + 0.5 * sin(fr * 3.14159)) * (0.85 + 0.25 * vnoise(vec2(q * 6.0, r * 20.0), uSeed + 135));
        if (n.z < 0.5) { c = rgb(186.0, 152.0, 108.0); f = 0.7 + 0.3 * stones(pl, 0.14, uSeed + 137); }
      }
      else if (m == 26) {
        vec2 w = pl * 22.0, cw = floor(w);
        float r = mod(cw.x + cw.y, 2.0) < 1.0 ? fract(w.y) : fract(w.x);
        c = rgb(176.0, 146.0, 92.0); f = 0.65 + 0.45 * sin(r * 3.14159);
      }
      else if (m == 27) {
        // a basket's produce: onions, apples, cabbages, figs, pears, turnips,
        // grapes, beans; round and heaped, each lit on its top
        float k = vMat.z;
        c = k < 0.12 ? rgb(186.0, 124.0, 62.0) : k < 0.24 ? rgb(178.0, 52.0, 36.0) : k < 0.36 ? rgb(98.0, 140.0, 72.0) : k < 0.48 ? rgb(92.0, 52.0, 78.0)
          : k < 0.6 ? rgb(204.0, 190.0, 92.0) : k < 0.72 ? rgb(222.0, 210.0, 214.0) : k < 0.84 ? rgb(86.0, 42.0, 88.0) : rgb(150.0, 180.0, 110.0);
        float sz = k >= 0.24 && k < 0.36 ? 0.12 : 0.05;
        f = 0.45 + 0.65 * puffs(pl / sz + k * 13.0, uSeed + 139);
      }
      else if (m == 22) { c = mix(rgb(118.0, 90.0, 52.0), rgb(92.0, 120.0, 98.0), 0.5 * vnoise(p * 12.0, uSeed + 123)); f = 0.95; }
      // iron, worn bright where it is struck
      else if (m == 28) { c = rgb(70.0, 70.0, 76.0); f = 0.8 + 0.3 * vnoise(p * 9.0, uSeed + 141) + 0.25 * n.z; }
      // embers: a forge's, a kiln's, an oven's mouth, stirring
      else if (m == 29) { float e = vnoise(p * 16.0 + vec2(uTime * 0.5, -uTime * 0.3), uSeed + 143) * 0.6 + vnoise(p * 40.0, uSeed + 149) * 0.4; c = mix(rgb(52.0, 30.0, 24.0), mix(rgb(170.0, 40.0, 12.0), rgb(255.0, 160.0, 50.0), smoothstep(0.55, 0.85, e)), smoothstep(0.35, 0.6, e)); f = 1.1; }
      // a fuller's vat: the grey liquor the cloth is trodden in
      else if (m == 30) { c = rgb(160.0, 164.0, 150.0); f = 0.82 + 0.16 * vnoise(p * 3.0 + vec2(uTime * 0.2), uSeed + 145); }
      // cloth on the loom: the warp's threads, a band of colour woven across
      else if (m == 31) {
        float q = vMat.w < 0.5 ? pl.x : pl.y;
        c = vMat.z < 0.3 ? rgb(214.0, 204.0, 180.0) : vMat.z < 0.6 ? rgb(164.0, 80.0, 56.0) : vMat.z < 0.8 ? rgb(120.0, 132.0, 150.0) : rgb(190.0, 160.0, 96.0);
        f = 0.8 + 0.2 * sin(q * 160.0);
      }
      // loaves on a counter, round, scored, brown on top
      else if (m == 32) { c = rgb(188.0, 128.0, 62.0); f = 0.5 + 0.65 * puffs(pl / 0.1 + vMat.y * 9.0, uSeed + 147); }
      else if (m == 14) { c = rgb(206.0, 196.0, 176.0); f = 0.9 + 0.14 * vnoise(p * 3.0, uSeed + 111); }
      else if (m == 15) { c = rgb(232.0, 228.0, 218.0); f = 0.9 + 0.1 * n.z; }
      else if (m == 16) { c = rgb(222.0, 212.0, 188.0); f = 0.92 + 0.1 * vnoise(p * 6.0, uSeed + 113); }
      else if (m == 17) { c = vMat.z < 0.33 ? rgb(150.0, 46.0, 36.0) : vMat.z < 0.66 ? rgb(186.0, 130.0, 52.0) : rgb(60.0, 74.0, 110.0); f = 0.9 + 0.12 * vnoise(p * 5.0, uSeed + 115); }
      else if (m == 18) { c = rgb(30.0, 26.0, 24.0); f = 0.9 + 0.2 * vnoise(p * 4.0, uSeed + 117); }
      else if (m == 19) { c = rgb(200.0, 174.0, 98.0); f = 0.8 + 0.3 * vnoise(p * 9.0, uSeed + 119); }
      else if (m == 20) { c = rgb(172.0, 96.0, 62.0); f = 0.88 + 0.16 * vMat.y; }
      else if (m == 21) { c = rgb(96.0, 64.0, 40.0); f = 0.9 + 0.15 * vnoise(p * 6.0, uSeed + 121); }
      oAlb = vec4(clamp(c * f, 0.0, 1.0), water);
      oNrm = vec4(n, fine);
      oH = vW.z;
    }`;

  // trees and beasts: round bodies, a tree's lumpy, its leaves in clumps
  const BODY_VS = NOISE + `
    layout(location = 0) in vec3 aDir;
    layout(location = 1) in vec3 aC;   // the middle
    layout(location = 2) in vec3 aR;   // the radii
    layout(location = 3) in vec4 aCol; // colour, and how lumpy
    layout(location = 4) in vec2 aRot; // turned, and its own number (a tree's, and which of its clumps)
    layout(location = 5) in vec2 aAnchor; // a tree's foot, and its height (unused while trees stand still)
    uniform mat4 uMVP;
    out vec3 vW, vD; flat out vec4 vCol; flat out vec2 vSeedOff; flat out float vTex;
    void main() {
      vec3 d = aDir;
      vSeedOff = vec2(fract(aRot.y * 0.618) * 37.0, fract(aRot.y * 0.377) * 41.0);
      vTex = aRot.y < 0.0 ? -aRot.y : 0.0; // (one of the living's things, its stuff)
      // a clump of a crown: its outline fractal, lumps on lumps
      float fr = 0.0;
      if (aCol.w > 0.0) {
        fr = fbm3(aDir * 2.0 + aRot.y * 13.7, 47);
        float fine = vnoise3(aDir * 6.5 + aRot.y * 5.1, 49);
        d *= 0.8 + 0.34 * fr + 0.12 * fine;
      }
      // a rock: craggy all over
      else if (aCol.w < 0.0) d *= 0.72 + 0.5 * vnoise3(aDir * 1.8 + aRot.y * 7.3, 71);
      vec3 q = d * aR;
      float c = cos(aRot.x), s = sin(aRot.x);
      vW = aC + vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
      vec3 e = aDir / aR;
      vD = vec3(c * e.x - s * e.y, s * e.x + c * e.y, e.z);
      vCol = aCol;
      gl_Position = uMVP * vec4(vW, 1.0);
    }`;
  const BODY_FS = NOISE + OUT + `
    in vec3 vW, vD; flat in vec4 vCol; flat in vec2 vSeedOff; flat in float vTex;
    void main() {
      vec3 n = normalize(vD);
      float tone = 1.0;
      if (vCol.w > 0.0) {
        // the crown's edge ragged: leaves and twigs against the gaps between,
        // fractal, the more the nearer its rim
        float rim = 1.0 - abs(n.z);
        float leafy = fbm3(vW / (vCol.w * 0.9) + 2.3, 97) * 0.7 + 0.3 * vnoise3(vW / (vCol.w * 0.35), 98);
        if (leafy < smoothstep(0.25, 0.95, rim) * 0.72) discard;
      }
      vec3 col = vCol.rgb;
      if (vCol.w > 0.0) {
        // foliage, as it looks from above: puffs of leaves heaped on one
        // another, big and small, each lit on its sunny side, dark in the
        // gaps between; warped, so no lattice shows
        float sz = vCol.w;
        vec3 w = vW;
        vec2 warp = 1.2 * vec2(fbm3(w / (sz * 6.0), 91) - 0.5, fbm3(w / (sz * 6.0) + 5.0, 93) - 0.5);
        float big = puffs(w.xy / (sz * 4.2) + warp + vSeedOff, 53);
        float small = puffs(w.xy / (sz * 1.7) + warp * 2.0 + vSeedOff * 1.7, 57);
        float hgt = 0.62 * big + 0.28 * small + 0.1 * vnoise3(w / (sz * 0.6), 59);
        // its slopes, from the pixels beside (north up, so y turned)
        float hm = hgt * sz * 3.0;
        vec2 gr = vec2(dFdx(hm), -dFdy(hm)) / uPx;
        // and the leaves themselves, a fine grain over it, catching the light
        float leafg = vnoise3(w / (sz * 0.32), 63), leafg2 = vnoise3(w / (sz * 0.14) + 1.7, 67);
        n = normalize(n + vec3(-gr * 0.75, 0.0) + 0.35 * vec3(leafg - 0.5, leafg2 - 0.5, 0.0));
        tone = (0.42 + 0.68 * smoothstep(0.05, 0.85, hgt)) * (0.82 + 0.22 * leafg + 0.12 * leafg2);
        col = mix(col * vec3(0.82, 0.9, 1.0), col * vec3(1.12, 1.1, 0.88), smoothstep(0.3, 0.9, hgt) * 0.7);
      } else if (vCol.w < 0.0) {
        // weathered stone, cracked, lichen in patches
        vec3 q = vW / 0.45;
        n = normalize(n + 0.5 * vec3(vnoise3(q, 73) - 0.5, vnoise3(q + 3.3, 79) - 0.5, 0.0));
        tone = 0.82 + 0.3 * vnoise3(vW * 1.3, 83);
        float lichen = smoothstep(0.62, 0.75, vnoise3(vW * 0.9, 89));
        oAlb = vec4(clamp(mix(vCol.rgb * tone, vec3(0.55, 0.56, 0.38), lichen * 0.5), 0.0, 1.0), 0.0);
        oNrm = vec4(n.z < 0.0 ? vec3(n.xy, -n.z) : n, 0.0);
        oH = vW.z;
        return;
      }
      // what the living's things are made of, as fine as can be drawn
      int tx = int(vTex + 0.5);
      if (tx == 1) {
        // straw, hay: stalks lying every way, in wisps, lighter and darker
        float an = vnoise3(vW * 3.0, 131) * TAU;
        vec2 d = vec2(cos(an), sin(an));
        float st = vnoise3(vec3(dot(vW.xy, d) * 3.0, dot(vW.xy, vec2(-d.y, d.x)) * 45.0, vW.z * 6.0), 133), v = seen(0.05);
        tone *= mix(1.0, 0.7 + 0.55 * st, v) * (0.85 + 0.25 * vnoise3(vW * 4.0, 135));
        n = normalize(n + v * 0.45 * vec3(vec2(-d.y, d.x) * (st - 0.5), 0.0));
      } else if (tx == 2) {
        // bark: rough, ridged and cracked
        float b = vnoise3(vW * 16.0, 137), c = vnoise3(vW * 45.0, 139), v = seen(0.08);
        tone *= mix(1.0, 0.62 + 0.45 * b + 0.18 * c, v);
        n = normalize(n + v * 0.5 * vec3(b - 0.5, c - 0.5, 0.0));
      } else if (tx == 3) {
        // wicker: withies woven over and under
        vec2 w = vW.xy * 22.0, cw = floor(w);
        bool across = mod(cw.x + cw.y, 2.0) < 1.0;
        float r = across ? fract(w.y) : fract(w.x), v = seen(0.09);
        tone *= mix(1.0, 0.62 + 0.5 * sin(r * 3.14159), v);
        n = normalize(n + v * 0.4 * vec3(across ? 0.0 : cos(r * 3.14159), across ? cos(r * 3.14159) : 0.0, 0.0));
      } else if (tx == 4) {
        // sacking: coarse cloth, a few folds
        vec2 w = vW.xy * 70.0;
        float v = seen(0.03), f = vnoise3(vW * 7.0, 141);
        tone *= mix(1.0, 0.9 + 0.1 * sin(w.x) * sin(w.y), v) * (0.85 + 0.25 * f);
      } else if (tx == 5) {
        // a fleece: wool in curls and locks, shadowed between, greyer and
        // dirtier low down where it brushes the ground
        float a = vnoise3(vW * 14.0, 143), b = vnoise3(vW * 34.0, 145), v = seen(0.05);
        float curl = smoothstep(0.25, 0.75, a * 0.65 + b * 0.35);
        tone *= mix(1.0, 0.72 + 0.38 * curl, v) * mix(0.82, 1.0, smoothstep(-0.2, 0.5, n.z));
        n = normalize(n + v * 0.55 * vec3(vnoise3(vW * 20.0, 147) - 0.5, vnoise3(vW * 20.0, 149) - 0.5, 0.0));
      }
      if (n.z < 0.0) n.z = -n.z;
      oAlb = vec4(clamp(col * tone, 0.0, 1.0), 0.0);
      oNrm = vec4(n, 0.0);
      oH = vW.z;
    }`;

  // depth only, for the shadows
  const DEPTH_VS = `
    layout(location = 0) in vec3 aPos;
    uniform mat4 uMVP;
    void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const EMPTY_FS = 'void main() {}';

  // a triangle over the whole target
  const QUAD_VS = `void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
  // the light, every pixel
  const LIGHT_FS = `
    uniform sampler2D uAlb, uNrm, uHgt, uNear, uFar;
    uniform sampler2DShadow uShadow, uShadowM; uniform int uMov; uniform float uBiasM; uniform mat4 uLightM;
    uniform vec4 uView; uniform vec2 uSize, uWorld;
    uniform mat4 uLight; uniform float uBias, uTexel, uShTexel;
    uniform vec3 uL, uSun, uSky; uniform float uGrey, uZbase;
    uniform vec4 uLamps[128]; uniform int uNL; uniform float uTime; uniform vec2 uWind;
    out vec4 o;
    uint hsh(int x, int y, int s) {
      uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 2147483647u;
      h = (h ^ (h >> 13)) * 1274126177u;
      return h ^ (h >> 16);
    }
    float hf(ivec3 c, int s) { return float(hsh(c.x, c.y + c.z * 7919, s)) / 4294967296.0; }
    float vn3(vec3 p, int s) {
      vec3 i = floor(p), f = p - i;
      ivec3 c = ivec3(i);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hf(c, s), hf(c + ivec3(1, 0, 0), s), u.x), mix(hf(c + ivec3(0, 1, 0), s), hf(c + ivec3(1, 1, 0), s), u.x), u.y),
                 mix(mix(hf(c + ivec3(0, 0, 1), s), hf(c + ivec3(1, 0, 1), s), u.x), mix(hf(c + ivec3(0, 1, 1), s), hf(c + ivec3(1, 1, 1), s), u.x), u.y), u.z);
    }
    float fbm(vec3 p, int s) { return 0.5 * vn3(p, s) + 0.27 * vn3(p * 2.07, s + 1) + 0.15 * vn3(p * 4.3, s + 2) + 0.08 * vn3(p * 8.9, s + 3); }
    // how much of a surface so rough faces exactly between the light and us
    float ggx(vec3 n, vec3 hh, float m2) {
      float c = max(dot(n, hh), 0.0), d = c * c * (m2 - 1.0) + 1.0;
      return m2 / (3.14159 * d * d);
    }
    const vec3 LAMP = vec3(1.0, 0.56, 0.22);
    float tone(float v) {
      float x = max(0.0, v * 0.9), y = x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14);
      return y <= 0.0031308 ? 12.92 * y : 1.055 * pow(min(1.0, y), 1.0 / 2.4) - 0.055;
    }
    vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    void main() {
      ivec2 px = ivec2(gl_FragCoord.xy);
      vec4 A = texelFetch(uAlb, px, 0);
      vec4 N4 = texelFetch(uNrm, px, 0);
      vec3 n = N4.xyz;
      float h = texelFetch(uHgt, px, 0).r;
      vec2 uv = gl_FragCoord.xy / uSize;
      vec2 w = vec2(uView.x + uView.z * uv.x, uView.y + uView.w * (1.0 - uv.y));
      vec3 P = vec3(w, h);
      // the sun's, or the moon's, unless something stands in the way
      vec4 lc = uLight * vec4(P + n * uTexel * 1.5, 1.0);
      vec3 s = lc.xyz * 0.5 + 0.5;
      float lit = 1.0;
      if (all(greaterThan(s.xy, vec2(0.0))) && all(lessThan(s.xy, vec2(1.0))) && s.z < 1.0) {
        lit = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
          lit += texture(uShadow, vec3(s.xy + vec2(x, y) * uShTexel * 1.2, s.z - uBias));
        lit /= 9.0;
      }
      // and the living's shadows, drawn each moment apart (one look,
      // softened by the card between its four nearest)
      if (uMov == 1) {
        vec3 sm = (uLightM * vec4(P + n * 0.02, 1.0)).xyz * 0.5 + 0.5;
        if (all(greaterThan(sm, vec3(0.0))) && all(lessThan(sm, vec3(1.0)))) lit = min(lit, texture(uShadowM, vec3(sm.xy, sm.z - uBiasM)));
      }
      float ndl = max(0.0, dot(n, uL)) * lit;
      // the sky, less of it below the heights about
      vec2 ta = vec2(w.x / uWorld.x, 1.0 - w.y / uWorld.y);
      float near = texture(uNear, ta).r + uZbase, far = texture(uFar, ta).r + uZbase;
      float ao = 1.0 - clamp((near - h) * 0.22, 0.0, 0.4) - clamp((far - h) * 0.06, 0.0, 0.25);
      bool water = A.a > 0.25;
      if (water) ao = max(ao, 0.85);
      // water: the slopes of its ripples too fine to draw, roughening it
      float m2 = 0.005 + 2.0 * N4.w;
      float amb = ao * (0.55 + 0.45 * n.z);
      // lamps
      float glow = 0.0;
      vec3 fire = vec3(0.0);
      for (int i = 0; i < uNL; i++) {
        vec4 l = uLamps[i];
        vec3 d = P - l.xyz;
        float d2 = dot(d, d);
        if (d2 > 256.0) continue;
        float fi = float(i) * 7.31;
        // its light flickering as the flame does
        float flick = 0.78 + 0.22 * vn3(vec3(uTime * 7.0, fi, 0.0), 5) + 0.1 * vn3(vec3(uTime * 19.0, fi, 1.0), 6);
        float dd = sqrt(d2), f = 1.0 - dd / 16.0;
        glow += l.w * flick * 1.2 / (1.0 + d2 * 0.3) * f * f * max(0.2, dot(-d, n) / max(dd, 1e-3) * 0.8 + 0.2);
        // on water the flame glittering, mirrored where the ripples tip to it
        if (water) fire += LAMP * l.w * flick * 0.02 * ggx(n, normalize(normalize(-d) + vec3(0.0, 0.0, 1.0)), m2) * f * f;
        // the flame, seen from above as it rises towards us: its tip over its
        // root, rings of heat about it, white within, red without, its rim
        // ragged and licking; leaning only a little, the way the draught
        // takes it, drawn out a little when it does; now and then a second
        vec2 r = (P.xy - l.xy) / (0.5 * sqrt(max(l.w, 0.2)));
        if (dot(r, r) < 9.0) {
          float wa0 = atan(uWind.y, uWind.x);
          for (int k = 0; k < 2; k++) {
            float fk = fi + float(k) * 3.3;
            float on = k == 0 ? 1.0 : smoothstep(0.55, 0.75, vn3(vec3(uTime * 0.6, fk, 2.0), 13));
            if (on <= 0.0) continue;
            float wa = wa0 + (vn3(vec3(uTime * 1.2, fk, 3.0), 14) - 0.5) * 1.8;
            vec2 dir = vec2(cos(wa), sin(wa));
            float lean = 0.1 + 0.5 * pow(vn3(vec3(uTime * 0.9, fk, 9.0), 19), 2.0) * (0.7 + 0.6 * vn3(vec3(uTime * 6.0, fk, 4.0), 15));
            float size = k == 0 ? 0.55 : 0.34;
            vec2 q = r - dir * (lean * 0.6 + (k == 0 ? 0.0 : 0.35));
            float u = dot(q, dir) / (size * (1.0 + lean * 1.4)), v = dot(q, vec2(-dir.y, dir.x)) / size;
            float a = atan(v, u);
            float rim = 0.78 + 0.4 * (vn3(vec3(cos(a) * 2.0, sin(a) * 2.0, uTime * 5.0 + fk), 16) - 0.5) + 0.18 * (vn3(vec3(cos(a) * 5.0, sin(a) * 5.0, uTime * 9.0 + fk), 12) - 0.5);
            float heat = clamp(1.0 - length(vec2(u, v)) / rim, 0.0, 1.0);
            heat = pow(heat, 0.75) * (0.8 + 0.4 * vn3(vec3(r * 5.0, uTime * 8.0 + fk), 17)) * on;
            vec3 c = mix(mix(vec3(0.7, 0.1, 0.02), vec3(1.0, 0.48, 0.08), smoothstep(0.0, 0.4, heat)), vec3(1.0, 0.93, 0.72), smoothstep(0.5, 0.95, heat));
            fire += c * heat * 2.4 * flick * min(l.w, 1.5);
          }
          fire += vec3(1.0, 0.45, 0.12) * 0.18 * exp(-dot(r, r) * 1.2) * flick * min(l.w, 1.5);
        }
      }
      vec3 v = lin(A.rgb) * (uSky * amb + uSun * ndl + LAMP * glow) + fire;
      if (water) {
        // the floor or the depths seen through the surface, lit through it
        // as if it were flat, but brighter where the ripples gather the
        // light onto it and lean towards it; the sky mirrored, more of it
        // and paler the more the ripples are tipped; and the sun (or the
        // moon) glittering, as much as the ripples tip towards us
        float cau = clamp(A.a * 2.0 - 1.0, 0.0, 1.0), up = max(uL.z, 0.0) * lit;
        float lean = clamp(1.0 + 3.2 * dot(n.xy, uL.xy), 0.35, 2.0);
        v = lin(A.rgb) * (uSky * ao * (0.6 + 0.3 * n.z) + uSun * up * lean * (0.7 + 1.1 * cau) + LAMP * glow) + fire;
        float rz = 2.0 * n.z * n.z - 1.0, fr = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
        v += (fr + 0.03) * uSky * ao * (1.3 + 3.0 * (1.0 - rz));
        vec3 hh = normalize(uL + vec3(0.0, 0.0, 1.0));
        v += uSun * lit * 0.02 * 0.25 * ggx(n, hh, m2) * smoothstep(0.0, 0.05, uL.z);
      }
      // at night colours fade, as they do to eyes in the dark, but lamplight's
      float lum = dot(v, vec3(0.2126, 0.7152, 0.0722)), warm = v.r - v.b;
      v = mix(v, lum * vec3(0.9, 0.97, 1.15), uGrey * clamp(1.0 - warm * 4.0, 0.0, 1.0));
      o = vec4(tone(v.r), tone(v.g), tone(v.b), 1.0);
    }`;
  const DOWN_FS = `
    uniform sampler2D uTex; uniform vec2 uOut;
    out vec4 o;
    void main() { o = texture(uTex, gl_FragCoord.xy / uOut); }`;
  const BLUR_FS = `
    uniform sampler2D uSrc; uniform ivec2 uDir; uniform int uR; uniform float uSub;
    out float o;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(uSrc, 0);
      float a = 0.0;
      for (int k = -uR; k <= uR; k++) a += texelFetch(uSrc, clamp(p + uDir * k, ivec2(0), sz - 1), 0).r;
      o = a / float(2 * uR + 1) - uSub;
    }`;

  // ---- the light of a moment ----
  // the sun's, reddening as it sets, or after dusk the moon's, as bright as
  // she is full; the sky's about, blue by day, rosy at twilight, dark at
  // night; night's light far brighter than it is, as eyes used to the dark
  // see it, and greyer; the lamps lit from dusk
  function lightOf(sky) {
    const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const dir = (az, el) => { const e = Math.max(el, 0.07); return [Math.cos(e) * Math.sin(az), -Math.cos(e) * Math.cos(az), Math.sin(e)]; };
    // (civil twilight, the sun up to 6° under, still light enough to see by)
    const { sun, moon } = sky, day = sm(-0.12, 0.0, sun.el), high = sm(0, 0.45, sun.el), up = sm(-0.015, 0.04, sun.el);
    const sunC = mixc([1.0, 0.42, 0.16], [1.0, 0.93, 0.8], high).map(v => v * 2.6 * up);
    const dusk = mixc([0.42, 0.36, 0.5], [0.69, 0.78, 0.92], high).map(v => v * (0.3 + 0.7 * sm(-0.12, 0.2, sun.el)));
    const mUp = sm(-0.015, 0.06, moon.el) * moon.lit * (1 - day);
    const moonC = [0.42, 0.56, 0.95].map(v => v * 0.42 * mUp);
    const night = [0.022, 0.03, 0.06].map((v, q) => v + [0.022, 0.03, 0.055][q] * moon.lit * sm(-0.015, 0.06, moon.el));
    const bySun = sunC[1] >= moonC[1];
    return {
      L: bySun ? dir(sun.az, sun.el) : dir(moon.az, moon.el), col: bySun ? sunC : moonC,
      sky: mixc(night, dusk, day), grey: 0.75 * (1 - day), lamps: 1 - sm(-0.09, 0.0, sun.el),
    };
  }

  // ---- the living, as round bodies: a person a dozen or so, head, body,
  // skirts, arms and legs, posed; a beast its body, head, neck and legs; a
  // cart, a boat; each body [x, y, z, radii, colour, turn] ----
  const rgbs = a => a.map(c => c.map(v => v / 255));
  const SKIN = rgbs([[204, 158, 120], [184, 136, 100], [158, 112, 80], [216, 176, 142], [140, 98, 70]]);
  const HAIR = rgbs([[26, 20, 18], [46, 32, 24], [74, 52, 34], [100, 58, 32], [58, 42, 30], [146, 120, 78], [34, 26, 22]]);
  const TUNIC = rgbs([[222, 212, 188], [204, 190, 160], [186, 184, 176], [132, 100, 72], [164, 88, 60], [192, 154, 86], [110, 128, 148], [130, 142, 108], [154, 60, 48], [214, 204, 178], [170, 150, 120]]);
  const STOLA = rgbs([[222, 172, 82], [204, 132, 130], [142, 168, 200], [126, 154, 110], [146, 118, 164], [228, 216, 192], [192, 152, 92], [180, 72, 66], [96, 120, 160]]);
  const SLAVE = rgbs([[142, 122, 100], [124, 116, 108], [156, 142, 118], [112, 94, 74], [168, 156, 132]]);
  const CLOAK = rgbs([[104, 86, 68], [92, 92, 98], [122, 98, 66], [72, 62, 54], [130, 74, 50]]);
  const COATS = {
    sheep: rgbs([[232, 226, 210], [224, 218, 200], [214, 206, 186], [226, 220, 206], [70, 62, 56]]), goat: rgbs([[150, 120, 92], [62, 54, 48], [226, 220, 208], [118, 90, 64], [180, 150, 112]]),
    cow: rgbs([[132, 88, 58], [98, 66, 46], [44, 40, 38], [198, 160, 112], [150, 110, 76]]), ox: rgbs([[208, 202, 190], [190, 184, 172], [176, 166, 150], [222, 214, 200]]),
    horse: rgbs([[116, 76, 48], [70, 48, 36], [150, 92, 54], [178, 168, 156], [44, 36, 32], [168, 130, 88]]), donkey: rgbs([[128, 118, 108], [150, 136, 118], [104, 92, 80]]),
    dog: rgbs([[176, 136, 90], [96, 70, 48], [40, 36, 34], [214, 204, 186], [150, 112, 70]]), cat: rgbs([[170, 120, 70], [80, 74, 70], [40, 36, 34], [200, 190, 176]]),
    hen: rgbs([[150, 90, 50], [196, 150, 96], [236, 228, 212], [60, 48, 40], [170, 70, 40]]),
    pig: rgbs([[222, 172, 160], [214, 160, 150], [70, 60, 58], [58, 50, 50], [196, 140, 120], [230, 188, 174]]),
  };
  const C = (r, g, b) => [r / 255, g / 255, b / 255];
  const WOOD = C(118, 86, 56), DARKWOOD = C(76, 56, 40), CLAY = C(180, 98, 62), WICKER = C(176, 146, 92), IRON = C(90, 90, 96), HOOF = C(46, 40, 36), HORN = C(214, 204, 176), STRAW = C(206, 178, 104);
  const pick = (list, id, k) => list[Math.floor(hash(id, k, 4441) * list.length) % list.length];
  // bodies for one figure, through E(forward, aside, up, rx, ry, rz, colour, turn) in its own frame
  function figureBodies(f, E, lod, fine) {
    const id = f.id || 1, ph = f.ph || 0, sw = Math.sin(ph * Math.PI * 2), cw = Math.cos(ph * Math.PI * 2);
    switch (f.kind) {
      case 'person': return personBodies(f, E, lod, fine);
      case 'rider': {
        beastBodies({ kind: 'horse', id, ph, pose: f.pose === 'walk' || f.pose === 'run' ? 'walk' : 'stand' }, E, lod);
        const cl = pick(f.dress === 'cloak' ? CLOAK : TUNIC, id, 3), sk = pick(SKIN, id, 1), hr = pick(HAIR, id, 2);
        E(-0.05, 0, 1.78, 0.14, 0.2, 0.3, cl); E(0, 0, 2.2, 0.11, 0.1, 0.12, hr); E(0.03, 0, 2.17, 0.09, 0.085, 0.09, sk);
        for (const sg of [-1, 1]) { E(0.12, sg * 0.24, 1.4, 0.18, 0.07, 0.24, cl); E(0.18, sg * 0.25, 1.75, 0.16, 0.06, 0.06, sk, sg * 0.4); }
        return;
      }
      case 'cart': {
        // a bed of boards on two wheels, a pole to the yoke, and its load
        E(0, 0, 0.98, 1.35, 0.74, 0.1, WOOD); E(2.1, 0, 0.8, 1.05, 0.05, 0.05, DARKWOOD);
        for (const sg of [-1, 1]) { E(0, sg * 0.7, 1.12, 1.35, 0.05, 0.16, DARKWOOD); E(0, sg * 0.88, 0.55, 0.56, 0.07, 0.56, DARKWOOD); E(0, sg * 0.88, 0.55, 0.12, 0.09, 0.12, IRON); }
        if (f.load) cartLoad(f.load, f.left ?? 1, id, E, lod);
        return;
      }
      case 'boat': {
        // a riverboat, its cargo amidships, the boatman poling at the stern
        const rowing = f.pose === 'row';
        E(0, 0, 0.0, 3.6, 0.95, 0.5, WOOD); E(0.15, 0, 0.18, 3.2, 0.72, 0.36, DARKWOOD); E(3.3, 0, 0.42, 0.35, 0.16, 0.12, WOOD);
        if (f.load === 'amphorae') for (let i = -2; i <= 2; i++) for (const j of [-0.26, 0.26]) E(i * 0.42, j, 0.62, 0.18, 0.14, 0.14, CLAY);
        else if (f.load === 'sacks') for (let i = -1; i <= 1; i++) E(i * 0.7, 0, 0.62, 0.33, 0.4, 0.2, C(206, 192, 160));
        personBodies({ kind: 'person', id: id * 7 + 1, sex: 'm', age: 'adult', dress: 'work', pose: 'stand', ph, anim: rowing ? 'pole' : null }, (fw, a, z, rx, ry, rz, c, t) => E(fw - 2.7, a, z + 0.25, rx, ry, rz, c, t), lod);
        if (rowing) E(-2.3, 0.4, 1.1 + 0.3 * sw, 1.6, 0.03, 0.03, WOOD, 0.4 + 0.3 * cw);
        return;
      }
      case 'meal': return mealBodies(f, E);
      case 'basket': E(0, 0, 0.18, 0.26, 0.26, 0.18, WICKER); E(0, 0, 0.33, 0.2, 0.2, 0.07, pick(rgbs([[150, 40, 40], [110, 140, 60], [200, 160, 60], [90, 60, 110], [170, 170, 160]]), id, 9)); return;
      case 'stone': E(0, 0, 0.32, 0.5, 0.32, 0.32, C(204, 196, 178), 0, 0); E(-0.2, 0.15, 0.03, 0.3, 0.25, 0.02, C(220, 214, 200)); return;
      case 'log': E(0, 0, 0.17, 0.62, 0.17, 0.16, BARK[id % BARK.length], 0, 2); E(0.6, 0, 0.17, 0.03, 0.16, 0.15, SPLIT); E(0.3, 0.35, 0.05, 0.2, 0.07, 0.05, SPLIT, 0.7); return;
      case 'desk': E(0, 0, 0.7, 0.28, 0.24, 0.025, WOOD); E(0, 0, 0.35, 0.035, 0.035, 0.34, DARKWOOD); return;
      // the day's split wood, stacked, higher as the day goes
      case 'woodpile': for (let k = 0; k < (f.n || 2); k++) { const row = k % 4, layer = k >> 2; E(0, (row - 1.5) * 0.17 + (layer % 2) * 0.08, 0.09 + layer * 0.15, 0.45, 0.075, 0.075, k % 3 ? BARK[(id + k) % BARK.length] : SPLIT, 0, 2); } return;
      // a beast's cage: a floor of boards, posts at its corners, bars round it, a roof of planks over
      case 'cage': {
        const L = f.big ? 3.2 : 1.9, D = f.big ? 2.2 : 1.3, h = f.big ? 3.3 : 1.8;
        E(0, 0, 0.06, L, D, 0.06, DARKWOOD);
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) E(a * L, b * D, h / 2, 0.08, 0.08, h / 2, DARKWOOD);
        for (let k = -6; k <= 6; k++) for (const sg of [-1, 1]) E(k / 6.5 * L, sg * D, h / 2, 0.025, 0.025, h / 2, WOOD);
        for (let k = -3; k <= 3; k++) for (const sg of [-1, 1]) E(sg * L, k / 3.5 * D, h / 2, 0.025, 0.025, h / 2, WOOD);
        for (const sg of [-1, 1]) E(0, sg * D, h, L, 0.05, 0.05, DARKWOOD);
        for (let k = -3; k <= 3; k += 2) E(k / 3.5 * L, 0, h + 0.04, 0.16, D, 0.03, WOOD);
        return;
      }
      // a herd's trough: a hollowed log, water in it
      case 'trough': E(0, 0, 0.22, 1.0, 0.32, 0.22, DARKWOOD); E(0, 0, 0.4, 0.88, 0.22, 0.04, C(70, 110, 112)); return;
      default: return beastBodies(f, E, lod, fine);
    }
  }
  // a cart's load, as much of it as is left (0…1), on its bed (1.08 up,
  // 2.7 long, 1.4 across): firewood, hay, baskets of vegetables or of
  // fruit, sacks of grain. (A body's last number, what it is made of:
  // 1 straw, 2 bark, 3 wicker, 4 sacking)
  const HAY = C(190, 176, 108), ROPE = C(92, 74, 52), SACK = C(196, 178, 140), SPLIT = C(206, 170, 120);
  const BARK = rgbs([[104, 90, 76], [86, 74, 62], [120, 104, 86], [74, 66, 58], [132, 112, 88]]);
  const VEG = {
    cabbage: [C(98, 140, 72), 2, 0.12, 1], lettuce: [C(132, 172, 82), 3, 0.09, 1], onion: [C(186, 124, 62), 7, 0.05, 1], garlic: [C(226, 220, 204), 8, 0.035, 1],
    turnip: [C(222, 210, 214), 6, 0.06, 1], beet: [C(120, 34, 50), 6, 0.055, 1], carrot: [C(136, 58, 90), 7, 0.03, 3.4], leek: [C(150, 180, 110), 5, 0.035, 5.5], beans: [C(96, 132, 64), 12, 0.022, 3],
  };
  const FRUIT = {
    apples: [C(178, 52, 36), 8, 0.045, 1], greens: [C(164, 176, 70), 8, 0.045, 1], pears: [C(204, 190, 92), 7, 0.05, 1.4], figs: [C(92, 52, 78), 10, 0.032, 1.2],
    grapes: [C(86, 42, 88), 26, 0.022, 1], white: [C(176, 182, 96), 26, 0.022, 1], pomegranates: [C(176, 58, 40), 6, 0.06, 1], quinces: [C(222, 190, 72), 6, 0.06, 1.1], plums: [C(96, 44, 92), 12, 0.03, 1.1],
  };
  function cartLoad(L, left, id, E, lod) {
    const R = k => hash(id, k, 2027), z0 = 1.1;
    if (L === 'hay') {
      // heaped up over the sides and ends, roped down
      const h = 0.25 + 0.75 * left;
      if (left <= 0) return;
      E(0, 0, z0 + 0.3 * h, 1.7, 1.02, 0.55 * h, HAY, 0, 1);
      if (lod) return;
      for (let k = 0; k < 7; k++) E((R(k) - 0.5) * 2.4, (R(k + 9) - 0.5) * 1.2, z0 + 0.55 * h + 0.15 * R(k + 20), 0.45 + 0.3 * R(k + 30), 0.35 + 0.25 * R(k + 40), 0.25 * h, HAY.map(v => v * (0.9 + 0.2 * R(k + 50))), R(k + 60) * 3, 1);
      for (const u of [-0.6, 0.6]) E(u, 0, z0 + 0.86 * h, 0.03, 1.0, 0.05, ROPE);
      return;
    }
    if (L === 'firewood') {
      // split logs, a cubit long, stacked across in layers, the top narrower
      const layers = [[13, 0.19], [12, 0.19], [9, 0.19]];
      let n = Math.ceil(34 * left), q = 0;
      if (lod) { if (n) E(0, 0, z0 + 0.22, 1.25, 0.6, 0.22 * left + 0.05, BARK[0], 0, 2); return; }
      layers.forEach(([m, step], l) => {
        for (let i = 0; i < m && n > 0; i++, n--, q++) {
          // (each log three bodies end to end, so it is round all along, not pointed)
          const fw = (i - (m - 1) / 2) * step + (l % 2) * 0.05, r = 0.075 + 0.02 * R(q), t = (R(q + 150) - 0.5) * 0.12, half = 0.44 + 0.06 * R(q + 90), o = (R(q + 70) - 0.5) * 0.1;
          const split = R(q + 110) < 0.25, col = split ? SPLIT : BARK[Math.floor(R(q + 130) * BARK.length)];
          for (const u of [-0.55, 0, 0.55]) E(fw - Math.sin(t) * u * half, o + Math.cos(t) * u * half, z0 + 0.08 + l * 0.15, r, half * 0.5, r, col, t, split ? 0 : 2);
        }
      });
      return;
    }
    if (L === 'grain') {
      // sacks lying two by two, tied at the neck, two more on top
      const spots = [[-0.9, -0.33, 0], [-0.9, 0.33, 0], [0, -0.33, 0], [0, 0.33, 0], [0.9, -0.33, 0], [0.9, 0.33, 0], [-0.45, 0, 1], [0.45, 0, 1]];
      const n = Math.ceil(spots.length * left);
      for (let k = 0; k < n; k++) {
        const [fw, a, l] = spots[k], t = (R(k) - 0.5) * 0.3, c = SACK.map(v => v * (0.92 + 0.12 * R(k + 10)));
        E(fw, a, z0 + 0.18 + l * 0.3, 0.38, 0.27, 0.19, c, t, 4);
        if (!lod) { E(fw + 0.4 * Math.cos(t), a + 0.4 * Math.sin(t), z0 + 0.22 + l * 0.3, 0.06, 0.06, 0.06, c.map(v => v * 0.9), 0, 4); E(fw + 0.47 * Math.cos(t), a + 0.47 * Math.sin(t), z0 + 0.24 + l * 0.3, 0.05, 0.08, 0.05, c, t, 4); }
      }
      return;
    }
    // baskets, two by two, each heaped with one thing
    const kinds = L === 'fruit' ? FRUIT : VEG, names = Object.keys(kinds), n = Math.ceil(8 * left);
    for (let k = 0; k < n; k++) {
      const fw = -0.99 + (k >> 1) * 0.66, a = (k % 2 ? 0.36 : -0.36), [col, m, r, long] = kinds[names[Math.floor(R(k + 200) * names.length)]];
      E(fw, a, z0 + 0.14, 0.3, 0.3, 0.16, WICKER, 0, 3);
      E(fw, a, z0 + 0.29, 0.25, 0.25, 0.03, col.map(v => v * 0.55));
      if (lod) { E(fw, a, z0 + 0.31, 0.22, 0.22, 0.05, col); continue; }
      for (let i = 0; i < m; i++) {
        // (in rings, the middle highest)
        const ring = i === 0 ? 0 : i < 7 ? 1 : i < 15 ? 2 : 3, at = i * 2.399 + R(k * 31 + i), rho = Math.min(0.2, ring * Math.max(r, 0.05) * 1.25);
        const c = col.map(v => v * (0.85 + 0.3 * R(k * 17 + i)));
        E(fw + rho * Math.cos(at), a + rho * Math.sin(at), z0 + 0.33 + (3 - ring) * r * 0.45, r * long, r, r * (long > 2 ? 0.9 : 1), c, at);
      }
    }
  }
  // a table laid: bread, a bowl of puls, olives, cheese, eggs, figs, a
  // jug of wine and a cup for each at it; in an atrium house a fish,
  // a fowl and grapes too
  const BREAD = C(196, 142, 70), CHEESE = C(232, 214, 160), OLIVE = C(52, 56, 34), FIG = C(96, 52, 70), EGG = C(238, 232, 214), PULS = C(214, 196, 150), GRAPE = C(92, 44, 86), FISH = C(170, 170, 160), FOWL = C(176, 110, 56), PLATE = C(196, 112, 74), WINE = C(70, 20, 30);
  function mealBodies(f, E) {
    const id = f.id, R = k => hash(id, k, 991), hw = (f.round ? f.w * 0.42 : f.w / 2 - 0.1), hd = (f.round ? f.d * 0.42 : f.d / 2 - 0.1);
    const at = (u, v) => [u * hw, v * hd];
    const dish = (u, v, r, food, n, s = 0.035) => {
      const [a, b] = at(u, v);
      E(a, b, 0.012, r, r, 0.012, PLATE);
      for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2 + R(k + 40) * 3, q = n > 1 ? r * 0.55 : 0; E(a + Math.cos(t) * q, b + Math.sin(t) * q, 0.03, s, s, s * 0.8, food); }
    };
    // the bread: a round loaf scored in eight
    { const [a, b] = at(-0.3, -0.35); E(a, b, 0.04, 0.1, 0.1, 0.045, BREAD); E(a, b, 0.07, 0.07, 0.07, 0.02, BREAD.map(v => v * 0.85)); }
    // the bowl of puls, the jug
    { const [a, b] = at(0.3, 0.35); E(a, b, 0.035, 0.085, 0.085, 0.035, PLATE); E(a, b, 0.065, 0.065, 0.065, 0.008, PULS); }
    { const [a, b] = at(0.62, -0.5); E(a, b, 0.11, 0.06, 0.06, 0.11, CLAY); E(a, b, 0.22, 0.03, 0.03, 0.02, WINE); }
    dish(-0.35, 0.4, 0.075, OLIVE, 7, 0.016);
    if (R(1) < 0.7) { const [a, b] = at(0.05, -0.05); E(a, b, 0.03, 0.06, 0.045, 0.03, CHEESE, 0.4); }
    if (R(2) < 0.5) dish(0.1, 0.45, 0.06, EGG, 3, 0.022);
    if (R(3) < 0.6) dish(-0.6, 0.0, 0.065, FIG, 4, 0.022);
    if (f.rich) {
      { const [a, b] = at(0, 0); E(a, b, 0.012, 0.16, 0.11, 0.012, PLATE); E(a, b, 0.04, 0.13, 0.04, 0.03, FISH); E(a + 0.12, b, 0.04, 0.03, 0.035, 0.012, FISH); }
      if (R(4) < 0.6) { const [a, b] = at(0.45, 0.05); E(a, b, 0.012, 0.11, 0.11, 0.012, PLATE); E(a, b, 0.06, 0.08, 0.06, 0.05, FOWL); }
      dish(-0.1, -0.5, 0.07, GRAPE, 9, 0.018);
    }
    // a cup for each at it, about the edge
    for (let k = 0, n = Math.max(1, Math.min(6, f.n || 2)); k < n; k++) {
      const t = k / n * Math.PI * 2 + 0.4, [a, b] = [Math.cos(t) * hw * 0.85, Math.sin(t) * hd * 0.85];
      E(a, b, 0.04, 0.035, 0.035, 0.04, CLAY); E(a, b, 0.08, 0.026, 0.026, 0.004, WINE);
    }
  }
  // ---- the trades in hand: where the hands are at each work, and the
  // tools and the work in them; a gladiator's arms; an actor's mask ----
  const WOOL = C(232, 226, 210), LEATHER = C(120, 76, 46), WAX = C(150, 120, 60), GOLD = C(214, 178, 82), DOUGH = C(234, 220, 188), MEAT = C(160, 60, 56);
  const HOT = C(255, 150, 50), BRONZE = C(170, 130, 70), SHIELD = C(150, 42, 34), NET = C(176, 166, 140), MASK = C(238, 232, 218), IVORY = C(226, 214, 184);
  // sitting: each hand [forward, aside, up] at the work
  function sitHands(anim, sg, s, ph, T) {
    const w = Math.sin(ph * T);
    switch (anim) {
      case 'craft': case 'sell': case 'talk': return [0.3 + 0.06 * Math.sin(ph * T * (anim === 'craft' ? 2 : 1) + sg), sg * 0.18, s + 0.42];
      case 'eat': return sg > 0 ? [0.2, 0.08, s + 0.42 + 0.3 * Math.max(0, w)] : [0.3, -0.15, s + 0.42];
      case 'drink': return sg > 0 ? [0.16, 0.06, s + 0.72] : [0.28, -0.15, s + 0.4];
      case 'spin': return sg < 0 ? [0.12, -0.2, s + 0.55] : [0.32, 0.18, s + 0.35 + 0.04 * Math.sin(ph * T * 3)];
      case 'stitch': case 'basket': return [0.32 + 0.05 * Math.sin(ph * T * 2 + sg), sg * 0.07, s + 0.36];
      case 'write': return sg < 0 ? [0.34, -0.08, s + 0.45] : [0.36 + 0.02 * Math.sin(ph * T * 4), 0.05, s + 0.48];
      case 'count': return [0.42 + 0.04 * Math.sin(ph * T * 2 + sg * 2), sg * 0.12, s + 0.34];
      case 'throw': return [0.45, sg * 0.08, s + 0.3 + 0.02 * Math.sin(ph * T * 3)];
      case 'pipe': return [0.28, sg * 0.05, s + 0.68];
      case 'dice': return sg > 0 ? [0.38, 0.1, s + 0.42 + 0.06 * Math.abs(Math.sin(ph * T * 2))] : [0.3, -0.15, s + 0.4];
      case 'clap': return [0.3, sg * (0.03 + 0.06 * Math.abs(Math.sin(ph * T * 3))), s + 0.6];
      case 'cheer': return [0.05, sg * 0.28, s + 0.95 + 0.06 * Math.sin(ph * T * 2 + sg)];
      default: return [0.22, sg * 0.18, s + 0.3];
    }
  }
  function sitWork(anim, s, ph, T, S) {
    switch (anim) {
      case 'craft': S(0.42, 0, s + 0.38, 0.12, 0.1, 0.04, WOOD); break;
      // the distaff up under the left arm, the wool on it; the spindle turning below the right hand
      case 'spin': S(0.1, -0.2, s + 0.8, 0.02, 0.02, 0.28, WOOD); S(0.1, -0.2, s + 1.05, 0.06, 0.06, 0.08, WOOL); S(0.32, 0.18, s + 0.15, 0.015, 0.015, 0.15, WOOD); S(0.32, 0.18, s + 0.04, 0.035, 0.035, 0.015, CLAY); break;
      case 'stitch': S(0.34, 0, s + 0.36, 0.1, 0.05, 0.04, LEATHER); break;
      case 'basket': S(0.38, 0, s + 0.3, 0.17, 0.17, 0.08, WICKER); break;
      case 'write': S(0.36, -0.06, s + 0.44, 0.09, 0.07, 0.012, WAX); break;
      case 'count': for (const o of [-0.08, 0.05, 0.14]) S(0.6, o, 0.74, 0.03, 0.03, 0.012 + 0.01 * (o > 0), GOLD); break;
      case 'pipe': for (const sg of [-1, 1]) S(0.42, sg * 0.04, s + 0.6, 0.18, 0.012, 0.012, IVORY); break;
    }
  }
  // standing: an arm [forward, up, its reach, its drop] at the work, or nothing
  function workArm(anim, sg, ph, T) {
    const w = Math.sin(ph * T);
    switch (anim) {
      case 'hammer': return sg > 0 ? [0.25, 1.25 + 0.35 * Math.max(0, Math.sin(ph * T * 1.5)), 0.1, 0.22] : [0.3, 1.0, 0.17, 0.07];
      case 'stoke': return [0.28, 0.9 + 0.08 * Math.sin(ph * T * 1.2 + (sg > 0 ? 0 : Math.PI)), 0.17, 0.07];
      case 'bake': return [0.3, 1.05, 0.2, 0.06];
      case 'knead': return [0.32 + 0.06 * Math.sin(ph * T * 1.5 + sg), 0.95, 0.2, 0.06];
      case 'push': return [0.3, 1.1, 0.2, 0.06];
      case 'tread': return [0.08, 1.05, 0.07, 0.22];
      case 'chop': return sg > 0 ? [0.25, 1.15 + 0.3 * Math.max(0, Math.sin(ph * T * 1.3)), 0.12, 0.2] : [0.3, 0.95, 0.17, 0.07];
      case 'weave': return [0.25, 1.35 + 0.1 * Math.sin(ph * T + sg), 0.12, 0.18];
      case 'saw': return sg > 0 ? [0.3 + 0.15 * Math.sin(ph * T * 1.2), 0.95, 0.2, 0.06] : [0.28, 0.92, 0.17, 0.07];
      case 'shave': return sg > 0 ? [0.32, 1.15 + 0.05 * Math.sin(ph * T * 2), 0.17, 0.07] : [0.3, 1.2, 0.15, 0.08];
      case 'pipe': return [0.22, 1.38, 0.13, 0.08];
      case 'drink': return sg > 0 ? [0.14, 1.4, 0.08, 0.12] : null;
      case 'fight': return sg > 0 ? [0.25 + 0.2 * Math.max(0, Math.sin(ph * T * 1.6)), 1.2, 0.2, 0.06] : [0.22, 1.1, 0.1, 0.16];
      case 'cheer': return [0.05, 1.55 + 0.08 * Math.sin(ph * T * 2 + sg), 0.06, 0.26];
      case 'clap': return [0.2, 1.2, 0.15, 0.06];
      case 'axe': return [0.2, 1.3 + 0.3 * Math.sin(ph * T * 0.9), 0.1, 0.22];
      case 'declaim': return sg > 0 ? [0.2 + 0.1 * Math.sin(ph * T * 0.6), 1.35, 0.17, 0.12] : [0.12, 1.15, 0.1, 0.15];
      default: void w; return null;
    }
  }
  function standWork(anim, ph, T, S) {
    switch (anim) {
      case 'hammer': {
        // the hammer coming down, the tongs holding the iron glowing on the anvil
        const hz = 1.25 + 0.35 * Math.max(0, Math.sin(ph * T * 1.5));
        S(0.45, 0.25, hz + 0.1, 0.13, 0.02, 0.02, WOOD); S(0.56, 0.25, hz + 0.12, 0.04, 0.04, 0.05, IRON);
        S(0.5, -0.12, 0.85, 0.22, 0.015, 0.015, IRON); S(0.68, -0.02, 0.76, 0.12, 0.02, 0.015, HOT);
        break;
      }
      case 'bake': S(0.9, 0, 1.05, 0.75, 0.025, 0.025, WOOD); S(1.62, 0, 1.0, 0.15, 0.13, 0.01, WOOD); break;
      case 'knead': S(0.42, 0, 0.93, 0.13, 0.13, 0.05, DOUGH); break;
      case 'chop': S(0.42, 0.25, 1.15 + 0.3 * Math.max(0, Math.sin(ph * T * 1.3)), 0.08, 0.02, 0.06, IRON); S(0.56, 0, 0.83, 0.15, 0.11, 0.05, MEAT); break;
      case 'saw': S(0.45 + 0.15 * Math.sin(ph * T * 1.2), 0.15, 0.84, 0.3, 0.01, 0.06, IRON); S(0.5, 0, 0.82, 0.62, 0.13, 0.025, WOOD); break;
      case 'shave': S(0.44, 0.2, 1.15, 0.04, 0.01, 0.02, IRON); break;
      case 'drink': S(0.2, 0.1, 1.48, 0.045, 0.045, 0.05, CLAY); break;
      case 'pipe': for (const sg of [-1, 1]) S(0.42, sg * 0.04, 1.36, 0.22, 0.012, 0.012, IVORY); break;
      case 'axe': { const z = 1.3 + 0.3 * Math.sin(ph * T * 0.9); S(0.45, 0, z, 0.36, 0.025, 0.025, WOOD); S(0.8, 0, z - 0.02, 0.07, 0.02, 0.1, IRON); break; }
    }
  }
  // a gladiator's arms: a sword-fighter his helmet, his tall shield and his
  // sword; a net-fighter, bareheaded, his trident and his net
  function gear(f, S, fighting, hz) {
    const thrust = fighting ? 0.2 * Math.max(0, Math.sin((f.ph || 0) * Math.PI * 2 * 1.6)) : 0;
    if (f.armed === 'spear') { S(0.7 + thrust, 0.22, 1.2, 1.1, 0.02, 0.02, WOOD, 0); S(1.82 + thrust, 0.22, 1.2, 0.12, 0.03, 0.015, IRON); return; }
    if (f.armed === 'net') {
      S(0.55 + thrust, 0.25, fighting ? 1.3 : 1.0, 0.85, 0.02, 0.02, WOOD); S(1.4 + thrust, 0.25, fighting ? 1.3 : 1.0, 0.06, 0.07, 0.015, IRON);
      S(0.25, -0.32, 0.95, 0.15, 0.12, 0.2, NET);
    } else {
      S(0, 0, hz + 0.03, 0.135, 0.125, 0.135, BRONZE); S(0, 0, hz + 0.17, 0.12, 0.02, 0.05, SHIELD);
      S(0.3, -0.3, 1.05, 0.04, 0.22, 0.38, SHIELD);
      S(0.5 + thrust, 0.25, 1.2, 0.22, 0.02, 0.015, IRON);
    }
  }
  function personBodies(f, E, lod, fine) {
    const id = f.id, ph = f.ph || 0, T = Math.PI * 2, sw = Math.sin(ph * T), cw = Math.cos(ph * T);
    const k = f.age === 'child' ? 0.66 : f.age === 'old' ? 0.95 : 1, fem = f.sex === 'f';
    const skin = pick(SKIN, id, 1), hair = f.age === 'old' ? C(160, 154, 146) : pick(HAIR, id, 2);
    const dress = f.dress, under = pick(TUNIC, id, 3);
    const cl = dress === 'toga' ? C(236, 232, 222) : dress === 'stola' ? pick(STOLA, id, 4) : dress === 'slave' ? pick(SLAVE, id, 5) : dress === 'cloak' ? pick(CLOAK, id, 6) : dress === 'work' ? pick(SLAVE, id, 7) : under;
    const palla = fem ? pick(STOLA, id, 8) : cl, veiled = fem && hash(id, 9, 77) > 0.55 && f.pose !== 'lie';
    const long = dress === 'toga' || fem, legC = skin, foot = C(96, 70, 48);
    const bearded = !fem && (f.age === 'old' ? hash(id, 31, 7) < 0.6 : f.age === 'adult' && hash(id, 31, 7) < 0.25);
    // (a body in the figure's frame, its size by the figure's)
    const S = (fw, a, z, rx, ry, rz, c, t = 0) => E(fw * k, a * k, z * k, rx * k, ry * k, rz * k, c, t);
    const head = (fw, z) => {
      S(fw, 0, z, 0.11, 0.1, 0.12, veiled ? palla : hair);
      S(fw + 0.035, 0, z - 0.02, 0.085, 0.085, 0.095, skin);
      if (veiled) S(fw - 0.02, 0, z + 0.02, 0.125, 0.115, 0.12, palla);
      // (an actor's mask, its open mouth dark)
      if (f.anim === 'declaim') { S(fw + 0.06, 0, z - 0.01, 0.075, 0.095, 0.115, MASK); S(fw + 0.13, 0, z - 0.06, 0.02, 0.03, 0.02, C(40, 30, 28)); }
      else if (fine) {
        // a nose, the ears; a man's beard, now and then; a woman's hair in a knot behind
        S(fw + 0.115, 0, z - 0.03, 0.03, 0.02, 0.025, skin.map(v => v * 0.94));
        if (!veiled) for (const sg of [-1, 1]) S(fw + 0.01, sg * 0.093, z - 0.02, 0.02, 0.018, 0.035, skin.map(v => v * 0.9));
        if (bearded) S(fw + 0.08, 0, z - 0.08, 0.05, 0.075, 0.045, hair);
        if (fem && !veiled && f.age !== 'child') S(fw - 0.1, 0, z + 0.03, 0.055, 0.06, 0.05, hair);
      }
    };
    if (lod) { S(0, 0, 0.82, 0.16, 0.22, 0.72, cl); S(0, 0, 1.52, 0.11, 0.1, 0.12, veiled ? palla : hair); return; }
    const pose = f.pose, anim = f.anim;
    const carry = f.carry;
    // what is carried
    const carried = (hz) => {
      if (carry === 'jar-full') { S(0, 0, hz + 0.24, 0.15, 0.15, 0.19, CLAY); S(0.04, 0.17, hz + 0.02, 0.05, 0.05, 0.2, skin); }
      else if (carry === 'jar') S(0.02, 0.24, 0.95, 0.13, 0.13, 0.17, CLAY);
      else if (carry === 'amphora') S(-0.02, -0.12, 1.5, 0.14, 0.44, 0.14, CLAY, 0.5);
      else if (carry === 'basket') { if (hash(id, 11, 3) < 0.5) { S(0, 0, hz + 0.15, 0.22, 0.22, 0.09, WICKER); S(0, 0, hz + 0.23, 0.17, 0.17, 0.05, pick(rgbs([[150, 40, 40], [110, 140, 60], [200, 160, 60]]), id, 12)); } else S(0.05, 0.27, 0.92, 0.18, 0.14, 0.12, WICKER); }
      else if (carry === 'bundle') S(-0.2, 0, 1.25, 0.15, 0.2, 0.2, pick(CLOAK, id, 13));
      else if (carry === 'torch') { S(0.3, 0.32, 1.72, 0.03, 0.03, 0.32, DARKWOOD); S(0.18, 0.3, 1.38, 0.06, 0.06, 0.2, skin); }
      else if (carry === 'staff' || carry === 'spear') S(0.08, 0.3, 1.0, 0.025, 0.025, carry === 'spear' ? 1.1 : 0.9, WOOD);
      else if (carry === 'rod') S(0.2, 0.25, 1.3, 0.9, 0.02, 0.02, WOOD, 0.2);
      else if (carry === 'bag') S(0.05, -0.22, 0.95, 0.14, 0.1, 0.15, C(200, 186, 150));
      else if (carry === 'tools') S(0.02, -0.22, 0.9, 0.16, 0.08, 0.12, C(120, 96, 70));
      // the fasces on the left shoulder: rods bound about an axe, its blade out at the top
      else if (carry === 'fasces') { S(0.05, -0.22, 1.45, 0.06, 0.06, 0.55, C(150, 104, 70)); for (const o of [-0.035, 0.035]) S(0.05 + o, -0.22, 1.45, 0.012, 0.012, 0.56, C(160, 40, 34)); S(0.12, -0.22, 2.0, 0.1, 0.02, 0.07, IRON); }
      else if (carry === 'axe') { S(-0.05, 0.18, 1.45, 0.45, 0.025, 0.025, WOOD, 0.12); S(0.36, 0.18, 1.5, 0.06, 0.02, 0.1, IRON); }
      // from a cart: a sack on the shoulder, an armful of firewood, a bundle of hay on the back
      else if (carry === 'sack') E(-0.02 * k, -0.1 * k, 1.58 * k, 0.4 * k, 0.24 * k, 0.17 * k, SACK, 0.15, 4);
      else if (carry === 'wood') for (const [o, z] of [[-0.09, 1.08], [0.09, 1.08], [0, 1.2]]) E(0.24 * k, o * k, z * k, 0.07 * k, 0.32 * k, 0.07 * k, BARK[0], 0, 2);
      else if (carry === 'hay') E(-0.18 * k, 0, 1.55 * k, 0.32 * k, 0.4 * k, 0.32 * k, HAY, 0, 1);
      // a timber on the shoulder, its length along the way he goes
      else if (carry === 'timber') E(0.1 * k, 0.2 * k, 1.58 * k, 1.5 * k, 0.08 * k, 0.08 * k, SPLIT, 0, 2);
      else if (carry) S(-0.05, 0.18, 1.45, 0.7, 0.025, 0.025, WOOD, 0.12); // a tool on the shoulder
    };
    switch (pose) {
      case 'lie': {
        // the length of it, a blanket over, the head on the pillow
        const cov = f.z > 0.3 || f.mat ? pick(STOLA, id, 14).map(v => v * 0.8) : cl;
        // (on the floor, a straw pallet under them, a rolled cloak for a pillow)
        if (f.mat) { E(0.05, 0, -0.03, 1.0, 0.4, 0.05, STRAW.map(v => v * 0.85), 0, 1); E(0.82, 0, 0.04, 0.12, 0.3, 0.06, pick(CLOAK, id, 16)); }
        S(0.72, 0, 0.13, 0.12, 0.1, 0.1, hair); S(0.28, 0, 0.13, 0.36, 0.21, 0.12, cov); S(-0.42, 0, 0.11, 0.5, 0.18, 0.1, cov);
        return;
      }
      case 'recline': {
        // propped on the left elbow, towards the table
        S(0.55, 0.06, 0.48, 0.11, 0.1, 0.12, hair); S(0.59, 0.06, 0.46, 0.085, 0.085, 0.09, skin);
        S(0.22, 0, 0.28, 0.32, 0.22, 0.17, cl); S(-0.5, -0.05, 0.12, 0.52, 0.2, 0.1, cl); S(0.35, 0.22, 0.2, 0.18, 0.06, 0.06, skin);
        S(0.45 + 0.05 * sw, -0.22, 0.35, 0.16, 0.05, 0.05, skin, 0.4);
        return;
      }
      case 'swim': {
        S(0.12, 0, 0.18, 0.11, 0.1, 0.11, hair); S(0, 0, 0.04, 0.15, 0.23, 0.08, skin);
        for (const sg of [-1, 1]) S(0.15 + 0.2 * Math.sin(ph * T + (sg > 0 ? 0 : Math.PI)), sg * 0.32, 0.03, 0.2, 0.05, 0.05, skin, sg * 0.5);
        return;
      }
      case 'sit': {
        const s = (f.seat || 0) / k;
        // (on a stool, if not on a bench or the ground)
        if (f.stool) { S(-0.04, 0, s * 0.5, 0.17, 0.17, s * 0.5, WOOD); }
        S(-0.02, 0, s + 0.4, 0.13, 0.2, 0.27, cl); head(0, s + 0.8);
        S(0.16, 0, s + 0.1, 0.26, 0.21, 0.11, long ? cl : under);
        for (const sg of [-1, 1]) {
          if (s > 0.12) { S(0.42, sg * 0.1, s / 2, 0.07, 0.065, s / 2, long ? cl : legC); S(0.48, sg * 0.1, 0.04, 0.12, 0.05, 0.04, foot); }
          else { S(0.62, sg * 0.1, 0.07, 0.25, 0.07, 0.07, long ? cl : legC); S(0.88, sg * 0.1, 0.08, 0.05, 0.05, 0.08, foot); }
          // the hands at work, or on the knees
          const [hx, hy, hz] = sitHands(anim, sg, s, ph, T);
          S(hx, hy, hz, 0.14, 0.055, 0.06, skin, -sg * 0.4);
        }
        sitWork(anim, s, ph, T, S);
        return;
      }
      case 'kneel': case 'squat': {
        const kn = pose === 'kneel';
        const lean = kn ? 0.12 : 0.05;
        S(lean, 0, kn ? 0.66 : 0.6, 0.15, 0.2, 0.25, cl); head(lean + 0.14, kn ? 0.98 : 0.92);
        for (const sg of [-1, 1]) {
          if (kn) { S(-0.16, sg * 0.11, 0.1, 0.26, 0.07, 0.08, long ? cl : legC); S(0.05, sg * 0.11, 0.28, 0.12, 0.07, 0.17, long ? cl : legC); }
          else { S(0.22, sg * 0.12, 0.36, 0.2, 0.07, 0.08, long ? cl : legC); S(0.32, sg * 0.12, 0.18, 0.07, 0.065, 0.18, legC); }
          const work = anim === 'wash' || anim === 'gather' || anim === 'fill';
          S(0.36 + (work ? 0.08 * Math.sin(ph * T * 1.5 + sg * 1.3) : 0), sg * 0.16, work ? 0.3 : 0.42, 0.16, 0.05, 0.05, skin, -sg * 0.3);
        }
        if (anim === 'wash') S(0.62, 0, 0.12, 0.3, 0.26, 0.05, pick(TUNIC, id, 15));
        if (anim === 'chisel') { S(0.5, 0.1, 0.42, 0.08, 0.02, 0.02, IRON, 0.3); S(0.42, -0.16, 0.5 + 0.12 * Math.max(0, sw), 0.05, 0.05, 0.05, WOOD); }
        if (anim === 'gather') S(0.5, 0.3, 0.12, 0.2, 0.2, 0.12, WICKER);
        carried(1.0);
        return;
      }
      case 'bend': {
        // bent over the work: the hoe, the sickle, the broom, the jar at the fountain
        const bob = anim === 'hoe' || anim === 'dig' ? Math.max(0, sw) : 0;
        S(0.2 - 0.04 * bob, 0, 1.0 + 0.1 * bob, 0.28, 0.2, 0.17, cl); head(0.47 - 0.08 * bob, 0.98 + 0.18 * bob);
        S(0.02, 0, 0.74, 0.17, 0.2, 0.2, long ? cl : under);
        for (const sg of [-1, 1]) { S(-0.02, sg * 0.09, 0.3, 0.07, 0.065, 0.3, long ? cl : legC); S(0.05, sg * 0.09, 0.04, 0.12, 0.05, 0.04, foot); }
        const reach = anim === 'reap' ? 0.15 * sw : 0;
        for (const sg of [-1, 1]) S(0.5 + 0.12 * bob, sg * 0.15 + reach, 0.62 + 0.35 * bob, 0.07, 0.06, 0.24, skin);
        if (anim === 'hoe' || anim === 'dig') S(0.78 + 0.15 * bob, 0, 0.3 + 0.55 * bob, 0.5, 0.03, 0.03, WOOD);
        if (anim === 'reap') S(0.62, 0.28 * sw, 0.35, 0.14, 0.05, 0.02, IRON, sw);
        if (anim === 'sweep') S(0.72, 0.2 * sw, 0.22, 0.5, 0.06, 0.04, STRAW, 0.4 * sw);
        if (anim === 'fill' || f.carry === 'jar' || f.carry === 'jar-full') S(0.55, 0, 0.62, 0.14, 0.14, 0.17, CLAY);
        if (anim === 'pick') S(0.3, -0.3, 0.6, 0.18, 0.15, 0.12, WICKER);
        if (anim === 'stoke') S(0.75, 0.05, 0.45 + 0.05 * sw, 0.5, 0.03, 0.03, DARKWOOD, 0.1);
        if (anim === 'heal') S(0.15, -0.3, 0.55, 0.14, 0.1, 0.15, C(200, 186, 150));
        return;
      }
      default: {
        // standing, walking or running
        const walking = pose === 'walk' || pose === 'run', run = pose === 'run';
        const st = walking ? (run ? 0.34 : 0.2) * sw : 0, lean = run ? 0.07 : 0;
        const bob = walking ? 0.025 * Math.abs(cw) : 0;
        const turnH = anim === 'talk' ? 0.35 * Math.sin(ph * T * 0.37) : 0;
        S(lean, 0, 1.17 + bob, 0.125, dress === 'toga' ? 0.24 : 0.2, 0.27, anim === 'fight' ? skin : cl); head(lean + 0.01, 1.52 + bob);
        if (turnH) S(0.06, turnH * 0.15, 1.5 + bob, 0.04, 0.04, 0.04, skin);
        if (fem && !veiled) S(-0.02, 0, 1.36 + bob, 0.15, 0.24, 0.12, palla);
        if (dress === 'toga') S(0.01, 0.07, 1.22 + bob, 0.15, 0.2, 0.25, cl, 0.25);
        if (fine) {
          S(0.01, 0, 1.43 + bob, 0.055, 0.055, 0.05, skin);
          // a belt about a tunic; a citizen's two red stripes down it
          if (!long && anim !== 'fight') { S(lean, 0, 1.0 + bob, 0.13, 0.205, 0.025, LEATHER); if (dress === 'tunic' && !f.bond) for (const sg of [-1, 1]) S(lean + 0.115, sg * 0.075, 1.15 + bob, 0.015, 0.012, 0.22, C(150, 40, 40)); }
          // a magistrate's toga its purple border; a freeborn boy's gold amulet; a lady's necklace
          if (dress === 'toga' && f.magistrate) S(0.06, -0.12, 1.22 + bob, 0.1, 0.035, 0.24, C(110, 40, 90), 0.25);
          if (f.age === 'child' && !fem) S(0.12, 0, 1.3 + bob, 0.025, 0.025, 0.025, GOLD);
          if (f.job === 'domina') S(0.1, 0, 1.36 + bob, 0.04, 0.1, 0.015, GOLD);
        }
        S(0.01, 0, long ? 0.6 : 0.78, 0.17, 0.21, long ? 0.44 : 0.22, long ? cl : under);
        for (const sg of [-1, 1]) {
          const leg = st * sg;
          const lift = anim === 'tread' ? 0.09 * Math.max(0, Math.sin(ph * T * 1.4) * sg) : 0;
          S(leg, sg * 0.085, 0.32 + lift, 0.07, 0.065, 0.32, long ? cl : legC);
          S(leg * 1.3 + 0.05, sg * 0.085, 0.04 + lift * 1.6, 0.12, 0.05, 0.04, foot);
          // the arms: swinging, or at their work
          let ax = -leg * 0.6, az = 1.12, arx = 0.06, arz = 0.27;
          if (anim === 'talk' && sg > 0) { ax = 0.17 + 0.07 * Math.sin(ph * T * 0.8); az = 1.22; arx = 0.17; arz = 0.07; }
          if (anim === 'sell' && sg > 0) { ax = 0.15; az = 1.05; arx = 0.15; arz = 0.06; }
          if (anim === 'pray') { ax = 0.16; az = 1.48; arx = 0.08; arz = 0.18; }
          if (anim === 'cook' || anim === 'eat') { ax = 0.2 + (anim === 'cook' ? 0.06 * Math.sin(ph * T + sg) : 0); az = 1.0 + (anim === 'eat' && sg > 0 ? 0.3 * Math.max(0, sw) : 0); arx = 0.17; arz = 0.07; }
          if (anim === 'ball' && sg > 0) { ax = 0.1; az = 1.5 + 0.2 * Math.max(0, sw); arx = 0.06; arz = 0.25; }
          if (anim === 'beat' || anim === 'prune' || anim === 'pole') { ax = 0.15; az = 1.55; arx = 0.07; arz = 0.25; }
          if (anim === 'scythe') { ax = 0.32; az = 0.95; arx = 0.2; arz = 0.06; }
          if ((anim === 'sow' || anim === 'scatter') && sg > 0) { ax = 0.22 * sw; az = 1.05; arx = 0.15; arz = 0.07; }
          if (anim === 'shoo') { ax = 0.12; az = 1.25 + 0.12 * sg * sw; arx = 0.08; arz = 0.2; }
          if (anim === 'plough') { ax = 0.32; az = 0.95; arx = 0.2; arz = 0.06; }
          if (anim === 'fish' && sg > 0) { ax = 0.2; az = 1.2; arx = 0.17; arz = 0.07; }
          const w = workArm(anim, sg, ph, T);
          if (w) [ax, az, arx, arz] = w;
          if (!(carry === 'torch' && sg > 0) && !(carry === 'jar-full' && sg > 0)) {
            S(lean + ax, sg * 0.25, az + bob, arx, 0.055, arz, cl === under || dress === 'tunic' || dress === 'work' || dress === 'slave' ? skin : cl);
            // (the hand at the arm's end)
            if (fine) { const hx = arx > arz ? ax + arx * 0.95 : ax, hz = arx > arz ? az : az - arz * 0.95; S(lean + hx, sg * 0.25, hz + bob, 0.045, 0.04, 0.05, skin); }
          }
        }
        // the work's tools
        if (anim === 'beat' || anim === 'pole') S(0.6, 0.15 * sw, 2.3, 1.1, 0.03, 0.03, WOOD, 0.5 * sw);
        if (anim === 'prune') S(0.32, 0, 1.75, 0.12, 0.03, 0.03, IRON);
        if (anim === 'scythe') S(0.8, 0.5 * Math.sin(ph * T * 0.7), 0.3, 0.75, 0.05, 0.03, IRON, 0.8 * Math.sin(ph * T * 0.7));
        if (anim === 'fish') S(1.9, 0.12, 1.45, 1.6, 0.015, 0.015, WOOD, 0.08);
        if (anim === 'plough') { S(0.75, 0, 0.75, 0.32, 0.25, 0.04, WOOD); S(1.2, 0, 0.45, 0.4, 0.06, 0.25, DARKWOOD); S(2.1, 0, 0.6, 0.9, 0.04, 0.04, WOOD); }
        standWork(anim, ph, T, S);
        if (f.armed && (anim === 'fight' || anim === 'cheer' || anim === 'watch')) gear(f, S, anim === 'fight', 1.52 + bob);
        if (!walking && f.carry === 'jar-full') S(0, 0, 1.76, 0.15, 0.15, 0.19, CLAY);
        if (walking || !anim || anim === 'watch' || anim === 'shoo' || anim === 'talk' || anim === 'scatter' || anim === 'pray') carried(1.52 + bob);
      }
    }
  }
  // the arena's beasts: a lion (the male's mane dark and shaggy), a bear
  // (up on its hind legs at the hunters), an elephant (ears, trunk, tusks),
  // an ostrich (its long bare neck and legs, black and white feathers)
  function wildBodies(f, E, lod, fine) {
    const id = f.id || 1, ph = f.ph || 0, T = Math.PI * 2, kind = f.kind, pose = f.pose, lie = pose === 'lie', walking = pose === 'walk' || pose === 'run';
    const sw = o => walking ? Math.sin((ph + o) * T) : 0;
    const legs = (L, Wd, h, r, col, gait) => { if (lie) return; for (const [fx, sg, o] of [[L, 1, 0], [L, -1, 0.5], [-L, 1, 0.5], [-L, -1, 0]]) E(fx + gait * sw(o), sg * Wd, h / 2, r, r * 0.9, h / 2, col); };
    if (kind === 'lion') {
      const coat = C(196, 150, 86), mane = C(110, 70, 36), z = lie ? 0.3 : 0.62;
      E(0, 0, z, 0.72, 0.26, lie ? 0.24 : 0.28, coat);
      E(0.78, 0, z + (lie ? 0.05 : 0.18), 0.2, 0.16, 0.17, coat); E(0.96, 0, z + (lie ? 0.02 : 0.14), 0.09, 0.08, 0.07, C(172, 128, 76));
      if (f.male) E(0.62, 0, z + (lie ? 0.1 : 0.22), 0.26, 0.3, 0.3, mane);
      if (lod) return;
      legs(0.48, 0.15, z - 0.05, 0.07, coat, 0.25);
      E(-0.95, 0, z + 0.05, 0.36, 0.03, 0.03, coat, 0.3); E(-1.28, 0.08, z + 0.02, 0.06, 0.05, 0.05, mane);
      if (fine) for (const sg of [-1, 1]) { E(0.82, sg * 0.13, z + 0.3, 0.04, 0.04, 0.04, coat.map(v => v * 0.8)); E(0.95, sg * 0.06, z + 0.2, 0.015, 0.015, 0.015, C(30, 24, 16)); }
      return;
    }
    if (kind === 'bear') {
      const coat = C(84, 60, 42), rear = pose === 'rear';
      if (rear) { E(0, 0, 1.1, 0.32, 0.36, 0.7, coat); E(0.12, 0, 1.85, 0.2, 0.2, 0.2, coat); E(0.3, 0, 1.82, 0.1, 0.08, 0.08, C(110, 84, 62)); for (const sg of [-1, 1]) { E(0.3, sg * 0.32, 1.45, 0.25, 0.08, 0.08, coat); E(0, sg * 0.18, 0.25, 0.12, 0.12, 0.25, coat); } return; }
      const z = lie ? 0.35 : 0.72;
      E(0, 0, z, 0.75, 0.42, lie ? 0.32 : 0.42, coat); E(0.78, 0, z + (lie ? 0 : 0.05), 0.24, 0.2, 0.2, coat); E(0.98, 0, z - 0.02, 0.1, 0.08, 0.08, C(110, 84, 62));
      if (lod) return;
      legs(0.45, 0.24, z - 0.1, 0.12, coat, 0.2);
      if (fine) for (const sg of [-1, 1]) E(0.72, sg * 0.15, z + 0.22, 0.05, 0.05, 0.04, coat);
      return;
    }
    if (kind === 'elephant') {
      const skin = C(132, 126, 120), z = 1.9;
      E(0, 0, z, 1.5, 0.95, 0.95, skin);
      E(1.55, 0, z + 0.25, 0.55, 0.5, 0.55, skin);
      for (const sg of [-1, 1]) E(1.35, sg * 0.75, z + 0.25, 0.25, 0.45, 0.55, skin.map(v => v * 0.92), sg * (0.25 + 0.15 * Math.sin(ph * T * 0.3)));
      if (lod) return;
      const tr = 0.25 * Math.sin(ph * T * 0.4);
      E(2.05, tr * 0.4, z - 0.35, 0.12, 0.12, 0.6, skin, tr); E(2.15, tr * 0.6, z - 1.0, 0.09, 0.09, 0.3, skin);
      for (const sg of [-1, 1]) E(2.1, sg * 0.25, z - 0.25, 0.35, 0.05, 0.05, C(236, 228, 206), sg * 0.2);
      legs(0.9, 0.55, z - 0.4, 0.28, skin, 0.3);
      E(-1.55, 0, z - 0.2, 0.05, 0.04, 0.55, skin);
      return;
    }
    // the ostrich
    const black = C(34, 30, 30), white = C(236, 230, 220), legC = C(214, 168, 150), run = pose === 'run';
    E(0, 0, 1.05, 0.42, 0.3, 0.26, black); E(-0.38, 0, 1.12, 0.16, 0.24, 0.16, white);
    E(0.42, 0, 1.55, 0.05, 0.05, 0.45, legC, 0); E(0.52, 0, 2.0, 0.1, 0.07, 0.07, legC); E(0.62, 0, 1.98, 0.06, 0.03, 0.025, C(190, 150, 110));
    if (lod) return;
    for (const sg of [-1, 1]) { const o = sg > 0 ? 0 : 0.5; E(0.05 + (run ? 0.3 : 0.15) * sw(o), sg * 0.12, 0.45, 0.05, 0.05, 0.45, legC); E(0.12 + (run ? 0.3 : 0.15) * sw(o), sg * 0.12, 0.03, 0.1, 0.05, 0.03, legC); }
  }
  function beastBodies(f, E, lod, fine) {
    const id = f.id || 1, ph = f.ph || 0, T = Math.PI * 2, kind = f.kind, coat = pick(COATS[kind] || COATS.dog, id, 21);
    const pose = f.pose, lie = pose === 'lie', graze = pose === 'graze', sit = pose === 'sit', walking = pose === 'walk' || pose === 'run';
    const legs = (L, Wd, h, r, col, gait) => {
      if (lie) return;
      for (const [fx, sg, o] of [[L, 1, 0], [L, -1, 0.5], [-L, 1, 0.5], [-L, -1, 0]]) {
        const sw = walking ? gait * Math.sin((ph + o) * T) : 0;
        E(fx + sw, sg * Wd, h / 2, r, r * 0.9, h / 2, col);
      }
    };
    const dark = coat.map(v => v * 0.55);
    if (kind === 'sheep' || kind === 'goat') {
      const g = kind === 'goat', s = g ? 0.95 : 1, face = !g && hash(id, 22, 5) < 0.3 ? C(60, 52, 46) : coat.map(v => v * 0.9);
      const hz = graze ? 0.2 : lie ? 0.38 : g ? 0.8 : 0.66, hf = graze ? 0.66 : lie ? 0.5 : 0.6;
      E(0, 0, lie ? 0.28 : g ? 0.62 : 0.56, 0.52 * s, g ? 0.21 : 0.3, lie ? 0.24 : g ? 0.24 : 0.3, coat, 0, g ? 0 : 5);
      if (!lod) {
        E(hf, 0, hz, 0.15, 0.085, 0.1, face);
        if (g) for (const sg of [-1, 1]) E(hf - 0.07, sg * 0.05, hz + 0.1, 0.09, 0.02, 0.03, HORN, sg * 0.4);
        legs(0.3, 0.13, g ? 0.48 : 0.36, 0.04, g ? coat.map(v => v * 0.8) : C(70, 62, 56), 0.12);
        E(-0.5, 0, (lie ? 0.3 : g ? 0.72 : 0.55), 0.08, 0.05, 0.06, coat);
      }
      if (fine) {
        // ears out to the sides, the eyes, the muzzle; a goat's beard (a sheep's fleece is in its stuff)
        for (const sg of [-1, 1]) { E(hf - 0.06, sg * 0.1, hz + 0.04, 0.05, 0.06, 0.02, face, sg * 0.6); E(hf + 0.06, sg * 0.06, hz + 0.04, 0.015, 0.015, 0.015, C(30, 26, 22)); }
        E(hf + 0.13, 0, hz - 0.03, 0.04, 0.05, 0.04, face.map(v => v * 0.85));
        if (g) E(hf + 0.06, 0, hz - 0.12, 0.03, 0.03, 0.06, coat.map(v => v * 0.6));
      }
      return;
    }
    if (kind === 'cow' || kind === 'ox' || kind === 'horse' || kind === 'donkey') {
      const horse = kind === 'horse' || kind === 'donkey', s = kind === 'donkey' ? 0.72 : 1;
      const S = (fw, a, z, rx, ry, rz, c, t) => E(fw * s, a * s, z * s, rx * s, ry * s, rz * s, c, t);
      const bz = lie ? 0.48 : horse ? 1.18 : 1.0;
      S(0, 0, bz, horse ? 0.92 : 1.05, horse ? 0.32 : 0.42, horse ? 0.34 : 0.42, coat);
      if (lod) { S(graze ? 1.2 : 1.15, 0, graze ? 0.35 : horse ? 1.55 : 1.05, 0.26, 0.14, 0.15, coat); return; }
      const nz = graze ? 0.75 : lie ? 0.7 : horse ? 1.5 : 1.1, hz = graze ? 0.32 : lie ? 0.6 : horse ? 1.62 : 1.05;
      S(0.88, 0, nz, 0.32, horse ? 0.14 : 0.2, horse ? 0.3 : 0.22, coat, 0);
      S(graze ? 1.2 : 1.2, 0, hz, horse ? 0.3 : 0.27, horse ? 0.12 : 0.15, horse ? 0.12 : 0.16, horse ? coat.map(v => v * 0.92) : coat);
      if (horse) S(0.78, 0, nz + 0.14, 0.32, 0.05, 0.1, dark);
      if (kind === 'ox' || (kind === 'cow' && hash(id, 23, 1) < 0.7)) for (const sg of [-1, 1]) S(1.12, sg * 0.2, hz + 0.12, 0.05, 0.16, 0.04, HORN, sg * 0.5);
      if (kind === 'donkey') for (const sg of [-1, 1]) S(1.05, sg * 0.08, hz + 0.25, 0.04, 0.03, 0.15, coat, 0);
      legs(horse ? 0.62 : 0.66, horse ? 0.18 : 0.24, horse ? 0.95 : 0.78, horse ? 0.07 : 0.09, horse ? coat.map(v => v * 0.75) : coat.map(v => v * 0.85), 0.28);
      S(-1.0, 0, horse ? 1.0 : 0.72, horse ? 0.12 : 0.05, horse ? 0.08 : 0.04, horse ? 0.32 : 0.3, horse ? dark : coat);
      if (f.laden || kind === 'donkey' && hash(id, 24, 1) < 0.5) for (const sg of [-1, 1]) S(0, sg * 0.42, bz - 0.15, 0.3, 0.14, 0.22, WICKER);
      if (fine) {
        // ears, eyes, a darker muzzle; hooves; a cow's udder and her patches;
        // a horse's forelock and its tail's long hair; the donkey's dark cross
        const ear = horse ? [0.06, 0.035, 0.08] : [0.04, 0.09, 0.03];
        if (kind !== 'donkey') for (const sg of [-1, 1]) S(1.02, sg * (horse ? 0.07 : 0.17), hz + (horse ? 0.15 : 0.05), ...ear, coat.map(v => v * 0.9), sg * 0.3);
        for (const sg of [-1, 1]) S(1.25, sg * (horse ? 0.08 : 0.1), hz + 0.05, 0.02, 0.02, 0.02, C(24, 20, 18));
        S(horse ? 1.47 : 1.43, 0, hz - 0.03, horse ? 0.08 : 0.09, horse ? 0.09 : 0.13, horse ? 0.08 : 0.1, kind === 'donkey' ? C(214, 206, 192) : coat.map(v => v * 0.7));
        if (!lie) for (const [fx, sg] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) S(fx * (horse ? 0.62 : 0.66), sg * (horse ? 0.18 : 0.24), 0.04, horse ? 0.08 : 0.1, horse ? 0.075 : 0.09, 0.04, HOOF);
        if (kind === 'cow') { if (!lie) S(-0.55, 0, 0.55, 0.17, 0.15, 0.1, C(222, 176, 166)); if (hash(id, 25, 1) < 0.5) for (let k = 0; k < 3; k++) S(-0.6 + k * 0.5 + 0.2 * hash(id, 80 + k, 1), (hash(id, 90 + k, 1) - 0.5) * 0.5, bz + 0.25, 0.25, 0.2, 0.18, k % 2 ? C(236, 228, 214) : coat.map(v => v * 0.5)); }
        if (kind === 'horse') { S(1.12, 0, hz + 0.1, 0.12, 0.05, 0.05, dark); S(-1.15, 0, 0.85, 0.1, 0.07, 0.38, dark); }
        if (kind === 'donkey') { S(0, 0, bz + 0.33, 0.85, 0.035, 0.02, dark); S(-0.1, 0, bz + 0.3, 0.035, 0.32, 0.02, dark); }
      }
      return;
    }
    if (kind === 'dog' || kind === 'cat') {
      const s = kind === 'cat' ? 0.55 : 1, S = (fw, a, z, rx, ry, rz, c, t) => E(fw * s, a * s, z * s, rx * s, ry * s, rz * s, c, t);
      if (lie) { S(0, 0, 0.14, 0.32, 0.2, 0.14, coat); S(0.22, 0.14, 0.14, 0.12, 0.09, 0.08, coat); S(-0.1, -0.2, 0.08, 0.2, 0.05, 0.04, coat, -1); return; }
      if (sit) { S(-0.1, 0, 0.32, 0.22, 0.14, 0.22, coat); S(0.12, 0, 0.6, 0.13, 0.085, 0.09, coat); S(0.02, 0, 0.22, 0.12, 0.1, 0.22, coat); S(-0.3, 0, 0.06, 0.2, 0.04, 0.04, coat); return; }
      S(0, 0, 0.44, 0.36, 0.14, 0.15, coat); S(0.42, 0, 0.56, 0.14, 0.08, 0.09, coat); S(0.55, 0, 0.53, 0.06, 0.04, 0.04, dark);
      if (!lod) { legs(0.24, 0.08, 0.36, 0.035, coat, 0.15); S(-0.45, 0, 0.55, 0.18, 0.03, 0.03, coat, 0); }
      if (fine) {
        // pricked ears (a cat's sharper), the nose's tip, the eyes; a working dog's red collar
        for (const sg of [-1, 1]) { S(0.36, sg * 0.06, 0.65, 0.035, 0.03, kind === 'cat' ? 0.06 : 0.045, coat.map(v => v * 0.85), sg * 0.3); S(0.5, sg * 0.04, 0.6, 0.015, 0.015, 0.015, C(26, 22, 18)); }
        S(0.6, 0, 0.53, 0.02, 0.02, 0.02, C(20, 16, 14));
        if (f.master || f.farm) S(0.3, 0, 0.55, 0.03, 0.09, 0.07, C(160, 40, 34));
      }
      return;
    }
    if (kind === 'lion' || kind === 'bear' || kind === 'elephant' || kind === 'ostrich') return wildBodies(f, E, lod, fine);
    if (kind === 'pig') {
      // a long round body on short legs, the head low, a flat snout, ears
      // flopped forward, a curl of a tail; caked with mud after a wallow
      const mud = C(92, 72, 50), m = Math.min(1, f.muddy || 0), col = coat.map((v, i) => lerp(v, mud[i], 0.75 * m)), low = coat.map((v, i) => lerp(v, mud[i], Math.min(1, 0.4 + m)));
      if (lie) {
        E(0, 0, 0.24, 0.55, 0.3, 0.22, col); E(0.52, 0.04, 0.2, 0.2, 0.17, 0.16, col); E(0.7, 0.04, 0.18, 0.06, 0.07, 0.06, low);
        if (!lod) for (const sg of [-1, 1]) E(0.45, sg * 0.12 + 0.04, 0.32, 0.09, 0.06, 0.03, col, sg * 0.4);
        return;
      }
      const hz = graze ? 0.2 : 0.36, hf = graze ? 0.66 : 0.6;
      E(0, 0, 0.42, 0.56, 0.27, 0.26, col); E(0, 0, 0.26, 0.5, 0.22, 0.14, low);
      E(hf, 0, hz, 0.2, 0.16, 0.16, col); E(hf + 0.19, 0, hz - 0.03, 0.05, 0.08, 0.07, low.map(v => v * 0.9));
      if (lod) return;
      for (const sg of [-1, 1]) E(hf - 0.02, sg * 0.1, hz + 0.13, 0.09, 0.06, 0.03, col, sg * 0.5);
      legs(0.3, 0.13, 0.22, 0.05, low, 0.1);
      if (fine) {
        // the snout's two nostrils, the eyes, the trotters dark
        for (const sg of [-1, 1]) { E(hf + 0.24, sg * 0.03, hz - 0.03, 0.01, 0.015, 0.015, C(60, 36, 34)); E(hf + 0.1, sg * 0.08, hz + 0.05, 0.012, 0.012, 0.012, C(26, 20, 18)); }
        for (const [fx, sg] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) E(fx * 0.3, sg * 0.13, 0.03, 0.05, 0.045, 0.03, C(70, 54, 46));
      }
      E(-0.58, 0, 0.5, 0.06, 0.04, 0.04, col); E(-0.62, 0.03, 0.54, 0.03, 0.03, 0.03, col);
      return;
    }
    if (kind === 'hen') {
      const peck = graze && Math.sin(ph * T * 2.3) > 0.3;
      E(0, 0, 0.22, 0.15, 0.1, 0.11, coat); E(-0.13, 0, 0.3, 0.07, 0.05, 0.08, coat.map(v => v * 0.8));
      E(peck ? 0.19 : 0.13, 0, peck ? 0.08 : 0.33, 0.05, 0.04, 0.045, coat); E(peck ? 0.2 : 0.14, 0, peck ? 0.11 : 0.37, 0.03, 0.01, 0.02, C(190, 40, 30));
      if (fine) {
        // the wings folded, the tail's feathers up, the beak, the wattle
        for (const sg of [-1, 1]) E(-0.02, sg * 0.09, 0.24, 0.1, 0.03, 0.06, coat.map(v => v * 0.85));
        E(-0.18, 0, 0.36, 0.05, 0.03, 0.09, coat.map(v => v * 0.6), 0);
        E(peck ? 0.24 : 0.18, 0, peck ? 0.06 : 0.32, 0.025, 0.012, 0.012, C(210, 170, 70)); E(peck ? 0.21 : 0.15, 0, peck ? 0.03 : 0.29, 0.015, 0.01, 0.025, C(190, 40, 30));
      }
      if (!lod) for (const sg of [-1, 1]) E(0, sg * 0.04, 0.06, 0.015, 0.015, 0.06, C(200, 160, 60));
      return;
    }
  }

  function create(canvas, town, { seed = 1 } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This painting needs WebGL2.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This painting needs float render targets (EXT_color_buffer_float).');
    const W = town.W, H = town.H, T = town.terrain, TA = town.town.angle, iseed = seed % 100000;
    // the wind's way, the same all over, and its strength
    const wa = hash(seed, 1, 99) * Math.PI * 2, ws = 0.6 + 0.6 * hash(seed, 2, 99), wind = [Math.cos(wa) * ws, Math.sin(wa) * ws];
    let time = 0;
    const setWind = (pr) => { gl.uniform2f(pr.loc.uWind, wind[0], wind[1]); gl.uniform1f(pr.loc.uTime, time); };
    let zmin = Infinity, zmax = -Infinity;
    for (const v of T.z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    const zlo = zmin - 20, zhi = zmax + 80;

    // ---- programs ----
    function program(vs, fs) {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, HEAD + vs], [gl.FRAGMENT_SHADER, HEAD + fs]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const loc = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); loc[name] = gl.getUniformLocation(p, name); }
      return { p, loc };
    }
    const P = {
      ground: program(GROUND_VS, GROUND_FS), solid: program(SOLID_VS, SOLID_FS), body: program(BODY_VS, BODY_FS),
      depth: program(DEPTH_VS, EMPTY_FS), bodyDepth: program(BODY_VS, EMPTY_FS),
      light: program(QUAD_VS, LIGHT_FS), down: program(QUAD_VS, DOWN_FS), blur: program(QUAD_VS, BLUR_FS),
    };

    // ---- the ground's heights and slopes, a texture ----
    const terTex = gl.createTexture();
    {
      const d = new Float32Array(T.nx * T.ny * 4);
      const zz = (a, b) => T.z[clamp(b, 0, T.ny - 1) * T.nx + clamp(a, 0, T.nx - 1)];
      for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
        const k = 4 * (j * T.nx + i);
        d[k] = zz(i, j); d[k + 1] = (zz(i + 1, j) - zz(i - 1, j)) / (2 * T.cell); d[k + 2] = (zz(i, j + 1) - zz(i, j - 1)) / (2 * T.cell);
      }
      gl.bindTexture(gl.TEXTURE_2D, terTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, T.nx, T.ny, 0, gl.RGBA, gl.FLOAT, d);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    }

    // ---- how much grass is left on each pasture, as the life says (all of it, till it does) ----
    const grassTex = gl.createTexture(), grassN = Math.max(1, town.fields.length);
    let grassV = -1;
    gl.bindTexture(gl.TEXTURE_2D, grassTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, grassN, 1, 0, gl.RED, gl.FLOAT, new Float32Array(grassN).fill(0.8));
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);

    // ---- the ground's patches: x, y, what, angle, across, level, tint ----
    const GV = [];
    const gvert = (x, y, m, a = 0, t = 0, lev = 0, tint = 0) => GV.push(x, y, m, a, t, lev, tint);
    function gpoly(pts, m, a = 0, tint = 0, lev = 0) {
      for (let i = 1; i + 1 < pts.length; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) gvert(q[0], q[1], m, a, 0, lev, tint);
    }
    // a line of a width: a strip, across it −1…1, mitred where it bends; a
    // river's way downstream at each point too
    function gline(pts, half, m, levels = null, ways = null) {
      const n = pts.length, side = [];
      for (let q = 0; q < n; q++) {
        const a = pts[Math.max(0, q - 1)], b = pts[Math.min(n - 1, q + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        let nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        // as wide across the bend as along the straight
        if (q > 0 && q < n - 1) {
          const p0 = pts[q - 1], p1 = pts[q], l0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
          const c = Math.max(0.5, nx * -(p1[1] - p0[1]) / l0 + ny * (p1[0] - p0[0]) / l0);
          nx /= c; ny /= c;
        }
        side.push([nx * half, ny * half]);
      }
      for (let q = 0; q + 1 < n; q++) {
        const [ax, ay] = pts[q], [bx, by] = pts[q + 1], [anx, any] = side[q], [bnx, bny] = side[q + 1];
        const la = levels ? levels[q] : 0, lb = levels ? levels[q + 1] : 0, wa = ways ? ways[q] : 0, wb = ways ? ways[q + 1] : 0;
        const A1 = [ax + anx, ay + any, 1, la, wa], A2 = [ax - anx, ay - any, -1, la, wa], B1 = [bx + bnx, by + bny, 1, lb, wb], B2 = [bx - bnx, by - bny, -1, lb, wb];
        for (const v of [A1, B1, B2, A1, B2, A2]) gvert(v[0], v[1], m, v[4], v[2], v[3]);
      }
    }
    gpoly([[0, 0], [W, 0], [W, H], [0, H]], GROUND.natural);
    // (a pasture its number, for how much grass is left on it)
    town.fields.forEach((f, i) => gpoly(f.poly, GROUND[f.crop] ?? GROUND.meadow, f.angle, hash(Math.round(f.poly[0][0] * 7), Math.round(f.poly[0][1] * 7), seed), f.crop === 'pasture' ? i + 0.5 : 0));
    for (const kind of ['track', 'via']) for (const r of town.roads) if (r.kind === kind) gline(r.points, r.width / 2, GROUND[kind]);
    if (town.river) {
      const R = town.river;
      gline(R.points, R.width / 2, GROUND.bank);
      // (which way it runs: downhill; the angle carried on round the bends, not
      // jumping a turn, so it can be blended between the points)
      const RP = R.points, down = R.level[0] >= R.level[RP.length - 1] ? 0 : Math.PI, ways = [];
      for (let q = 0; q < RP.length; q++) {
        const a = RP[Math.max(0, q - 1)], b = RP[Math.min(RP.length - 1, q + 1)];
        let w = Math.atan2(b[1] - a[1], b[0] - a[0]) + down;
        if (q) w = ways[q - 1] + Math.atan2(Math.sin(w - ways[q - 1]), Math.cos(w - ways[q - 1]));
        ways.push(w);
      }
      gline(RP, R.width / 2 - 0.6, GROUND.river, R.level, ways);
    }
    // (the grass trodden about a wallow the same green as its pasture, how bare it is for its angle)
    const tintOf = g => { const [x, y] = g.poly[0], f = town.fields.find(f => f.mud && Math.hypot(f.mud.x - x, f.mud.y - y) < 15); return f ? hash(Math.round(f.poly[0][0] * 7), Math.round(f.poly[0][1] * 7), seed) : 0; };
    for (const g of town.grounds) gpoly(g.poly, GROUND[g.kind] ?? GROUND.yard, g.kind === 'trodden' ? g.bare : g.angle || 0, g.kind === 'trodden' ? tintOf(g) : 0);
    const groundVAO = gl.createVertexArray(), groundN = GV.length / 7;
    gl.bindVertexArray(groundVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(GV), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

    // ---- the solids: x, y, z, normal, what, two tints ----
    const SV = [];
    let mat = [0, 0, 0, 0];
    const svert = (p, n) => SV.push(p[0], p[1], p[2], n[0], n[1], n[2], mat[0], mat[1], mat[2], mat[3]);
    // a flat convex polygon, its normal from all its corners (Newell's), so
    // a corner repeated does no harm
    function face(pts) {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]);
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      const sg = nz < 0 ? -1 / l : 1 / l, n = [nx * sg, ny * sg, nz * sg];
      for (let i = 1; i + 1 < pts.length; i++) { svert(pts[0], n); svert(pts[i], n); svert(pts[i + 1], n); }
    }
    const tri3 = (a, b, c, na, nb, nc) => { svert(a, na); svert(b, nb); svert(c, nc); };
    // the walls under a line of points [x, y, ztop], down into the ground
    function walls(pts, zb, closed = true) {
      for (let i = 0; i + (closed ? 0 : 1) < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        face([[a[0], a[1], zb], [b[0], b[1], zb], [b[0], b[1], b[2]], [a[0], a[1], a[2]]]);
      }
    }
    const matOf = b => b.use === 'steps' ? SOLID.steps : b.use === 'wall' || b.use === 'gate' ? SOLID.wall : SOLID[b.mat] ?? SOLID.stone;
    const tints = b => [hash(Math.round(b.x * 10), Math.round(b.y * 10), seed + 21), hash(Math.round(b.x * 3), Math.round(b.y * 3), seed + 22)];
    function box(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), hw = b.w / 2, hd = b.d / 2, Wd = b.w, D = b.d, k = b.pitch || 0;
      const Q = (a, c, z) => [b.x + (a - hw) * ca - (c - hd) * sa, b.y + (a - hw) * sa + (c - hd) * ca, z];
      const zt = b.z0 + b.h, zb = b.z0 - 3;
      const rect = z => [Q(0, 0, z), Q(Wd, 0, z), Q(Wd, D, z), Q(0, D, z)];
      switch (k > 0 || b.roof === 'court' ? b.roof : 'flat') {
        case 'hip': {
          if (Wd >= D) {
            const r = D / 2, zr = zt + k * r;
            face([Q(0, 0, zt), Q(Wd, 0, zt), Q(Wd - r, r, zr), Q(r, r, zr)]);
            face([Q(0, D, zt), Q(r, r, zr), Q(Wd - r, r, zr), Q(Wd, D, zt)]);
            face([Q(0, 0, zt), Q(r, r, zr), Q(0, D, zt)]);
            face([Q(Wd, 0, zt), Q(Wd, D, zt), Q(Wd - r, r, zr)]);
          } else {
            const r = Wd / 2, zr = zt + k * r;
            face([Q(0, 0, zt), Q(0, D, zt), Q(r, D - r, zr), Q(r, r, zr)]);
            face([Q(Wd, 0, zt), Q(r, r, zr), Q(r, D - r, zr), Q(Wd, D, zt)]);
            face([Q(0, 0, zt), Q(r, r, zr), Q(Wd, 0, zt)]);
            face([Q(0, D, zt), Q(Wd, D, zt), Q(r, D - r, zr)]);
          }
          walls(rect(zt), zb);
          break;
        }
        case 'gable': {
          if (b.axis === 'w') {
            const zr = zt + k * D / 2;
            face([Q(0, 0, zt), Q(Wd, 0, zt), Q(Wd, D / 2, zr), Q(0, D / 2, zr)]);
            face([Q(0, D, zt), Q(0, D / 2, zr), Q(Wd, D / 2, zr), Q(Wd, D, zt)]);
            face([Q(0, 0, zt), Q(0, D, zt), Q(0, D / 2, zr)]);
            face([Q(Wd, 0, zt), Q(Wd, D, zt), Q(Wd, D / 2, zr)]);
          } else {
            const zr = zt + k * Wd / 2;
            face([Q(0, 0, zt), Q(0, D, zt), Q(Wd / 2, D, zr), Q(Wd / 2, 0, zr)]);
            face([Q(Wd, 0, zt), Q(Wd / 2, 0, zr), Q(Wd / 2, D, zr), Q(Wd, D, zt)]);
            face([Q(0, 0, zt), Q(Wd, 0, zt), Q(Wd / 2, 0, zr)]);
            face([Q(0, D, zt), Q(Wd, D, zt), Q(Wd / 2, D, zr)]);
          }
          walls(rect(zt), zb);
          break;
        }
        case 'shed': {
          const zA = { '+w': [zt + k * Wd, zt, zt, zt + k * Wd], '-w': [zt, zt + k * Wd, zt + k * Wd, zt], '+d': [zt + k * D, zt + k * D, zt, zt], '-d': [zt, zt, zt + k * D, zt + k * D] }[b.low] || [zt, zt, zt, zt];
          const top = [Q(0, 0, zA[0]), Q(Wd, 0, zA[1]), Q(Wd, D, zA[2]), Q(0, D, zA[3])];
          face(top);
          walls(top, zb);
          break;
        }
        case 'court': {
          const [s1, t1, s2, t2] = b.hole, zo = zt + k * Math.max(0, Math.min(t1, Wd - s2, D - t2, s1));
          face([Q(0, 0, zo), Q(Wd, 0, zo), Q(s2, t1, zt), Q(s1, t1, zt)]);
          face([Q(Wd, 0, zo), Q(Wd, D, zo), Q(s2, t2, zt), Q(s2, t1, zt)]);
          face([Q(Wd, D, zo), Q(0, D, zo), Q(s1, t2, zt), Q(s2, t2, zt)]);
          face([Q(0, D, zo), Q(0, 0, zo), Q(s1, t1, zt), Q(s1, t2, zt)]);
          walls(rect(zo), zb);
          walls([Q(s1, t1, zt), Q(s2, t1, zt), Q(s2, t2, zt), Q(s1, t2, zt)], zb);
          break;
        }
        default: {
          face(rect(zt));
          walls(rect(zt), zb);
          // a wall's walk between its parapets
          if (b.use === 'wall' && D > 1.6) {
            for (const [c1, c2] of [[0, 0.5], [D - 0.5, D]]) {
              const pr = [Q(0, c1, zt + 1.2), Q(Wd, c1, zt + 1.2), Q(Wd, c2, zt + 1.2), Q(0, c2, zt + 1.2)];
              face(pr);
              walls(pr, zt);
            }
          }
        }
      }
    }
    function round(b) {
      const n = clamp(Math.round(b.r * 7), 12, 64), zt = b.z0 + b.h, zb = b.z0 - 3, r = b.r, k = b.pitch || 0;
      const at = (i, rr, z) => { const a = i / n * Math.PI * 2; return [b.x + rr * Math.cos(a), b.y + rr * Math.sin(a), z]; };
      const rim = [];
      for (let i = 0; i < n; i++) rim.push(at(i, r, zt));
      walls(rim, zb);
      if (b.hole) {
        const inner = [];
        for (let i = 0; i < n; i++) { inner.push(at(i, b.hole, zt)); face([at(i, b.hole, zt), at(i, r, zt), at(i + 1, r, zt), at(i + 1, b.hole, zt)]); }
        walls(inner, zb);
      } else if (b.roof === 'cone' && k > 0) {
        const apex = [b.x, b.y, zt + k * r], l = Math.hypot(k, 1);
        const nn = j => { const a = j / n * Math.PI * 2; return [k * Math.cos(a) / l, k * Math.sin(a) / l, 1 / l]; };
        for (let i = 0; i < n; i++) tri3(at(i, r, zt), at(i + 1, r, zt), apex, nn(i), nn(i + 1), nn(i + 0.5));
      } else if (b.roof === 'dome' && k > 0) {
        const c = r * k, rings = 8;
        const pt = (i, j) => at(i, r * Math.cos(j / rings * Math.PI / 2), zt + c * Math.sin(j / rings * Math.PI / 2));
        const nn = (i, j) => {
          const q = Math.cos(j / rings * Math.PI / 2), a = i / n * Math.PI * 2;
          const v = [Math.cos(a) * q / r, Math.sin(a) * q / r, Math.sin(j / rings * Math.PI / 2) / c], l = Math.hypot(...v);
          return v.map(x => x / l);
        };
        for (let j = 0; j < rings; j++) for (let i = 0; i < n; i++) {
          tri3(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), nn(i, j), nn(i + 1, j), nn(i + 1, j + 1));
          tri3(pt(i, j), pt(i + 1, j + 1), pt(i, j + 1), nn(i, j), nn(i + 1, j + 1), nn(i, j + 1));
        }
      } else face(rim);
    }
    // a theatre's seats: steps rising in a half ring about the orchestra
    function cavea(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), steps = Math.round((b.r1 - b.r0) / 0.8), rise = b.h / steps, n = 48;
      const at = (i, r, z) => { const a = -Math.PI / 2 + i / n * Math.PI, x = r * Math.cos(a), y = r * Math.sin(a); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca, z]; };
      mat = [SOLID.paving, 0, 0, 0];
      for (let i = 0; i < n; i++) face([[b.x, b.y, b.z0 + 0.05], at(i, b.r0, b.z0 + 0.05), at(i + 1, b.r0, b.z0 + 0.05)]);
      mat = [SOLID.stone, 0.5, 0, 0];
      for (let s = 0; s < steps; s++) {
        const r1 = b.r0 + s * 0.8, r2 = r1 + 0.8, z = b.z0 + 1 + s * rise, ring = [];
        // each step's seat, its worn front edge darker
        mat = [SOLID.stone, 0.5, 0, 0];
        for (let i = 0; i < n; i++) face([at(i, r1 + 0.14, z), at(i, r2, z), at(i + 1, r2, z), at(i + 1, r1 + 0.14, z)]);
        mat = [SOLID.stone, -1.2, 0, 0];
        for (let i = 0; i < n; i++) face([at(i, r1, z), at(i, r1 + 0.14, z), at(i + 1, r1 + 0.14, z), at(i + 1, r1, z)]);
        mat = [SOLID.stone, 0.5, 0, 0];
        for (let i = 0; i <= n; i++) ring.push(at(i, r1, z));
        walls(ring, b.z0 - 1, false);
      }
      const zt = b.z0 + 1 + b.h + 3, outer = [];
      for (let i = 0; i < n; i++) face([at(i, b.r1, zt), at(i, b.r1 + 2.5, zt), at(i + 1, b.r1 + 2.5, zt), at(i + 1, b.r1, zt)]);
      for (let i = 0; i <= n; i++) outer.push(at(i, b.r1 + 2.5, zt));
      walls(outer, b.z0 - 1, false);
    }
    // an amphitheatre: the arena of sand, the seats rising round it, the gates through
    function arena(b) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), n = 96, r0 = b.a0 / b.a, steps = Math.round((b.a - b.a0) / 0.8), ro = 1 + 3 / b.a;
      const loc = (i, rho) => { const a = i / n * Math.PI * 2; return [rho * b.a * Math.cos(a), rho * b.b * Math.sin(a)]; };
      const at = (i, rho, z) => { const [x, y] = loc(i, rho); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca, z]; };
      const gate = (i, rho) => { const [x, y] = loc(i + 0.5, rho); return Math.abs(y) < 2.2 || Math.abs(x) < 2.2; };
      mat = [SOLID.sand, 0, 0, 0];
      for (let i = 0; i < n; i++) face([[b.x, b.y, b.z0], at(i, r0, b.z0), at(i + 1, r0, b.z0)]);
      for (let s = 0; s <= steps; s++) {
        const rA = r0 + (1 - r0) * s / steps, rB = s === steps ? ro : r0 + (1 - r0) * (s + 1) / steps;
        const z = s === steps ? b.z0 + 3.5 + b.h + 3 : b.z0 + 3.5 + s * b.h / steps;
        for (let i = 0; i < n; i++) {
          if (gate(i, (rA + rB) / 2)) { mat = [SOLID.passage, 0, 0, 0]; face([at(i, rA, b.z0 + 0.02), at(i, rB, b.z0 + 0.02), at(i + 1, rB, b.z0 + 0.02), at(i + 1, rA, b.z0 + 0.02)]); continue; }
          const lip = s < steps ? rA + (rB - rA) * 0.18 : rA;
          mat = [SOLID.stone, -1.2, 0, 0];
          if (lip > rA) face([at(i, rA, z), at(i, lip, z), at(i + 1, lip, z), at(i + 1, rA, z)]);
          mat = [SOLID.stone, 0.5, 0, 0];
          face([at(i, lip, z), at(i, rB, z), at(i + 1, rB, z), at(i + 1, lip, z)]);
          face([at(i, rA, b.z0 - 1), at(i + 1, rA, b.z0 - 1), at(i + 1, rA, z), at(i, rA, z)]);
          if (s === steps) face([at(i, rB, b.z0 - 1), at(i + 1, rB, b.z0 - 1), at(i + 1, rB, z), at(i, rB, z)]);
        }
      }
    }
    // a building cut through as a plan is, a little above the floor: its
    // floors, the stumps of its walls, its columns
    const CUT = 2.4;
    function cutaway(b, t1, t2) {
      const I = b.interior, ca = Math.cos(b.angle), sa = Math.sin(b.angle), hw = b.w / 2, hd = b.d / 2;
      const Q = (a, c, z) => [b.x + (a - hw) * ca - (c - hd) * sa, b.y + (a - hw) * sa + (c - hd) * ca, z];
      const zf = b.z0 + 0.08, zw = b.z0 + Math.min(CUT, b.h);
      for (const [a1, c1, a2, c2, kind] of I.floors) {
        mat = [SOLID[kind] ?? SOLID.paving, t1, t2, 0];
        const z = kind === 'pool' ? zf + 0.02 : zf;
        face([Q(a1, c1, z), Q(a2, c1, z), Q(a2, c2, z), Q(a1, c2, z)]);
      }
      mat = [SOLID.plaster, t1, t2, 0];
      const T = 0.25;
      for (const [a1, c1, a2, c2] of I.walls) {
        const x1 = Math.min(a1, a2) - T, x2 = Math.max(a1, a2) + T, y1 = Math.min(c1, c2) - T, y2 = Math.max(c1, c2) + T;
        const top = [Q(x1, y1, zw), Q(x2, y1, zw), Q(x2, y2, zw), Q(x1, y2, zw)];
        face(top);
        walls(top, b.z0 - 3);
      }
      // a block, from z1 to z2 above the floor
      const block = (a1, c1, a2, c2, z1, z2, m, u1 = t1, u2 = t2, w = 0) => {
        mat = [m, u1, u2, w];
        const top = [Q(a1, c1, b.z0 + z2), Q(a2, c1, b.z0 + z2), Q(a2, c2, b.z0 + z2), Q(a1, c2, b.z0 + z2)];
        face(top);
        walls(top, b.z0 + z1);
      };
      const disc = (a, c, r, z1, z2, m, n = 10) => {
        mat = [m, t1, t2, 0];
        const ring = [];
        for (let k = 0; k < n; k++) { const an = k / n * Math.PI * 2; ring.push(Q(a + r * Math.cos(an), c + r * Math.sin(an), b.z0 + z2)); }
        face(ring);
        walls(ring, b.z0 + z1);
      };
      // which way a piece against a wall faces, into the room
      const facing = f => { const a = { 0: Math.PI / 2, 2: -Math.PI / 2, 1: Math.PI, 3: 0 }[f.side] ?? 0; return [Math.cos(a), Math.sin(a)]; };
      // windows: the wall below them left, to the sill, a lattice across
      for (const [a1, c1, a2, c2] of I.windows || []) {
        block(Math.min(a1, a2) - T, Math.min(c1, c2) - T, Math.max(a1, a2) + T, Math.max(c1, c2) + T, -3, 1.0, SOLID.plaster);
        const h = Math.abs(a2 - a1) > Math.abs(c2 - c1);
        const mx = (a1 + a2) / 2, my = (c1 + c2) / 2, L = Math.max(Math.abs(a2 - a1), Math.abs(c2 - c1)) / 2;
        block(h ? mx - L : mx - 0.03, h ? my - 0.03 : my - L, h ? mx + L : mx + 0.03, h ? my + 0.03 : my + L, 1.0, 1.7, SOLID.timber);
        for (let k = -1; k <= 1; k++) {
          const o = k * L * 0.5;
          block(h ? mx + o - 0.025 : mx - T, h ? my - T : my + o - 0.025, h ? mx + o + 0.025 : mx + T, h ? my + T : my + o + 0.025, 1.0, 1.72, SOLID.timber);
        }
      }
      // (the doors are drawn apart, each moment, swinging as people go through)
      // furniture
      for (const f of I.furniture || []) {
        const a1 = f.a - (f.w || 0) / 2, c1 = f.c - (f.d || 0) / 2, a2 = f.a + (f.w || 0) / 2, c2 = f.c + (f.d || 0) / 2;
        const longW = (f.w || 0) >= (f.d || 0), e = 0.07;
        switch (f.k) {
          case 'bed': case 'couch': {
            // a wooden frame, a woollen cover over it, a pillow at the head
            const g = 0.1;
            block(a1, c1, a2, c2, 0, 0.42, SOLID.timber);
            block(a1 + g, c1 + g, a2 - g, c2 - g, 0.42, 0.58, SOLID.cushion);
            const p = 0.42;
            if (longW) block(a2 - g - p, c1 + g * 1.5, a2 - g - 0.05, c2 - g * 1.5, 0.58, 0.7, SOLID.fabric);
            else block(a1 + g * 1.5, c2 - g - p, a2 - g * 1.5, c2 - g - 0.05, 0.58, 0.7, SOLID.fabric);
            break;
          }
          case 'table': if (f.round) disc(f.a, f.c, f.w / 2, 0, 0.72, SOLID.timber, 14); else block(a1, c1, a2, c2, 0, 0.75, SOLID.timber); break;
          case 'bench': case 'stall': block(a1, c1, a2, c2, 0, f.k === 'bench' ? 0.45 : 0.85, SOLID.timber); break;
          case 'chest': block(a1, c1, a2, c2, 0, 0.6, SOLID.timber); block(a1 - 0.01, (c1 + c2) / 2 - 0.04, a2 + 0.01, (c1 + c2) / 2 + 0.04, 0, 0.61, SOLID.dark); break;
          case 'hearth': block(a1, c1, a2, c2, 0, 0.5, SOLID.stone); block(a1 + 0.12, c1 + 0.12, a2 - 0.12, c2 - 0.12, 0.5, 0.52, SOLID.dark); break;
          case 'counter': {
            block(a1, c1, a2, c2, 0, 0.95, SOLID.plaster);
            const L = longW ? a2 - a1 : c2 - c1, along = t => longW ? [a1 + (a2 - a1) * t, f.c] : [f.a, c1 + (c2 - c1) * t];
            if (f.bread) {
              // the day's loaves, in a row or two
              for (let k = 0, n = Math.max(2, Math.floor(L / 0.26)); k < n; k++) for (const o of [-0.14, 0.14]) {
                const [a, c] = along((k + 0.5) / n);
                mat = [SOLID.bread, t1, hash(k, o > 0 ? 1 : 2, seed), 0];
                disc(a + (longW ? 0 : o), c + (longW ? o : 0), 0.11, 0.95, 1.02, SOLID.bread, 10);
              }
            } else if (f.produce) {
              // baskets set out on it
              for (let k = 0, n = Math.max(1, Math.floor(L / 0.6)); k < n; k++) {
                const [a, c] = along((k + 0.5) / n);
                disc(a, c, 0.24, 0.95, 1.2, SOLID.wicker, 12);
                mat = [SOLID.produce, t1, hash(k, Math.round(a * 10), seed + 36), 0];
                disc(a, c, 0.2, 1.2, 1.24, SOLID.produce, 12);
              }
            } else for (let k = 0, n = f.jars || 2; k < n; k++) {
              const [a, c] = along((k + 0.5) / n);
              disc(a, c, 0.22, 0.95, 0.965, SOLID.dark, 12);
            }
            break;
          }
          // ---- a shop's trade: what its work is done at ----
          case 'oven': {
            // a stone base, the dome on it, its mouth to the room, embers in it
            const r = Math.min(f.w, f.d) / 2, [ux, uy] = facing(f);
            block(a1, c1, a2, c2, 0, 0.75, SOLID.stone);
            for (let k = 0; k < 4; k++) disc(f.a - ux * 0.05, f.c - uy * 0.05, r * 0.92 * Math.cos(k * 0.38), 0.75 + k * 0.16, 0.91 + k * 0.16, SOLID.plaster, 14);
            const mx = f.a + ux * r * 0.78, mc = f.c + uy * r * 0.78;
            block(mx - 0.24, mc - 0.24, mx + 0.24, mc + 0.24, 0.75, 1.12, SOLID.dark);
            disc(f.a + ux * r * 0.5, f.c + uy * r * 0.5, 0.2, 0.75, 0.78, SOLID.embers, 8);
            break;
          }
          case 'mill': {
            // the lava mill: the cone below, the hourglass turned on it, a bar through to push
            disc(f.a, f.c, 0.5, 0, 0.45, SOLID.stone, 14);
            disc(f.a, f.c, 0.44, 0.45, 0.72, SOLID.dark, 14); disc(f.a, f.c, 0.3, 0.72, 0.86, SOLID.dark, 12); disc(f.a, f.c, 0.44, 0.86, 1.15, SOLID.dark, 14);
            block(f.a - 0.95, f.c - 0.05, f.a + 0.95, f.c + 0.05, 0.74, 0.84, SOLID.timber);
            break;
          }
          case 'forge': {
            const [ux, uy] = facing(f);
            block(a1, c1, a2, c2, 0, 0.85, SOLID.stone);
            block(a1 + 0.15, c1 + 0.15, a2 - 0.15, c2 - 0.15, 0.85, 0.88, SOLID.embers);
            // the bellows to one side of it
            const bx = f.a - uy * (Math.max(f.w, f.d) / 2 - 0.2) - ux * 0.1, bc = f.c + ux * (Math.max(f.w, f.d) / 2 - 0.2) - uy * 0.1;
            block(bx - 0.17, bc - 0.17, bx + 0.17, bc + 0.17, 0.85, 1.0, SOLID.dark);
            break;
          }
          case 'anvil': disc(f.a, f.c, 0.22, 0, 0.5, SOLID.timber, 10); block(a1, c1, a2, c2, 0.5, 0.72, SOLID.iron); break;
          case 'vat': {
            const r = Math.min(f.w, f.d) / 2;
            disc(f.a, f.c, r, 0, 0.7, SOLID.plaster, 16); disc(f.a, f.c, r - 0.09, 0.7, 0.705, SOLID.liquor, 14);
            break;
          }
          case 'kiln': {
            const r = Math.min(f.w, f.d) / 2, [ux, uy] = facing(f);
            disc(f.a, f.c, r, 0, 1.1, SOLID.terracotta, 16); disc(f.a, f.c, r * 0.62, 1.1, 1.3, SOLID.terracotta, 12); disc(f.a, f.c, r * 0.3, 1.3, 1.32, SOLID.dark, 10);
            const mx = f.a + ux * r * 0.85, mc = f.c + uy * r * 0.85;
            block(mx - 0.22, mc - 0.22, mx + 0.22, mc + 0.22, 0, 0.5, SOLID.dark);
            disc(mx, mc, 0.14, 0.02, 0.06, SOLID.embers, 8);
            break;
          }
          case 'wheel': {
            // the kick-wheel below, the shaft, the head, a pot on it
            disc(f.a, f.c, 0.33, 0, 0.1, SOLID.timber, 14); disc(f.a, f.c, 0.05, 0.1, 0.68, SOLID.timber, 6);
            disc(f.a, f.c, 0.19, 0.68, 0.72, SOLID.timber, 12); disc(f.a, f.c, 0.1, 0.72, 0.86, SOLID.terracotta, 10);
            break;
          }
          case 'block': disc(f.a, f.c, Math.min(f.w, f.d) / 2, 0, 0.8, SOLID.timber, 12); break;
          case 'loom': {
            // the warp-weighted loom against the wall: two uprights, the beam
            // across, the cloth hanging, the weights in a row at its foot
            const L = longW ? f.w : f.d, ax = longW ? 1 : 0, cx = 1 - ax, [ux, uy] = facing(f);
            for (const e of [-1, 1]) { const pa = f.a + ax * e * (L / 2 - 0.05), pc = f.c + cx * e * (L / 2 - 0.05); block(pa - 0.05, pc - 0.05, pa + 0.05, pc + 0.05, 0, 1.95, SOLID.timber); }
            block(f.a - ax * L / 2 - cx * 0.06, f.c - cx * L / 2 - ax * 0.06, f.a + ax * L / 2 + cx * 0.06, f.c + cx * L / 2 + ax * 0.06, 1.8, 1.92, SOLID.timber);
            const ca = f.a + ux * 0.04, cc = f.c + uy * 0.04;
            mat = [SOLID.cloth, t1, hash(Math.round(f.a * 10), Math.round(f.c * 10), seed + 39), longW ? 0 : 1];
            block(ca - ax * (L / 2 - 0.12) - cx * 0.02, cc - cx * (L / 2 - 0.12) - ax * 0.02, ca + ax * (L / 2 - 0.12) + cx * 0.02, cc + cx * (L / 2 - 0.12) + ax * 0.02, 0.45, 1.78, SOLID.cloth, t1, hash(Math.round(f.a * 10), Math.round(f.c * 10), seed + 39), longW ? 0 : 1);
            for (let k = 0, n = Math.floor(L / 0.16); k < n; k++) { const o = -L / 2 + 0.15 + k * (L - 0.3) / Math.max(1, n - 1); disc(ca + ux * 0.04 + ax * o, cc + uy * 0.04 + cx * o, 0.055, 0.2, 0.36, SOLID.terracotta, 6); }
            break;
          }
          case 'workbench': block(a1, c1, a2, c2, 0, 0.78, SOLID.timber); block(a1 + 0.2, c1 + 0.1, a1 + 0.6, c2 - 0.1, 0.78, 0.86, SOLID.logs, t1, t2, longW ? 1 : 0); break;
          case 'chair': disc(f.a, f.c, 0.24, 0, 0.47, SOLID.timber, 10); break;
          case 'latrine': {
            // a stone bench, a keyhole of a hole every two feet along it; in
            // the public one water running in a channel at its foot
            const [ux, uy] = facing(f), L = longW ? f.w : f.d, n = f.holes || 1, ax = longW ? 1 : 0, cx = 1 - ax;
            block(a1, c1, a2, c2, 0, 0.45, SOLID.marble);
            for (let k = 0; k < n; k++) {
              const o = -L / 2 + (k + 0.5) * L / n, a = f.a + ax * o - ux * 0.02, c = f.c + cx * o - uy * 0.02;
              disc(a, c, 0.11, 0.45, 0.455, SOLID.dark, 10);
              block(a + ux * 0.1 - cx * 0.035, c + uy * 0.1 - ax * 0.035, a + ux * 0.34 + cx * 0.035, c + uy * 0.34 + ax * 0.035, 0.45, 0.455, SOLID.dark);
            }
            if (n > 1) { const h = Math.abs(ux) > 0.5 ? f.w / 2 : f.d / 2, ga = f.a + ux * (h + 0.14), gc = f.c + uy * (h + 0.14); block(ga - ax * L / 2 - cx * 0.1, gc - cx * L / 2 - ax * 0.1, ga + ax * L / 2 + cx * 0.1, gc + cx * L / 2 + ax * 0.1, 0.06, 0.1, SOLID.liquor); }
            break;
          }
          case 'plinth': case 'tribunal': block(a1, c1, a2, c2, 0, f.k === 'plinth' ? 1.2 : 1.1, SOLID.marble); break;
          case 'statue': disc(f.a, f.c, f.r, 1.2, 3.0, SOLID.column, 12); break;
          case 'hay': {
            // a heap, rounded
            mat = [SOLID.hay, t1, t2, 0];
            const n = 14, rings = 4, rx = f.w / 2, ry = f.d / 2, hh = 1.3;
            for (let j = 0; j < rings; j++) for (let k = 0; k < n; k++) {
              const p = (jj, kk) => { const q = Math.cos(jj / rings * Math.PI / 2), an = kk / n * Math.PI * 2; return Q(f.a + rx * q * Math.cos(an), f.c + ry * q * Math.sin(an), b.z0 + hh * Math.sin(jj / rings * Math.PI / 2)); };
              face([p(j, k), p(j, k + 1), p(j + 1, k + 1), p(j + 1, k)]);
            }
            break;
          }
          case 'grain': {
            // a heap of grain, low and rounded, its slopes at rest
            mat = [SOLID.grain, t1, t2, 0];
            const n = 16, rings = 4, rx = f.w / 2, ry = f.d / 2, hh = Math.min(0.8, Math.min(rx, ry) * 0.5);
            for (let j = 0; j < rings; j++) for (let k = 0; k < n; k++) {
              const p = (jj, kk) => { const q = 1 - jj / rings, an = kk / n * Math.PI * 2; return Q(f.a + rx * q * Math.cos(an), f.c + ry * q * Math.sin(an), b.z0 + hh * (1 - q * q)); };
              face([p(j, k), p(j, k + 1), p(j + 1, k + 1), p(j + 1, k)]);
            }
            break;
          }
          case 'sacks': {
            // sacks lying side by side against the wall, some a second on top
            const n = Math.max(1, Math.round((longW ? f.w : f.d) / 0.55)), L = (longW ? f.w : f.d) / n;
            for (let k = 0; k < n; k++) {
              const lo = (longW ? a1 : c1) + k * L + 0.03, hi = lo + L - 0.06, two = hash(k, Math.round(f.a * 10), seed + 31) < 0.45;
              const tt = hash(k, Math.round(f.c * 10), seed + 33);
              if (longW) block(lo, c1, hi, c2, 0, 0.38, SOLID.sacking, tt, t2); else block(a1, lo, a2, hi, 0, 0.38, SOLID.sacking, tt, t2);
              if (two) { if (longW) block(lo + 0.06, c1 + 0.08, hi - 0.06, c2 - 0.1, 0.38, 0.72, SOLID.sacking, 1 - tt, t2); else block(a1 + 0.08, lo + 0.06, a2 - 0.1, hi - 0.06, 0.38, 0.72, SOLID.sacking, 1 - tt, t2); }
            }
            break;
          }
          case 'woodpile': block(a1, c1, a2, c2, 0, f.tall || 1.5, SOLID.logs, t1, t2, longW ? 0 : 1); break;
          case 'baskets': {
            // a row of baskets, each heaped with one thing
            const n = Math.max(1, Math.floor((longW ? f.w : f.d) / 0.62));
            for (let k = 0; k < n; k++) {
              const u = (longW ? a1 : c1) + (k + 0.5) * (longW ? f.w : f.d) / n, [ca, cc] = longW ? [u, f.c] : [f.a, u];
              disc(ca, cc, 0.28, 0, 0.42, SOLID.wicker, 12);
              mat = [SOLID.produce, t1, hash(k, Math.round(u * 10), seed + 35), 0];
              const ring = [];
              for (let q = 0; q < 12; q++) { const an = q / 12 * Math.PI * 2; ring.push(Q(ca + 0.24 * Math.cos(an), cc + 0.24 * Math.sin(an), b.z0 + 0.5)); }
              face(ring);
            }
            break;
          }
          case 'amphora': disc(f.a, f.c, f.r, 0, 0.72, SOLID.terracotta, 8); disc(f.a, f.c, f.r * 0.35, 0.72, 0.8, SOLID.terracotta, 6); break;
          case 'dolium': disc(f.a, f.c, f.r, 0, 0.75, SOLID.terracotta, 14); disc(f.a, f.c, f.r * 0.5, 0.75, 0.77, SOLID.dark, 12); break;
        }
      }
      mat = [SOLID.column, t1, t2, 0];
      for (const [a, c, r] of I.columns) {
        const [x, y] = Q(a, c, 0), n = 10, zc = b.z0 + Math.min(CUT, b.h) + 0.3, ring = [];
        for (let k = 0; k < n; k++) { const an = k / n * Math.PI * 2; ring.push([x + r * Math.cos(an), y + r * Math.sin(an), zc]); }
        face(ring);
        walls(ring, b.z0 - 1);
      }
    }
    // the solids, roofed or cut through, into a buffer
    function solids(cut) {
      SV.length = 0;
      for (const b of town.buildings) {
        const [t1, t2] = tints(b);
        mat = [matOf(b), t1, t2, 0];
        if (b.shape === 'box') {
          if (cut && b.interior) cutaway(b, t1, t2);
          else if (cut && b.use === 'gate' && b.passage) {
            // a gate cut through: its two piers, the passage between them open
            const pw = (b.w - b.passage) / 2, c = Math.cos(b.angle), sn = Math.sin(b.angle);
            for (const sg of [-1, 1]) { const o = sg * (b.passage / 2 + pw / 2); box({ ...b, x: b.x + c * o, y: b.y + sn * o, w: pw, h: Math.min(CUT, b.h) }); }
          } else box(b);
        }
        else if (b.shape === 'round') round(b);
        else if (b.shape === 'cavea') cavea(b);
        else if (b.shape === 'arena') arena(b);
      }
      // the fountains' spouts, bronze, pointing where the water falls
      mat = [SOLID.bronze, 0, 0, 0];
      for (const j of town.jets || []) {
        const a = Math.atan2(j.y - j.sy, j.x - j.sx), c = Math.cos(a), sn = Math.sin(a), zt = j.z + j.h + 0.08;
        const q = (u, v) => [j.sx + u * c - v * sn, j.sy + u * sn + v * c, zt];
        const top = [q(-0.12, -0.08), q(0.14, -0.08), q(0.14, 0.08), q(-0.12, 0.08)];
        face(top);
        walls(top, zt - 0.22);
      }
      const buf = gl.createBuffer(), n = SV.length / 10;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(SV), gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
      const dvao = gl.createVertexArray();
      gl.bindVertexArray(dvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      return { vao, dvao, n };
    }
    const ROOFED = solids(false), CUTAWAY = solids(true);
    // ---- the doors: each leaf on its hinge, standing as it was left, swung
    // open as someone comes to it, easing back once they have gone ----
    const DOORS = [];
    for (const b of town.buildings) for (const d of (b.interior && b.interior.doors) || []) {
      const [ha, hc, rest, wd, shut = rest] = d, ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const L = (a, c) => [b.x + (a - b.w / 2) * ca - (c - b.d / 2) * sa, b.y + (a - b.w / 2) * sa + (c - b.d / 2) * ca];
      const [mx, my] = L(ha + Math.cos(shut) * wd / 2, hc + Math.sin(shut) * wd / 2);
      const sg = Math.sign(Math.sin(rest - shut)) || 1;
      DOORS.push({ b, ha, hc, wd, rest, open: shut + sg * 1.5, cur: rest, mx, my, z: b.z0, t: tints(b), h: 2.1 });
    }
    // and the pastures' wooden gates, shut, a leaf or two, swinging in to let the shepherd through, and held open as his flock goes
    for (const f of town.fields) {
      const G = f.gateway;
      if (!G) continue;
      const L = Math.hypot(G.b[0] - G.a[0], G.b[1] - G.a[1]), two = L > 3.2, wd = (two ? L / 2 : L) - 0.2;
      for (const [hx, hy, ox, oy] of two ? [[...G.a, ...G.b], [...G.b, ...G.a]] : [[...G.a, ...G.b]]) {
        const shut = Math.atan2(oy - hy, ox - hx), nx = -Math.sin(shut), ny = Math.cos(shut);
        const sg = nx * (G.inside[0] - hx) + ny * (G.inside[1] - hy) > 0 ? 1 : -1;
        const b = { x: hx, y: hy, angle: 0, w: 0, d: 0, z0: G.z };
        DOORS.push({ b, ha: 0, hc: 0, wd, rest: shut, open: shut + sg * 1.55, cur: shut, mx: hx + Math.cos(shut) * wd / 2, my: hy + Math.sin(shut) * wd / 2, z: G.z, t: [0.5, 0.5], h: 1.1, field: true, reach: Math.max(1.6, wd * 0.7) });
      }
    }
    const doorBuf = gl.createBuffer(), doorVAO = gl.createVertexArray(), doorDVAO = gl.createVertexArray();
    gl.bindVertexArray(doorVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, doorBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.bindVertexArray(doorDVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, doorBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.bindVertexArray(null);
    let doorN = 0, doorT = null;
    function doorsIn(rect, life, t) {
      const dt = doorT === null ? 0 : clamp(t - doorT, 0, 0.2);
      doorT = t;
      // who is about the doors in view (people, dogs), a couple of metres a cell
      const near = new Map(), x0 = rect[0] - 3, y0 = rect[1] - 3, x1 = rect[0] + rect[2] + 3, y1 = rect[1] + rect[3] + 3;
      if (life) for (const f of life.figures) {
        if ((f.kind !== 'person' && f.kind !== 'dog' && !f.drove) || f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
        const k = Math.floor(f.x / 2) * 65536 + Math.floor(f.y / 2);
        (near.get(k) || near.set(k, []).get(k)).push(f);
      }
      SV.length = 0;
      for (const D of DOORS) {
        if ((S !== CUTAWAY && !D.field) || D.mx < x0 || D.mx > x1 || D.my < y0 || D.my > y1) continue;
        let by = false;
        const rr = D.reach || 1.4;
        for (let i = Math.floor((D.mx - rr) / 2); i <= Math.floor((D.mx + rr) / 2) && !by; i++)
          for (let j = Math.floor((D.my - rr) / 2); j <= Math.floor((D.my + rr) / 2) && !by; j++)
            for (const f of near.get(i * 65536 + j) || []) if (Math.hypot(f.x - D.mx, f.y - D.my) < (D.reach || 1.4) && Math.abs((f.z || 0) - D.z) < 1.6) { by = true; break; }
        const want = by ? D.open : D.rest;
        let d = (want - D.cur) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        D.cur += clamp(d, -(by ? 3.2 : 1.1) * dt, (by ? 3.2 : 1.1) * dt);
        const b = D.b, ca = Math.cos(b.angle), sa = Math.sin(b.angle), hw = b.w / 2, hd = b.d / 2;
        const Q = (a, c, z) => [b.x + (a - hw) * ca - (c - hd) * sa, b.y + (a - hw) * sa + (c - hd) * ca, z];
        const ux = Math.cos(D.cur), uy = Math.sin(D.cur), nx = -uy * 0.06, ny = ux * 0.06, zt = b.z0 + 0.08 + D.h;
        mat = [D.field ? SOLID.timber : SOLID.door, D.t[0], D.t[1], 0];
        const top = [Q(D.ha + nx, D.hc + ny, zt), Q(D.ha + ux * D.wd + nx, D.hc + uy * D.wd + ny, zt), Q(D.ha + ux * D.wd - nx, D.hc + uy * D.wd - ny, zt), Q(D.ha - nx, D.hc - ny, zt)];
        face(top);
        walls(top, b.z0);
        if (D.z < movZ[0]) movZ[0] = D.z;
        if (D.z > movZ[1]) movZ[1] = D.z;
      }
      doorN = SV.length / 10;
      if (doorN) { gl.bindBuffer(gl.ARRAY_BUFFER, doorBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(SV), gl.DYNAMIC_DRAW); }
      SV.length = 0;
    }
    SV.length = 0;
    // close enough (less than this many metres across) to look inside
    const INSIDE = 200;
    let S = ROOFED;

    // the ground as a mesh, for the hills' shadows
    const terVAO = gl.createVertexArray();
    let terN;
    {
      const v = new Float32Array(T.nx * T.ny * 3), idx = [];
      for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) { const k = j * T.nx + i; v[3 * k] = i * T.cell; v[3 * k + 1] = j * T.cell; v[3 * k + 2] = T.z[k]; }
      for (let j = 0; j + 1 < T.ny; j++) for (let i = 0; i + 1 < T.nx; i++) { const k = j * T.nx + i; idx.push(k, k + 1, k + T.nx, k + 1, k + T.nx + 1, k + T.nx); }
      gl.bindVertexArray(terVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
      terN = idx.length;
    }

    // ---- round bodies: a sphere, coarser and finer; each body x, y, z, radii, colour, lumpiness, turn, number ----
    function sphere(sub) {
      const t = (1 + Math.sqrt(5)) / 2;
      const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
      const vs = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
      let fs = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      for (let s = 0; s < sub; s++) {
        const cache = new Map(), nf = [];
        const mid = (a, b) => {
          const key = a < b ? a + ',' + b : b + ',' + a;
          if (!cache.has(key)) { vs.push(norm(vs[a].map((x, i) => (x + vs[b][i]) / 2))); cache.set(key, vs.length - 1); }
          return cache.get(key);
        };
        for (const [a, b, c] of fs) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
        fs = nf;
      }
      return new Float32Array(fs.flat().flatMap(i => vs[i]));
    }
    // a tree as clumps, as its kind grows: a cypress's or a poplar's stacked
    // up, narrowing; a pine's spread flat as a parasol; the rest heaped
    // round, a few on top; each clump its leaves' size
    const LEAF = { cypress: 0.22, poplar: 0.26, pine: 0.34, oak: 0.3, olive: 0.2, fruit: 0.27, shrub: 0.18, plane: 0.38 };
    const bodies = [];
    town.trees.forEach((t, i) => {
      const [colK, depth] = TREES[t.kind] || TREES.oak, cdep = depth > 1 ? Math.min(depth, t.h * 0.5) : depth * t.h;
      const R = t.r, zb = t.z0 + t.h - cdep, leaf = LEAF[t.kind] || 0.3;
      // each tree its own green, from yellow-lime to dark, as in a wood
      const VAR = [[136, 152, 58], [156, 154, 66], [92, 124, 50], [42, 72, 36], [104, 112, 56], [66, 100, 42], [50, 84, 40]];
      const vr = VAR[Math.floor(hash(i, 11, seed) * VAR.length)], vt = 0.25 + 0.4 * hash(i, 12, seed);
      const tone = 0.9 + 0.22 * hash(i, 3, seed);
      const col = [0, 1, 2].map(q => lerp(colK[q], vr[q], t.kind === 'olive' ? vt * 0.4 : vt));
      let k = 0;
      const rnd = () => hash(i, 100 + k * 7 + (rnd.n = (rnd.n || 0) + 1), seed + 77);
      const clump = (dx, dy, z, rx, rz) => {
        const v = 0.88 + 0.24 * rnd();
        bodies.push([t.x + dx, t.y + dy, z, rx, rx * (0.85 + 0.3 * rnd()), rz, col[0] / 255 * tone * v, col[1] / 255 * tone * v, col[2] / 255 * tone * v, leaf, rnd() * 6.28, i + (k++) / 64, t.z0, t.h]);
      };
      if (t.kind === 'cypress' || t.kind === 'poplar') {
        const n = 4 + (rnd() * 3 | 0);
        for (let j = 0; j < n; j++) {
          const f = j / (n - 1), r = R * (1.05 - 0.6 * f);
          clump((rnd() - 0.5) * 0.3 * R, (rnd() - 0.5) * 0.3 * R, t.z0 + t.h * (0.18 + 0.72 * f), r, t.h / n * 0.85);
        }
      } else if (t.kind === 'pine') {
        clump(0, 0, zb, R * 0.6, cdep * 0.55);
        for (let j = 0, n = 5 + (rnd() * 3 | 0); j < n; j++) {
          const a = (j + rnd() * 0.6) / n * Math.PI * 2, d = R * (0.45 + 0.15 * rnd());
          clump(Math.cos(a) * d, Math.sin(a) * d, zb + (rnd() - 0.6) * cdep * 0.6, R * (0.38 + 0.15 * rnd()), cdep * (0.4 + 0.2 * rnd()));
        }
      } else if (t.kind === 'shrub') {
        for (let j = 0, n = 2 + (rnd() * 3 | 0); j < n; j++) {
          const a = rnd() * Math.PI * 2, d = R * 0.35 * rnd();
          clump(Math.cos(a) * d, Math.sin(a) * d, t.z0 + t.h * (0.35 + 0.2 * rnd()), R * (0.5 + 0.25 * rnd()), t.h * 0.45);
        }
      } else {
        clump(0, 0, zb, R * 0.62, cdep * 0.75);
        for (let j = 0, n = 5 + (rnd() * 4 | 0); j < n; j++) {
          const a = (j + rnd() * 0.7) / n * Math.PI * 2, d = R * (0.42 + 0.18 * rnd());
          clump(Math.cos(a) * d, Math.sin(a) * d, zb - cdep * (0.05 + 0.25 * rnd()), R * (0.4 + 0.15 * rnd()), cdep * (0.5 + 0.15 * rnd()));
        }
        for (let j = 0, n = 1 + (rnd() * 2 | 0); j < n; j++) {
          const a = rnd() * Math.PI * 2, d = R * 0.25 * rnd();
          clump(Math.cos(a) * d, Math.sin(a) * d, zb + cdep * (0.3 + 0.15 * rnd()), R * (0.35 + 0.12 * rnd()), cdep * 0.45);
        }
      }
    });
    (town.rocks || []).forEach((r, i) => {
      const g = 0.5 + 0.12 * hash(i, 7, seed), warm = 0.03 * hash(i, 8, seed);
      bodies.push([r.x, r.y, r.z0 + r.h * 0.25, r.r, r.r * (0.65 + 0.35 * hash(i, 9, seed)), r.h, g + warm, g, g - warm, -0.6, r.angle, i + 50000, r.z0, r.h]);
    });
    (town.animals || []).forEach((an, i) => {
      const [Ln, Wd, Ht, cols] = BEASTS[an.kind] || BEASTS.sheep;
      const col = cols[Math.floor(hash(i, 5, seed) ** 2 * cols.length)].map(v => v / 255);
      const c = Math.cos(an.angle), s = Math.sin(an.angle);
      bodies.push([an.x, an.y, an.z0 + Ht * 0.7, Ln / 2, Wd / 2, Ht * 0.3, ...col, 0, an.angle, 0, an.z0, Ht]);
      bodies.push([an.x + c * Ln * 0.55, an.y + s * Ln * 0.55, an.z0 + Ht * 0.8, Ln * 0.17, Wd * 0.28, Ht * 0.15, ...col.map(v => v * 0.85), 0, an.angle, 0, an.z0, Ht]);
    });
    const spheres = [1, 2, 3].map(sub => {
      const data = sphere(sub), vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { vbo, n: data.length / 3 };
    });
    const instBuf = gl.createBuffer();
    const bodyVAOs = spheres.map(sp => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sp.vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      for (const [loc, size, off] of [[1, 3, 0], [2, 3, 12], [3, 4, 24], [4, 2, 40], [5, 2, 48]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 56, off);
        gl.vertexAttribDivisor(loc, 1);
      }
      return vao;
    });
    const BS = 14, instData = new Float32Array(Math.max(1, bodies.length) * BS);
    // the living: drawn afresh each frame, into a buffer of their own
    const movBuf = gl.createBuffer();
    const movVAOs = spheres.map(sp => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sp.vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, movBuf);
      for (const [loc, size, off] of [[1, 3, 0], [2, 3, 12], [3, 4, 24], [4, 2, 40], [5, 2, 48]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 56, off);
        gl.vertexAttribDivisor(loc, 1);
      }
      return vao;
    });
    let movData = new Float32Array(BS * 8192), movN = 0, movZ = [0, 0];
    // the figures within a rectangle (and a margin, for their shadows) as bodies
    function movers(life, x0, y0, x1, y1, scale) {
      movN = 0; movZ = [Infinity, -Infinity];
      if (!life) return 0;
      // (close enough, the small things too: faces, hands, belts, ears, tails)
      const lod = scale < 3.2, fine = scale > 9;
      for (const f of life.figures) {
        if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
        const ca = Math.cos(f.a || 0), sa = Math.sin(f.a || 0), fz = f.z || 0;
        if (fz < movZ[0]) movZ[0] = fz;
        if (fz > movZ[1]) movZ[1] = fz;
        figureBodies(f, (fw, aside, up, rx, ry, rz, col, t = 0, tex = 0) => {
          if (movN * BS + BS > movData.length) { const d = new Float32Array(movData.length * 2); d.set(movData); movData = d; }
          const o = BS * movN++;
          movData[o] = f.x + ca * fw - sa * aside; movData[o + 1] = f.y + sa * fw + ca * aside; movData[o + 2] = fz + up;
          movData[o + 3] = rx; movData[o + 4] = ry; movData[o + 5] = rz;
          movData[o + 6] = col[0]; movData[o + 7] = col[1]; movData[o + 8] = col[2]; movData[o + 9] = 0;
          movData[o + 10] = (f.a || 0) + t; movData[o + 11] = -tex; movData[o + 12] = fz; movData[o + 13] = 2;
        }, lod, fine);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, movBuf);
      gl.bufferData(gl.ARRAY_BUFFER, movData.subarray(0, BS * Math.max(movN, 1)), gl.DYNAMIC_DRAW);
      return movN;
    }
    // the bodies within a rectangle, into the instance buffer
    function bodiesIn(x0, y0, x1, y1) {
      let n = 0;
      for (const b of bodies) {
        const r = Math.max(b[3], b[4]);
        if (b[0] + r < x0 || b[0] - r > x1 || b[1] + r < y0 || b[1] - r > y1) continue;
        instData.set(b, BS * n++);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instData.subarray(0, BS * Math.max(n, 1)), gl.DYNAMIC_DRAW);
      return n;
    }

    // ---- render targets ----
    function tex(w, h, internal, filter = gl.NEAREST) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, filter);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
      return t;
    }
    function gbuffer(w, h) {
      const g = { w, h, alb: tex(w, h, gl.RGBA8), nrm: tex(w, h, gl.RGBA16F), hgt: tex(w, h, gl.R32F), fbo: gl.createFramebuffer() };
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.alb, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g.nrm, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, g.hgt, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      g.free = () => { for (const t of [g.alb, g.nrm, g.hgt]) gl.deleteTexture(t); gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(g.fbo); };
      return g;
    }
    function target(t) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    }
    const SH = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, SH, SH);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const MSH = Math.min(1024, SH), mShadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, mShadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, MSH, MSH);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const mShadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, mShadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, mShadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    // ---- cameras ----
    // straight down on a rectangle of the world, north up, the higher the nearer
    function topDown(x0, y0, w, h) {
      return new Float32Array([2 / w, 0, 0, 0, 0, -2 / h, 0, 0, 0, 0, -2 / (zhi - zlo), 0, -2 * x0 / w - 1, 2 * y0 / h + 1, 1 + 2 * zlo / (zhi - zlo), 1]);
    }
    // the light's: looking along it at whatever it falls on in the rectangle
    // (or, tight, only as deep as from zl to zh over the rectangle: the living's)
    function lightView(L, x0, y0, w, h, zl = zlo, zh = zhi, tight = false) {
      const f = [-L[0], -L[1], -L[2]];
      let r = [f[1], -f[0], 0];
      const rl = Math.hypot(r[0], r[1]);
      r = rl < 1e-6 ? [1, 0, 0] : [r[0] / rl, r[1] / rl, 0];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const dot = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
      let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity, az = Infinity, bz = -Infinity;
      for (const x of [x0, x0 + w]) for (const y of [y0, y0 + h]) for (const z of [zl, zh]) {
        const p = [x, y, z];
        ax = Math.min(ax, dot(r, p)); bx = Math.max(bx, dot(r, p)); ay = Math.min(ay, dot(u, p)); by = Math.max(by, dot(u, p));
        if (tight) { const d = dot(f, p); az = Math.min(az, d); bz = Math.max(bz, d); }
      }
      if (!tight) for (const x of [0, W]) for (const y of [0, H]) for (const z of [zlo, zhi]) { const d = dot(f, [x, y, z]); az = Math.min(az, d); bz = Math.max(bz, d); }
      az -= 10; bz += 10;
      const sx = 2 / (bx - ax), sy = 2 / (by - ay), sz = 2 / (bz - az);
      // clip = ((r·p − ax)·sx − 1, (u·p − ay)·sy − 1, (f·p − az)·sz − 1), by columns
      const m = new Float32Array([
        r[0] * sx, u[0] * sy, f[0] * sz, 0,
        r[1] * sx, u[1] * sy, f[1] * sz, 0,
        r[2] * sx, u[2] * sy, f[2] * sz, 0,
        -ax * sx - 1, -ay * sy - 1, -az * sz - 1, 1,
      ]);
      return { m, texel: Math.max(bx - ax, by - ay) / SH, depth: bz - az };
    }

    // ---- passes ----
    const jetData = new Float32Array(32 * 4), jetH = new Float32Array(32);
    function drawScene(g, mvp, rect, scale, life = null) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
      gl.viewport(0, 0, g.w, g.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // the ground, in order, each patch over the last
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(P.ground.p);
      const L = P.ground.loc;
      gl.uniformMatrix4fv(L.uMVP, false, mvp);
      gl.uniform1f(L.uZmid, (zlo + zhi) / 2);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, terTex);
      gl.uniform1i(L.uTer, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, grassTex);
      if (life && life.grass && life.grassV !== grassV) { grassV = life.grassV; gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grassN, 1, gl.RED, gl.FLOAT, life.grass); }
      gl.uniform1i(L.uGrass, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform3f(L.uTerDim, T.nx, T.ny, T.cell);
      gl.uniform1i(L.uSeed, iseed);
      gl.uniform1f(L.uTA, TA); gl.uniform1f(L.uZmin, zmin); gl.uniform1f(L.uZmax, zmax); gl.uniform1f(L.uRelief, 3);
      gl.uniform1f(L.uPx, rect[2] / g.w);
      setWind(P.ground);
      // the jets near enough to show
      let nj = 0;
      for (const j of town.jets || []) {
        if (nj >= 32 || j.x < rect[0] - 4 || j.x > rect[0] + rect[2] + 4 || j.y < rect[1] - 4 || j.y > rect[1] + rect[3] + 4) continue;
        jetData.set([j.x, j.y, j.sx, j.sy], 4 * nj); jetH[nj++] = j.h;
      }
      gl.uniform4fv(L.uJets, jetData); gl.uniform1fv(L.uJetH, jetH); gl.uniform1i(L.uNJ, nj);
      gl.bindVertexArray(groundVAO);
      gl.drawArrays(gl.TRIANGLES, 0, groundN);
      // what stands on it, the highest seen
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.useProgram(P.solid.p);
      gl.uniformMatrix4fv(P.solid.loc.uMVP, false, mvp);
      gl.uniform1i(P.solid.loc.uSeed, iseed);
      gl.uniform1f(P.solid.loc.uTA, TA);
      gl.uniform1f(P.solid.loc.uPx, rect[2] / g.w);
      setWind(P.solid);
      gl.bindVertexArray(S.vao);
      gl.drawArrays(gl.TRIANGLES, 0, S.n);
      if (doorN && g === liveG) { gl.bindVertexArray(doorVAO); gl.drawArrays(gl.TRIANGLES, 0, doorN); }
      const nb = bodiesIn(rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]);
      if (nb) {
        gl.useProgram(P.body.p);
        gl.uniformMatrix4fv(P.body.loc.uMVP, false, mvp);
        gl.uniform1f(P.body.loc.uPx, rect[2] / g.w);
        setWind(P.body);
        const k = scale > 30 ? 2 : scale > 6 ? 1 : 0; // (rounder close up)
        gl.bindVertexArray(bodyVAOs[k]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, spheres[k].n, nb);
      }
      if (movN) {
        gl.useProgram(P.body.p);
        gl.uniformMatrix4fv(P.body.loc.uMVP, false, mvp);
        gl.uniform1f(P.body.loc.uPx, rect[2] / g.w);
        setWind(P.body);
        gl.bindVertexArray(movVAOs[scale > 40 ? 2 : scale > 8 ? 1 : 0]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, spheres[scale > 40 ? 2 : scale > 8 ? 1 : 0].n, movN);
      }
      gl.bindVertexArray(null);
    }
    function drawShadows(lv, rect) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
      gl.viewport(0, 0, SH, SH);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.useProgram(P.depth.p);
      gl.uniformMatrix4fv(P.depth.loc.uMVP, false, lv.m);
      gl.bindVertexArray(terVAO);
      gl.drawElements(gl.TRIANGLES, terN, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(S.dvao);
      gl.drawArrays(gl.TRIANGLES, 0, S.n);
      // the bodies that may shade the rectangle: those in it, and about it
      const m = 60;
      const nb = bodiesIn(rect[0] - m, rect[1] - m, rect[0] + rect[2] + m, rect[1] + rect[3] + m);
      if (nb) {
        gl.useProgram(P.bodyDepth.p);
        gl.uniformMatrix4fv(P.bodyDepth.loc.uMVP, false, lv.m);
        setWind(P.bodyDepth);
        gl.bindVertexArray(bodyVAOs[0]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, spheres[0].n, nb);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    }
    // the living's shadows, each frame, as the light falls
    let mlv = null;
    function drawMoverShadows(L, rect) {
      // the light's view of them alone: the rectangle only as deep as they stand, so it is fine
      const m = 30, lv = mlv = lightView(L, rect[0] - m, rect[1] - m, rect[2] + 2 * m, rect[3] + 2 * m, movZ[0] - 1.5, movZ[1] + 4, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, mShadowFBO);
      gl.viewport(0, 0, MSH, MSH);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.useProgram(P.bodyDepth.p);
      gl.uniformMatrix4fv(P.bodyDepth.loc.uMVP, false, lv.m);
      setWind(P.bodyDepth);
      if (movN) { gl.bindVertexArray(movVAOs[1]); gl.drawArraysInstanced(gl.TRIANGLES, 0, spheres[1].n, movN); }
      if (doorN) {
        gl.useProgram(P.depth.p);
        gl.uniformMatrix4fv(P.depth.loc.uMVP, false, lv.m);
        gl.bindVertexArray(doorDVAO);
        gl.drawArrays(gl.TRIANGLES, 0, doorN);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    }
    const quad = () => { gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); };

    // ---- the heights about each point, the whole world's, once: near and further ----
    const AS = 2, aw = Math.ceil(W * AS), ah = Math.ceil(H * AS), zbase = zmin;
    const aoNear = tex(aw, ah, gl.R16F, gl.LINEAR), aoFar = tex(aw, ah, gl.R16F, gl.LINEAR);
    {
      const g = gbuffer(aw, ah);
      drawScene(g, topDown(0, 0, aw / AS, ah / AS), [0, 0, W, H], AS);
      gl.disable(gl.DEPTH_TEST);
      const tmp = [tex(aw, ah, gl.R32F), tex(aw, ah, gl.R32F)], tf = tmp.map(target);
      gl.useProgram(P.blur.p);
      gl.viewport(0, 0, aw, ah);
      const pass = (src, dstF, dir, r, sub) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstF);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform1i(P.blur.loc.uSrc, 0); gl.uniform2i(P.blur.loc.uDir, dir[0], dir[1]); gl.uniform1i(P.blur.loc.uR, r); gl.uniform1f(P.blur.loc.uSub, sub);
        quad();
      };
      for (const [r, out] of [[2, aoNear], [7, aoFar]]) {
        const of = target(out);
        pass(g.hgt, tf[0], [1, 0], r, 0);
        pass(tmp[0], tf[1], [0, 1], r, 0);
        pass(tmp[1], tf[0], [1, 0], r, 0);
        pass(tmp[0], of, [0, 1], r, zbase);
        gl.deleteFramebuffer(of);
      }
      tmp.forEach(t => gl.deleteTexture(t));
      tf.forEach(f => gl.deleteFramebuffer(f));
      g.free();
    }

    // ---- each frame ----
    const ss = canvas.width * canvas.height * 4 <= 10e6 ? 2 : 1; // drawn finer, then averaged
    const G = gbuffer(canvas.width * ss, canvas.height * ss), liveG = G;
    const litTex = ss > 1 ? tex(G.w, G.h, gl.RGBA8, gl.LINEAR) : null, litFBO = litTex ? target(litTex) : null;
    const lampData = new Float32Array(128 * 4);

    // the shadows drawn again only when the view or the light has moved
    let shadowKey = '', lv = null;
    function draw(rect, sky, t = 0, life = null) {
      time = t % 3600;
      const lt = lightOf(sky), scale = canvas.width / rect[2];
      // the living about, a little beyond the edges too, for their shadows
      const mm = 24;
      movers(life, rect[0] - mm, rect[1] - mm, rect[0] + rect[2] + mm, rect[1] + rect[3] + mm, scale);
      // roofs off when close, as a plan is drawn (a little either way, so it
      // does not flicker at the edge)
      if (S === ROOFED && rect[2] < INSIDE * 0.95) S = CUTAWAY;
      else if (S === CUTAWAY && rect[2] > INSIDE * 1.05) S = ROOFED;
      const key = rect.join() + lt.L.join() + (S === CUTAWAY);
      if (key !== shadowKey) { lv = lightView(lt.L, ...rect); drawShadows(lv, rect); shadowKey = key; }
      doorsIn(rect, life, t);
      const shade = movN || doorN;
      if (shade) drawMoverShadows(lt.L, rect);
      drawScene(G, topDown(...rect), rect, scale, life);
      // the light
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, litFBO);
      gl.viewport(0, 0, G.w, G.h);
      gl.useProgram(P.light.p);
      const L = P.light.loc;
      [[G.alb, 'uAlb'], [G.nrm, 'uNrm'], [G.hgt, 'uHgt'], [aoNear, 'uNear'], [aoFar, 'uFar'], [shadowTex, 'uShadow'], [mShadowTex, 'uShadowM']].forEach(([t, name], i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(L[name], i);
      });
      gl.uniform4f(L.uView, ...rect);
      gl.uniform2f(L.uSize, G.w, G.h);
      gl.uniform2f(L.uWorld, aw / AS, ah / AS);
      gl.uniformMatrix4fv(L.uLight, false, lv.m);
      gl.uniform1f(L.uTexel, lv.texel);
      gl.uniform1f(L.uShTexel, 1 / SH);
      gl.uniform1f(L.uBias, (0.04 + lv.texel * 0.5) / lv.depth);
      gl.uniform1i(L.uMov, shade ? 1 : 0);
      if (shade) {
        gl.uniformMatrix4fv(L.uLightM, false, mlv.m);
        gl.uniform1f(L.uBiasM, (0.02 + mlv.texel * SH / MSH * 0.6) / mlv.depth);
      }
      gl.uniform3f(L.uL, ...lt.L); gl.uniform3f(L.uSun, ...lt.col); gl.uniform3f(L.uSky, ...lt.sky);
      gl.uniform1f(L.uGrey, lt.grey); gl.uniform1f(L.uZbase, zbase);
      setWind(P.light);
      // the lamps near enough to light it
      let nl = 0;
      // the torches carried first
      if (life && lt.lamps > 0.01) for (const l of life.lights) {
        if (nl >= 128 || l.x < rect[0] - 16 || l.x > rect[0] + rect[2] + 16 || l.y < rect[1] - 16 || l.y > rect[1] + rect[3] + 16) continue;
        lampData.set([l.x, l.y, l.z, l.power * lt.lamps], 4 * nl++);
      }
      if (lt.lamps > 0.01) for (const l of town.lamps || []) {
        if (nl >= 128 || l.x < rect[0] - 16 || l.x > rect[0] + rect[2] + 16 || l.y < rect[1] - 16 || l.y > rect[1] + rect[3] + 16) continue;
        lampData.set([l.x, l.y, l.z, l.power * lt.lamps], 4 * nl++);
      }
      gl.uniform4fv(L.uLamps, lampData);
      gl.uniform1i(L.uNL, nl);
      quad();
      if (ss > 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(P.down.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, litTex);
        gl.uniform1i(P.down.loc.uTex, 0);
        gl.uniform2f(P.down.loc.uOut, canvas.width, canvas.height);
        quad();
      }
    }
    return { draw };
  }

  return { create };
})();
