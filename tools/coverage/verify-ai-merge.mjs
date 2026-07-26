/* End-to-end check for WS0.4 client integration: with the extraction endpoint
 * mocked (Playwright route interception), dropping a PDF must trigger the AI
 * pass — page rendered + POSTed — and the returned boards/devices/feeds must
 * merge into the analysis as review-pending rows. No API key involved; this
 * tests everything except Claude itself.
 */
import { DEFAULT_FIXTURE } from './lib/paths.mjs';
import { launchAppPage, openNewProject } from './lib/browser.mjs';

const FIXTURE = DEFAULT_FIXTURE;

const MOCK_RESULT = {
  classification: { type: 'db_schedule', sub_format: 'simple', confidence: 0.9 },
  boards: [{
    ref: 'DB-E13', description: 'Distribution board E13', location: 'Riser 1', fed_from_ref: 'MSB1',
    serving: 'Small power', ways_total: 6, ways_sp: 6, ways_tp: null, spare_capacity_pct: null,
    incomer_class: 'Switch Disconnector', incomer_rating_a: 100, incomer_poles: 4,
    board_model: 'Hager JKD186TM', metering: 'MID kWh meter', fault_ka: 10,
    board_type_text: '6 WAY SP&N', continuation: false, confidence: 0.9,
  }],
  devices: [
    { board_ref: 'DB-E13', way: null, phase: '', description: 'Main switch', device_class: 'switch_disconnector', rating_a: 100, trip_curve: '', rcd_ma: null, afdd: false, poles: 4, cable_type: null, phase_csa_mm2: null, cpc_csa_mm2: null, circuit_config: '', install_method: null, is_spare: false, is_spd: false, is_incomer: true, confidence: 0.9 },
    { board_ref: 'DB-E13', way: 1, phase: 'L1', description: 'Sockets ring GF', device_class: 'RCBO', rating_a: 32, trip_curve: 'B', rcd_ma: 30, afdd: false, poles: 1, cable_type: 'T5', phase_csa_mm2: 2.5, cpc_csa_mm2: 1.5, circuit_config: 'RING', install_method: null, is_spare: false, is_spd: false, is_incomer: false, confidence: 0.92 },
    { board_ref: 'DB-E13', way: 2, phase: 'L1', description: 'Lighting', device_class: 'MCB', rating_a: 6, trip_curve: 'B', rcd_ma: null, afdd: false, poles: 1, cable_type: 'T1', phase_csa_mm2: 1.5, cpc_csa_mm2: 1.5, circuit_config: 'RADIAL', install_method: null, is_spare: false, is_spd: false, is_incomer: false, confidence: 0.9 },
    { board_ref: 'DB-E13', way: 3, phase: 'L1', description: 'Spare', device_class: 'spare', rating_a: null, trip_curve: '', rcd_ma: null, afdd: false, poles: null, cable_type: null, phase_csa_mm2: null, cpc_csa_mm2: null, circuit_config: '', install_method: null, is_spare: true, is_spd: false, is_incomer: false, confidence: 0.85 },
    { board_ref: 'DB-E13', way: 4, phase: 'L1', description: 'SPD Type 2', device_class: 'SPD', rating_a: null, trip_curve: '', rcd_ma: null, afdd: false, poles: null, cable_type: null, phase_csa_mm2: null, cpc_csa_mm2: null, circuit_config: '', install_method: null, is_spare: false, is_spd: true, is_incomer: false, confidence: 0.8 },
  ],
  feeds: [{ from_ref: 'MSB1', to_ref: 'DB-E13', device_class: 'MCCB', rating_a: 100, poles: 4, cable_ref: 'F3', cable_csa_mm2: 25, cable_cpc_mm2: 16, cable_desc: '4C 25mm² XLPE/SWA/LS0H', confidence: 0.85 }],
  flags: [{ kind: 'uncertain', message: 'Handwritten note near way 4 partially legible' }],
};

const { browser, page } = await launchAppPage();

// mock the serverless extraction endpoint
let postCount = 0;
let sawImage = false;
await page.route('**/.netlify/functions/extract', async (route) => {
  if (route.request().method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', configured: true, model: 'mock-model' }) });
    return;
  }
  postCount++;
  const body = JSON.parse(route.request().postData() || '{}');
  if (body.image_base64 && body.image_base64.length > 1000) sawImage = true;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: MOCK_RESULT, model: 'mock-model', usage: {} }) });
});

try {
  await openNewProject(page, 'AI merge check');
  await page.setInputFiles('#fileInput', FIXTURE);
  console.log('file dropped; waiting for OCR + analysis + mocked AI pass…');
  await page.waitForFunction('state.cur.analysis && state.cur.analysis.aiPages != null', null, { timeout: 300000 });
  const res = await page.evaluate(`({
    aiStatus: window.__aiStatus,
    aiPages: state.cur.analysis.aiPages,
    aiErrors: state.cur.analysis.aiErrors,
    aiRows: state.cur.analysis.rows.filter(r => r.kind === 'ai').length,
    boards: Object.keys(state.cur.analysis.boards),
    parentOfE13: state.cur.analysis.boards.DBE13 ? state.cur.analysis.boards.DBE13.parent : null,
    header: state.cur.analysis.boards.DBE13 ? state.cur.analysis.boards.DBE13.header : null,
    feeders: state.cur.analysis.feeders.filter(f => f.ai).length,
    spareRows: state.cur.analysis.rows.filter(r => r.kind === 'ai' && r.spare).length,
    spdRows: state.cur.analysis.rows.filter(r => r.kind === 'ai' && r.device === 'SPD').length,
    incomerRows: state.cur.analysis.rows.filter(r => r.kind === 'ai' && r.incomer).length,
    aiFlags: (state.cur.analysis.aiFlags || []).length,
  })`);
  console.log(JSON.stringify(res, null, 2), '\nPOSTs:', postCount, 'image sent:', sawImage);
  const fails = [];
  if (!res.aiStatus.startsWith('active')) fails.push('probe did not report active');
  if (postCount < 1) fails.push('no POST reached the endpoint');
  if (!sawImage) fails.push('no page image in the POST payload');
  if (res.aiRows < 5) fails.push(`expected ≥5 AI rows, got ${res.aiRows}`);
  if (!res.boards.includes('DBE13')) fails.push('AI board not merged');
  if (res.parentOfE13 !== 'MSB1') fails.push(`fed_from not applied (parent=${res.parentOfE13})`);
  if (!res.header || res.header.board_model !== 'Hager JKD186TM') fails.push('board header fields not stored');
  if (res.feeders < 1) fails.push('AI feed not merged');
  if (res.spareRows < 1 || res.spdRows < 1 || res.incomerRows < 1) fails.push('spare/SPD/incomer flags lost in merge');
  if (fails.length) { console.log('\nFAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('\nPASS: AI pass triggered, page image posted, boards/devices/feeds merged with flags intact.');
} finally {
  await browser.close();
}
