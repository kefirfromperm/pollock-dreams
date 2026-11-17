// Roman Town — a view of the model (roman-town.js) straight down from above,
// north up, drawn by the graphics card (WebGL2).
//
// It knows nothing of how the town was made, only what the model says is
// there. Once, it turns the model into geometry: the ground and every patch
// laid on it (fields, roads, streets, the river) as flat shapes coloured
// by what they are; every building as boxes with their roofs, walls and
// steps; trees, rocks and beasts as lumpy round bodies. Then for each frame, any
// rectangle of the world at any scale:
//   - the sun's (or the moon's) view of everything, for the shadows;
//   - from above, for each pixel, its height, which way it faces and its
//     colour, the patterns of tiles, stones and furrows worked out there;
//   - lit: the sun or the moon on whatever faces it unless something stands
//     in the way, the sky's light, less of it in hollows and narrow streets
//     (from the heights about, the whole world's, found once), lamps at night.
//
//   const view = RomanTownView.create(canvas, town, { seed })
//   view.draw([x0, y0, w, h], sky, t)   the canvas filled with that rectangle of
//     the world, lit as the sky is: { sun: { az, el }, moon: { az, el, lit } },
//     azimuths from north (up) clockwise, elevations, radians; lit, the
//     moon's lit part; t, seconds, for what moves: the wind in the grass,
//     the crops and the trees, the torches' flames
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
    via: 19, track: 20, river: 21, bank: 22,
  };
  const SOLID = { tile: 0, stone: 1, marble: 2, timber: 3, turf: 4, steps: 5, sand: 6, paving: 7, passage: 8, wall: 9 };
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
    // the wind: gusts going over, downwind at 5 m/s, streaks longer across
    // the wind than along it
    uniform vec2 uWind; uniform float uTime;
    float gust(vec2 p) {
      vec2 w = normalize(uWind);
      vec2 q = vec2(dot(p, w) - uTime * 5.0, dot(p, vec2(-w.y, w.x)));
      return fnoise(q / vec2(18.0, 42.0), 41);
    }
  `;
  const OUT = 'layout(location = 0) out vec4 oAlb;\nlayout(location = 1) out vec4 oNrm;\nlayout(location = 2) out float oH;\n';

  // the ground and what is laid on it
  const GROUND_VS = `
    layout(location = 0) in vec2 aPos;
    layout(location = 1) in vec4 aA; // what it is, an angle, across a road (-1…1), the water's level
    layout(location = 2) in float aTint;
    uniform mat4 uMVP; uniform float uZmid;
    out vec2 vP; out float vT, vLevel; flat out float vMat, vAngle, vTint;
    void main() {
      vP = aPos; vMat = aA.x; vAngle = aA.y; vT = aA.z; vLevel = aA.w; vTint = aTint;
      gl_Position = uMVP * vec4(aPos, uZmid, 1.0);
    }`;
  const GROUND_FS = NOISE + OUT + `
    in vec2 vP; in float vT, vLevel; flat in float vMat, vAngle, vTint;
    uniform sampler2D uTer; uniform vec3 uTerDim; // the ground's heights and slopes; nx, ny, its cell
    uniform int uSeed; uniform float uTA, uZmin, uZmax, uRelief;
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
      float z = t.x, flag = 0.0;
      vec2 g = uRelief * t.yz; // (its slopes shaded as if steeper, as relief maps do, so the hills show)
      vec3 n = normalize(vec3(-g, 1.0));
      int m = int(vMat + 0.5);
      float tint = 0.9 + 0.2 * vTint, nz = fnoise(p / 3.0, uSeed + 3), f = 1.0, grass = 0.0;
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
      else if (m == 8) { c = rgb(72.0, 140.0, 148.0); f = 0.95 + 0.1 * nz; }
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
      else if (m == 15) { c = rgb(112.0, 126.0, 60.0); f = tint * (0.78 + 0.3 * fnoise(p / 1.3, uSeed + 19)) * (0.9 + 0.2 * fnoise(p / 14.0, uSeed + 23)); }
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
        // the river: water at its level, flat
        z = vLevel; n = vec3(0.0, 0.0, 1.0); flag = 1.0;
        c = rgb(52.0, 82.0, 80.0); f = 0.92 + 0.12 * fnoise(p / 9.0, uSeed + 17);
      }
      else if (m == 22) { f = 0.75; }
      if (m == 13 || m == 15) grass = 1.0;
      if (m == 10) grass = 1.4; // (wheat, taller, waves more)
      if (m == 5) grass = 0.4;
      if (grass > 0.0) {
        // grass in the wind: bent over where a gust goes, its paler blades
        // showing, rippling; its blades, fine, fractal
        float gu = gust(p), rip = fnoise((p - uWind * uTime * 5.0) / 2.5, 43);
        float bend = grass * (1.6 * (gu - 0.42) + 0.5 * (rip - 0.5));
        n = normalize(n + vec3(uWind * bend * 1.1, 0.0));
        f *= 1.0 + 0.32 * bend;
        f *= 1.0 + min(grass, 1.0) * 0.14 * (fnoise(p / 0.35, uSeed + 47) - 0.5 + 0.5 * (fnoise(p / 0.12, uSeed + 49) - 0.5));
      }
      oAlb = vec4(clamp(c * f, 0.0, 1.0), flag);
      oNrm = vec4(n, 0.0);
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
      oAlb = vec4(clamp(c * f, 0.0, 1.0), 0.0);
      oNrm = vec4(n, 0.0);
      oH = vW.z;
    }`;

  // trees and beasts: round bodies, a tree's lumpy, its leaves in clumps
  const BODY_VS = NOISE + `
    layout(location = 0) in vec3 aDir;
    layout(location = 1) in vec3 aC;   // the middle
    layout(location = 2) in vec3 aR;   // the radii
    layout(location = 3) in vec4 aCol; // colour, and how lumpy
    layout(location = 4) in vec2 aRot; // turned, and its own number (a tree's, and which of its clumps)
    layout(location = 5) in vec2 aAnchor; // a tree's foot, and its height
    uniform mat4 uMVP;
    out vec3 vW, vD; flat out vec4 vCol; flat out vec2 vSeedOff;
    void main() {
      vec3 d = aDir;
      vSeedOff = vec2(fract(aRot.y * 0.618) * 37.0, fract(aRot.y * 0.377) * 41.0);
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
      if (aCol.w > 0.0) {
        // the wind: the tree leaning with the gusts, the higher the more,
        // swaying back and to, its leaves fluttering
        float tid = floor(aRot.y), ph = tid * 1.7, H = max(aAnchor.y, 1.0);
        float up = clamp((vW.z - aAnchor.x) / H, 0.0, 1.2);
        float sway = (gust(aC.xy) - 0.3) * 1.4 + 0.4 * sin(uTime * (0.35 + 0.2 * fract(tid * 0.37)) + ph) + 0.12 * sin(uTime * 0.9 + ph * 1.3);
        vW.xy += uWind * sway * up * up * min(H, 16.0) * 0.08;
        float fl = 0.03 * min(aR.x, 2.5) * (0.5 + gust(aC.xy));
        vW.xy += fl * vec2(sin(uTime * 2.2 + dot(aDir, vec3(13.0, 7.0, 5.0)) + ph), cos(uTime * 1.9 + dot(aDir, vec3(5.0, 11.0, 3.0)) + ph));
      }
      vec3 e = aDir / aR;
      vD = vec3(c * e.x - s * e.y, s * e.x + c * e.y, e.z);
      vCol = aCol;
      gl_Position = uMVP * vec4(vW, 1.0);
    }`;
  const BODY_FS = NOISE + OUT + `
    in vec3 vW, vD; flat in vec4 vCol; flat in vec2 vSeedOff;
    uniform float uPx; // metres a pixel
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
        // gaps between; warped, so no lattice shows; stirring in the wind
        float sz = vCol.w, g = gust(vW.xy);
        vec3 stir = vec3(uWind * (0.05 + 0.07 * g) * sin(uTime * 0.9 + vW.z * 0.7), 0.0);
        vec3 w = vW + stir;
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
    uniform sampler2DShadow uShadow;
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
    float tone(float v) {
      float x = max(0.0, v * 0.9), y = x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14);
      return y <= 0.0031308 ? 12.92 * y : 1.055 * pow(min(1.0, y), 1.0 / 2.4) - 0.055;
    }
    vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    void main() {
      ivec2 px = ivec2(gl_FragCoord.xy);
      vec4 A = texelFetch(uAlb, px, 0);
      vec3 n = texelFetch(uNrm, px, 0).xyz;
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
      float ndl = max(0.0, dot(n, uL)) * lit;
      // the sky, less of it below the heights about
      vec2 ta = vec2(w.x / uWorld.x, 1.0 - w.y / uWorld.y);
      float near = texture(uNear, ta).r + uZbase, far = texture(uFar, ta).r + uZbase;
      float ao = 1.0 - clamp((near - h) * 0.22, 0.0, 0.4) - clamp((far - h) * 0.06, 0.0, 0.25);
      bool water = A.a > 0.5;
      if (water) ao = max(ao, 0.85);
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
      const vec3 LAMP = vec3(1.0, 0.56, 0.22);
      vec3 v = lin(A.rgb) * (uSky * amb + uSun * ndl + LAMP * glow) + fire;
      if (water) v += 0.05 * uSky * ao;
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
    const { sun, moon } = sky, day = sm(-0.12, 0.06, sun.el), high = sm(0, 0.45, sun.el), up = sm(-0.015, 0.04, sun.el);
    const sunC = mixc([1.0, 0.42, 0.16], [1.0, 0.93, 0.8], high).map(v => v * 2.6 * up);
    const dusk = mixc([0.42, 0.36, 0.5], [0.69, 0.78, 0.92], high).map(v => v * (0.3 + 0.7 * sm(-0.12, 0.2, sun.el)));
    const mUp = sm(-0.015, 0.06, moon.el) * moon.lit * (1 - day);
    const moonC = [0.42, 0.56, 0.95].map(v => v * 0.42 * mUp);
    const night = [0.022, 0.03, 0.06].map((v, q) => v + [0.022, 0.03, 0.055][q] * moon.lit * sm(-0.015, 0.06, moon.el));
    const bySun = sunC[1] >= moonC[1];
    return {
      L: bySun ? dir(sun.az, sun.el) : dir(moon.az, moon.el), col: bySun ? sunC : moonC,
      sky: mixc(night, dusk, day), grey: 0.75 * (1 - day), lamps: 1 - sm(-0.1, 0.03, sun.el),
    };
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

    // ---- the ground's patches: x, y, what, angle, across, level, tint ----
    const GV = [];
    const gvert = (x, y, m, a = 0, t = 0, lev = 0, tint = 0) => GV.push(x, y, m, a, t, lev, tint);
    function gpoly(pts, m, a = 0, tint = 0) {
      for (let i = 1; i + 1 < pts.length; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) gvert(q[0], q[1], m, a, 0, 0, tint);
    }
    // a line of a width: a strip, across it −1…1, mitred where it bends
    function gline(pts, half, m, levels = null) {
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
        const la = levels ? levels[q] : 0, lb = levels ? levels[q + 1] : 0;
        const A1 = [ax + anx, ay + any, 1, la], A2 = [ax - anx, ay - any, -1, la], B1 = [bx + bnx, by + bny, 1, lb], B2 = [bx - bnx, by - bny, -1, lb];
        for (const v of [A1, B1, B2, A1, B2, A2]) gvert(v[0], v[1], m, 0, v[2], v[3]);
      }
    }
    gpoly([[0, 0], [W, 0], [W, H], [0, H]], GROUND.natural);
    for (const f of town.fields) gpoly(f.poly, GROUND[f.crop] ?? GROUND.meadow, f.angle, hash(Math.round(f.poly[0][0] * 7), Math.round(f.poly[0][1] * 7), seed));
    for (const kind of ['track', 'via']) for (const r of town.roads) if (r.kind === kind) gline(r.points, r.width / 2, GROUND[kind]);
    if (town.river) {
      const R = town.river;
      gline(R.points, R.width / 2, GROUND.bank);
      gline(R.points, R.width / 2 - 0.6, GROUND.river, R.level);
    }
    for (const g of town.grounds) gpoly(g.poly, GROUND[g.kind] ?? GROUND.yard, g.angle || 0);
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
    for (const b of town.buildings) {
      const [t1, t2] = tints(b);
      mat = [matOf(b), t1, t2, 0];
      if (b.shape === 'box') box(b);
      else if (b.shape === 'round') round(b);
      else if (b.shape === 'cavea') cavea(b);
      else if (b.shape === 'arena') arena(b);
    }
    const solidBuf = gl.createBuffer(), solidN = SV.length / 10;
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(SV), gl.STATIC_DRAW);
    const solidVAO = gl.createVertexArray();
    gl.bindVertexArray(solidVAO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    const solidDepthVAO = gl.createVertexArray();
    gl.bindVertexArray(solidDepthVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);

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
    function lightView(L, x0, y0, w, h) {
      const f = [-L[0], -L[1], -L[2]];
      let r = [f[1], -f[0], 0];
      const rl = Math.hypot(r[0], r[1]);
      r = rl < 1e-6 ? [1, 0, 0] : [r[0] / rl, r[1] / rl, 0];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const dot = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
      let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity, az = Infinity, bz = -Infinity;
      for (const x of [x0, x0 + w]) for (const y of [y0, y0 + h]) for (const z of [zlo, zhi]) {
        const p = [x, y, z];
        ax = Math.min(ax, dot(r, p)); bx = Math.max(bx, dot(r, p)); ay = Math.min(ay, dot(u, p)); by = Math.max(by, dot(u, p));
      }
      for (const x of [0, W]) for (const y of [0, H]) for (const z of [zlo, zhi]) { const d = dot(f, [x, y, z]); az = Math.min(az, d); bz = Math.max(bz, d); }
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
    function drawScene(g, mvp, rect, scale) {
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
      gl.uniform3f(L.uTerDim, T.nx, T.ny, T.cell);
      gl.uniform1i(L.uSeed, iseed);
      gl.uniform1f(L.uTA, TA); gl.uniform1f(L.uZmin, zmin); gl.uniform1f(L.uZmax, zmax); gl.uniform1f(L.uRelief, 3);
      setWind(P.ground);
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
      setWind(P.solid);
      gl.bindVertexArray(solidVAO);
      gl.drawArrays(gl.TRIANGLES, 0, solidN);
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
      gl.bindVertexArray(solidDepthVAO);
      gl.drawArrays(gl.TRIANGLES, 0, solidN);
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
    const G = gbuffer(canvas.width * ss, canvas.height * ss);
    const litTex = ss > 1 ? tex(G.w, G.h, gl.RGBA8, gl.LINEAR) : null, litFBO = litTex ? target(litTex) : null;
    const lampData = new Float32Array(128 * 4);

    // the shadows drawn again only when the view or the light has moved (the
    // trees' swaying left out of them)
    let shadowKey = '', lv = null;
    function draw(rect, sky, t = 0) {
      time = t % 3600;
      const lt = lightOf(sky), scale = canvas.width / rect[2];
      const key = rect.join() + lt.L.join();
      if (key !== shadowKey) { lv = lightView(lt.L, ...rect); drawShadows(lv, rect); shadowKey = key; }
      drawScene(G, topDown(...rect), rect, scale);
      // the light
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, litFBO);
      gl.viewport(0, 0, G.w, G.h);
      gl.useProgram(P.light.p);
      const L = P.light.loc;
      [[G.alb, 'uAlb'], [G.nrm, 'uNrm'], [G.hgt, 'uHgt'], [aoNear, 'uNear'], [aoFar, 'uFar'], [shadowTex, 'uShadow']].forEach(([t, name], i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(L[name], i);
      });
      gl.uniform4f(L.uView, ...rect);
      gl.uniform2f(L.uSize, G.w, G.h);
      gl.uniform2f(L.uWorld, aw / AS, ah / AS);
      gl.uniformMatrix4fv(L.uLight, false, lv.m);
      gl.uniform1f(L.uTexel, lv.texel);
      gl.uniform1f(L.uShTexel, 1 / SH);
      gl.uniform1f(L.uBias, (0.04 + lv.texel * 0.5) / lv.depth);
      gl.uniform3f(L.uL, ...lt.L); gl.uniform3f(L.uSun, ...lt.col); gl.uniform3f(L.uSky, ...lt.sky);
      gl.uniform1f(L.uGrey, lt.grey); gl.uniform1f(L.uZbase, zbase);
      setWind(P.light);
      // the lamps near enough to light it
      let nl = 0;
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
