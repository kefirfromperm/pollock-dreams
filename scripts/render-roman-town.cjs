#!/usr/bin/env node
// Film Roman Town along one of its plots (scripts/roman-town-plots.js): the
// town at a day and an hour, the camera going where the plot takes it,
// frame by frame on a virtual clock; the frames to stdout as a PNG stream
// (for ffmpeg -f image2pipe) and what is heard of it, as it is seen, to a WAV.
//
//   node scripts/render-roman-town.cjs --plot P [--seconds S] [--fps F]
//                                      [--width W] [--height H] [--wav F]
//   node scripts/render-roman-town.cjs --plot P --stills 0,10,20 --out DIR
//   (and --software: drawn by chromium's software GPU, a hundred times slower)
//
//   plot    which plot (its name in roman-town-plots.js)
//   seconds how long (default the plot's own)
//   wav     where to write the sound: the town's own (roman-town-sound.js),
//           what is in view heard as the page would hear it, rendered offline
//   stills  only a frame at each of these seconds, as PNGs in DIR, the film
//           run to them as it would be, the frames between not kept
//
// The town is the plot's seed's, at its hour in Rome (time in Europe/Rome);
// the page's clock (performance.now, requestAnimationFrame, its timers) is
// replaced, so every frame advances exactly 1/fps seconds of the town's time
// (times the plot's speed) however long it takes to draw, and Math.random is
// seeded. Needs playwright-core (NODE_PATH) and chromium; the town is drawn
// by the machine's graphics card (ANGLE on EGL), or by chromium's software
// GPU (SwiftShader) with --software.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, v === undefined || isNaN(v) ? v : Number(v)]));
const root = path.resolve(__dirname, '..');
const fps = args.fps ?? 30, width = args.width ?? 1080, height = args.height ?? 1920, SR = 48000;
const stills = args.stills !== undefined ? String(args.stills).split(',').map(Number) : null;
const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath,
    args: args.software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, timezoneId: 'Europe/Rome' });
  page.on('pageerror', e => process.stderr.write(`page: ${e.message}\n`));
  // the project's files on a made-up origin, nothing else (no analytics)
  await page.route(/^https?:/, r => {
    const u = new URL(r.request().url());
    if (u.host !== 'render.local') return r.abort();
    const file = path.join(root, decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404 });
    r.fulfill({ body: fs.readFileSync(file) });
  });
  // the plot, to know its town and its hour before the page is loaded
  const plots = new Function(fs.readFileSync(path.join(__dirname, 'roman-town-plots.js'), 'utf8') + '; return RomanTownPlots;')();
  const plot = plots[args.plot];
  if (!plot) throw new Error(`no plot ${args.plot}: ${Object.keys(plots).join(', ')}`);
  const seconds = args.seconds ?? plot.seconds, seed = plot.seed ?? 5;
  const speed = t => typeof plot.speed === 'function' ? plot.speed(t) : plot.speed ?? 1;

  await page.addInitScript(({ seed, width, height }) => {
    let a = seed;
    Math.random = () => { // mulberry32
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    let now = 0, queue = [], timers = [], tid = 0;
    performance.now = () => now;
    window.requestAnimationFrame = f => queue.push(f);
    window.setTimeout = (f, ms = 0, ...a) => (timers.push({ id: ++tid, at: now + ms, f, a }), tid);
    window.setInterval = (f, ms = 0, ...a) => (timers.push({ id: ++tid, at: now + ms, every: Math.max(1, ms), f, a }), tid);
    window.clearTimeout = window.clearInterval = id => { timers = timers.filter(t => t.id !== id); };
    Object.defineProperty(screen, 'width', { get: () => width });
    Object.defineProperty(screen, 'height', { get: () => height });
    window.__step = ms => {
      now += ms;
      for (const t of timers.filter(t => t.at <= now)) {
        if (t.every) t.at += Math.ceil((now - t.at + 1) / t.every) * t.every; else timers.splice(timers.indexOf(t), 1);
        t.f(...t.a);
      }
      const q = queue; queue = [];
      q.forEach(f => f(now));
    };
    // the WebGL canvas kept as it was last drawn, to be read between frames
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return getContext.call(this, type, /webgl/.test(type) ? { ...opts, preserveDrawingBuffer: true } : opts);
    };
  }, { seed, width, height });
  await page.goto(`http://render.local/roman-town.html?seed=${seed}&time=${plot.time}`);
  await page.addScriptTag({ path: path.join(__dirname, 'roman-town-plots.js') });

  // ---- in the page: a frame, the camera first where the plot has it, the
  // town on, drawn; what is heard noted every few frames ----
  await page.evaluate(({ name, seed }) => {
    const plot = RomanTownPlots[name], cam = window.camera, ear = RomanTownSound.create(town, seed);
    const ctx = { town, life, cam };
    window.__heard = [];
    let lastHeard = 0;
    // (dt of the film, at speed, unless the camera says how fast)
    window.__frame = (t, dt, speed, png) => {
      const [x, y, z, fast] = plot.camera(t, ctx);
      cam.look(x, y, z);
      window.__step(dt * 1000 * (fast ?? speed));
      if (t - lastHeard >= 0.15 || !window.__heard.length) {
        const v = cam.get();
        window.__heard.push([t, ear.hear(life, v.rect, v.sky, true), v.rect, Math.min(0.5, t - lastHeard)]);
        lastHeard = t;
      }
      return png ? document.getElementById('c').toDataURL('image/png').slice(22) : null;
    };
    // the plot's camera knows where it is from the first frame
    plot.camera(0, ctx);
  }, { name: args.plot, seed });

  const t0 = Date.now();
  if (stills) {
    fs.mkdirSync(args.out ?? '.', { recursive: true });
    const want = new Map(stills.map(s => [Math.round(s * fps), s])), last = Math.max(...want.keys());
    for (let f = 0; f <= last; f++) {
      const s = want.get(f);
      const png = await page.evaluate(a => window.__frame(...a), [f / fps, 1 / fps, speed(f / fps), s !== undefined]);
      if (s === undefined) continue;
      const v = await page.evaluate(() => { const c = camera.get(); return `${c.date.toTimeString().slice(0, 8)} at ${c.x.toFixed(0)},${c.y.toFixed(0)} ×${c.zoom.toFixed(1)}`; });
      const file = path.join(args.out ?? '.', `${args.plot}-${String(s).padStart(5, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(png, 'base64'));
      process.stderr.write(`${file}: ${v}\n`);
    }
    await browser.close();
    return;
  }

  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    const png = Buffer.from(await page.evaluate(a => window.__frame(...a, true), [f / fps, 1 / fps, speed(f / fps)]), 'base64');
    if (!process.stdout.write(png)) await new Promise(r => process.stdout.once('drain', r));
    if (f % (fps * 10) === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`${args.plot}: frame ${f}/${frames}  ${el.toFixed(0)} s elapsed, ~${(el / (f + 1) * (frames - f) / 60).toFixed(0)} min left\n`);
    }
  }

  // ---- what was heard, played offline as the page would have played it ----
  if (args.wav) {
    const b64 = await page.evaluate(async ({ seconds, SR, seed }) => {
      const ac = new OfflineAudioContext(2, Math.round(seconds * SR), SR);
      const sound = RomanTownSound.create(town, seed, ac);
      for (const [t, heard, rect, dt] of window.__heard) sound.play(heard, rect, t, dt || 0.15);
      const buf = await ac.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1), out = new Float32Array(L.length * 2);
      for (let i = 0; i < L.length; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
      let s = '';
      const bytes = new Uint8Array(out.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, { seconds, SR, seed });
    const data = Buffer.from(b64, 'base64'), wav = Buffer.alloc(44);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + data.length, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 8, 28); wav.writeUInt16LE(8, 32); wav.writeUInt16LE(32, 34);
    wav.write('data', 36); wav.writeUInt32LE(data.length, 40);
    fs.writeFileSync(args.wav, Buffer.concat([wav, data]));
  }
  process.stderr.write(`${args.plot}: ${frames} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
