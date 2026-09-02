/* The app shell: does the logo go home, and does every full-width surface share
 * one left edge? The gutter disagreement (app bar 18px, page 22px) is invisible
 * until you measure it, and then you cannot unsee it. */
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); bad++; } };

for (const width of [1900, 1440, 1100, 820]) {
  const page = await (await b.newContext({ viewport: { width, height: 900 } })).newPage();
  await page.goto('http://127.0.0.1:8765/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined"');
  await page.waitForSelector('.proj-card.new', { timeout: 30000 });
  const m = await page.evaluate(`(() => {
    const r = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const logo = r('#homeBtn .brand-logo'), pg = r('.page'), card = r('.proj-card');
    const firstContent = card || pg;
    return {
      vw: window.innerWidth,
      pageW: Math.round(pg.width), gapR: Math.round(window.innerWidth - pg.right),
      logoL: Math.round(logo.left), contentL: Math.round(firstContent.left),
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
  console.log(`${String(width).padStart(4)}px  page ${String(m.pageW).padStart(4)}px  logo@${String(m.logoL).padStart(3)}  content@${String(m.contentL).padStart(3)}`);
  check(`${width}px: page fills the viewport`, m.pageW === m.vw, `${m.pageW} of ${m.vw}`);
  check(`${width}px: logo and content share a left edge`, Math.abs(m.logoL - m.contentL) <= 1,
    `logo ${m.logoL} vs content ${m.contentL}`);
  check(`${width}px: no horizontal scrollbar`, !m.hOverflow);
  await page.context().close();
}
await b.close();
if (bad) { console.log(`\n${bad} failure(s)`); process.exit(1); }
console.log('PASS: full-bleed at every width, one shared left edge, no overflow.');
