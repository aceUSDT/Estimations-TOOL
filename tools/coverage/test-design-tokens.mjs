/* A ratchet on visual consistency.
 *
 * The audit in docs/DESIGN_BRIEF.md found 20 font sizes, 11 radii and 22 padding
 * values in index.html. None of that is a bug in the usual sense — every value
 * works — which is exactly why it accumulated: nothing was counting.
 *
 * A design system decays without enforcement, and this project already has the
 * habit that fixes it: a test that fails when a number moves the wrong way. The
 * budgets below are the CURRENT measured counts, not aspirations. They may only
 * ever go DOWN. Adding the 21st font size fails the build; removing one and
 * lowering the budget is how the system gets built, incrementally, without a
 * risky rewrite of a 335KB file that carries the whole extraction pipeline.
 *
 * TARGET is where each should land (docs/DESIGN_BRIEF.md). It is reported, not
 * enforced — the point is direction of travel, not a cliff nobody can ship past.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

const distinct = (re) => [...new Set((html.match(re) || []).map((m) => m.replace(/^[^:]*:\s*/, '')))];

/* Each budget is what index.html contains today. Lower it when you remove one. */
const BUDGETS = [
  { what: 'font sizes',    re: /font-size:\s*[0-9.]+(?:px|rem|em)/g,   budget: 20, target: 8,
    why: 'includes 10.5 / 11.5 / 12.5 / 13.5 / 14.5px — half-steps are the clearest sign nothing is on a scale' },
  { what: 'border radii',  re: /border-radius:\s*[0-9.]+px/g,          budget: 11, target: 4,
    why: '2,3,4,5,6,7,8,9,11,12,14px — every value chosen locally' },
  { what: 'padding steps', re: /padding:\s*[0-9]+px/g,                 budget: 22, target: 8,
    why: 'nearly every integer from 2 to 16px' },
];

for (const { what, re, budget, target, why } of BUDGETS) {
  const found = distinct(re);
  check(`${what}: no more than ${budget} distinct values`, found.length <= budget,
    `${found.length} found. ${why}`);
  if (found.length < budget) {
    console.log(`  ↓ ${what}: ${found.length} (budget ${budget}) — lower the budget in this file to lock the gain in`);
  }
  if (found.length > target) console.log(`  · ${what}: ${found.length} → target ${target}`);
}

/* Half-pixel type is the specific tell. Ratchet it to zero separately, because
   removing these is mechanical and needs no design decisions. */
const halfPixel = distinct(/font-size:\s*[0-9]+\.[0-9]+px/g);
/* Budget 6 because index.html contains 6 today. A ratchet MUST start at the
   measured value: set it at an aspiration and the suite is red on day one, and a
   check that cannot be actioned is one people learn to ignore — the exact
   mistake PROJECT_HISTORY §2.5 records, where ten false completeness alarms
   trained the estimator to skip the eleventh, which was real. */
check('half-pixel font sizes: no more than 6', halfPixel.length <= 6, halfPixel.join(', '));
if (halfPixel.length) console.log(`  · half-pixel sizes still present: ${halfPixel.join(', ')} (target 0)`);

/* Motion with no easing curve reads as cheap, and it is the least risky thing to
   fix in the whole system — a curve cannot break a layout. */
const bareTransitions = (html.match(/transition:\s*\.?[0-9.]+s\s*[;"}]/g) || []);
check('transitions with no easing curve: no more than 3', bareTransitions.length <= 3,
  `${bareTransitions.length}: ${[...new Set(bareTransitions)].join(' ')}`);

/* Keyboard focus. Currently zero, which is both an accessibility failure and the
   clearest visual signal of an unfinished interface. Any increase is progress;
   this asserts it never goes back to nothing once started. */
const focusVisible = (html.match(/:focus-visible/g) || []).length;
console.log(`  · :focus-visible rules: ${focusVisible} (target: every interactive element)`);

/* Two primaries doing similar jobs reads as an accident rather than a choice.
   Recorded so that resolving it is a deliberate act, not a silent drift. */
const hasBothBlues = /--brand:\s*#009ee2/.test(html) && /--blue:\s*#1668e3/.test(html);
if (hasBothBlues) console.log('  · two primary blues still defined (--brand #009ee2, --blue #1668e3) — give one a distinct job');

if (fail) {
  console.log(`\n${fail} budget(s) exceeded. A new one-off value was added.`);
  console.log('Use an existing token, or lower a budget deliberately if you removed values.');
  process.exit(1);
}
console.log('PASS: design token budgets held (see docs/DESIGN_PLAN.md for the ratchet).');
