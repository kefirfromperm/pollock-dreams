#!/usr/bin/env node
// Render the gallery's Open Graph image (1200x630): the three paintings'
// previews side by side, the site's title written over them with og/og.html.
//
//   node scripts/make-og-gallery.cjs [--seed N] [--out og/og-gallery.png]
//
// Run scripts/make-previews.cjs first. Needs playwright-core (NODE_PATH) and
// chromium; og.html loads opentype.js from cdnjs, so it also needs network
// access.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, v]));
const seed = Number(args.seed ?? 3);
const out = path.resolve(args.out ?? path.join(__dirname, '../og/og-gallery.png'));
const width = 1200, height = 630, root = path.resolve(__dirname, '..');
const PREVIEWS = ['previews/pollock-dreams.jpg', 'previews/rectangle-dreams.jpg', 'previews/pour-dreams.jpg'];
const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  // the project's files on a made-up origin (og.html loads its font over
  // XHR, which file:// doesn't allow); cdnjs for opentype.js; nothing else
  let bg;
  await page.route(/^https?:/, r => {
    const u = new URL(r.request().url());
    if (u.host === 'cdnjs.cloudflare.com') return r.continue();
    if (u.host !== 'og.local') return r.abort();
    if (u.pathname === '/bg.png') return r.fulfill({ body: bg, contentType: 'image/png' });
    if (u.pathname === '/blank.html') return r.fulfill({ body: '<!doctype html><canvas></canvas>', contentType: 'text/html' });
    const file = path.join(root, decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404 });
    r.fulfill({ body: fs.readFileSync(file) });
  });

  // 1. the previews in three panels, each cropped to fill its panel
  await page.goto('http://og.local/blank.html');
  bg = Buffer.from(await page.evaluate(async ({ PREVIEWS, width, height }) => {
    const c = document.querySelector('canvas'), ctx = c.getContext('2d'), w = width / PREVIEWS.length;
    c.width = width; c.height = height;
    for (const [k, src] of PREVIEWS.entries()) {
      const img = new Image();
      img.src = '/' + src;
      await img.decode();
      const s = Math.max(w / img.width, height / img.height), sw = w / s, sh = height / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, k * w, 0, w, height);
    }
    return c.toDataURL('image/png').slice(22);
  }, { PREVIEWS, width, height }), 'base64');

  // 2. the title over them
  await page.goto(`http://og.local/og/og.html?seed=${seed}&bg=/bg.png&text=${encodeURIComponent('Digital Art Meditation')}`);
  await page.waitForFunction(() => /^(DONE|ERROR)/.test(document.title), null, { timeout: 60000 });
  const title = await page.title();
  if (title.startsWith('ERROR')) throw new Error(title);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
