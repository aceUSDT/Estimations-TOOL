/* The schematic orders, checked against a real drawing's expected take-off.
 *
 * fixtures/schematic-pb1.expected.json states what a correct reading of an
 * estimator's annotated 12-way panelboard returns. This asserts that the
 * standing orders actually instruct an agent to look for every kind of thing
 * that fixture contains, and that the result schema has somewhere to put it.
 *
 * It cannot assert that a model reads the drawing correctly — that needs an
 * extraction key and the drawing itself. What it CAN stop is the orders and the
 * expectation drifting apart, which is how a fixture quietly stops meaning
 * anything.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const load = (p) => import(pathToFileURL(path.resolve(ROOT, p)));

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

const fixture = JSON.parse(await fs.readFile(path.join(HERE, 'fixtures/schematic-pb1.expected.json'), 'utf8'));
const { runAgentTeam } = await load('api/_lib/extraction/agent-team.mjs');
const { EXTRACTION_SCHEMA } = await load('api/_lib/extraction/domain-pack.mjs');

/* The orders a schematic page actually receives. */
const prompts = [];
await runAgentTeam(
  { textLines: ['LV SINGLE LINE DIAGRAM', 'BUSBAR', '12WAY TP&N PANELBOARD - PB1'], filename: 'pb1.pdf', pageNumber: 1 },
  {
    pool: { callRole: async (role, req) => { prompts.push(req.prompt); return { content: '{"devices":[]}', model: 'm', keyId: 1, ms: 1 }; } },
    crossCheck: () => ({ mismatches: [] }), geminiConfigured: false, buildInstruction: () => 'I',
  },
);
const orders = prompts[0] || '';
check('the page is recognised as a schematic', /THIS PAGE IS A SCHEMATIC/.test(orders));

/* Every field the fixture uses must be something the orders ask for. Each entry
 * is: what the drawing shows → the order that must cover it. */
const covered = [
  ['the panel is a board in its own right', /BOARD HEADER/],
  ['its way count and rating', /12WAY TP&N PANELBOARD|RATED CURRENT/],
  ['its location', /GROUND FLOOR PLANT ROOM|location/i],
  ['the incoming device frame and setting', /frame is 200A and the setting 160A/],
  ['metering, SPD and CTs as associated equipment', /NOT protective devices/],
  ['the incoming cable is not a rating', /not a device rating/],
  ['way number, rating, type and poles', /pole configuration/],
  ['a device named by model rather than class', /named by its MODEL, not by a class word/],
  ['a frame/trip pair on an outgoing way', /frame size and a trip/],
  ['a way split across L1, L2 and L3', /ONE way carrying THREE single-phase devices/],
  ['spare ways', /SPARE WAY" is a way that exists/],
  ['a meter drawn on a way', /circled M drawn on an outgoing way/],
  ['equipment marked by others', /BY OTHERS/],
];
for (const [what, re] of covered) {
  check(`orders cover: ${what}`, re.test(orders));
}

/* The fixture is only meaningful if the schema can carry it. */
const props = EXTRACTION_SCHEMA.properties;
check('schema carries boards', Boolean(props.boards));
check('schema carries devices', Boolean(props.devices));
check('schema carries feeds', Boolean(props.feeds));
check('schema carries flags for "by others"', Boolean(props.flags));
check('schema carries the layout reading', Boolean(props.layout));

/* Internal consistency: the fixture must not claim a total its own rows
 * contradict, or it would enshrine a wrong answer as the target. */
const ways = fixture.ways;
const spares = ways.filter((w) => w.spare).length;
const metered = ways.filter((w) => w.metered).length;
const singlePhase = ways.filter((w) => w.phase_config === 'SPN' && !w.spare).length;
const distinctWays = new Set(ways.map((w) => w.way)).size;
check('fixture: every way of the board is listed', distinctWays === fixture.board.ways_total,
  `${distinctWays} of ${fixture.board.ways_total}`);
check('fixture: spare count matches its rows', spares === fixture.totals_for_review.spare_ways, String(spares));
check('fixture: meter count matches its rows', metered === fixture.totals_for_review.way_meters, String(metered));
check('fixture: single-phase device count matches its rows',
  singlePhase === fixture.totals_for_review.of_which_single_phase_devices, String(singlePhase));
check('fixture: incomer items match', fixture.incomer.length === fixture.totals_for_review.incomer_items);
/* Anything the drawing was too coarse to read is listed, not dropped — an
   unread way is what the completeness check exists to surface. */
check('fixture: illegible items are still listed', ways.some((w) => w.legible === false));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: schematic orders cover the annotated drawing; fixture is self-consistent.');
