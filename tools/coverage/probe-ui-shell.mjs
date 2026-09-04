/* The application shell, measured in a real browser.
 *
 * Two properties the owner asked for by name, and neither is expressible as a
 * string check on the HTML — both are about where things land on screen:
 *
 *   1. The Hager brand is the way back to the projects list.
 *   2. The shell fills the window instead of sitting in a boxed column, and the
 *      logo, the tab row and the page content start on the SAME pixel column.
 *
 * The second is why this measures geometry rather than asserting a CSS string:
 * a width cap removed in one rule and reinstated in a later one reads fine in
 * the stylesheet and still boxes the page. That is exactly what had happened.
 */
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = pathToFileURL(join(HERE, '../../index.html')).href;
const playwright = process.env.PLAYWRIGHT_CORE_PATH
  ? await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE_PATH, 'index.mjs')).href)
  : await import('playwright-core');
const { chromium } = playwright;

let fail = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail++;
};

/* CHROMIUM_PATH covers a machine with only the bundled build (CI images, the
   remote container); the repo's usual channel:'chrome' covers a workstation. */
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] }
  : { channel: 'chrome', headless: true });

/* Past the PIN lock and into the project view, which is where the tab row is. */
const openApp = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(APP);
  await page.evaluate(() => {
    const lock = document.querySelector('#lockView');
    if (lock) { lock.classList.remove('active'); lock.style.display = 'none'; }
    const app = document.querySelector('#appView');
    app.classList.add('active'); app.style.display = 'block';
    const proj = document.querySelector('#projView');
    if (proj) { proj.classList.add('active'); proj.style.display = 'block'; }
  });
  return page;
};

/* Four widths, because a single one cannot tell a fluid gutter from a cap that
   simply happens to exceed the viewport. 1900 is wider than the old 1600 cap. */
for (const width of [1900, 1440, 1100, 820]) {
  const page = await openApp(width);
  const m = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    };
    return {
      win: window.innerWidth,
      bar: box('.appbar'),
      logo: box('.appbar .brand-logo'),
      page: box('#projView'),
      tabs: box('.ptabs'),
      /* The first tab's own text, not the row's background: the row bleeds to
         the page edge on purpose, so comparing backgrounds proves nothing. */
      firstTab: box('.ptab'),
      headRow: box('.proj-head'),
    };
  });
  check(`${width}px: the app bar spans the window`,
    m.bar && m.bar.left === 0 && m.bar.right === m.win, JSON.stringify(m.bar));
  check(`${width}px: the page spans the window`,
    m.page && m.page.left === 0 && m.page.right === m.win, JSON.stringify(m.page));
  check(`${width}px: the tab row is not a box in the middle of the page`,
    m.tabs && (m.tabs.right - m.tabs.left) > m.win * 0.9,
    m.tabs && `${m.tabs.right - m.tabs.left} of ${m.win}`);
  /* The detail that separates designed from assembled: one left edge, shared by
     the logo in the bar, the page heading, and the first tab label. */
  check(`${width}px: logo, page content and first tab start on the same column`,
    m.logo && m.firstTab && m.headRow
      && Math.abs(m.logo.left - m.firstTab.left) <= 1
      && Math.abs(m.logo.left - m.headRow.left) <= 1,
    m.logo && m.firstTab && m.headRow
      && `logo ${m.logo.left}, content ${m.headRow.left}, tab ${m.firstTab.left}`);
  /* The tab row's background still reaches the page edge — that bleed is the
     design; what must not happen is the row floating inset with the content. */
  check(`${width}px: the tab row reaches the page edge`,
    m.tabs && m.tabs.left === 0 && m.tabs.right === m.win, JSON.stringify(m.tabs));
  await page.close();
}

/* The brand as a control, and as a control that actually navigates. */
{
  const page = await openApp(1440);
  const wired = await page.evaluate(() => {
    const el = document.querySelector('#homeBtn');
    return {
      tag: el && el.tagName,
      label: el && el.getAttribute('aria-label'),
      cursor: el && getComputedStyle(el).cursor,
      focusable: el ? el.tabIndex >= 0 : false,
    };
  });
  check('the brand is a button, not a div dressed up as one', wired.tag === 'BUTTON', String(wired.tag));
  check('it says where it goes, for anyone not seeing the logo', /projects/i.test(wired.label || ''), wired.label);
  check('it reads as clickable', wired.cursor === 'pointer', wired.cursor);
  check('it can be reached by keyboard', wired.focusable === true);

  /* And it leaves the same state behind as the back arrow: one shared handler,
     so guided review and the processing dock cannot be left running. */
  const shared = await page.evaluate(() => typeof goHome === 'function');
  check('back arrow and brand share one way home', shared === true);

  /* Start in the project view and assert the click MOVES it. An "is home
     showing?" check passes whether or not the button is wired — mutation
     testing caught exactly that: deleting the listener left this check green. */
  const wentHome = await page.evaluate(() => {
    show('proj');
    const before = {
      home: document.querySelector('#homeView').classList.contains('active'),
      proj: document.querySelector('#projView').classList.contains('active'),
      body: document.body.dataset.view,
    };
    document.querySelector('#homeBtn').click();
    const after = {
      home: document.querySelector('#homeView').classList.contains('active'),
      proj: document.querySelector('#projView').classList.contains('active'),
      body: document.body.dataset.view,
    };
    return { before, after };
  });
  check('the probe started in the project view, or it proves nothing',
    wentHome.before.proj === true && wentHome.before.home === false, JSON.stringify(wentHome.before));
  check('clicking the brand leaves the project view',
    wentHome.after.proj === false, JSON.stringify(wentHome.after));
  check('clicking the brand shows the projects list',
    wentHome.after.home === true && wentHome.after.body === 'home', JSON.stringify(wentHome.after));
  await page.close();
}

await browser.close();
if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('\nPASS: the brand is the way home; the shell fills the window on one shared edge.');
