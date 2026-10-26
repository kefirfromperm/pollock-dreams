#!/usr/bin/env node
// Render the Open Graph image (1200x630) of an endless painting: paint it for
// a while on a virtual clock, then write its title over it with og/og.html.
//
//   node scripts/make-og-endless.cjs [--page rectangle-dreams.html] [--text "Rectangle Dreams"]
//                                    [--seed N] [--seconds S] [--out og/og-rectangles.png]
//   node scripts/make-og-endless.cjs --page pour-dreams.html --text "Pour Dreams" \
//                                    --seed 5 --seconds 150 --out og/og-pour.png
//
// Needs playwright-core (NODE_PATH) and chromium (WebGL paintings are drawn
// by its software GPU, SwiftShader); og.html loads opentype.js from cdnjs,
// so it also needs network access.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/(?:^| )--/).filter(Boolean)
  .map(s => s.trim()).map(s => [s.split(/\s+/)[0], s.slice(s.split(/\s+/)[0].length).trim().replace(/^"(.*)"$/, '$1')]));
const pageName = args.page ?? 'rectangle-dreams.html', text = args.text ?? 'Rectangle Dreams';
const seed = Number(args.seed ?? 23), seconds = Number(args.seconds ?? 40);
const out = path.resolve(args.out ?? path.join(__dirname, '../og/og-rectangles.png'));
const width = 1200, height = 630, root = path.resolve(__dirname, '..');
const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  // the project's files on a made-up origin (og.html loads its font over
  // XHR, which file:// doesn't allow); cdnjs for opentype.js; nothing else
  let bg;
  await page.route(/^https?:/, r => {
    const u = new URL(r.request().url());
    if (u.host === 'cdnjs.cloudflare.com') return r.continue();
    if (u.host !== 'og.local') return r.abort(); // no analytics
    if (u.pathname === '/bg.png') return r.fulfill({ body: bg, contentType: 'image/png' });
    const file = path.join(root, decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404 });
    r.fulfill({ body: fs.readFileSync(file) });
  });

  // 1. the painting, its time and randomness under our control
  await page.addInitScript(({ seed, width, height, pageName }) => {
    if (location.pathname !== '/' + pageName) return;
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
      return document.getElementById('c').toDataURL('image/png').slice(22);
    };
  }, { seed, width, height, pageName });
  await page.goto(`http://og.local/${pageName}`);
  bg = Buffer.from(await page.evaluate(ms => window.__run(ms, 1000 / 30), seconds * 1000), 'base64');

  // 2. the title over it
  await page.goto(`http://og.local/og/og.html?seed=${seed}&bg=/bg.png&text=${encodeURIComponent(text)}`);
  await page.waitForFunction(() => /^(DONE|ERROR)/.test(document.title), null, { timeout: 60000 });
  const title = await page.title();
  if (title.startsWith('ERROR')) throw new Error(title);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
