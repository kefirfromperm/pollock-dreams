#!/usr/bin/env node
// Render pollock-dreams.html frame by frame on a virtual clock and write the frames
// to stdout as a PNG stream (for ffmpeg -f image2pipe).
//
//   node scripts/render-frames.cjs [--seed N] [--seconds S] [--fps F] [--width W] [--height H]
//
// The page's clock (performance.now, requestAnimationFrame) is replaced, so
// every frame advances exactly 1/fps seconds however long it takes to draw,
// and Math.random is seeded, so one seed always gives the same painting.
// Needs playwright-core (NODE_PATH) and chromium.
const path = require('path');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, Number(v)]));
const seed = args.seed ?? 1, seconds = args.seconds ?? 600, fps = args.fps ?? 30;
const width = args.width ?? 1920, height = args.height ?? 1080;
const frames = Math.round(seconds * fps);

const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => require('fs').existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route(/^https?:/, r => r.abort()); // no analytics
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
    window.__frame = ms => {
      now += ms;
      const q = queue; queue = [];
      q.forEach(f => f(now));
      return document.getElementById('c').toDataURL('image/png').slice(22);
    };
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#hint { display: none !important; }';
      document.head.append(s);
    });
  }, { seed, width, height });
  await page.goto('file://' + path.resolve(__dirname, '../pollock-dreams.html'));

  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const png = Buffer.from(await page.evaluate(ms => window.__frame(ms), 1000 / fps), 'base64');
    if (!process.stdout.write(png)) await new Promise(r => process.stdout.once('drain', r));
    if (f % (fps * 10) === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`frame ${f}/${frames}  ${el.toFixed(0)} s elapsed, ~${(el / (f + 1) * (frames - f) / 60).toFixed(0)} min left\n`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
