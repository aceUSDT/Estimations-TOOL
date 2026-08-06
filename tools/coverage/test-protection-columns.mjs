import assert from 'node:assert/strict';

await import('../../extractor-core.js');
const Core = globalThis.EstimationExtractorCore;

const header = [
  'Way Phase Device BS (EN) Type Rating (A) Short Circuit Capacity (kA)',
  'AFDD RCD x/y Operating Current (mA) Circuit Reference Circuit Type Live CPC Cable Type',
].join(' ');

const rcbo = Core.parseProtectionTableLine(
  '1 L1 61009 B 16 10 x yes 30 SMALL POWER Rg 2.5 1.5 B 102 0.4 2.73',
  { headerText: header },
);
assert.equal(rcbo.device, 'RCBO');
assert.equal(rcbo.rating, 16);
assert.equal(rcbo.curve, 'B');
assert.equal(rcbo.ka, 10);
assert.equal(rcbo.sens, 30);
assert.equal(rcbo.protectionStandard, 'BS EN 61009');
assert.equal(rcbo.resolutionSource, 'ordered_protection_columns');
assert.deepEqual(rcbo.columnEvidence, {
  standard: 'BS EN 61009',
  curve: 'B',
  rating: 16,
  breakingCapacityKa: 10,
  rcdProtected: true,
  sensitivityMa: 30,
});
assert.equal(rcbo.requiresReview, false);

const sixAmpRcbo = Core.parseProtectionTableLine(
  '2 L2 61009 B 6 10 x yes 30 LIGHTING-BEDROOM Rd 1.5 1 B 102 0.4 7.28',
  { headerText: header },
);
assert.equal(sixAmpRcbo.device, 'RCBO', 'the RCD column and BS EN 61009 must produce an RCBO');
assert.equal(sixAmpRcbo.rating, 6);
assert.equal(sixAmpRcbo.sens, 30);

const mcbWithRcdColumn = Core.parseProtectionTableLine(
  '5 L1 60898 C 10 10 x yes 30 LIGHTING-BATHROOM/HALL Rd 1.5 1 B 102 0.4 2.19',
  { headerText: header },
);
assert.equal(mcbWithRcdColumn.device, 'RCBO', 'an MCB standard plus same-row RCD protection is a combined RCBO');
assert.equal(mcbWithRcdColumn.rating, 10);
assert.equal(mcbWithRcdColumn.curve, 'C');
assert.equal(mcbWithRcdColumn.rcdProtected, true);
assert.equal(mcbWithRcdColumn.sens, 30);

const condenser = Core.parseProtectionTableLine(
  '9 L2 60898 C 32 10 x x POWER FOR CONDENSER Rd 6 6 A C/E 0.4 0.68',
  { headerText: header },
);
assert.equal(condenser.device, 'MCB');
assert.equal(condenser.rating, 32, 'later 6 A cable text must not replace the protection rating');
assert.equal(condenser.curve, 'C');
assert.equal(condenser.ka, 10);
assert.equal(condenser.sens, null);
assert.equal(condenser.rcdProtected, false, 'two explicit negative protection indicators mean No RCD');
assert.equal(condenser.protectionStandard, 'BS EN 60898');
assert.match(condenser.desc, /^POWER FOR CONDENSER\b/);

const explicitRcbo = Core.parseProtectionTableLine(
  '7 Lighting ground floor east RCBO 40A 1P Type B L1',
  { headerText: header },
);
assert.equal(explicitRcbo.rcdProtected, true, 'an explicitly identified RCBO must never be presented as No RCD');
const rcdUnstated = Core.parseProtectionStandardSequence('60898 C 20 10 EXTERNAL LIGHTING');
assert.equal(rcdUnstated.rcdProtected, null, 'missing RCD-column evidence must remain unstated');

const afddRcbo = Core.parseProtectionTableLine(
  '3 L3 BS EN 61009 Type C 20 10 yes yes 30 EXTERNAL LIGHTING',
  { headerText: header },
);
assert.equal(afddRcbo.device, 'AFDD+RCBO');
assert.equal(afddRcbo.afdd, true);
assert.equal(afddRcbo.rcdProtected, true);

const incompleteRcbo = Core.parseProtectionTableLine(
  '4 L1 61009 B 20 10 x yes EXTERNAL LIGHTING',
  { headerText: header },
);
assert.equal(incompleteRcbo.device, 'RCBO');
assert.equal(incompleteRcbo.requiresReview, true, 'an RCBO without a sensitivity must remain in review');

const reconciledAiRow = Core.reconcileCombinedProtection({device:'MCB',rating:10,curve:'C',rcdProtected:true,sens:30,afdd:false});
assert.equal(reconciledAiRow.device, 'RCBO', 'the shared reconciliation rule must cover non-table extraction paths');
const unstatedRcd = Core.reconcileCombinedProtection({device:'MCB',rating:20,rcdProtected:null,sens:null});
assert.equal(unstatedRcd.rcdProtected, null, 'reconciliation must preserve an unstated RCD field instead of inventing No RCD');

console.log('Protection-column standards, ratings, curves, kA, AFDD and RCD mapping: OK');
