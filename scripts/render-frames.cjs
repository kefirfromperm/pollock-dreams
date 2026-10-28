#!/usr/bin/env node
// Render an endless painting frame by frame on a virtual clock and write the
// frames to stdout as a PNG stream (for ffmpeg -f image2pipe).
//
//   node scripts/render-frames.cjs [--page P] [--seed N] [--seconds S] [--fps F]
//                                  [--width W] [--height H] [--skip S] [--pours F]
//
//   page   the painting (default pollock-dreams.html)
//   skip   seconds painted before the first frame is written (default 0)
//   pours  a JSON file to write how the painting poured (its pour events:
//          [video seconds, dt, flow, pan, fresh] each frame), for
//          render-music.cjs to gurgle in time with the video
//
// The page's clock (performance.now, requestAnimationFrame) is replaced, so
// every frame advances exactly 1/fps seconds however long it takes to draw,
// and Math.random is seeded, so one seed always gives the same painting.
// Needs playwright-core (NODE_PATH) and chromium; WebGL paintings are drawn
// by its software GPU (SwiftShader).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, isNaN(v) ? v : Number(v)]));
const pageName = args.page ?? 'pollock-dreams.html';
const seed = args.seed ?? 1, seconds = args.seconds ?? 600, fps = args.fps ?? 30;
const width = args.width ?? 1920, height = args.height ?? 1080, skip = args.skip ?? 0, poursFile = args.pours;
const frames = Math.round(seconds * fps), root = path.resolve(__dirname, '..');
const webgl = /getContext\('webgl/.test(fs.readFileSync(path.join(root, pageName), 'utf8'));

const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath,
    args: webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  // the project's files on a made-up origin, nothing else (no analytics)
  await page.route(/^https?:/, r => {
    const u = new URL(r.request().url());
    if (u.host !== 'render.local') return r.abort();
    const file = path.join(root, decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404 });
    r.fulfill({ body: fs.readFileSync(file) });
  });
  await page.addInitScript(({ seed, width, height }) => {
    let a = seed;
    Math.random = () => { // mulberry32
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    let now = 0, queue = [];
    performance.now = () => now;
    window.requestAnimationFrame = f => queue.push(f);
    Object.defineProperty(screen, 'width', { get: () => width });
    Object.defineProperty(screen, 'height', { get: () => height });
    const step = ms => {
      now += ms;
      const q = queue; queue = [];
      q.forEach(f => f(now));
    };
    window.__skip = (ms, n) => { for (let i = 0; i < n; i++) step(ms); };
    window.__pours = [];
    addEventListener('pour', ({ detail: d }) => window.__pours.push([now / 1000, d.dt, d.flow, d.pan, d.fresh]));
    window.__frame = ms => {
      step(ms);
      return document.getElementById('c').toDataURL('image/png').slice(22);
    };
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#hint { display: none !important; }';
      document.head.append(s);
    });
  }, { seed, width, height });
  await page.goto(`http://render.local/${pageName}`);

  const t0 = Date.now();
  for (let n = Math.round(skip * fps); n > 0; n -= fps)
    await page.evaluate(([ms, n]) => window.__skip(ms, n), [1000 / fps, Math.min(n, fps)]);
  if (skip) process.stderr.write(`skipped ${skip} s in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  for (let f = 0; f < frames; f++) {
    const png = Buffer.from(await page.evaluate(ms => window.__frame(ms), 1000 / fps), 'base64');
    if (!process.stdout.write(png)) await new Promise(r => process.stdout.once('drain', r));
    if (f % (fps * 10) === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`frame ${f}/${frames}  ${el.toFixed(0)} s elapsed, ~${(el / (f + 1) * (frames - f) / 60).toFixed(0)} min left\n`);
    }
  }
  if (poursFile) {
    // frame f, at f / fps in the video, shows the painting at skip + (f + 1) / fps
    const pours = (await page.evaluate(() => window.__pours))
      .map(([t, ...p]) => [+(t - skip - 1 / fps).toFixed(4), ...p]);
    fs.writeFileSync(poursFile, JSON.stringify(pours));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
