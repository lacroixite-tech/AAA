// Usage: node scripts/shot.mjs <shotName...> [--w=1600 --h=900 --out=shots --q=high --wait=90]
// Starts a private Vite server on a free port, renders each /?shot=<name> in headless
// Chromium (SwiftShader/ANGLE WebGL), and writes shots/<name>.png. Prints console errors.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length) names.push('overview');
const W = +(opt.w || 1600), H = +(opt.h || 900), out = opt.out || 'shots';
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error', clearScreen: false });
await server.listen();
const url = server.resolvedUrls.local[0];
const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
let failed = false;
try {
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
    const t0 = Date.now();
    await page.goto(`${url}?shot=${encodeURIComponent(name)}&q=${opt.q || 'high'}${opt.frames ? '&frames=' + opt.frames : ''}`, { waitUntil: 'commit', timeout: 0 });
    try { await page.waitForFunction(() => window.__READY === true, null, { timeout: +(opt.timeout || 240000), polling: 500 }); }
    catch { errs.push('[timeout] window.__READY never set'); failed = true; }
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    for (const e of errs.slice(0, 20)) console.log('   ', e);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
process.exit(failed ? 1 : 0);
