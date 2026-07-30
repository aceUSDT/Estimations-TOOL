/* The schematic orders, checked against real drawings' expected take-offs.
 *
 * TWO fixtures, because one drawing only teaches its own conventions:
 *   schematic-pb1.expected.json          12-way TP&N panelboard. Frame/trip
 *                                        written inline, "GREY BY OTHERS" in
 *                                        words, feeds drawn as boxes.
 *   schematic-sb4-daltons.expected.json  SB/4 Daltons LV panelboard. Frame/trip
 *                                        STACKED, items greyed with no wording,
 *                                        feeds drawn as captions, cable sizes
 *                                        listed once at the side.
 *
 * Each states what a correct reading returns. This asserts that the standing
 * orders instruct an agent to look for every kind of thing the fixtures contain,
 * and that the result schema has somewhere to put it.
 *
 * It cannot assert that a model reads the drawings correctly — that needs an
 * extraction key and the drawings themselves. What it CAN stop is the orders and
 * the expectation drifting apart, which is how a fixture quietly stops meaning
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

const readFixture = async (name) =>
  JSON.parse(await fs.readFile(path.join(HERE, 'fixtures', name), 'utf8'));
const fixture = await readFixture('schematic-pb1.expected.json');
const sb4 = await readFixture('schematic-sb4-daltons.expected.json');
const { runAgentTeam } = await load('api/_lib/extraction/agent-team.mjs');
const { EXTRACTION_SCHEMA, NUMERIC_FIELDS } = await load('api/_lib/extraction/domain-pack.mjs');

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
/* The second drawing's conventions. Every one of these is something PB1 did not
 * show, so each existed as an untested assumption until this drawing arrived. */
const coveredSb4 = [
  ['a frame/trip pair printed STACKED, not inline', /STACKED/],
  ['a way set to its full frame printing the same figure twice', /same number twice/],
  ['greying as a convention, said nowhere in words', /GREYING IS A CONVENTION/],
  ['a caption naming the board a way feeds', /names WHAT IT FEEDS/],
  ['cable sizes listed once at the side, not per way', /listed ONCE at the side/],
  ['the busbar\'s own rating and withstand', /BUSBAR SHORT/],
  ['the construction form belongs to the board', /FORM 3b/],
];
for (const [what, re] of coveredSb4) {
  check(`orders cover (SB/4): ${what}`, re.test(orders));
}

/* The fixtures are only meaningful if the schema can carry them. */
const props = EXTRACTION_SCHEMA.properties;
check('schema carries boards', Boolean(props.boards));
check('schema carries devices', Boolean(props.devices));
check('schema carries feeds', Boolean(props.feeds));
check('schema carries flags for "by others"', Boolean(props.flags));
check('schema carries the layout reading', Boolean(props.layout));

/* An order telling an agent to return something the schema forbids is worse than
 * no order at all: additionalProperties:false means the value is rejected, so the
 * work is done and then discarded. These four were exactly that until the
 * fixtures above were written down. */
const boardProps = props.boards.items.properties;
const deviceProps = props.devices.items.properties;
check('schema carries a frame/trip PAIR, not one rating (order 22)',
  Boolean(deviceProps.frame_a && deviceProps.setting_a));
check('schema records a device drawn greyed (order 30)', Boolean(deviceProps.drawn_greyed));
check('schema carries board-level cable specs (order 32)', Boolean(boardProps.board_cables));
check('schema carries busbar rating and withstand (order 33)',
  Boolean(boardProps.busbar_rating_a && boardProps.busbar_withstand_text));
/* Busbar and incomer ratings must be SEPARATE fields. SB/4 happens to have a
   250A busbar behind a 250A switch, but a 250A busbar behind a 160A incomer is
   routine, and one field cannot hold both. */
check('busbar rating is a field of its own, not folded into the incomer',
  Boolean(boardProps.busbar_rating_a) && Boolean(boardProps.incomer_rating_a));
/* Numbers arrive from the provider as strings; anything not coerced reaches the
   report as "63" and silently fails every arithmetic comparison. */
check('new numeric fields are coerced back to numbers',
  NUMERIC_FIELDS.device.includes('frame_a') && NUMERIC_FIELDS.device.includes('setting_a')
  && NUMERIC_FIELDS.board.includes('busbar_rating_a'));

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

/* SB/4 the same way. Its totals are different in kind from PB1's — reduced
 * settings, greyed items and board-level cable types instead of spares and
 * single-phase splits — so they need their own arithmetic. */
const s4 = sb4.ways;
const s4totals = sb4.totals_for_review;
check('SB/4: every way of the board is listed', s4.length === sb4.board.ways_total, `${s4.length} of ${sb4.board.ways_total}`);
check('SB/4: MCCB count matches its rows', s4.length === s4totals.outgoing_mccbs, String(s4.length));
/* A reduced setting is the whole point of carrying both figures: price the frame,
   protect at the setting. If these ever collapse to one number the count goes to 0. */
const reduced = s4.filter((w) => w.setting_a != null && w.frame_a != null && w.setting_a < w.frame_a).length;
check('SB/4: reduced-setting count matches its rows', reduced === s4totals.of_which_reduced_setting, String(reduced));
const s4metered = s4.filter((w) => w.metered).length;
check('SB/4: meter count matches its rows', s4metered === s4totals.way_meters, String(s4metered));
const greyed = s4.filter((w) => w.drawn_greyed).length;
check('SB/4: greyed count matches its rows', greyed === s4totals.greyed_items, String(greyed));
check('SB/4: board cable types match its rows',
  sb4.board_cables.length === s4totals.board_cable_types, String(sb4.board_cables.length));
/* Every way must carry BOTH figures. A stacked pair read as one number is the
   failure this drawing was added to catch. */
check('SB/4: every way states frame and setting',
  s4.every((w) => Number.isFinite(w.frame_a) && Number.isFinite(w.setting_a)));
check('SB/4: illegible ways are listed, not dropped', s4.some((w) => w.legible === false));
/* The greyed ways must also be flagged for the reviewer, not only marked on the
   row — greying said nowhere in words is a pricing question, not a data point. */
check('SB/4: greying is raised as a flag as well as a field',
  sb4.flags.some((f) => /grey/i.test(f.message)));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: schematic orders cover both annotated drawings; schema carries every field; fixtures are self-consistent.');
