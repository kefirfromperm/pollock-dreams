#!/usr/bin/env node
// Render the gallery previews on the front page: paint each endless painting
// for a while on a virtual clock and save its canvas as a JPEG, untitled.
//
//   node scripts/make-previews.cjs [--seconds S]
//
// Needs playwright-core (NODE_PATH) and chromium.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, v]));
const seconds = Number(args.seconds ?? 40);
const width = 800, height = 1000, root = path.resolve(__dirname, '..');
const PAINTINGS = [
  { page: 'pollock-dreams.html', seed: 7, out: 'previews/pollock-dreams.jpg' },
  { page: 'rectangles.html', seed: 23, out: 'previews/rectangles.jpg' },
];
const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--disable-gpu'] });
  fs.mkdirSync(path.join(root, 'previews'), { recursive: true });
  for (const { page: name, seed, out } of PAINTINGS) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // the project's files on a made-up origin, nothing else (no analytics)
    await page.route(/^https?:/, r => {
      const u = new URL(r.request().url());
      if (u.host !== 'preview.local') return r.abort();
      const file = path.join(root, decodeURIComponent(u.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404 });
      r.fulfill({ body: fs.readFileSync(file) });
    });
    // the painting, its time and randomness under our control
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
      window.__run = (ms, step) => {
        for (let t = 0; t < ms; t += step) {
          now += step;
          const q = queue; queue = [];
          q.forEach(f => f(now));
        }
        return document.getElementById('c').toDataURL('image/jpeg', 0.85).slice(23);
      };
    }, { seed, width, height });
    await page.goto(`http://preview.local/${name}`);
    const jpeg = await page.evaluate(ms => window.__run(ms, 1000 / 30), seconds * 1000);
    fs.writeFileSync(path.join(root, out), Buffer.from(jpeg, 'base64'));
    await page.close();
    console.log(out);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
