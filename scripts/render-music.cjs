#!/usr/bin/env node
// Render an endless painting's own Web Audio music offline, as the page would
// play it for the same seed, and write it to stdout as a stereo 32-bit float WAV.
//
//   node scripts/render-music.cjs [--page P] [--seed N] [--seconds S]
//                                 [--pours F] [--from S] > music.wav
//
//   page   the painting (default pollock-dreams.html); its music is the
//          *-music.js it loads, at the master LEVEL given there
//   seed   the seed given to render-frames.cjs: the page's own seed is the
//          first Math.random() it draws from it
//   pours  how the painting poured, as render-frames.cjs writes it, for music
//          that hears the paint (pour-music.js): it gurgles in time with the
//          video, a video second v being music second from + v
//   from   where the video starts in the music (default 0)
//
// Needs playwright-core (NODE_PATH) and chromium.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, isNaN(v) ? v : Number(v)]));
const pageName = args.page ?? 'pollock-dreams.html';
const seed = args.seed ?? 1, seconds = args.seconds ?? 60, from = args.from ?? 0, SR = 48000;
const pours = args.pours ? JSON.parse(fs.readFileSync(args.pours, 'utf8')) : [];
const root = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(root, pageName), 'utf8');
const musicFile = html.match(/<script src="([\w-]*music\.js)">/)[1];
const musicSrc = fs.readFileSync(path.join(root, musicFile), 'utf8');
const musicName = musicSrc.match(/^const (\w+) = \(\(\) =>/m)[1];
const level = Number(musicSrc.match(/const LEVEL = ([\d.]+)/)[1]);
const ahead = Number(musicSrc.match(/const AHEAD = ([\d.]+)/)[1]);

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pageSeed = (mulberry32(seed)() * 1e9) | 0;

const browserPath = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><title>music</title>');
  for (const file of ['pollock.js', musicFile]) await page.addScriptTag({ path: path.join(root, file) });

  // the player's chain, without its fade in: a limiter as a safety net and the master gain
  const b64 = await page.evaluate(async ({ musicName, pageSeed, seconds, level, ahead, SR, pours, from }) => {
    const ac = new OfflineAudioContext(2, Math.round(seconds * SR), SR);
    const limit = ac.createDynamicsCompressor();
    limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20;
    limit.attack.value = 0.003; limit.release.value = 0.25;
    limit.connect(ac.destination);
    const master = ac.createGain();
    master.gain.value = level;
    master.connect(limit);
    const music = eval(musicName).graph(ac, pageSeed, master), at = music.time?.(); // a WAV second w is music second w + at
    if (music.pour) for (const [t, dt, flow, pan, fresh] of pours)
      if (from + t < seconds) music.pour(from + t + at, dt, { flow, pan, fresh });
    music.schedule(seconds + ahead);
    const buf = await ac.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), out = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
    let s = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { musicName, pageSeed, seconds, level, ahead, SR, pours, from });
  await browser.close();

  const data = Buffer.from(b64, 'base64'), wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + data.length, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 8, 28); wav.writeUInt16LE(8, 32); wav.writeUInt16LE(32, 34);
  wav.write('data', 36); wav.writeUInt32LE(data.length, 40);
  process.stdout.write(Buffer.concat([wav, data]));
  process.stderr.write(`${musicFile} (${musicName}), page seed ${pageSeed}, ${seconds} s\n`);
})().catch(e => { console.error(e); process.exit(1); });
