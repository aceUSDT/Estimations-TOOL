import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');

const Core = globalThis.EstimationExtractorCore;
const FIXTURE_ROOT = new URL('./fixtures/electrical-tier1/', import.meta.url);

async function parseFixture(name) {
  const fixture = JSON.parse(await readFile(new URL(`${name}.page.json`, FIXTURE_ROOT), 'utf8'));
  return Core.parseSpatialSchedulePage({
    ...fixture,
    pageType: 'db-schedule',
    materializeMissingWays: false,
  });
}

function scalar(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'value') ? value.value : value;
}

function deviceClass(row) {
  return scalar(row?.device?.class ?? row?.device);
}

function classBasis(row) {
  return row?.device?.class_basis ?? row?.device?.classBasis ?? row?.class_basis ?? row?.classBasis;
}

function rating(row) {
  return scalar(row?.device?.rating_a ?? row?.device?.ratingA ?? row?.rating);
}

function curve(row) {
  return scalar(row?.device?.curve ?? row?.curve);
}

function rcdPresent(row) {
  return scalar(row?.device?.rcd?.present ?? row?.rcdProtected);
}

function rcdSensitivity(row) {
  return scalar(row?.device?.rcd?.sensitivity_ma ?? row?.device?.rcd?.sensitivityMa ?? row?.sens);
}

function cableValue(row, snakeName, legacyName) {
  return scalar(row?.cable?.[snakeName] ?? row?.cable?.[legacyName]);
}

test('T-01 binds protection and cable values to the correct geometry columns', async () => {
  const result = await parseFixture('t01');
  assert.equal(result.matched, true, 'the source page must reach the production spatial schedule parser');

  const row = result.rows.find((candidate) => /POWER FOR CONDENSER/i.test(candidate.desc || '')
    && cableValue(candidate, 'live_csa_mm2', 'size') === 6
    && cableValue(candidate, 'cpc_csa_mm2', 'cpc') === 6);
  assert.ok(row, 'the 6 mm2 POWER FOR CONDENSER source row must be present');
  assert.equal(rating(row), 32);
  assert.equal(curve(row), 'C');
  assert.equal(deviceClass(row), 'MCB');
  assert.equal(cableValue(row, 'live_csa_mm2', 'size'), 6);
  assert.equal(cableValue(row, 'cpc_csa_mm2', 'cpc'), 6);
  assert.equal(cableValue(row, 'install_method', 'installMethod'), 'A');
});

test('T-02 reports BS EN 61009 rows as 30 mA RCBOs', async () => {
  const result = await parseFixture('t02');
  assert.equal(result.matched, true, 'the source page must reach the production spatial schedule parser');

  const ways = result.rows.filter((row) => [1, 2, 3].includes(Number(row.way)));
  assert.equal(ways.length, 3);
  assert.deepEqual(ways.map(rating), [16, 6, 6]);
  for (const way of ways) {
    assert.equal(deviceClass(way), 'RCBO');
    assert.equal(rcdPresent(way), true);
    assert.equal(rcdSensitivity(way), 30);
    assert.equal(classBasis(way), 'bs_en');
  }
});

test('T-03 groups a three-phase bracket as one 25 A device occupying three ways', async () => {
  const result = await parseFixture('t03-t04');
  assert.equal(result.matched, true, 'Quinnross page 2 must reach the production spatial schedule parser');
  assert.ok(result.grid.reviewReasons.includes('device_column_missing'), 'an indirect protection layout must be retained with an explicit review reason');

  const wayOne = result.rows.filter((row) => Number(row.way) === 1);
  assert.equal(wayOne.length, 1, 'way 1 L1/L2/L3 must be one grouped circuit');
  const circuit = wayOne[0];
  assert.equal(circuit.occupies_ways ?? circuit.occupiesWays, 3);
  assert.equal(rating(circuit), 25);
  assert.match(String(scalar(circuit.description) ?? circuit.desc ?? ''), /^TPN Isolator for AHU/i);
  assert.equal(result.rows.filter((row) => rating(row) === 25 && Number(row.qty ?? 1) > 0).length, 1);
});

test('T-04 upgrades a 40 A device marked c/w RCD to RCBO', async () => {
  const result = await parseFixture('t03-t04');
  assert.equal(result.matched, true, 'Quinnross page 2 must reach the production spatial schedule parser');

  const way = result.rows.find((row) => Number(row.way) === 2 && rating(row) === 40);
  assert.ok(way, 'way 2 40 A source row must be present');
  assert.equal(deviceClass(way), 'RCBO');
  assert.equal(classBasis(way), 'derived_rcd');
});
