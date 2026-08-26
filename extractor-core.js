(function attachEstimationExtractorCore(global) {
  'use strict';

  const DEFAULT_PROTECTION_LEGEND = {
    P1: { device: 'MCB', curve: 'C', source: 'legend' },
    P2: { device: 'RCBO', rcdType: 'A', sensitivityMa: 30, source: 'legend' },
    P3: { device: 'MCB+RCD', sensitivityMa: 30, source: 'legend' },
    P4: { device: 'Fuse', fuseType: 'HRC', source: 'legend' },
    P5: { device: 'MCB', userDefined: true, source: 'legend' },
    B: { device: null, fittedBlank: true, source: 'legend' },
  };

  function cloneLegend() {
    return Object.fromEntries(
      Object.entries(DEFAULT_PROTECTION_LEGEND).map(([key, value]) => [key, { ...value }]),
    );
  }

  function parseProtectionLegend(text) {
    const legend = cloneLegend();
    const source = String(text || '');
    const explicitCodes = new Set();
    for (const code of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      if (new RegExp(`\\b${code}\\s*[-–:]`).test(source)) explicitCodes.add(code);
    }
    if (/\bP1\s*[-–:]\s*MCB\s+Curve\s+Type\s+C/i.test(source)) {
      legend.P1 = { device: 'MCB', curve: 'C', source: 'document_legend' };
    }
    if (/\bP2\s*[-–:]\s*RCBO/i.test(source)) {
      legend.P2 = {
        device: 'RCBO',
        rcdType: /Type\s+A/i.test(source) ? 'A' : null,
        sensitivityMa: /30\s*mA/i.test(source) ? 30 : null,
        source: 'document_legend',
      };
    }
    if (/\bP3\s*[-–:]\s*MCB\s*\/\s*Fuse/i.test(source)) {
      legend.P3 = {
        device: 'MCB+RCD',
        sensitivityMa: /30\s*mA/i.test(source) ? 30 : null,
        source: 'document_legend',
      };
    }
    if (/\bP4\s*[-–:]\s*HRC/i.test(source)) {
      legend.P4 = { device: 'Fuse', fuseType: 'HRC', source: 'document_legend' };
    }
    if (/\bP5\s*[-–:]\s*MCB/i.test(source)) {
      legend.P5 = { device: 'MCB', userDefined: true, source: 'document_legend' };
    }
    if (/\bB\s+Fitted\s+blank/i.test(source)) {
      legend.B = { device: null, fittedBlank: true, source: 'document_legend' };
    }
    return { legend, explicitCodes: [...explicitCodes] };
  }

  const OCCUPANCY_LABELS = Object.freeze({
    spare: new Set(['SPARE', 'SPARE WAY', 'UNUSED', 'UNUSED WAY', 'FUTURE', 'FUTURE WAY']),
    space: new Set(['SPACE', 'SPACE WAY', 'FITTED BLANK', 'FITTED BLANK WAY', 'BLANK', 'BLANK WAY', 'EMPTY', 'EMPTY WAY', 'NOT USED']),
  });

  function occupancyLabel(value) {
    const label = String(value || '')
      .toUpperCase()
      .replace(/[\u2010-\u2015_/]+/g, ' ')
      .replace(/[|:;,.()[\]{}]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^SP\s*ARE(?:\s+WAY)?(?:\s+0)?$/.test(label)) return 'spare';
    if (OCCUPANCY_LABELS.spare.has(label)) return 'spare';
    if (OCCUPANCY_LABELS.space.has(label)) return 'space';
    return null;
  }

  function scheduleOccupancyLabel(value) {
    let payload = String(value || '').replace(/\s+/g, ' ').trim();
    payload = payload.replace(/^\s*(?:(?:WAY|CCT|CKT|CIRCUIT)\s*[:#-]?\s*)?\d{1,3}(?:\s*[/-]\s*L[123])?\b\s*/i, '');
    payload = payload.replace(/^L[123]\b\s*/i, '');
    const direct = occupancyLabel(payload);
    if (direct) return direct;

    // Flattened PDF text commonly represents empty table cells as dashes before
    // the final occupancy cell. Only discard placeholder-only prefixes; words
    // before SPACE/SPARE indicate a genuine circuit description.
    const withoutPlaceholders = payload
      .replace(/^(?:(?:[-\u2013\u2014_]+|N\/?A|NIL)\s*)+/i, '')
      .trim();
    return withoutPlaceholders === payload ? null : occupancyLabel(withoutPlaceholders);
  }

  function hasFittedProtectionDevice(row) {
    return Boolean(String(row?.device || '').trim());
  }

  function hasProtectionEvidence(row) {
    if (!row) return false;
    const hasValue = (value) => value != null && String(value).trim() !== '';
    return hasFittedProtectionDevice(row)
      || hasValue(row.rating)
      || hasValue(row.protectionStandard)
      || hasValue(row.protectionStandardCode)
      || hasValue(row.tripUnit)
      || hasValue(row.curve)
      || hasValue(row.ka)
      || hasValue(row.sens)
      || row.rcdProtected === true
      || row.afdd === true
      || /^P[1-5]$/i.test(String(row.protectionCode || '').trim());
  }

  function protectionDeviceQuantity(row) {
    return hasFittedProtectionDevice(row) ? Math.max(1, Number(row?.qty) || 1) : 0;
  }

  function isCountableProtectionDevice(row) {
    return protectionDeviceQuantity(row) > 0;
  }

  function isPopulatedProtectionRow(row) {
    return Boolean(row) && (hasProtectionEvidence(row) || (!row.space && !row.spare));
  }

  function reconcileRowOccupancy(row) {
    if (!row) return row;
    const next = { ...row };
    const fittedDevice = hasFittedProtectionDevice(next);
    const unresolvedProtection = !fittedDevice && hasProtectionEvidence(next);
    const reasons = Array.isArray(next.resolutionReasons) ? [...next.resolutionReasons] : [];

    if (next.space === true && fittedDevice) {
      const reason = 'Populated protective-device evidence overrides an apparent SPACE label';
      next.space = false;
      next.occupancyConflict = {
        printed: 'SPACE',
        interpreted: next.spare === true ? 'fitted_spare' : 'fitted_device',
        reason,
      };
      next.requiresReview = true;
      const confidence = Number(next.conf);
      next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.84, 0.84);
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    if (next.space === true && unresolvedProtection) {
      const reason = 'SPACE row contains protection evidence that requires classification review';
      next.occupancyConflict = {
        printed: 'SPACE',
        interpreted: 'unresolved_protection_evidence',
        reason,
      };
      next.requiresReview = true;
      const confidence = Number(next.conf);
      next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.65, 0.65);
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    if (next.spare === true && unresolvedProtection) {
      const reason = 'SPARE row contains protection evidence but its device class is unresolved';
      next.requiresReview = true;
      const confidence = Number(next.conf);
      next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.72, 0.72);
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    if (next.space === true && next.spare === true && !fittedDevice) {
      const reason = 'Conflicting SPARE and SPACE occupancy labels require review';
      next.requiresReview = true;
      const confidence = Number(next.conf);
      next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.55, 0.55);
      next.occupancyConflict = { printed: 'SPARE + SPACE', interpreted: null, reason };
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    if (fittedDevice) {
      next.qty = protectionDeviceQuantity(next);
      next.occupancy = next.spare === true ? 'fitted_spare' : 'fitted_device';
    } else if (next.space === true) {
      next.qty = 0;
      next.occupancy = 'space';
    } else if (next.spare === true) {
      next.qty = 0;
      next.occupancy = unresolvedProtection ? 'fitted_spare_unresolved' : 'unpopulated_spare';
    }
    next.resolutionReasons = reasons;
    return next;
  }

  function explicitPoleEvidence(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ');
    const tokenSource = source.replace(/[|,;:()[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
    const bare = (token) => new RegExp(`(?:^|\\s)${token}(?=\\s|$)`).test(tokenSource);
    if (/\b(?:4P|FOUR[- ]POLE)\b/.test(source)) return { configuration: '4P', poles: 4 };
    if (/\b(?:TPN|TP\s*&\s*N|3P\s*\+\s*N)\b/.test(source)) return { configuration: 'TPN', poles: 3 };
    if (/\b(?:3P|TRIPLE[- ]POLE|THREE[- ]POLE)\b/.test(source) || bare('TP')) return { configuration: 'TP', poles: 3 };
    if (/\b(?:DPN|2P\s*\+\s*N)\b/.test(source)) return { configuration: 'DPN', poles: 2 };
    if (/\b(?:2P|DOUBLE[- ]POLE)\b/.test(source) || bare('DP')) return { configuration: 'DP', poles: 2 };
    if (/\b(?:SPN|1P\s*\+\s*N)\b/.test(source)) return { configuration: 'SPN', poles: 1 };
    if (/\b(?:1P|SINGLE[- ]POLE)\b/.test(source) || bare('SP')) return { configuration: 'SP', poles: 1 };
    return null;
  }

  function explicitPhaseEvidence(value, { strongOnly = false } = {}) {
    const source = String(value || '').toUpperCase()
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) return null;
    const boundaryStart = '(?:^|[\\s(:,;\\[])';
    const boundaryEnd = '(?=$|[\\s),;:\\]])';
    const range = new RegExp(`${boundaryStart}L1\\s*(?:-|TO)\\s*L3${boundaryEnd}`).test(source);
    const listed = new RegExp(`${boundaryStart}L1\\s*[-/,+&|]\\s*L2\\s*[-/,+&|]\\s*L3${boundaryEnd}`).test(source);
    const compact = new RegExp(`${boundaryStart}L1L2L3${boundaryEnd}`).test(source);
    const spaced = !strongOnly
      && new RegExp(`${boundaryStart}L1\\s+L2\\s+L3${boundaryEnd}`).test(source);
    const phaseLabel = new RegExp(`${boundaryStart}(?:3\\s*PH(?:ASE)?|PHASE\\s*3|THREE\\s+PHASE)${boundaryEnd}`).test(source);
    const poleLabel = explicitPoleEvidence(source);
    const threePoleLabel = !strongOnly && poleLabel && poleLabel.poles >= 3 && poleLabel.poles <= 4;
    if (!(range || listed || compact || spaced || phaseLabel || threePoleLabel)) return null;
    return {
      phase: '3PH',
      phases: ['L1', 'L2', 'L3'],
      poles: threePoleLabel ? poleLabel.poles : 3,
      configuration: threePoleLabel ? poleLabel.configuration : 'TP',
      basis: range ? 'phase_range'
        : (listed || compact || spaced ? 'phase_set' : (phaseLabel ? 'phase_label' : 'pole_label')),
      originalText: String(value || '').trim(),
    };
  }

  /**
   * Keep phase occupancy and pole classification coherent after every
   * extraction route. A bounded L1/L2/L3 slot proves a single-phase position,
   * while an explicit phase set or range proves one multi-pole device even
   * when that phase cell wraps over multiple printed lines.
   */
  function reconcilePoleEvidence(row) {
    if (!row) return row;
    const next = { ...row };
    const phase = String(next.phase || '').toUpperCase().replace(/\s+/g, '');
    const corrections = Array.isArray(next.corrections) ? next.corrections : [];
    const poleCorrected = corrections.some((item) => String(item?.field || '').toLowerCase() === 'pole configuration');
    const phaseCorrected = corrections.some((item) => String(item?.field || '').toLowerCase() === 'phase');
    const userCorrected = poleCorrected || phaseCorrected
      || next.poleEvidenceBasis === 'user_correction'
      || next.phaseEvidenceBasis === 'user_correction';
    const phaseFieldText = next.fieldSources?.phase?.originalText || next.fieldSources?.phase?.text || '';
    const phaseEvidence = explicitPhaseEvidence(phaseFieldText)
      || explicitPhaseEvidence(next.phase)
      || explicitPhaseEvidence(next.phaseSourceText)
      || explicitPhaseEvidence(next.srcText, { strongOnly: true });
    const sourcePoleText = next.fieldSources?.poles?.originalText || next.fieldSources?.poles?.text
      || next.poleSourceText || next.srcText || '';
    const sourceEvidence = explicitPoleEvidence(sourcePoleText);
    if (!userCorrected && phaseEvidence) {
      const sourceConflict = sourceEvidence && sourceEvidence.poles < 3;
      const resolvedPole = sourceEvidence && sourceEvidence.poles >= 3 ? sourceEvidence : phaseEvidence;
      const configuration = String(next.poleConfiguration || next.poleConfig || next.pole || '').toUpperCase();
      const poleCount = Number(next.poles);
      const differs = phase !== '3PH' || poleCount !== resolvedPole.poles
        || configuration !== resolvedPole.configuration || next.occupies_ways !== Math.min(3, resolvedPole.poles);
      next.phase = '3PH';
      next.poles = resolvedPole.poles;
      next.poleConfiguration = resolvedPole.configuration;
      next.occupies_ways = Math.min(3, resolvedPole.poles);
      next.poleEvidenceExplicit = true;
      next.phaseEvidenceExplicit = true;
      next.poleEvidenceBasis = phaseFieldText ? `source_${phaseEvidence.basis}` : phaseEvidence.basis;
      next.sharedPhaseSpan = true;
      next.phaseSlotIndependent = false;
      if (differs || sourceConflict) {
        const reason = sourceConflict
          ? 'Explicit three-phase span conflicts with a single-pole source label and requires review'
          : 'Explicit phase span establishes one three-phase outgoing device';
        next.poleReconciliation = {
          original: configuration || (Number.isFinite(poleCount) ? `${poleCount}P` : null),
          corrected: resolvedPole.configuration,
          reason,
          phaseEvidence: phaseEvidence.originalText,
        };
        const reasons = Array.isArray(next.resolutionReasons) ? [...next.resolutionReasons] : [];
        if (!reasons.includes(reason)) reasons.push(reason);
        next.resolutionReasons = reasons;
        if (sourceConflict) {
          next.requiresReview = true;
          const confidence = Number(next.conf);
          next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.72, 0.72);
        }
      }
      return next;
    }

    const singlePhaseSlot = next.phaseSlotIndependent === true
      || (/^L[123]$/.test(phase) && next.sharedPhaseSpan !== true);
    if (!singlePhaseSlot) return next;
    const explicit = next.poleEvidenceExplicit === true || userCorrected || Boolean(sourceEvidence);
    const configuration = String(next.poleConfiguration || next.poleConfig || next.pole || '').toUpperCase();
    const poleCount = Number(next.poles);
    const claimsThreePole = poleCount >= 3 || /^(?:TP|TPN|3P|3P\+N|4P)$/.test(configuration);

    if (!userCorrected && sourceEvidence) {
      const differs = poleCount !== sourceEvidence.poles || configuration !== sourceEvidence.configuration;
      next.poles = sourceEvidence.poles;
      next.poleConfiguration = sourceEvidence.configuration;
      next.occupies_ways = Math.max(1, Math.min(3, sourceEvidence.poles));
      next.poleEvidenceExplicit = true;
      next.poleEvidenceBasis = 'source_pole_label';
      next.sharedPhaseSpan = sourceEvidence.poles >= 3;
      next.phaseSlotIndependent = sourceEvidence.poles < 3;
      if (differs) {
        const reason = 'Explicit source pole label overrides a conflicting extracted pole value';
        next.poleReconciliation = {
          original: configuration || (Number.isFinite(poleCount) ? `${poleCount}P` : null),
          corrected: sourceEvidence.configuration,
          reason,
        };
        const reasons = Array.isArray(next.resolutionReasons) ? [...next.resolutionReasons] : [];
        if (!reasons.includes(reason)) reasons.push(reason);
        next.resolutionReasons = reasons;
      }
      return next;
    }

    const missingConfiguration = !configuration && poleCount === 1;
    if (!explicit && (claimsThreePole || !Number.isFinite(poleCount) || poleCount < 1 || missingConfiguration)) {
      const reason = claimsThreePole
        ? 'Bounded single-phase slot evidence overrides an unproven three-pole grouping'
        : 'Bounded phase-slot geometry establishes a single-pole outgoing device';
      next.poles = 1;
      next.poleConfiguration = 'SP';
      next.occupies_ways = 1;
      next.sharedPhaseSpan = false;
      next.phaseSlotIndependent = true;
      next.poleEvidenceBasis = 'bounded_phase_lane';
      if (claimsThreePole) {
        next.poleReconciliation = {
          original: configuration || (Number.isFinite(poleCount) ? `${poleCount}P` : null),
          corrected: 'SP',
          reason,
        };
        next.requiresReview = true;
        const confidence = Number(next.conf);
        next.conf = Math.min(Number.isFinite(confidence) ? confidence : 0.84, 0.84);
      }
      const reasons = Array.isArray(next.resolutionReasons) ? [...next.resolutionReasons] : [];
      if (!reasons.includes(reason)) reasons.push(reason);
      next.resolutionReasons = reasons;
    }
    return next;
  }

  function normaliseInstallMethod(value) {
    return value ? value.replace(/\s+/g, '').replace(/,+/g, ',') : null;
  }

  function parseTrailingCable(text) {
    const value = String(text || '').trim();
    const match = value.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)\s+(T[1-6])\s+([\d\s,]+))$/i);
    if (!match) return { description: value, cable: null };
    return {
      description: match[1].trim(),
      cable: {
        size: Number(match[2]),
        typeCode: match[3].toUpperCase(),
        installMethod: normaliseInstallMethod(match[4]),
        orig: `${match[2]} mm² ${match[3].toUpperCase()}`,
      },
    };
  }

  function normaliseBoardReference(value) {
    return String(value || '').toUpperCase().replace(/[\s._/-]+/g, '');
  }

  function canonicalBoardReference(value) {
    const original = String(value || '').trim();
    let display = original.toUpperCase()
      .replace(/\s*[._/\\-]\s*/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    let splitSection = null;
    const split = display.match(/^(DB(?:-[A-Z0-9]+)+)-(LP|L|P)$/i);
    if (split && /(?:^|-)\d{1,3}$/.test(split[1])) {
      display = split[1];
      splitSection = split[2].toUpperCase();
    }
    return {
      original,
      display: display || original,
      normalised: normaliseBoardReference(display || original),
      splitSection,
    };
  }

  // Words that can follow "DB" in prose without naming a board ("DB Schedule",
  // "DB Fed From", …). A candidate whose first token is one of these is prose.
  const BOARD_REF_STOPWORDS = new Set([
    'SCHEDULE', 'SCHEDULES', 'REFERENCE', 'REF', 'BOARD', 'BOARDS', 'FED', 'FROM',
    'TO', 'SERVING', 'SERVED', 'TYPE', 'RATING', 'SIZE', 'WAY', 'WAYS', 'NO',
    'NUMBER', 'DATA', 'INCOMER', 'LOCATION', 'NOTES', 'NOTE', 'LEGEND', 'CHART',
    'CHARTS', 'IDENTITY', 'AND', 'OR', 'THE', 'FOR', 'WITH', 'IS', 'ARE', 'MODEL',
  ]);

  function extractBoardReferences(text) {
    const source = String(text || '');
    // Ordered most-specific first; shorter matches fully contained inside an
    // already-found span are dropped (so "DB-00-SUBEXT" wins over "DB-00").
    const patterns = [
      // compound refs containing DB as an inner/terminal token: G1-GF-DB-LL
      { re: /\b[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6})*-DB(?:-[A-Z0-9]{1,6})+\b/gi },
      { re: /\bSMDB(?:[\s._/-]?\d+[A-Z]?)*\b/gi },
      { re: /\bMDB(?:[\s._/-]?\d+[A-Z]?)*\b/gi },
      { re: /\b(?:LDB|PDB|MCC|MCP|SB)(?:[\s._/-]?\d+[A-Z]?)+\b/gi },
      // DB + letter-bearing tokens: DB-MECH, DB-AV, DB/GF, DB-ESS-01, DB-00-SUBEXT
      { re: /\bDB\s?[.\-_/]\s?[A-Z0-9]{1,8}(?:[.\-_/][A-Z0-9]{1,8})*\b/gi, guard: true },
      { re: /\bDB\.?(?:[\s._/-]?\d+[A-Z]?)+(?:\s+[A-Z])?\b/gi },
      // panelboards / switchboards: PB01, MSB1
      { re: /\b(?:PB|MSB)[\s.\-_/]?\d+[A-Z]?\b/gi },
      { re: /\bmain\s+lv\s+(?:panel|switchboard)\b/gi },
      { re: /\bmain\s+switchboard\b/gi },
      // consumer-unit variants: "Consumer Unit (General Apartment)" → CU General Apartment
      { re: /\bconsumer\s+unit\s*\(([^)]{2,30})\)/gi, cu: true },
    ];
    // header-labelled refs catch names no generic pattern can (e.g. "Reference: 2A4")
    const headerRe = /(?<!(?:cable|drawing|document|project|job|schedule)\s)\b(?:board\s+)?(?:reference|identity)\s*[:\-]?\s+([A-Z0-9][A-Z0-9/._-]{1,14})/gi;
    const spans = [];
    for (const { re, guard, cu } of patterns) {
      re.lastIndex = 0;
      for (const match of source.matchAll(re)) {
        let original = match[0].trim();
        if (cu) original = 'CU ' + match[1].trim();
        if (guard) {
          const tokens = original.split(/[\s.\-_/]+/).slice(1);
          if (!tokens.length || BOARD_REF_STOPWORDS.has(tokens[0].toUpperCase())) continue;
        }
        spans.push({ original, start: match.index, end: match.index + match[0].length });
      }
    }
    headerRe.lastIndex = 0;
    for (const match of source.matchAll(headerRe)) {
      const token = match[1].replace(/[.,:]+$/, '');
      // require a digit or separator so prose ("Reference: Drawings") is skipped
      if (!/[\d/-]/.test(token) || BOARD_REF_STOPWORDS.has(token.toUpperCase())) continue;
      spans.push({ original: token, start: match.index, end: match.index + match[0].length });
    }
    // drop spans fully contained in a longer span (sub-matches of the same text)
    const kept = spans.filter((s) => !spans.some((o) => o !== s
      && o.start <= s.start && o.end >= s.end && (o.end - o.start) > (s.end - s.start)));
    const found = [];
    const seen = new Set();
    for (const s of kept) {
      const normalised = /main\s/i.test(s.original) ? 'MAINLVPANEL' : normaliseBoardReference(s.original);
      if (!normalised || seen.has(normalised)) continue;
      seen.add(normalised);
      found.push({ original: s.original, normalised });
    }
    return found;
  }

  function classifyPageText(text, pageIndex = 0, totalPages = 1) {
    const source = String(text || '');
    const lower = source.toLowerCase();
    const scores = {};
    const add = (type, score) => { scores[type] = (scores[type] || 0) + score; };
    const strongSchematicTitle = /\b(?:LV\s+SCHEMATIC|ELECTRICAL\s+SCHEMATIC|SINGLE[- ]LINE\s+(?:DIAGRAM|SCHEMATIC)|ONE[- ]LINE\s+DIAGRAM)\b/i.test(source);
    if (/drawing register|drawing list|drawing index|dwg register/.test(lower)) add('register', 8);
    if (/\blegend\b/.test(lower) && /symbol|description|abbrev/.test(lower)) add('legend', 5);
    if (/lighting (?:layout|plan|drawing)/.test(lower)) add('lighting-plan', 5);
    if (/small.?power|power (?:layout|plan)/.test(lower)) add('power-plan', 5);
    if (/fire.?alarm (?:layout|plan|drawing)|fire detection layout/.test(lower)) add('fire-plan', 5);
    if (/containment|cable tray layout|trunking layout|basket layout/.test(lower)) add('containment-plan', 5);
    if (/single.?line|schematic|busbar|incoming supply|main switchboard/.test(lower)) add('sld', 4);
    if (strongSchematicTitle) add('sld', 14);
    if (/distribution board schedule|board schedule|db schedule/.test(lower)) add('db-schedule', 7);
    if (/main (?:panel|lv panel|switch\s?board).{0,30}schedule/.test(lower)) add('main-schedule', 7);
    if (/cable schedule/.test(lower)) add('cable-schedule', 7);
    if (/equipment schedule/.test(lower)) add('equipment-schedule', 7);
    if (/specification|shall be provided|shall comply|bs 7671|clause/.test(lower)) add('spec', 3);
    if (/general notes|electrical notes/.test(lower)) add('notes', 4);
    const protectionCodes = (source.match(/\bP[1-5]\b/g) || []).length;
    const phaseRows = (source.match(/\bL[123]\b/g) || []).length;
    if (protectionCodes >= 4 && phaseRows >= 6) add('db-schedule', 7);
    const codedRows = (source.match(/(?:^|\n)\s*(?:\d{1,3}\s+)?(?:L[123]\s+)?\d+(?:\.\d+)?\s+[JKLMN]\s+[BCD]\b[^\n]*\b(?:Ri|Ra)\s+[LP]\b/gim) || []).length;
    if (codedRows >= 2 && phaseRows >= 3) add('db-schedule', 9);
    const boardCount = extractBoardReferences(source).length;
    if (boardCount >= 3 && /mccb|fuse|cable|connected from|connected to/i.test(source)) add('sld', 5);
    const scheduleCandidate = scoreScheduleCandidate(source.split(/\r?\n/));
    if (!strongSchematicTitle && scheduleCandidate.score >= 0.45 && scheduleCandidate.signals.length >= 3) {
      add('db-schedule', 10);
    }
    if (pageIndex === 0 && totalPages > 1 && /project|issued|revision/.test(lower) && !Object.keys(scores).length) add('cover', 3);
    let type = 'unknown';
    let best = 0;
    for (const [candidate, score] of Object.entries(scores)) {
      if (score > best) { type = candidate; best = score; }
    }
    return { type, confidence: type === 'unknown' ? 0.3 : Math.min(0.97, 0.5 + best * 0.06), scores };
  }

  function parseBamScheduleLine(line, context = {}) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    // BAM schedules use: [Way] Phase In [Ib] ProtectionCode Description CableCSA CableType InstallMethod.
    // Empty cells disappear in PDF text extraction, so Way is optional on L2/L3 continuation rows.
    const match = text.match(/^(?:(\d{1,3})\s+)?(L[123])\s+(?:(\d+(?:\.\d+)?)\s+)?(P[1-5]|B)\b\s*(.*)$/i);
    if (!match) return null;

    const phase = match[2].toUpperCase();
    const explicitWay = match[1] ? Number(match[1]) : null;
    const phaseOrder = { L1: 1, L2: 2, L3: 3 };
    const phaseReset = explicitWay === null
      && context.lastPhase
      && phaseOrder[phase] <= phaseOrder[context.lastPhase];
    const way = explicitWay !== null ? explicitWay : (phaseReset ? null : (context.lastWay ?? null));
    const rating = match[3] ? Number(match[3]) : null;
    const protectionCode = match[4].toUpperCase();
    const resolved = (context.protectionLegend || DEFAULT_PROTECTION_LEGEND)[protectionCode]
      || DEFAULT_PROTECTION_LEGEND[protectionCode]
      || {};
    const { description, cable } = parseTrailingCable(match[5]);
    const spare = occupancyLabel(description) === 'spare';
    const space = protectionCode === 'B' || Boolean(resolved.fittedBlank);
    const placeholder = /\b(TBC|TBD|GUESS|UNKNOWN)\b|\?\?/i.test(description);

    const row = {
      way,
      phase,
      rating,
      protectionCode,
      device: resolved.device || null,
      curve: resolved.curve || null,
      rcdType: resolved.rcdType || null,
      sens: resolved.sensitivityMa || null,
      poles: 1,
      ka: null,
      cable,
      desc: description,
      spare,
      space,
      incomer: false,
      qty: space ? 0 : 1,
      placeholder,
      requiresReview: placeholder || Boolean(resolved.userDefined) || !resolved.device,
      resolutionSource: resolved.source || 'unresolved',
      srcText: text,
      conf: placeholder ? 0.55 : (resolved.source === 'document_legend' ? 0.94 : 0.86),
    };
    context.pendingRows = context.pendingRows || [];
    if (explicitWay !== null) {
      for (const pending of context.pendingRows) pending.way = explicitWay;
      context.pendingRows.length = 0;
      context.lastWay = explicitWay;
    } else if (way === null) {
      row.deferredWay = true;
      context.pendingRows.push(row);
    }
    context.lastPhase = phase;
    return row;
  }

  const TBA_PROTECTION_LEGEND = {
    J: { device: 'MCCB' },
    K: { device: 'MCB' },
    L: { device: 'Fuse' },
    M: { device: 'RCBO' },
    N: { device: 'AFDD+RCBO', afdd: true },
  };

  const ASSOCIATED_EQUIPMENT_DEFS = [
    { device: 'Contactor', re: /\bcontactors?\b/i },
    { device: 'Emergency power off', re: /\bEPO\b|\bemergency\s+(?:power\s+)?off\b|\bmushroom\s+push\s+button\s+emergency\s+stop\b/i },
    { device: 'Key reset', re: /\bkey\s+reset(?:\s+buttons?)?\b/i },
    { device: 'Time clock', re: /\b(?:time\s*clock|timeclock)\b/i },
    { device: 'Photocell', re: /\b(?:photo\s*cell|photocell)\b/i },
    { device: 'Relay', re: /\brelays?\b/i },
    { device: 'Timer', re: /\btimers?\b/i },
    { device: 'Motor starter', re: /\b(?:motor\s+)?starters?\b/i },
    { device: 'Overload', re: /\boverloads?\b/i },
    { device: 'Transformer', re: /\btransformers?\b/i },
    { device: 'DALI controller', re: /\bDALI\s+(?:headend|controller|control\s+unit)\b/i },
    { device: 'Lighting controller', re: /\blighting\s+(?:controller|control\s+(?:module|unit))\b/i },
    { device: 'Key switch', re: /\bkey\s+switch(?:es)?\b/i },
    { device: 'BMS interface', re: /\bBMS\s+(?:interface|connection|control\s+point)\b/i },
  ];

  function extractAssociatedEquipment(description) {
    const source = String(description || '');
    const equipment = [];
    for (const definition of ASSOCIATED_EQUIPMENT_DEFS) {
      const match = source.match(definition.re);
      if (!match) continue;
      const before = source.slice(Math.max(0, match.index - 12), match.index);
      const quantity = Number(before.match(/(\d{1,3})\s*(?:x|×)\s*$/i)?.[1]) || 1;
      equipment.push({ device: definition.device, qty: quantity });
    }
    return equipment;
  }

  function noteReferences(value) {
    const source = String(value || '');
    const labels = [];
    const patterns = [
      /\(\s*#\s*([A-Z0-9][A-Z0-9.-]{0,11})\s*\)/gi,
      /\bNOTE\s*#\s*([A-Z0-9][A-Z0-9.-]{0,11})\b/gi,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const label = match[1].toUpperCase();
        if (!labels.includes(label)) labels.push(label);
      }
    }
    return labels;
  }

  function parseGoverningNotes(lines) {
    const sourceLines = (lines || []).map((line, index) => ({
      line: index,
      text: String(line?.text ?? line ?? '').replace(/\s+/g, ' ').trim(),
      bbox: line?.bbox || null,
      confidence: Number(line?.confidence ?? 1),
    })).filter((line) => line.text);
    const notes = [];
    let active = null;
    for (const source of sourceLines) {
      const definition = source.text.match(/^\s*(?:NOTE\s*)?\(\s*#\s*([A-Z0-9][A-Z0-9.-]{0,11})\s*\)\s*[:.\-]?\s*(.+)$/i)
        || source.text.match(/^\s*NOTE\s*#\s*([A-Z0-9][A-Z0-9.-]{0,11})\s*[:.\-]?\s*(.+)$/i);
      if (definition) {
        active = {
          label: definition[1].toUpperCase(),
          text: definition[2].trim(),
          line: source.line,
          bbox: source.bbox,
          confidence: source.confidence,
        };
        notes.push(active);
        continue;
      }
      if (!active || noteReferences(source.text).length) {
        active = null;
        continue;
      }
      const likelyTableContent = /^\s*(?:\d{1,3}|[LP]\d+)\b/i.test(source.text)
        || /\b(?:WAY|CCT|CIRCUIT|LOAD\s+DESCRIPTION|RATING|DEVICE\s+BS)\b/i.test(source.text);
      if (likelyTableContent) {
        active = null;
        continue;
      }
      if (active.text.length < 480) active.text += ` ${source.text}`;
    }
    return notes.map((note) => ({ ...note, associatedDevices: extractAssociatedEquipment(note.text) }));
  }

  function applyGoverningNotes(row, notes) {
    const references = noteReferences([row?.desc, row?.srcText, row?.circuitReferenceText].filter(Boolean).join(' '));
    if (!references.length) return { ...row, noteReferences: [], governingNotes: Array.isArray(row?.governingNotes) ? row.governingNotes : [] };
    const governingNotes = (notes || []).filter((note) => references.includes(String(note.label || '').toUpperCase()));
    const associated = [...(Array.isArray(row?.associatedDevices) ? row.associatedDevices : [])];
    for (const note of governingNotes) {
      for (const item of note.associatedDevices || extractAssociatedEquipment(note.text)) {
        const existing = associated.find((candidate) => candidate.device === item.device);
        if (existing) existing.qty = Math.max(Number(existing.qty) || 1, Number(item.qty) || 1);
        else associated.push({ ...item, source: 'governing_note', noteLabel: note.label });
      }
    }
    return {
      ...row,
      noteReferences: references,
      governingNotes: governingNotes.map((note) => ({
        label: note.label,
        text: note.text,
        page: note.page || null,
        line: note.line,
        bbox: note.bbox,
        confidence: note.confidence,
      })),
      associatedDevices: associated,
    };
  }

  function cleanTbaDescription(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    const cablePattern = /(?:^|\s)([A-I])\s+(\d+)\s+(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?)\s+(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?)\s+([WXYZ])\s+([NY])\s+(N\/A|[A-Z])\s+([NY])(?=\s|$)/ig;
    let cableMatch = null;
    for (const match of source.matchAll(cablePattern)) cableMatch = match;
    if (!cableMatch) return { description: source, cable: null };
    const sizeValue = cableMatch[3].replace(/\s+/g, '');
    const cpcValue = cableMatch[4].replace(/\s+/g, '');
    const description = `${source.slice(0, cableMatch.index)} ${source.slice(cableMatch.index + cableMatch[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return {
      description,
      cable: {
        typeCode: cableMatch[1].toUpperCase(),
        cores: Number(cableMatch[2]),
        size: /^\d+(?:\.\d+)?$/.test(sizeValue) ? Number(sizeValue) : sizeValue,
        cpc: /^\d+(?:\.\d+)?$/.test(cpcValue) ? Number(cpcValue) : cpcValue,
        cpcType: cableMatch[5].toUpperCase(),
        orig: `${cableMatch[2]}C ${sizeValue}mm2`,
      },
    };
  }

  function parseTbaProtectionLine(line) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/^(?:(\d{1,3})\s+)?(L[123])\s+(\d+(?:\.\d+)?)\s+([JKLMN])(?:\s+([BCD]))?\s+(.*?)\s+(Ri|Ra)\s+([LP])(?:\s+(.*))?$/i);
    if (!match) return null;
    const protectionCode = match[4].toUpperCase();
    const resolved = TBA_PROTECTION_LEGEND[protectionCode];
    if (!resolved) return null;
    const middleNumbers = (match[6].match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const ka = middleNumbers.length ? middleNumbers[middleNumbers.length - 1] : null;
    const sensitivity = middleNumbers.length > 1 ? middleNumbers[0] : null;
    const cleaned = cleanTbaDescription(match[9]);
    const associatedDevices = extractAssociatedEquipment(cleaned.description);
    return {
      way: match[1] ? Number(match[1]) : null,
      phase: match[2].toUpperCase(),
      rating: Number(match[3]),
      protectionCode,
      device: resolved.device,
      curve: match[5] ? match[5].toUpperCase() : null,
      sens: sensitivity,
      poles: 1,
      ka,
      circuitConfig: match[7].toLowerCase() === 'ri' ? 'ring' : 'radial',
      serviceCode: match[8].toUpperCase(),
      discipline: match[8].toUpperCase() === 'L' ? 'Lighting' : '',
      cable: cleaned.cable,
      desc: cleaned.description,
      associatedDevices,
      afdd: Boolean(resolved.afdd),
      spare: false,
      space: false,
      incomer: false,
      qty: 1,
      resolutionSource: 'document_legend',
      srcText: text,
      conf: 0.98,
    };
  }

  function parseTbaSchedulePage(lines, context = {}) {
    const sourceLines = (lines || []).map((line, index) => ({
      index,
      text: String(line && line.text != null ? line.text : line || '').replace(/\s+/g, ' ').trim(),
    }));
    const consumed = new Set();
    const reconstructed = [];
    let detachedCount = 0;

    for (let index = 0; index < sourceLines.length; index += 1) {
      if (consumed.has(index)) continue;
      const source = sourceLines[index];
      const detached = source.text.match(/^(?:(\d{1,3})\s+)?(\d+(?:\.\d+)?)\s+([JKLMN])\b(.*)$/i);
      if (detached && /\b(?:Ri|Ra)\s+[LP]\b/i.test(source.text)) {
        const embedded = detached[4].match(/\b(L[123])\b/i);
        if (embedded) {
          const phase = embedded[1].toUpperCase();
          const remainder = `${detached[4].slice(0, embedded.index)} ${detached[4].slice(embedded.index + embedded[0].length)}`.trim();
          reconstructed.push({
            index: source.index,
            text: `${detached[1] ? `${detached[1]} ` : ''}${phase} ${detached[2]} ${detached[3]} ${remainder}`,
          });
          detachedCount += 1;
          continue;
        }
        let joined = false;
        for (let lookahead = index + 1; lookahead <= Math.min(index + 2, sourceLines.length - 1); lookahead += 1) {
          if (consumed.has(lookahead)) continue;
          const phaseOnly = sourceLines[lookahead].text.match(/^(?:(\d{1,3})\s+)?(L[123])(?:\s+(.*))?$/i);
          if (!phaseOnly || /^\d+(?:\.\d+)?\s+[JKLMN]\b/i.test(phaseOnly[3] || '')) continue;
          const way = detached[1] || phaseOnly[1];
          reconstructed.push({
            index: source.index,
            text: `${way ? `${way} ` : ''}${phaseOnly[2].toUpperCase()} ${detached[2]} ${detached[3]} ${detached[4]} ${phaseOnly[3] || ''}`,
          });
          consumed.add(lookahead);
          detachedCount += 1;
          joined = true;
          break;
        }
        if (joined) continue;
      }
      reconstructed.push(source);
    }

    const slots = [];
    for (const source of reconstructed) {
      const phaseLine = source.text.match(/^(?:(\d{1,3})\s+)?(L[123])(?:\s+(.*))?$/i);
      if (!phaseLine) continue;
      const payload = String(phaseLine[3] || '').trim();
      const row = parseTbaProtectionLine(source.text);
      slots.push({
        line: source.index,
        explicitWay: phaseLine[1] ? Number(phaseLine[1]) : null,
        phase: phaseLine[2].toUpperCase(),
        payload,
        row,
        spare: occupancyLabel(payload) === 'spare',
        blank: !payload,
      });
    }

    const rows = [];
    let group = [];
    const finalizeGroup = () => {
      if (!group.length) return;
      const explicit = group.find((slot) => Number.isInteger(slot.explicitWay));
      const way = explicit ? explicit.explicitWay
        : (Number.isInteger(context.lastTbaWay) ? context.lastTbaWay + 1 : null);
      if (Number.isInteger(way)) context.lastTbaWay = way;
      const deviceSlots = group.filter((slot) => slot.row);
      const phases = new Set(group.map((slot) => slot.phase));
      const isThreePole = deviceSlots.length === 1
        && phases.size === 3
        && group.filter((slot) => !slot.row).every((slot) => slot.blank && !slot.spare);
      for (const slot of deviceSlots) {
        rows.push({
          ...slot.row,
          way,
          phase: isThreePole ? '3PH' : slot.phase,
          poles: isThreePole ? 3 : 1,
          line: slot.line,
        });
      }
      if (!deviceSlots.length && Number.isInteger(way)) {
        const isSpare = group.some((slot) => slot.spare);
        const slot = group.find((candidate) => candidate.spare) || group[0];
        rows.push({
          way,
          phase: null,
          rating: null,
          protectionCode: null,
          device: null,
          poles: 1,
          desc: isSpare ? 'Spare' : 'Space',
          spare: isSpare,
          space: !isSpare,
          incomer: false,
          qty: 0,
          srcText: slot.payload || (isSpare ? 'Spare' : 'Blank way'),
          conf: 0.98,
          line: slot.line,
        });
      }
      group = [];
    };

    for (const slot of slots) {
      if (group.length && (slot.phase === 'L1'
        || (Number.isInteger(slot.explicitWay) && group.some((candidate) => Number.isInteger(candidate.explicitWay))))) {
        finalizeGroup();
      }
      group.push(slot);
      if (slot.phase === 'L3') finalizeGroup();
    }
    finalizeGroup();

    const codedCount = rows.filter((row) => row.device).length;
    return { matched: codedCount > 0, rows, codedCount, detachedCount };
  }

  function dialectSpareRow(text, way, phase = null) {
    return {
      way,
      phase,
      rating: null,
      device: null,
      poles: 1,
      desc: 'Spare',
      spare: true,
      space: false,
      incomer: false,
      qty: 0,
      srcText: text,
      conf: 0.96,
      resolutionSource: 'schedule_columns',
    };
  }

  function dialectDevice({ rcdMa = null, afdd = false } = {}) {
    if (afdd) return 'AFDD+RCBO';
    return Number(rcdMa) > 0 ? 'RCBO' : 'MCB';
  }

  function parseKnownScheduleLine(line) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const slash = text.match(/^(\d{1,3})\s*\/\s*(L[123])\s+(.+)$/i);
    if (slash) {
      const way = Number(slash[1]);
      const phase = slash[2].toUpperCase();
      const body = slash[3].trim();
      if (scheduleOccupancyLabel(text) === 'spare') return dialectSpareRow(text, way, phase);

      const syntegral = body.match(/^(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(YES|NO)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?|SWA)\s+(RAD|RING)\s+(.+)$/i);
      if (syntegral) {
        const rcdMa = syntegral[3] === '-' ? null : Number(syntegral[3]);
        const afdd = syntegral[4].toUpperCase() === 'YES';
        const description = syntegral[9].trim();
        return {
          way,
          phase,
          rating: Number(syntegral[1]),
          device: dialectDevice({ rcdMa, afdd }),
          curve: syntegral[2].toUpperCase(),
          sens: rcdMa,
          afdd,
          poles: 1,
          circuitConfig: syntegral[8].toUpperCase() === 'RING' ? 'ring' : 'radial',
          cable: {
            typeCode: syntegral[5],
            size: Number(syntegral[6]),
            cpc: /^\d/.test(syntegral[7]) ? Number(syntegral[7]) : syntegral[7].toUpperCase(),
            orig: `${syntegral[6]}mm2 type ${syntegral[5]}`,
          },
          desc: description,
          associatedDevices: extractAssociatedEquipment(description),
          spare: false,
          space: false,
          incomer: false,
          qty: 1,
          srcText: text,
          conf: 0.94,
          resolutionSource: 'schedule_columns',
        };
      }

      const heavacomp = body.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?|SWA)\s+(.+?)\s+(Fixed power|Lighting)\s+(.+)$/i);
      if (heavacomp) {
        const service = heavacomp[5].toLowerCase();
        const description = `${heavacomp[5]} ${heavacomp[6]}`.trim();
        return {
          way,
          phase,
          rating: Number(heavacomp[1]),
          device: service === 'lighting' ? 'MCB' : 'RCBO',
          curve: null,
          sens: service === 'lighting' ? null : 30,
          poles: 1,
          serviceCode: service === 'lighting' ? 'L' : 'P',
          discipline: service === 'lighting' ? 'Lighting' : '',
          cable: {
            size: Number(heavacomp[2]),
            cpc: /^\d/.test(heavacomp[3]) ? Number(heavacomp[3]) : heavacomp[3].toUpperCase(),
            construction: heavacomp[4],
            orig: `${heavacomp[2]}mm2 ${heavacomp[4]}`,
          },
          desc: description,
          associatedDevices: extractAssociatedEquipment(description),
          spare: false,
          space: false,
          incomer: false,
          qty: 1,
          srcText: text,
          conf: 0.9,
          resolutionSource: 'schedule_columns',
        };
      }
    }

    const bes = text.match(/^(\d{1,3})\s+(L[123])\s+(.+?)\s+(RAD|RING)\s+(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(YES|NO)$/i);
    if (bes) {
      const rcdMa = bes[7] === '-' ? null : Number(bes[7]);
      const afdd = bes[8].toUpperCase() === 'YES';
      const description = bes[3].trim();
      return {
        way: Number(bes[1]),
        phase: bes[2].toUpperCase(),
        rating: Number(bes[5]),
        device: dialectDevice({ rcdMa, afdd }),
        curve: bes[6].toUpperCase(),
        sens: rcdMa,
        afdd,
        poles: 1,
        circuitConfig: bes[4].toUpperCase() === 'RING' ? 'ring' : 'radial',
        desc: description,
        associatedDevices: extractAssociatedEquipment(description),
        spare: false,
        space: false,
        incomer: false,
        qty: 1,
        srcText: text,
        conf: 0.93,
        resolutionSource: 'schedule_columns',
      };
    }

    const amtechSpare = text.match(/^(\d{1,3})\s+Spare(?:\s+0)?$/i);
    if (amtechSpare) return dialectSpareRow(text, Number(amtechSpare[1]));
    const amtech = text.match(/^(\d{1,3})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)$/i);
    if (amtech) {
      const rcdMa = amtech[5] === '-' ? null : Number(amtech[5]);
      const description = amtech[2].trim();
      return {
        way: Number(amtech[1]),
        phase: null,
        rating: Number(amtech[3]),
        device: dialectDevice({ rcdMa }),
        curve: amtech[4].toUpperCase(),
        sens: rcdMa,
        poles: 1,
        discipline: /\blighting\b/i.test(description) ? 'Lighting' : '',
        cable: {
          size: Number(amtech[6]),
          cores: Number(amtech[7]),
          cpc: Number(amtech[8]),
          orig: `${amtech[7]}C ${amtech[6]}mm2`,
        },
        desc: description,
        associatedDevices: extractAssociatedEquipment(description),
        spare: false,
        space: false,
        incomer: false,
        qty: 1,
        srcText: text,
        conf: 0.91,
        resolutionSource: 'schedule_columns',
      };
    }
    return null;
  }

  function explicitProtectionDevice(text) {
    const source = String(text || '');
    const definitions = [
      ['AFDD+RCBO', /\b(?:AFDD|AFFD)\s*(?:\+|\/|AND)?\s*RCBO\b/i],
      ['RCBO', /\bRCBO\b/i],
      ['MCCB', /\bMCCB\b/i],
      ['MCB', /\bMCB\b/i],
      ['ACB', /\bACB\b/i],
      ['RCD', /\bRCD\b/i],
      ['Fuse', /\b(?:HRC\s+)?FUSE\b/i],
      ['Isolator', /\b(?:ISOLATOR|SWITCH\s+DISCONNECTOR)\b/i],
    ];
    return definitions.find(([, pattern]) => pattern.test(source))?.[0] || null;
  }

  const PROTECTION_STANDARDS = {
    '60898': { label: 'BS EN 60898', device: 'MCB', combinedRcd: false },
    '61009': { label: 'BS EN 61009', device: 'RCBO', combinedRcd: true },
    '61008': { label: 'BS EN 61008', device: 'RCD', combinedRcd: true },
    '60947-2': { label: 'BS EN 60947-2', device: 'MCCB', combinedRcd: false },
    '60947-3': { label: 'BS EN 60947-3', device: 'Isolator', combinedRcd: false },
  };

  function indicatorState(value) {
    const token = String(value || '').trim();
    if (/^(?:YES|Y|TRUE|1|CHECKED|TICK|[✓✔☑])$/i.test(token)) return true;
    if (/^(?:NO|N|FALSE|0|X|[-–—]|[×✕✖□☐])$/i.test(token)) return false;
    return null;
  }

  /**
   * Read the ordered overcurrent-protection columns used by UK board schedules.
   * Once a BS standard is found, curve/rating/kA are taken from the immediately
   * following columns. This prevents later cable values such as "6 A" from
   * replacing a 32 A protective-device rating.
   */
  function parseProtectionStandardSequence(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    const standardMatch = source.match(/\b(?:BS\s*(?:EN\s*)?)?(61009(?:-1)?|60898(?:-1)?|61008(?:-1)?|60947\s*[-/]\s*[23])\b/i);
    if (!standardMatch) return null;

    const rawCode = standardMatch[1].replace(/\s*[/]\s*/, '-').replace(/-(?:1)$/i, '');
    const standardCode = /^60947/i.test(rawCode) ? rawCode.replace(/\s+/g, '') : rawCode.slice(0, 5);
    const standard = PROTECTION_STANDARDS[standardCode];
    if (!standard) return null;

    const tail = source.slice(standardMatch.index + standardMatch[0].length).trim();
    const protection = tail.match(/^(?:TYPE\s*)?([BCDKZ])\s+(\d{1,4}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)(?=\s|$)/i);
    if (!protection) return null;

    const rating = Number(protection[2]);
    const breakingCapacityKa = Number(protection[3]);
    if (!Number.isFinite(rating) || rating <= 0 || rating > 6300
      || !Number.isFinite(breakingCapacityKa) || breakingCapacityKa <= 0 || breakingCapacityKa > 150) return null;

    const remainder = tail.slice(protection[0].length).trim();
    const tokens = remainder ? remainder.split(/\s+/) : [];
    const indicators = [];
    while (tokens.length && indicators.length < 2) {
      const state = indicatorState(tokens[0]);
      if (state == null) break;
      indicators.push(state);
      tokens.shift();
    }

    const afdd = indicators[0] === true;
    const rcdColumn = indicators.length >= 2 ? indicators[1] : null;
    let sensitivityMa = null;
    const possibleSensitivity = Number(tokens[0]);
    if ((standard.combinedRcd || rcdColumn === true) && [10, 30, 100, 300, 500].includes(possibleSensitivity)) {
      sensitivityMa = possibleSensitivity;
      tokens.shift();
    }

    const rcdProtected = standard.combinedRcd ? true : rcdColumn;
    let device = standard.device;
    if (afdd && device === 'RCBO') device = 'AFDD+RCBO';
    return {
      standard: standard.label,
      standardCode,
      device,
      curve: protection[1].toUpperCase(),
      rating,
      breakingCapacityKa,
      afdd,
      rcdProtected,
      rcdCombined: standard.combinedRcd,
      rcdArrangement: standard.combinedRcd ? 'integral' : (rcdColumn === true ? 'separate' : null),
      sensitivityMa,
      description: tokens.join(' ').trim(),
      indicatorsCaptured: indicators.length,
      confidence: 0.97,
      source: 'ordered_protection_columns',
    };
  }

  /**
   * Guarded fallback for flattened protection tables. It only infers a device
   * when a numbered circuit row contains protection evidence and the nearby
   * table header names protection columns. Inferred rows stay reviewable.
   */
  function parseProtectionTableLine(line, context = {}) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const wayMatch = text.match(/^\s*(?:(?:WAY|CCT|CKT|CIRCUIT)\s*[:#-]?\s*)?(\d{1,3})(?:\s*[\/-]\s*(L[123]))?\b/i);
    if (!wayMatch) return null;

    const header = String(context.headerText || '');
    const protectionHeader = /\b(?:PROTECTION|PROTECTIVE|DEVICE|RATING|AMPS?|CURVE|TRIP|RCD|RCBO|MCB|BREAKING|kA|POLES?)\b/i.test(header);
    const occupancy = scheduleOccupancyLabel(text);
    const spare = occupancy === 'spare';
    const space = occupancy === 'space';
    const standardSequence = parseProtectionStandardSequence(text);
    const explicitDevice = explicitProtectionDevice(text);
    const explicitRating = text.match(/\b(\d+(?:\.\d+)?)\s*A(?:MPS?)?\b/i);
    const ratingCurve = text.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s+([BCDKZ])(?=\s|$|[,;])/i);
    const curveEvidence = extractTrippingCurve(text, { deviceContext: protectionHeader || Boolean(explicitDevice) });
    const rating = standardSequence?.rating ?? (explicitRating ? Number(explicitRating[1])
      : (curveEvidence?.rating ?? (ratingCurve ? Number(ratingCurve[1]) : null)));
    const curve = standardSequence?.curve || curveEvidence?.value || (ratingCurve ? ratingCurve[2].toUpperCase() : null);
    const sensitivity = standardSequence?.sensitivityMa ?? (Number(text.match(/\b(\d{1,4})\s*mA\b/i)?.[1]) || null);
    const explicitCombinedRcd = /^(?:RCBO|AFDD\+RCBO|RCD)$/i.test(explicitDevice || '');
    const rcdHeader = /\bRCD\b/i.test(header);
    const explicitRcdYes = /(?:^|\s)(?:YES|TRUE|TICK|[✓✔☑])(?:\s|$)/i.test(text) && rcdHeader;
    const explicitRcdNo = /(?:^|\s)(?:NO|FALSE|[×✕✖☐])(?:\s|$)/i.test(text) && rcdHeader;
    const rcdState = standardSequence
      ? standardSequence.rcdProtected
      : (explicitCombinedRcd || sensitivity != null || explicitRcdYes ? true : (explicitRcdNo ? false : null));
    const rcdConfirmed = rcdState === true;
    let device = standardSequence?.device || explicitDevice;
    if (device === 'RCBO' && standardSequence?.afdd) device = 'AFDD+RCBO';
    let rcdArrangement = standardSequence?.rcdArrangement
      || (explicitCombinedRcd ? 'integral' : (rcdConfirmed && explicitDevice === 'MCB' ? 'separate' : null));
    let inferredDevice = false;
    if (!device && curve && rating != null && protectionHeader) {
      device = rcdConfirmed ? 'RCBO' : 'MCB';
      inferredDevice = true;
      if (device === 'RCBO' && !rcdArrangement) rcdArrangement = 'integral';
    } else if (!device && rating != null && protectionHeader
      && (extractBreakingCapacity(text) || /\b[1-4]\s*P(?:OLE)?\b/i.test(text))) {
      device = 'Protective device';
      inferredDevice = true;
    }
    if (!device && !spare && !space) return null;
    if (!protectionHeader && !standardSequence && !explicitDevice && !spare && !space) return null;

    const poleMatch = text.match(/\b([1-4])\s*P(?:OLE)?\b/i);
    const phase = (wayMatch[2] || text.match(/\b(L[123])\b/i)?.[1] || '').toUpperCase() || null;
    const breaking = standardSequence
      ? { value: standardSequence.breakingCapacityKa, original: `${standardSequence.breakingCapacityKa}kA`, confidence: standardSequence.confidence }
      : extractBreakingCapacity(text);
    const incomer = /\b(?:INCOMER|INCOMING|MAIN\s+SWITCH)\b/i.test(text);
    const confidence = standardSequence?.confidence ?? (inferredDevice ? 0.68 : (explicitDevice ? 0.88 : 0.72));
    return {
      way: Number(wayMatch[1]),
      phase,
      rating: Number.isFinite(rating) ? rating : null,
      device,
      curve,
      sens: sensitivity,
      afdd: Boolean(standardSequence?.afdd),
      rcdProtected: rcdState,
      rcdArrangement,
      protectionStandard: standardSequence?.standard || null,
      poles: poleMatch ? Number(poleMatch[1]) : null,
      ka: breaking?.value ?? null,
      cable: null,
      desc: standardSequence?.description || text.slice(wayMatch[0].length).trim(),
      spare,
      space,
      incomer,
      qty: space ? 0 : (device ? 1 : 0),
      inferredDevice,
      requiresReview: inferredDevice || (!spare && !space && (rating == null || !device
        || ((device === 'RCBO' || device === 'AFDD+RCBO') && sensitivity == null))),
      resolutionSource: standardSequence?.source || (inferredDevice ? 'protection_table_inference' : 'protection_table_evidence'),
      columnEvidence: standardSequence ? {
        standard: standardSequence.standard,
        curve: standardSequence.curve,
        rating: standardSequence.rating,
        breakingCapacityKa: standardSequence.breakingCapacityKa,
        rcdProtected: standardSequence.rcdProtected,
        rcdArrangement: standardSequence.rcdArrangement,
        sensitivityMa: standardSequence.sensitivityMa,
      } : null,
      srcText: text,
      conf: confidence,
    };
  }

  /** Reconcile protection attributes without overwriting an evidenced class. */
  function reconcileCombinedProtection(row) {
    if (!row) return row;
    const next = reconcilePoleEvidence(reconcileRowOccupancy(row));
    const rcdProtected = next.rcdProtected === true || next.sens != null
      ? true
      : (next.rcdProtected === false ? false : null);
    const afdd = next.afdd === true;
    const current = String(next.device || '').toUpperCase().replace(/\s+/g, '');
    let device = next.device;
    let rcdArrangement = next.rcdArrangement || null;
    if ((current === 'RCBO' || current === 'AFDD+RCBO' || current === 'RCD') && rcdProtected !== false) {
      rcdArrangement = 'integral';
    } else if (current === 'MCB' && rcdProtected && !rcdArrangement) {
      rcdArrangement = next.separateRcd ? 'separate' : 'separate_or_unspecified';
    }
    if ((current === 'RCBO' || current === 'AFDD+RCBO') && afdd && next.afddArrangement !== 'separate') {
      device = 'AFDD+RCBO';
    }
    const reconciledRcd = current === 'RCBO' || current === 'AFDD+RCBO' || current === 'RCD'
      ? (rcdProtected === false ? false : true) : rcdProtected;
    if (device === next.device && next.rcdProtected === reconciledRcd
      && next.rcdArrangement === rcdArrangement) return next;

    next.device = device;
    next.rcdProtected = reconciledRcd;
    next.rcdArrangement = rcdArrangement;
    const reasons = Array.isArray(next.resolutionReasons) ? [...next.resolutionReasons] : [];
    const reason = device !== row.device
      ? 'RCBO with integral AFDD row evidence classified as AFDD+RCBO'
      : (current === 'MCB' && reconciledRcd
        ? 'MCB class retained; RCD protection recorded as a separate attribute'
        : 'Integral residual-current protection normalised from the device class');
    if (device !== row.device && !reasons.includes(reason)) reasons.push(reason);
    next.resolutionReasons = reasons;
    if ((device === 'RCBO' || device === 'AFDD+RCBO') && next.sens == null) next.requiresReview = true;
    return next;
  }

  function aggregateDevices(rows) {
    const totals = new Map();
    for (const row of rows || []) {
      const quantity = protectionDeviceQuantity(row);
      if (!row || !quantity) continue;
      const key = [
        row.device,
        row.rating ?? '',
        row.curve || '',
        row.poles || '',
        row.sens ?? '',
        row.rcdType || '',
        row.rcdArrangement || '',
      ].join('|');
      if (!totals.has(key)) {
        totals.set(key, {
          device: row.device,
          rating: row.rating,
          curve: row.curve,
          poles: row.poles,
          sensitivityMa: row.sens,
          rcdType: row.rcdType,
          rcdArrangement: row.rcdArrangement,
          quantity: 0,
          evidence: [],
        });
      }
      const total = totals.get(key);
      total.quantity += quantity;
      total.evidence.push({ way: row.way, phase: row.phase, source: row.srcText });
    }
    return [...totals.values()];
  }

  function finalizeScheduleContext(context = {}) {
    const pending = context.pendingRows || [];
    if (!pending.length) return [];
    if (Number.isInteger(context.lastWay)) {
      const inferredWay = context.lastWay + 1;
      for (const row of pending) {
        row.way = inferredWay;
        row.deferredWay = false;
        row.inferredWay = true;
        row.requiresReview = true;
        row.conf = Math.min(row.conf ?? 0.65, 0.65);
      }
    } else {
      for (const row of pending) {
        row.requiresReview = true;
        row.conf = Math.min(row.conf ?? 0.45, 0.45);
      }
    }
    context.pendingRows = [];
    return pending;
  }

  function normaliseAssistedDevice(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!source) return null;
    if (/\bAFDD\b/.test(source) && /\bRCBO\b/.test(source)) return 'AFDD+RCBO';
    if (/\bRCBO\b/.test(source)) return 'RCBO';
    if (/\bMCCB\b/.test(source)) return 'MCCB';
    if (/\bMCB\b/.test(source)) return 'MCB';
    if (/\bRCD\b/.test(source)) return 'RCD';
    if (/\b(?:HRC\s+)?FUSE\b/.test(source)) return 'FUSE';
    return source.replace(/\s*\+\s*/g, '+');
  }

  function assistedSeedFromText(text, row = null) {
    const source = String(text || row?.srcText || '').replace(/\s+/g, ' ').trim();
    const device = normaliseAssistedDevice(row?.device || source.match(/\b(?:AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|RCD|HRC\s+FUSE|FUSE)\b/i)?.[0]);
    let rating = Number.isFinite(Number(row?.rating)) ? Number(row.rating) : null;
    if (rating === null && device) {
      const escaped = device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('AFDD\\+RCBO', 'AFDD\\s*\\+\\s*RCBO');
      const before = source.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:A|AMP(?:S)?)?\\s+${escaped}\\b`, 'i'));
      const after = source.match(new RegExp(`${escaped}\\b[^\\n]{0,18}?(\\d+(?:\\.\\d+)?)\\s*(?:A|AMP(?:S)?)\\b`, 'i'));
      const generic = source.match(/\b(\d+(?:\.\d+)?)\s*(?:A|AMP(?:S)?)\b/i);
      const found = before || after || generic;
      if (found) rating = Number(found[1]);
    }
    if (!device || !Number.isFinite(rating)) return null;
    return { device, rating, label: `${rating}A ${device}`, source };
  }

  function matchAssistedRows(rows, seed, options = {}) {
    if (!seed) return { rows: [], quantity: 0 };
    const boardNorm = options.boardNorm || seed.boardNorm || null;
    const fileId = options.fileId || seed.fileId || null;
    const device = normaliseAssistedDevice(seed.device);
    const rating = Number(seed.rating);
    const matches = (rows || []).filter((row) => {
      if (!row || row.status === 'rejected' || !isCountableProtectionDevice(row)) return false;
      if (boardNorm && row.boardNorm !== boardNorm) return false;
      if (fileId && row.fileId !== fileId) return false;
      return normaliseAssistedDevice(row.device) === device && Number(row.rating) === rating;
    });
    return {
      rows: matches,
      quantity: matches.reduce((sum, row) => sum + protectionDeviceQuantity(row), 0),
    };
  }

  function assessPageText(lines, options = {}) {
    const records = (lines || []).map((line) => typeof line === 'string' ? { text: line } : (line || {}));
    const source = records.map((line) => String(line.text || '')).join('\n').trim();
    if (!source) {
      return {
        route: 'ocr', reliable: false, score: 0, lineCount: 0, characterCount: 0,
        reasons: ['No embedded text was found'],
      };
    }
    const characters = Array.from(source);
    const printable = characters.filter((character) => {
      const code = character.codePointAt(0);
      return character === '\n' || character === '\t' || (code >= 32 && code !== 0xfffd);
    }).length;
    const replacementCount = (source.match(/\uFFFD|�/g) || []).length;
    const printableRatio = printable / Math.max(1, characters.length);
    const alphanumericRatio = (source.match(/[A-Za-z0-9]/g) || []).length / Math.max(1, characters.length);
    const tokens = source.match(/[A-Za-z0-9][A-Za-z0-9+&./-]*/g) || [];
    const electricalSignals = (source.match(/\b(?:DB|BOARD|WAY|CIRCUIT|L[123]|MCB|MCCB|RCBO|RCD|AFDD|SPD|\d+(?:\.\d+)?\s*(?:A|MA|KA)|SPN|DPN|TPN)\b/gi) || []).length;
    const bboxes = records.map((line) => line.bbox).filter((bbox) => Array.isArray(bbox) && bbox.length >= 4 && bbox.every(Number.isFinite));
    let orderingErrors = 0;
    for (let index = 1; index < bboxes.length; index += 1) {
      const priorY = Number(bboxes[index - 1][1]);
      const nextY = Number(bboxes[index][1]);
      if (nextY + Math.max(4, Number(bboxes[index][3]) || 0) < priorY) orderingErrors += 1;
    }
    const orderingErrorRatio = orderingErrors / Math.max(1, bboxes.length - 1);
    const orderingUnreliable = orderingErrors > 0 && orderingErrorRatio > 0.12;
    const expectedType = String(options.expectedType || '').toLowerCase();
    const expectsDenseTable = /schedule|table/.test(expectedType);
    let score = 0.15
      + Math.min(0.25, characters.length / 1200)
      + Math.min(0.12, records.length / 30)
      + printableRatio * 0.18
      + Math.min(0.1, tokens.length / 120)
      + Math.min(0.12, electricalSignals / 30);
    if (printableRatio > 0.96 && alphanumericRatio > 0.45) score += 0.18;
    score -= Math.min(0.45, replacementCount / Math.max(1, characters.length) * 8);
    score -= Math.min(0.35, orderingErrorRatio * 1.5);
    if (expectsDenseTable && (characters.length < 80 || records.length < 3)) score -= 0.35;
    if (tokens.length && tokens.filter((token) => token.length === 1).length / tokens.length > 0.55) score -= 0.2;
    score = Math.max(0, Math.min(1, score));
    const reasons = [];
    if (replacementCount) reasons.push('The text layer contains corrupt replacement characters');
    if (printableRatio < 0.9) reasons.push('The text layer contains too many non-printable characters');
    if (orderingUnreliable) reasons.push('The text layer is not in a reliable reading order');
    else if (orderingErrors) reasons.push('Localized reading-order anomalies were normalized');
    if (expectsDenseTable && (characters.length < 80 || records.length < 3)) reasons.push('The schedule text layer appears incomplete');
    const reliable = score >= 0.62 && printableRatio >= 0.9 && replacementCount === 0 && !orderingUnreliable;
    if (!reliable && !reasons.length) reasons.push('Embedded-text quality is below the acceptance threshold');
    return {
      route: reliable ? 'embedded_text' : 'ocr',
      reliable,
      score,
      lineCount: records.length,
      characterCount: characters.length,
      printableRatio,
      alphanumericRatio,
      electricalSignals,
      orderingErrors,
      orderingErrorRatio,
      orderingUnreliable,
      reasons,
    };
  }

  function buildOcrCandidatePlan(metrics = {}) {
    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
      const value = {
        id: candidate.id,
        rotation: Number(candidate.rotation) || 0,
        deskew: Number(candidate.deskew) || 0,
        scale: Number(candidate.scale) || 2.25,
        grayscale: candidate.grayscale !== false,
        contrast: Number(candidate.contrast) || 1,
        threshold: candidate.threshold || null,
        denoise: Boolean(candidate.denoise),
        sharpen: Boolean(candidate.sharpen),
        backgroundCorrection: Boolean(candidate.backgroundCorrection),
      };
      const key = JSON.stringify(value);
      if (!seen.has(key)) { seen.add(key); candidates.push(value); }
    };
    const orientation = [90, 180, 270].includes(Number(metrics.orientation)) ? Number(metrics.orientation) : 0;
    const textHeight = Number(metrics.estimatedTextHeight) || 12;
    const lowResolution = textHeight < 9 || Math.min(Number(metrics.width) || 2000, Number(metrics.height) || 2000) < 800;
    const scale = lowResolution ? 3 : 2.25;
    add({ id: 'base', rotation: 0, scale, grayscale: true, contrast: 1.08 });
    add({ id: 'enhanced', rotation: orientation, scale, grayscale: true, contrast: 1.35, sharpen: true });
    if (orientation) add({ id: `rotate-${orientation}`, rotation: orientation, scale, grayscale: true, contrast: 1.2, sharpen: true });
    if (Math.abs(Number(metrics.skewAngle) || 0) >= 0.35) {
      add({ id: 'deskew', rotation: orientation, deskew: -Number(metrics.skewAngle), scale, grayscale: true, contrast: 1.25, sharpen: true });
    }
    if (Number(metrics.contrast) < 0.2 || metrics.unevenBackground || Number(metrics.noise) > 0.2) {
      add({
        id: 'adaptive-threshold', rotation: orientation, scale, grayscale: true, contrast: 1.45,
        threshold: 'adaptive', denoise: Number(metrics.noise) > 0.15, sharpen: true,
        backgroundCorrection: Boolean(metrics.unevenBackground),
      });
    }
    if (lowResolution) add({ id: 'upscaled', rotation: orientation, scale: 3, grayscale: true, contrast: 1.3, sharpen: true });
    if (metrics.tryOrientations) {
      [90, 180, 270].forEach((rotation) => add({ id: `fallback-${rotation}`, rotation, scale, grayscale: true, contrast: 1.25, sharpen: true }));
    }
    return candidates;
  }

  function scoreOcrCandidate(candidate = {}) {
    const text = String(candidate.text || candidate.data?.text || '');
    const lines = Array.isArray(candidate.lines) && candidate.lines.length
      ? candidate.lines
      : text.split(/\r?\n/).filter(Boolean).map((value) => ({ text: value }));
    const quality = assessPageText(lines, { expectedType: candidate.expectedType });
    const rawConfidence = Number(candidate.confidence ?? candidate.data?.confidence) || 0;
    const confidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
    const domainHits = (text.match(/\b(?:MCB|MCCB|RCBO|RCD|AFDD|SPD|SPN|DPN|TPN|L[123]|\d+(?:\.\d+)?\s*(?:A|MA|KA))\b/gi) || []).length;
    const tableRows = lines.filter((line) => /(?:^|\s)(?:\d{1,3}\s*(?:\/\s*)?L[123]|L[123]\s+\d+(?:\.\d+)?)/i.test(String(line.text || ''))).length;
    const score = Math.max(0, Math.min(1,
      confidence * 0.45 + quality.score * 0.42 + Math.min(0.08, domainHits * 0.008) + Math.min(0.05, tableRows * 0.01)));
    return { score, confidence, textQuality: quality, domainHits, tableRows };
  }

  function selectBestOcrCandidate(candidates) {
    const scored = (candidates || []).map((candidate, index) => ({ candidate, index, ...scoreOcrCandidate(candidate) }));
    scored.sort((left, right) => right.score - left.score || left.index - right.index);
    return scored.length ? { candidate: scored[0].candidate, score: scored[0].score, scored } : { candidate: null, score: 0, scored: [] };
  }

  function correctElectricalOcrText(value) {
    const originalText = String(value || '');
    let correctedText = originalText;
    const corrections = [];
    const replace = (pattern, replacement, reason) => {
      correctedText = correctedText.replace(pattern, (...args) => {
        const original = args[0];
        const corrected = typeof replacement === 'function' ? replacement(...args) : replacement;
        if (corrected !== original) corrections.push({ original, corrected, reason });
        return corrected;
      });
    };
    replace(/\b(Way|Cct|Ckt|Circuit)\s+[lI|](?=\s*[:#])/gi, (match, label) => `${label} 1`, 'OCR confused the circuit number 1 with I, l, or |');
    replace(/\b[lI|](\d{1,2})\s*A\b/g, (match, suffix) => {
      const candidate = Number(`1${suffix}`);
      return [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125].includes(candidate) ? `${candidate}A` : match;
    }, 'OCR confused the leading digit 1 in a standard current rating');
    replace(/\bMC8\b/gi, 'MCB', 'OCR confused the letter B with the digit 8 in MCB');
    replace(/\bMCC8\b/gi, 'MCCB', 'OCR confused the letter B with the digit 8 in MCCB');
    replace(/\bRC8O\b/gi, 'RCBO', 'OCR confused the letter B with the digit 8 in RCBO');
    replace(/\b(\d{1,2})[OoQ]\s*kA\b/gi, (match, prefix) => `${prefix}0kA`, 'OCR confused the digit 0 with O or Q in a breaking-capacity value');
    return { originalText, text: correctedText, corrections };
  }

  function extractTrippingCurve(value, context = {}) {
    const source = String(value || '');
    const explicit = source.match(/\b(?:TYPE|CURVE|CHARACTERISTIC)\s*[-:]?\s*([BCDKZ])\b/i)
      || source.match(/\b([BCDKZ])\s*[- ]?CURVE\b/i);
    if (explicit) return { value: explicit[1].toUpperCase(), original: explicit[0], confidence: 0.98, reason: 'Explicit tripping-curve wording' };
    const hasDevice = Boolean(context.deviceContext) || /\b(?:MCB|MCCB|RCBO|AFDD|CIRCUIT BREAKER)\b/i.test(source);
    if (!hasDevice) return null;
    const compact = source.match(/(?:^|\s)([BCDKZ])\s*[-]?\s*(\d{1,3})(?=\s|$|[,;])/i);
    if (!compact) return null;
    if (/\b(?:DB|BOARD|REV(?:ISION)?)\s*[- ]?\s*[BCDKZ]\s*[-]?\s*\d{1,3}\b/i.test(source) && !/\b(?:MCB|MCCB|RCBO|AFDD)\b/i.test(source)) return null;
    return { value: compact[1].toUpperCase(), rating: Number(compact[2]), original: compact[0].trim(), confidence: 0.94, reason: 'Compact curve-and-rating value in device context' };
  }

  function extractBreakingCapacity(value) {
    const source = String(value || '');
    const match = source.match(/\b(\d+(?:\.\d+)?)\s*kA\b/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 150) return null;
    return { value: amount, original: match[0], confidence: 0.98, reason: 'Explicit kA unit' };
  }

  function reconstructSpatialRows(words) {
    const clean = (words || []).map((word) => {
      const box = word?.bbox || word?.boundingBox || word || {};
      const x0 = Number(box.x0 ?? box.left);
      const y0 = Number(box.y0 ?? box.top);
      const x1 = Number(box.x1 ?? box.right);
      const y1 = Number(box.y1 ?? box.bottom);
      return { text: String(word?.text || '').trim(), x0, y0, x1, y1, confidence: Number(word?.confidence ?? word?.conf) };
    }).filter((word) => word.text && [word.x0, word.y0, word.x1, word.y1].every(Number.isFinite));
    clean.sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);
    const rows = [];
    clean.forEach((word) => {
      const cy = (word.y0 + word.y1) / 2;
      const height = Math.max(1, word.y1 - word.y0);
      let row = rows.find((candidate) => Math.abs(candidate.cy - cy) <= Math.max(4, Math.min(candidate.height, height) * 0.65));
      if (!row) {
        row = { words: [], cy, height };
        rows.push(row);
      }
      row.words.push(word);
      row.cy = row.words.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / row.words.length;
      row.height = Math.max(...row.words.map((item) => item.y1 - item.y0));
    });
    return rows.sort((left, right) => left.cy - right.cy).map((row) => {
      row.words.sort((left, right) => left.x0 - right.x0);
      const cells = [];
      row.words.forEach((word) => {
        const prior = cells[cells.length - 1];
        const gap = prior ? word.x0 - prior.x1 : 0;
        if (!prior || gap > Math.max(18, row.height * 2.2)) {
          cells.push({ text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1, words: [word] });
        } else {
          prior.text += ` ${word.text}`;
          prior.x1 = Math.max(prior.x1, word.x1); prior.y0 = Math.min(prior.y0, word.y0); prior.y1 = Math.max(prior.y1, word.y1); prior.words.push(word);
        }
      });
      cells.forEach((cell) => {
        cell.bbox = [cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0];
        cell.confidence = cell.words.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / Math.max(1, cell.words.length) / 100;
      });
      const x0 = Math.min(...row.words.map((word) => word.x0));
      const y0 = Math.min(...row.words.map((word) => word.y0));
      const x1 = Math.max(...row.words.map((word) => word.x1));
      const y1 = Math.max(...row.words.map((word) => word.y1));
      return { text: row.words.map((word) => word.text).join(' '), bbox: [x0, y0, x1 - x0, y1 - y0], cells };
    });
  }

  function stitchSchedulePages(pages) {
    const output = [];
    let boardRef = null;
    const headerKeys = new Set();
    (pages || []).forEach((page) => {
      if (page && page.boardRef) boardRef = page.boardRef;
      (page && page.rows || []).forEach((row) => {
        const text = String(row && row.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const header = /\b(?:WAY|CCT|CIRCUIT)\b.*\b(?:DESCRIPTION|RATING|DEVICE|PROTECTION)\b/i.test(text);
        if (header) { headerKeys.add(text.toUpperCase()); return; }
        if (headerKeys.has(text.toUpperCase())) return;
        output.push({ ...row, text, page: page.page, boardRef: page.boardRef || boardRef });
      });
    });
    return output;
  }

  function deduplicateExtractionRows(rows) {
    const output = [];
    const duplicates = [];
    const indexes = new Map();
    const keyFor = (row) => {
      const board = String(row?.boardNorm || '').toUpperCase();
      const capacity = row?.breakingCapacity ?? row?.breakingCapacityKa ?? row?.ka ?? '';
      const poles = row?.poleConfiguration ?? row?.poleConfig ?? row?.pole ?? row?.poles ?? '';
      if (board && row?.way != null) return ['circuit', board, row.way, row.phase || '', row.device || '', row.rating ?? '', row.curve || '', capacity, poles].join('|');
      const bbox = Array.isArray(row?.bbox) ? row.bbox.map((value) => Number(value).toFixed(1)).join(',') : '';
      if (row?.fileId && row?.page != null && bbox) return ['region', row.fileId, row.page, bbox, row.device || '', row.rating ?? ''].join('|');
      return ['source', row?.id || '', row?.fileId || '', row?.page ?? '', row?.line ?? '', row?.srcText || ''].join('|');
    };
    (rows || []).forEach((row) => {
      const key = keyFor(row);
      const index = indexes.get(key);
      if (index == null) { indexes.set(key, output.length); output.push(row); return; }
      const prior = output[index];
      const priorScore = Number(prior?.conf || 0) + (prior?.status === 'confirmed' ? 1 : 0);
      const nextScore = Number(row?.conf || 0) + (row?.status === 'confirmed' ? 1 : 0);
      if (nextScore > priorScore) {
        output[index] = row;
        duplicates.push({ retained: row, excluded: prior, key });
      } else {
        duplicates.push({ retained: prior, excluded: row, key });
      }
    });
    return { rows: output, duplicates };
  }

  function ocrWordsToLines(words, renderedWidth, renderedHeight, pageWidth, pageHeight) {
    const sx = Number(pageWidth) / Math.max(1, Number(renderedWidth));
    const sy = Number(pageHeight) / Math.max(1, Number(renderedHeight));
    const clean = (words || []).map((word) => {
      const box = word?.bbox || word?.boundingBox || {};
      const x0 = Number(box.x0 ?? box.left);
      const y0 = Number(box.y0 ?? box.top);
      const x1 = Number(box.x1 ?? box.right);
      const y1 = Number(box.y1 ?? box.bottom);
      return { text: String(word?.text || '').trim(), x0, y0, x1, y1, confidence: Number(word?.confidence ?? word?.conf) };
    }).filter((word) => word.text && [word.x0, word.y0, word.x1, word.y1].every(Number.isFinite));
    clean.sort((a, b) => {
      const ay = (a.y0 + a.y1) / 2;
      const by = (b.y0 + b.y1) / 2;
      return Math.abs(ay - by) > Math.max(5, Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6)
        ? ay - by
        : a.x0 - b.x0;
    });
    const lines = [];
    for (const word of clean) {
      const cy = (word.y0 + word.y1) / 2;
      const height = Math.max(1, word.y1 - word.y0);
      let line = lines.find((candidate) => Math.abs(candidate.cy - cy) <= Math.max(5, Math.min(candidate.height, height) * 0.65));
      if (!line) {
        line = { words: [], cy, height, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
        lines.push(line);
      }
      line.words.push(word);
      line.x0 = Math.min(line.x0, word.x0); line.y0 = Math.min(line.y0, word.y0);
      line.x1 = Math.max(line.x1, word.x1); line.y1 = Math.max(line.y1, word.y1);
      line.cy = (line.y0 + line.y1) / 2; line.height = Math.max(1, line.y1 - line.y0);
    }
    return lines.sort((a, b) => a.y0 - b.y0).map((line) => {
      line.words.sort((a, b) => a.x0 - b.x0);
      return {
        text: line.words.map((word) => word.text).join(' '),
        bbox: [line.x0 * sx, line.y0 * sy, (line.x1 - line.x0) * sx, (line.y1 - line.y0) * sy],
        confidence: line.words.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / Math.max(1, line.words.length) / 100,
        words: line.words.map((word) => ({
          text: word.text,
          bbox: [word.x0 * sx, word.y0 * sy, (word.x1 - word.x0) * sx, (word.y1 - word.y0) * sy],
          confidence: Number.isFinite(word.confidence) ? word.confidence / 100 : null,
        })),
        ocr: true,
      };
    });
  }

  /* ===== Workstream 0 §0.3 — reconciliation / completeness pass =====
   * Deterministic self-check of an analysis against the documents' own
   * evidence: board headers declare way counts ("18 WAY TP&N" ⇒ 18), pages
   * that look like schedules must yield rows, and every shortfall is
   * surfaced — never silently accepted. */
  const WAY_HEADER_PATTERNS = [
    /\b(\d{1,3})\s*[- ]?WAYS?\b/i,                                  // "18 WAY TP&N", "12-way"
    /\bWAYS?\s*[:=]\s*(\d{1,3})\b/i,                                // "Ways: 12"
    /\bN(?:o|umber)\.?\s*of\s*ways?\s*(?:\((?:SP|TP)\))?\s*[:=]?\s*(\d{1,3})/i,
  ];

  function expectedWaysFromText(text) {
    const source = String(text || '');
    const split = source.match(/\b(\d{1,3})\s*[- ]?Ways?\s+Power\s*\+\s*(\d{1,3})\s*[- ]?Ways?\s+Lighting\b/i);
    if (split) {
      const ways = Number(split[1]) + Number(split[2]);
      if (ways >= 2 && ways <= 200) return { ways, evidence: split[0].trim(), split: true };
    }
    const compactSplit = source.match(/\bWAYS?\s*(?:[-:=]|TOTAL\s*[:=])?\s*(\d{1,3})\s*\+\s*(\d{1,3})\b/i);
    if (compactSplit) {
      const ways = Number(compactSplit[1]) + Number(compactSplit[2]);
      if (ways >= 2 && ways <= 200) return { ways, evidence: compactSplit[0].trim(), split: true };
    }
    for (const pattern of WAY_HEADER_PATTERNS) {
      const match = source.match(pattern);
      if (match) {
        const ways = Number(match[1]);
        if (ways >= 2 && ways <= 200) return { ways, evidence: match[0].trim() };
      }
    }
    return null;
  }

  function isSchematicTopologyEvidence(row) {
    return Boolean(row) && (row.kind === 'schematic' || String(row.sourceRole || '').startsWith('schematic_'));
  }

  function isTakeoffEvidenceRow(row) {
    return Boolean(row) && !isSchematicTopologyEvidence(row)
      && ['schedule', 'ai', 'manual', 'mention'].includes(row.kind);
  }

  function applyBoardScope(boards, rows) {
    const scopedBoards = {};
    const rowList = (rows || []).map((row) => ({ ...row }));
    for (const [norm, sourceBoard] of Object.entries(boards || {})) {
      const board = { ...sourceBoard };
      const boardRows = rowList.filter((row) => row.boardNorm === norm && row.status !== 'rejected' && !row.incomer);
      const fuseOutgoings = boardRows.filter((row) => row.device === 'Fuse'
        || /\bBS\s*88\b|\bFUSE(?:\s+SWITCH)?\b/i.test([row.protectionStandard, row.srcText, row.desc].filter(Boolean).join(' ')))
        .reduce((sum, row) => sum + Math.max(1, Number(row.qty) || 1), 0);
      const reference = `${norm} ${board.orig || ''}`.replace(/[\s._/\\-]+/g, '').toUpperCase();
      const reasons = [];
      if (board.takeoffEligible === false && !board.scheduleEvidence && !board.manual) reasons.push('SCHEMATIC_ONLY');
      if (reference.includes('MSDB')) reasons.push('MSDB_ASSEMBLY');
      if (fuseOutgoings >= 4) reasons.push('FOUR_OR_MORE_FUSE_OUTGOINGS');
      board.inScope = reasons.length === 0;
      board.outOfScope = reasons.length > 0;
      board.outOfScopeReasons = reasons;
      board.fuseOutgoingCount = fuseOutgoings;
      scopedBoards[norm] = board;
    }
    for (const row of rowList) {
      const board = scopedBoards[row.boardNorm];
      if (!board?.outOfScope) continue;
      row.outOfScope = true;
      row.exclusionReasons = [...board.outOfScopeReasons];
    }
    return { boards: scopedBoards, rows: rowList };
  }

  function cleanHeaderValue(value) {
    return String(value || '')
      .split(/\s*[|;]\s*/)[0]
      .split(/\s+\b(?:LOCATION|PURPOSE|SIZE|SERVING|SERVED\s+BY|FED\s+FROM|SUPPLIED\s+FROM|WAYS?|INCOMER|MAIN\s+SWITCH|FAULT|METERING|MODEL|VOLTAGE|SUPPLY\s+CABLE|SUPPLY\s+CPD|INTERNAL\s+ISOLATOR)\b\s*[:=]/i)[0]
      .replace(/^[\s:=\-]+|[\s,]+$/g, '')
      .trim()
      .slice(0, 240);
  }

  function extractBoardHeader(lines) {
    const sourceLines = (lines || []).map((line) => String(line?.text ?? line ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const header = {};
    const evidence = {};
    const set = (field, value, line) => {
      if (value === undefined || value === null || value === '') return;
      header[field] = value;
      evidence[field] = line;
    };
    const labelled = (field, pattern) => {
      for (const line of sourceLines) {
        const match = line.match(pattern);
        if (!match) continue;
        const value = cleanHeaderValue(match[1]);
        if (value) { set(field, value, line); return; }
      }
    };

    const combined = sourceLines.join('\n');
    const ways = expectedWaysFromText(combined);
    if (ways) set('ways_total', ways.ways, ways.evidence);
    labelled('board_ref', /\b(?:DIST\s*\/\s*BD|DISTRIBUTION\s+BOARD|DB|BOARD)\s*(?:REF(?:ERENCE)?|IDENTITY)\b\s*[:=\-]?\s*(.+)$/i);
    labelled('description', /\bBOARD\s+DESCRIPTION\b\s*[:=\-]?\s*(.+)$/i);
    labelled('description', /^DESCRIPTION\s*[:=\-]\s*(.+)$/i);
    labelled('location', /\bLOCATION\b\s*[:=\-]?\s*(.+)$/i);
    labelled('purpose', /\bPURPOSE\b\s*[:=\-]?\s*(.+)$/i);
    labelled('size_text', /\bSIZE\b\s*[:=\-]?\s*(.+)$/i);
    labelled('board_type_text', /\bSIZE\b\s*[:=\-]?\s*(.+)$/i);
    labelled('fed_from_ref', /\b(?:DB\s+FED\s+FROM|FED\s+FROM|SERVED\s+BY|SUPPLIED\s+FROM)\b\s*[:=\-]?\s*(.+)$/i);
    labelled('supplied_from_text', /\bSUPPLIED\s+FROM\b\s*[:=\-]?\s*(.+)$/i);
    labelled('serving', /\bSERVING\b\s*[:=\-]?\s*(.+)$/i);
    labelled('board_model', /\b(?:BOARD\s+MODEL|MODEL|CAT(?:ALOGUE)?\.?\s*(?:NO|NUMBER)?)\b\s*[:=\-]?\s*(.+)$/i);
    labelled('metering', /\bMETERING\b\s*[:=\-]?\s*(.+)$/i);
    labelled('supply_cable_details', /\bSUPPLY\s+CABLE\s+DETAILS?\b\s*[:=\-]?\s*(.+)$/i);
    labelled('supply_cpd_details', /\bSUPPLY\s+CPD\s+DETAILS?\b\s*[:=\-]?\s*(.+)$/i);
    labelled('internal_isolator_details', /\bINTERNAL\s+ISOLATOR\s+DETAILS?\b\s*[:=\-]?\s*(.+)$/i);

    const phaseConfig = combined.match(/\b(TP\s*&?\s*N|TPN|SP\s*&?\s*N|SPN|3\s*PHASE|THREE\s+PHASE|1\s*PHASE|SINGLE\s+PHASE)\b/i);
    if (phaseConfig) {
      const token = phaseConfig[1].replace(/\s+/g, '').toUpperCase();
      set('phase_config', /^(?:TP&?N|TPN|3PHASE|THREEPHASE)$/.test(token) ? 'TPN' : 'SPN', phaseConfig[0]);
      set('phase_count', /^(?:TP&?N|TPN|3PHASE|THREEPHASE)$/.test(token) ? 3 : 1, phaseConfig[0]);
    }
    const voltage = combined.match(/\bVOLTAGE\b\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*V?\b/i);
    if (voltage) set('voltage_v', Number(voltage[1]), voltage[0]);

    for (const line of sourceLines) {
      const spareCapacity = line.match(/\bSPARE\s+CAPACITY\b\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*%/i);
      if (spareCapacity) set('spare_capacity_pct', Number(spareCapacity[1]), line);
      if (/\b(?:INCOMER|INCOMING\s+(?:DEVICE|SUPPLY)|MAIN\s+SWITCH)\b/i.test(line)) {
        const device = explicitProtectionDevice(line)
          || line.match(/\b(?:SWITCH\s+DISCONNECTOR|ISOLATOR|CIRCUIT\s+BREAKER)\b/i)?.[0];
        const rating = line.match(/\b(\d+(?:\.\d+)?)\s*A(?:MPS?)?\b/i);
        const poles = line.match(/\b([1-4])\s*P(?:OLE)?\b/i)
          || line.match(/\b(SPN|DPN|TPN|TP&N)\b/i);
        if (device) set('incomer_class', device, line);
        if (rating) set('incomer_rating_a', Number(rating[1]), line);
        if (poles) {
          const poleValue = /^\d/.test(poles[1]) ? Number(poles[1]) : ({ SPN: 1, DPN: 2, TPN: 4, 'TP&N': 4 }[poles[1].toUpperCase()] || null);
          set('incomer_poles', poleValue, line);
        }
      }
      if (/\b(?:FAULT|BREAKING|SHORT\s+CIRCUIT)\b/i.test(line)) {
        const breaking = extractBreakingCapacity(line);
        if (breaking) set('fault_ka', breaking.value, line);
      }
      if (/\bINTERNAL\s+ISOLATOR\s+DETAILS?\b/i.test(line)) {
        const rating = line.match(/\b(\d+(?:\.\d+)?)\s*A(?:MPS?)?\b/i);
        set('internal_isolator_class', 'Isolator', line);
        if (rating) {
          set('internal_isolator_rating_a', Number(rating[1]), line);
          set('board_rating_a', Number(rating[1]), line);
          if (header.incomer_rating_a === undefined) set('incomer_rating_a', Number(rating[1]), line);
          if (header.incomer_class === undefined) set('incomer_class', 'Isolator', line);
        }
      }
    }
    const completenessFields = ['board_ref', 'ways_total', 'description', 'location', 'purpose', 'fed_from_ref', 'serving',
      'supply_cable_details', 'supply_cpd_details', 'internal_isolator_details', 'incomer_class', 'incomer_rating_a',
      'incomer_poles', 'fault_ka', 'board_model', 'metering'];
    return { header, evidence, completeness: completenessFields.filter((field) => header[field] !== undefined).length };
  }

  function pageLooksTabular(text) {
    const lines = String(text || '').split(/\r?\n/);
    let hits = 0;
    for (const line of lines) {
      if (/^\s*\d{1,3}\s*[\/ ]\s*L[123]\b/i.test(line)) hits += 1;                 // "4/L1 …"
      else if (/^\s*(?:way|cct|ckt|circuit)\s*\d{1,3}\b/i.test(line)) hits += 1;   // "CCT 4 …"
      else if (/^\s*(?:\d{1,3}\s+)?L[123]\b/i.test(line)) hits += 1;              // TBA phase slots
    }
    return hits >= 4;
  }

  const COVERAGE_SCHEDULE_TYPES = new Set(['db-schedule', 'main-schedule', 'equipment-schedule']);

  /**
   * @param boards map norm → {norm, orig, pages:[{fileId,page}] }
   * @param rows   extracted rows (schedule kind) with boardNorm/way/page/fileId
   * @param pages  [{fileId, page, text, type}] — one entry per analysed page
   */
  function buildCoverage({ boards, rows, pages }) {
    const pageMap = new Map();
    for (const pg of pages || []) pageMap.set(`${pg.fileId}#${pg.page}`, pg);
    const scheduleRows = (rows || []).filter((r) => r && r.kind === 'schedule');
    const boardValues = Object.values(boards || {});
    const hasPrimaryMetadata = boardValues.some((board) =>
      (board.pages || []).some((ref) => ref && ref.primary));
    const primaryBoardsByPage = new Map();
    if (hasPrimaryMetadata) {
      for (const board of boardValues) {
        for (const ref of board.pages || []) {
          if (!ref || !ref.primary) continue;
          const key = `${ref.fileId}#${ref.page}`;
          if (!primaryBoardsByPage.has(key)) primaryBoardsByPage.set(key, new Set());
          primaryBoardsByPage.get(key).add(board.norm);
        }
      }
    }

    const perBoard = [];
    for (const board of boardValues) {
      let expected = null;
      let evidence = null;
      const boardPages = (hasPrimaryMetadata
        ? (board.pages || []).filter((ref) => ref && ref.primary)
        : (board.pages || [])).filter((ref) => {
        const type = String(pageMap.get(`${ref.fileId}#${ref.page}`)?.type || '').toLowerCase();
        return type !== 'sld' && type !== 'schematic';
      });
      const extractedWayCount = Number(board.header?.ways_total);
      const headerWaySource = board.headerEvidence?.ways_total || null;
      const validExtractedWayCount = Number.isInteger(extractedWayCount) && extractedWayCount > 0 && extractedWayCount <= 200;
      const trustedHeaderWayCount = validExtractedWayCount && Boolean(headerWaySource)
        && (Number(headerWaySource?.confidence) >= 0.8
          || /(?:SPATIAL|USER|MANUAL|CALIBRAT)/i.test(String(headerWaySource?.extractionMethod || '')));
      if (!trustedHeaderWayCount) {
        for (const ref of boardPages) {
          const pg = pageMap.get(`${ref.fileId}#${ref.page}`);
          const found = pg && expectedWaysFromText(pg.text);
          if (found && (!expected || found.ways > expected)) {
            expected = found.ways;
            evidence = { fileId: ref.fileId, page: ref.page, text: found.evidence };
          }
        }
      }
      if (trustedHeaderWayCount || (expected == null && validExtractedWayCount)) {
        expected = extractedWayCount;
        const source = headerWaySource;
        evidence = {
          fileId: boardPages[0]?.fileId || null,
          page: boardPages[0]?.page || null,
          text: String(source?.text || source || `${extractedWayCount} distinct schedule ways`),
          method: source?.extractionMethod || 'Board header extraction',
        };
      }
      const boardRows = scheduleRows.filter((r) => r.boardNorm === board.norm);
      const observedRows = boardRows.filter((row) => !row.inferredWay || row.status === 'confirmed');
      const ways = new Set(observedRows.filter((r) => r.way != null).map((r) => `${r.boardSection || ''}:${r.way}`));
      const inferredWays = new Set(boardRows.filter((row) => row.inferredWay && row.status !== 'confirmed' && row.way != null)
        .map((row) => `${row.boardSection || ''}:${row.way}`));
      const protectionRows = boardRows.filter((r) => isPopulatedProtectionRow(r) && r.status !== 'rejected');
      const incompleteProtectionRows = protectionRows.filter((r) => r.status !== 'confirmed' && (!r.device || r.rating == null)).length;
      const unaccounted = expected != null ? Math.max(0, expected - ways.size) : null;
      const upstreamType = /^(?:MAIN|MDB|SMDB|MCC|SB|PB)$/.test(String(board.type || '').toUpperCase());
      const upstreamReference = /^(?:MAIN|MSB|SWB|SMDB|MDB|PB|MCC|MCP|GENERATOR)/i.test(String(board.orig || '').replace(/[\s._/\\-]+/g, ''));
      const inScope = board.inScope !== false && boardPages.length > 0 && !upstreamType && !upstreamReference;
      perBoard.push({
        norm: board.norm, orig: board.orig,
        expectedWays: expected, evidence,
        capturedWays: ways.size, inferredWays: inferredWays.size, rowsCaptured: boardRows.length,
        protectionRows: protectionRows.length,
        incompleteProtectionRows,
        unaccountedWays: unaccounted, inScope,
      });
    }

    const scopedBoardNorms = new Set(perBoard.filter((board) => board.inScope).map((board) => board.norm));
    const zeroRowSchedulePages = [];
    for (const pg of pages || []) {
      if (!String(pg.text || '').trim()) continue;
      if (String(pg.type || '').toLowerCase() === 'sld' || String(pg.type || '').toLowerCase() === 'schematic') continue;
      const pageKey = `${pg.fileId}#${pg.page}`;
      const primaryBoards = primaryBoardsByPage.get(pageKey);
      if (hasPrimaryMetadata && (!primaryBoards || !primaryBoards.size)) continue;
      if (hasPrimaryMetadata && !Array.from(primaryBoards).some((norm) => scopedBoardNorms.has(norm))) continue;
      const hasHeader = /\bDB\s+REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)?\s*[:=\-]/i.test(pg.text);
      const scheduleish = hasPrimaryMetadata
        ? hasHeader || pageLooksTabular(pg.text) || Boolean(expectedWaysFromText(pg.text))
        : COVERAGE_SCHEDULE_TYPES.has(pg.type) || pageLooksTabular(pg.text) || Boolean(expectedWaysFromText(pg.text));
      if (!scheduleish) continue;
      const hasRows = scheduleRows.some((r) =>
        r.fileId === pg.fileId && r.page === pg.page
        && (!hasPrimaryMetadata || primaryBoards.has(r.boardNorm)));
      if (!hasRows) {
        zeroRowSchedulePages.push({
          fileId: pg.fileId,
          page: pg.page,
          type: pg.type,
          boardNorm: primaryBoards && primaryBoards.size === 1 ? Array.from(primaryBoards)[0] : null,
          boardNorms: primaryBoards ? Array.from(primaryBoards) : [],
        });
      }
    }

    const scopedBoards = perBoard.filter((board) => board.inScope);
    const expectedTotal = scopedBoards.reduce((sum, b) => sum + (b.expectedWays || 0), 0);
    const capturedTotal = scopedBoards.reduce((sum, b) => sum + (b.expectedWays != null ? Math.min(b.capturedWays, b.expectedWays) : 0), 0);
    return {
      perBoard,
      zeroRowSchedulePages,
      summary: {
        boards: scopedBoards.length,
        boardsWithRows: scopedBoards.filter((b) => b.rowsCaptured > 0).length,
        expectedWays: expectedTotal,
        capturedWays: capturedTotal,
        pctComplete: expectedTotal ? Math.round((100 * capturedTotal) / expectedTotal) : null,
        unaccountedBoards: scopedBoards.filter((b) => (b.unaccountedWays || 0) > 0).length,
        inferredWays: scopedBoards.reduce((sum, board) => sum + (board.inferredWays || 0), 0),
        incompleteProtectionRows: scopedBoards.reduce((sum, board) => sum + board.incompleteProtectionRows, 0),
        boardsWithProtectionGaps: scopedBoards.filter((board) => board.incompleteProtectionRows > 0 || board.protectionRows === 0).length,
      },
    };
  }

  /* ===== Workstream 5.1 — three-type classification ===== */
  // The product taxonomy is exactly three classes; the legacy classifier emits
  // ~16 fine-grained types. Collapse them so the UI and pipeline speak in three.
  const THREE_TYPES = { schematic: 'Schematic', db_schedule: 'Distribution Board Schedule', specification: 'Specification' };
  const LEGACY_TO_THREE = {
    // schematics
    sld: 'schematic', schematic: 'schematic',
    // distribution board schedules (incl. main/cable/equipment/CU/switchboard/mccb variants)
    'db-schedule': 'db_schedule', 'main-schedule': 'db_schedule', 'cable-schedule': 'db_schedule',
    'equipment-schedule': 'db_schedule', cu: 'db_schedule', switchboard: 'db_schedule', mccb: 'db_schedule',
    // specifications
    spec: 'specification', specification: 'specification',
  };
  // Plans/legends/registers/notes/covers/unknown have no take-off value; the
  // three-type view treats them as "other" (kept out of extraction, still shown).
  function toThreeType(legacyType) {
    if (!legacyType) return 'other';
    const key = String(legacyType).toLowerCase();
    if (THREE_TYPES[key]) return key;                 // already a 3-type value
    return LEGACY_TO_THREE[key] || 'other';
  }

  /* ===== Analysis health — honest completeness states =====
   * An analysis may only present itself as "Analysed" when these invariants
   * hold. Anything else is 'incomplete' (some evidence was not captured) or
   * 'failed' (the result is unusable), each with STABLE reason codes the UI,
   * diagnostics export, and tests all share. This exists because a real
   * project once showed "7 boards / 0 devices" as a successful analysis. */
  const HEALTH_REASONS = {
    ZERO_DEVICES_WITH_BOARDS: 'Boards were identified but no device rows were captured anywhere',
    DEVICE_COUNT_BELOW_BOARD_COUNT: 'Fewer protective devices were captured than boards',
    BOARD_ROWS_MISSING: 'Board has schedule evidence but zero captured device rows',
    WAYS_UNACCOUNTED: 'Board header promises more ways than were captured',
    WAYS_OVER_CAPACITY: 'Captured populated and spare ways exceed the stated board capacity',
    BOARD_FEED_MISSING: 'Board has no resolved feed edge and is not explicitly marked orphaned',
    PROTECTION_DETAILS_MISSING: 'Active circuit rows are missing a protective device or rating',
    SCHEDULE_PAGE_UNPARSED: 'Page looks like a schedule but produced no rows',
    SCHEDULE_DOC_NO_BOARDS: 'Schedule-type pages exist but no board reference was identified',
    UNASSIGNED_SCHEDULE_ROWS: 'Active schedule rows were captured without a resolved board identity',
    SCHEDULE_GRID_UNPROVEN: 'A schedule page contains rows but its table geometry was not proven',
    PROTECTION_CLASS_CONFLICT: 'Explicit device wording conflicts with the governing protection standard',
    PHASE_POLE_CONFLICT: 'Printed phase evidence conflicts with the device pole descriptor',
    INVALID_PROTECTION_DOMAIN: 'A protection value falls outside the supported electrical unit domain',
    SCHEMATIC_FEEDS_MISSING: 'Schematic boards were identified but no feeder relationships were captured',
    SCHEMATIC_VECTOR_GEOMETRY_MISSING: 'A schematic page has no validated vector conductor geometry',
    SCHEMATIC_TOPOLOGY_UNRESOLVED: 'One or more schematic board endpoints could not be traced to a source',
    SCHEMATIC_TOPOLOGY_AMBIGUOUS: 'One or more schematic board endpoints have multiple plausible conductor anchors',
    SCHEMATIC_TOPOLOGY_INFERRED_GAP: 'A small conductor gap was bridged and requires review',
    SCHEMATIC_SCHEDULE_FEED_MISMATCH: 'Schematic and schedule supply relationships do not agree',
    SCHEMATIC_SCHEDULE_DEVICE_MISMATCH: 'Schematic and schedule incoming device details do not agree',
    SCHEMATIC_SCHEDULE_CABLE_MISMATCH: 'Schematic and schedule incoming cable details do not agree',
    SCHEMATIC_ORPHAN_BOARD: 'A schematic board has no exact board-schedule counterpart',
    SCHEDULE_ORPHAN_BOARD: 'A board schedule has no exact schematic counterpart',
    DOCUMENT_REVISION_CONFLICT: 'Cross-referenced documents have conflicting revision evidence',
    PAGE_TEXT_UNRELIABLE: 'Page text is unreliable and OCR has not replaced it',
    OCR_PENDING: 'Page is still waiting for OCR',
    DOCUMENT_UNREADABLE: 'Document could not be read',
    NO_CONTENT: 'No readable pages were available to analyse',
  };

  /* Multi-signal schedule-candidate score. A page is a candidate because of
   * what is ON it, never because a single classifier label said so. Returns
   * {score 0..1, signals[]} — callers treat score ≥ 0.45 with ≥ 2 signal
   * families as a candidate. */
  function scoreScheduleCandidate(lines) {
    const texts = (lines || []).map((l) => (typeof l === 'string' ? l : (l && l.text) || ''));
    const all = texts.join('\n');
    const signals = [];
    let wayLines = 0;
    for (const t of texts) {
      if (/^\s*\d{1,3}\s*[\/ ]\s*L[123]\b/i.test(t) || /^\s*(?:way|cct|ckt|circuit)\s*\d{1,3}\b/i.test(t)
        || /^\s*\d{1,3}\s{2,}\S/.test(t)) wayLines += 1;
    }
    if (wayLines >= 4) signals.push('way-sequence');
    const deviceHits = (all.match(/\b(?:MCB|MCCB|RCBO|RCC?B|ACB|SPD|AFDD|RCD|isolator|contactor|switch\s*fuse|fuse\s*switch|time\s*clock|photocell|relay|meter)\b/gi) || []).length;
    if (deviceHits >= 3) signals.push('device-tokens');
    const ratingHits = (all.match(/\b\d{1,4}\s*A(?:mps?)?\b/gi) || []).length;
    if (ratingHits >= 4) signals.push('rating-tokens');
    if (/\b(?:type\s*[BCD]\b|[BCD]\d{2,3}\b)/i.test(all) && /\bL[123]\b|\bTP&?N\b|\bSP&?N\b|\b[13]PH?\b/i.test(all)) signals.push('curve-phase');
    if (texts.some((t) => (t.match(/\b(?:way|cct|circuit|description|device|rating|poles?|curve|phase|protective|breaking)\b/gi) || []).length >= 3)) {
      signals.push('column-header');
    }
    if (/\bDB\s*REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)\b/i.test(all)) signals.push('board-header');
    if (/\bBOARD\s+DATA\b/i.test(all) && /\bID\s*(?:NO|NUMBER)\b/i.test(all)) signals.push('board-data-identity');
    if (/\bOVER\s*CURRENT\s+PROTECTIVE\s+DEVICE\b/i.test(all)
      && /\bEARTH\s+FAULT\s+PROTECTIVE\s+DEVICE\b/i.test(all)) signals.push('stacked-protection');
    if (expectedWaysFromText(all)) signals.push('way-count-header');
    const score = Math.min(1, signals.length * 0.2 + (wayLines >= 8 ? 0.15 : 0) + (deviceHits >= 8 ? 0.1 : 0));
    return { score: Number(score.toFixed(2)), signals };
  }

  function selectAiRecoveryReason(input = {}) {
    const pageType = String(input.pageType || 'unknown').toLowerCase();
    const scheduleRows = Array.isArray(input.scheduleRows) ? input.scheduleRows : [];
    const schematic = pageType === 'sld' || pageType === 'schematic';
    if (schematic) {
      return Number(input.schematicFeedCount || 0) === 0 ? 'schematic-topology-missing' : null;
    }
    const scheduleTypes = new Set(['db-schedule', 'main-schedule', 'equipment-schedule']);
    if (!scheduleTypes.has(pageType) && pageType !== 'unknown') return null;
    const candidate = input.scheduleCandidate || { score: 0, signals: [] };
    if (Number(candidate.score || 0) < 0.45 || (candidate.signals || []).length < 2) return null;
    if (!scheduleRows.length) return 'schedule-rows-missing';
    const activeRows = scheduleRows.filter(isPopulatedProtectionRow);
    const unresolved = activeRows.filter((row) => !row.device || row.rating == null);
    if (activeRows.length && unresolved.length / activeRows.length >= 0.35) return 'schedule-protection-fields-missing';
    const expectedWays = Number(input.expectedWays || 0);
    const capturedWays = new Set(scheduleRows.map((row) => row.way).filter((way) => way != null)).size;
    if (expectedWays > 0 && capturedWays < expectedWays && (expectedWays - capturedWays) / expectedWays >= 0.2) {
      return 'schedule-coverage-gap';
    }
    return null;
  }

  const AI_RECOVERY_PRIORITY = Object.freeze({
    'schedule-rows-missing': 0,
    'schedule-protection-fields-missing': 1,
    'schedule-coverage-gap': 2,
    'schematic-topology-missing': 3,
  });

  function planAiRecoveryJobs(jobs = [], options = {}) {
    const requestedLimit = Number(options.maxPages);
    const maxPages = Number.isFinite(requestedLimit)
      ? Math.max(0, Math.min(10, Math.floor(requestedLimit))) : 3;
    const seen = new Set();
    const ranked = [];
    (jobs || []).forEach((job, index) => {
      const key = `${job?.id || job?.fileId || ''}#${Number(job?.pageNo || job?.page || 0)}`;
      if (seen.has(key)) return;
      seen.add(key);
      ranked.push({
        job,
        index,
        priority: AI_RECOVERY_PRIORITY[job?.reason] ?? 9,
        unresolvedRatio: Number(job?.unresolvedRatio) || 0,
        candidateScore: Number(job?.candidateScore) || 0,
        page: Number(job?.pageNo || job?.page || 0),
      });
    });
    ranked.sort((left, right) => left.priority - right.priority
      || right.unresolvedRatio - left.unresolvedRatio
      || right.candidateScore - left.candidateScore
      || left.page - right.page
      || left.index - right.index);
    return {
      selected: ranked.slice(0, maxPages).map((entry) => entry.job),
      deferred: ranked.slice(maxPages).map((entry) => entry.job),
      eligible: ranked.length,
      maxPages,
    };
  }

  function buildDocumentExtractionScope(pages, options = {}) {
    const longDocumentThreshold = Number(options.longDocumentThreshold) || 80;
    const pageList = (pages || []).map((page, index) => {
      const text = String(page?.text ?? (page?.lines || []).map((line) => line?.text ?? line ?? '').join('\n') ?? '');
      const type = String(page?.type || 'unknown').toLowerCase();
      return {
        page: Number(page?.page) || index + 1,
        type,
        text,
        schedule: scoreScheduleCandidate(text.split(/\r?\n/)),
      };
    });
    const circuitMarkerIndex = pageList.findIndex((page) => /\bCIRCUIT\s+CHARTS?\b|\bDISTRIBUTION\s+BOARD\s+(?:SCHEDULES?|CHARTS?)\b/i.test(page.text));
    let scheduleStartIndex = -1;
    let scheduleEndIndex = -1;
    if (circuitMarkerIndex >= 0) {
      const marker = pageList[circuitMarkerIndex];
      const markerIsSchedule = COVERAGE_SCHEDULE_TYPES.has(marker.type)
        || (marker.schedule.score >= 0.45 && marker.schedule.signals.length >= 2 && /\b(?:WAY|CCT|CIRCUIT)\b/i.test(marker.text));
      scheduleStartIndex = markerIsSchedule ? circuitMarkerIndex : circuitMarkerIndex + 1;
      const cableIndex = pageList.findIndex((page, index) => index >= scheduleStartIndex
        && (page.type === 'cable-schedule' || /\bCABLE\s+SCHEDULES?\b/i.test(page.text)));
      scheduleEndIndex = (cableIndex >= 0 ? cableIndex : pageList.length) - 1;
    }

    const selected = new Set();
    if (scheduleStartIndex >= 0 && scheduleStartIndex < pageList.length && scheduleEndIndex >= scheduleStartIndex) {
      for (let index = scheduleStartIndex; index <= scheduleEndIndex; index += 1) selected.add(pageList[index].page);
    }
    for (const page of pageList) {
      const schematic = page.type === 'sld' || page.type === 'schematic'
        || /\b(?:SINGLE\s+LINE|LV\s+SCHEMATIC|DISTRIBUTION\s+SCHEMATIC)\b/i.test(page.text);
      if (schematic) selected.add(page.page);
    }

    let enforced = scheduleStartIndex >= 0;
    if (!enforced && pageList.length >= longDocumentThreshold) {
      for (const page of pageList) {
        if (COVERAGE_SCHEDULE_TYPES.has(page.type)
          || (page.schedule.score >= 0.4 && page.schedule.signals.length >= 2)) selected.add(page.page);
      }
      enforced = selected.size > 0;
    }
    if (!enforced) pageList.forEach((page) => selected.add(page.page));

    const scheduleRange = scheduleStartIndex >= 0 && scheduleEndIndex >= scheduleStartIndex
      ? { start: pageList[scheduleStartIndex].page, end: pageList[scheduleEndIndex].page }
      : null;
    return {
      enforced,
      pages: [...selected].sort((left, right) => left - right),
      scheduleRange,
      reason: scheduleRange ? 'circuit-charts-to-cable-schedules' : (enforced ? 'long-document-content-signals' : 'all-pages-short-document'),
      totalPages: pageList.length,
    };
  }

  /**
   * Compute the honest health of one analysis run.
   * @param coverage output of buildCoverage (may be null)
   * @param boards   analysis boards map
   * @param rows     analysis rows
   * @param pages    [{fileId, page, type, textLines, needsOcr, source, scheduleScore, rowsParsed}]
   * @param files    [{id, name, status}] all files that were in scope
   * @returns {state:'complete'|'incomplete'|'failed', reasons:[{code,message,count,refs}], counters}
   */
  function buildAnalysisHealth({ coverage, boards, rows, pages, files, feeders, discrepancies }) {
    const reasons = new Map();
    const addReason = (code, ref) => {
      if (!reasons.has(code)) reasons.set(code, { code, message: HEALTH_REASONS[code] || code, count: 0, refs: [] });
      const entry = reasons.get(code);
      entry.count += 1;
      if (ref && entry.refs.length < 25) entry.refs.push(ref);
    };

    const allRows = (rows || []).filter((r) => r && r.status !== 'rejected' && !r.outOfScope);
    const deviceRows = allRows.filter(isCountableProtectionDevice);
    const deviceCount = deviceRows.reduce((sum, r) => sum + protectionDeviceQuantity(r), 0);
    const inScopeBoardNorms = coverage
      ? new Set((coverage.perBoard || []).filter((board) => board.inScope).map((board) => board.norm))
      : null;
    const boardCount = inScopeBoardNorms
      ? inScopeBoardNorms.size
      : Object.values(boards || {}).filter((board) => board?.inScope !== false).length;
    const pageList = pages || [];
    const schematicPages = pageList.filter((pg) => pg.type === 'sld' || pg.type === 'schematic');
    const schedulePages = pageList.filter((pg) => pg.type !== 'sld' && pg.type !== 'schematic'
      && ((pg.scheduleScore || 0) >= 0.45 || COVERAGE_SCHEDULE_TYPES.has(pg.type)));
    const pageTypeByKey = new Map(pageList.map((pg) => [`${pg.fileId}#${pg.page}`, pg.type]));
    const schematicBoardNorms = Object.entries(boards || {}).filter(([, board]) => (board?.pages || []).some((ref) => {
      const type = pageTypeByKey.get(`${ref.fileId}#${ref.page}`);
      return type === 'sld' || type === 'schematic';
    })).map(([norm]) => norm);

    for (const file of files || []) {
      if (file.status === 'error') addReason('DOCUMENT_UNREADABLE', { fileId: file.id });
    }
    for (const pg of pageList) {
      if (pg.source === 'ocr_pending' || (pg.needsOcr && pg.source !== 'ocr')) {
        addReason('OCR_PENDING', { fileId: pg.fileId, page: pg.page });
      } else if (pg.textQualityUnreliable) {
        addReason('PAGE_TEXT_UNRELIABLE', { fileId: pg.fileId, page: pg.page });
      }
    }
    for (const pg of schedulePages) {
      if ((pg.rowsParsed || 0) === 0 && (pg.textLines || 0) > 0) {
        addReason('SCHEDULE_PAGE_UNPARSED', { fileId: pg.fileId, page: pg.page, score: pg.scheduleScore || null });
      }
      if ((pg.spatialBlockingReasons || []).length > 0) {
        addReason('SCHEDULE_GRID_UNPROVEN', { fileId: pg.fileId, page: pg.page });
      }
    }
    for (const pg of schematicPages) {
      const ref = { fileId: pg.fileId, page: pg.page };
      if (!pg.schematicVectorStats?.segments && pg.schematicTopologyMethod !== 'ai_visual_trace') {
        addReason('SCHEMATIC_VECTOR_GEOMETRY_MISSING', ref);
      }
      if ((pg.schematicUnresolvedBoards || []).length) {
        addReason('SCHEMATIC_TOPOLOGY_UNRESOLVED', { ...ref, count: pg.schematicUnresolvedBoards.length });
      }
      if ((pg.schematicAmbiguousBoards || []).length) {
        addReason('SCHEMATIC_TOPOLOGY_AMBIGUOUS', { ...ref, count: pg.schematicAmbiguousBoards.length });
      }
      if ((pg.schematicGraphStats?.usedInferredBridges || 0) > 0) {
        addReason('SCHEMATIC_TOPOLOGY_INFERRED_GAP', { ...ref, count: pg.schematicGraphStats.usedInferredBridges });
      }
    }
    for (const row of allRows) {
      if (row.kind !== 'schedule' || !isPopulatedProtectionRow(row)) continue;
      const ref = { fileId: row.fileId, page: row.page };
      if (!row.boardNorm) addReason('UNASSIGNED_SCHEDULE_ROWS', ref);
      if (row.classConflict && !row.edited) addReason('PROTECTION_CLASS_CONFLICT', ref);
      if (row.poleConflict && !row.edited) addReason('PHASE_POLE_CONFLICT', ref);
      if (!row.edited && (row.validation?.invalidSensitivity || row.validation?.invalidBreakingCapacity)) {
        addReason('INVALID_PROTECTION_DOMAIN', ref);
      }
    }
    if (coverage) {
      for (const board of coverage.perBoard || []) {
        if (!board.inScope) continue;
        if (board.rowsCaptured === 0) addReason('BOARD_ROWS_MISSING', { board: board.norm });
        else if ((board.unaccountedWays || 0) > 0) {
          addReason('WAYS_UNACCOUNTED', { board: board.norm, expected: board.expectedWays, captured: board.capturedWays });
        }
        if (board.expectedWays != null && Number(board.capturedWays || 0) > Number(board.expectedWays)) {
          addReason('WAYS_OVER_CAPACITY', { board: board.norm, expected: board.expectedWays, captured: board.capturedWays });
        }
        if ((board.incompleteProtectionRows || 0) > 0) {
          addReason('PROTECTION_DETAILS_MISSING', { board: board.norm, count: board.incompleteProtectionRows });
        }
      }
    }
    for (const [norm, board] of Object.entries(boards || {})) {
      if (inScopeBoardNorms && !inScopeBoardNorms.has(norm)) continue;
      const hasFeed = Boolean(board && board.parent);
      if (!hasFeed && !(board && board.orphaned === true)) addReason('BOARD_FEED_MISSING', { board: norm });
    }
    if (boardCount === 0 && schedulePages.length > 0) addReason('SCHEDULE_DOC_NO_BOARDS', null);
    if (schematicPages.length > 0 && schematicBoardNorms.length > 1 && !(feeders || []).some((feeder) => feeder?.to)) {
      addReason('SCHEMATIC_FEEDS_MISSING', { boards: schematicBoardNorms.length });
    }
    for (const discrepancy of discrepancies || []) {
      if (discrepancy.status === 'resolved' || discrepancy.severity === 'info') continue;
      const ref = { board: discrepancy.scheduleNorm || discrepancy.schematicNorm || null };
      if (discrepancy.kind === 'missing_schedule') addReason('SCHEMATIC_ORPHAN_BOARD', ref);
      else if (discrepancy.kind === 'schedule_orphan_board') addReason('SCHEDULE_ORPHAN_BOARD', ref);
      else if (discrepancy.kind === 'supply_from_mismatch' || discrepancy.kind === 'schematic_feed_missing') addReason('SCHEMATIC_SCHEDULE_FEED_MISMATCH', ref);
      else if (discrepancy.kind === 'rating_mismatch' || discrepancy.kind === 'device_mismatch' || discrepancy.kind === 'poles_mismatch') addReason('SCHEMATIC_SCHEDULE_DEVICE_MISMATCH', ref);
      else if (discrepancy.kind === 'cable_mismatch') addReason('SCHEMATIC_SCHEDULE_CABLE_MISMATCH', ref);
      else if (discrepancy.kind === 'revision_conflict') addReason('DOCUMENT_REVISION_CONFLICT', ref);
    }
    if (pageList.length === 0) addReason('NO_CONTENT', null);
    if (boardCount > 0 && deviceCount === 0) addReason('ZERO_DEVICES_WITH_BOARDS', null);
    if (boardCount > 0 && deviceCount < boardCount) {
      addReason('DEVICE_COUNT_BELOW_BOARD_COUNT', { boards: boardCount, devices: deviceCount });
    }

    let state = 'complete';
    if (reasons.size > 0) state = 'incomplete';
    if (reasons.has('ZERO_DEVICES_WITH_BOARDS') || reasons.has('NO_CONTENT')
      || reasons.has('DEVICE_COUNT_BELOW_BOARD_COUNT') || reasons.has('WAYS_OVER_CAPACITY')
      || reasons.has('BOARD_FEED_MISSING') || reasons.has('SCHEMATIC_FEEDS_MISSING')
      || reasons.has('SCHEMATIC_VECTOR_GEOMETRY_MISSING') || reasons.has('SCHEMATIC_TOPOLOGY_UNRESOLVED')
      || reasons.has('SCHEMATIC_TOPOLOGY_AMBIGUOUS') || reasons.has('SCHEMATIC_SCHEDULE_FEED_MISMATCH')
      || reasons.has('SCHEMATIC_SCHEDULE_DEVICE_MISMATCH') || reasons.has('SCHEMATIC_SCHEDULE_CABLE_MISMATCH')
      || reasons.has('DOCUMENT_REVISION_CONFLICT')
      || reasons.has('UNASSIGNED_SCHEDULE_ROWS') || reasons.has('SCHEDULE_GRID_UNPROVEN')
      || reasons.has('PROTECTION_CLASS_CONFLICT') || reasons.has('PHASE_POLE_CONFLICT')
      || reasons.has('INVALID_PROTECTION_DOMAIN')
      || (deviceCount === 0 && schedulePages.length > 0)) state = 'failed';

    return {
      state,
      reasons: Array.from(reasons.values()),
      counters: {
        pagesAnalysed: pageList.length,
        schedulePages: schedulePages.length,
        schedulePagesParsed: schedulePages.filter((pg) => (pg.rowsParsed || 0) > 0).length,
        boards: boardCount,
        boardsWithRows: coverage ? (coverage.perBoard || []).filter((b) => b.rowsCaptured > 0).length : null,
        deviceCount,
        expectedWays: coverage ? coverage.summary.expectedWays : null,
        capturedWays: coverage ? coverage.summary.capturedWays : null,
      },
    };
  }

  const DIAGNOSTIC_SCHEDULE_ROLES = Object.freeze(['way', 'rating', 'circuit_reference_or_description']);

  const DIAGNOSTIC_GUIDANCE = Object.freeze({
    NO_READABLE_PAGE_INPUT: 'The page supplied no text, positioned words, table cells, or vector geometry; re-acquire it with raster OCR.',
    POSITIONAL_TEXT_MISSING: 'Text was present but had no usable word positions; run raster OCR to rebuild table geometry.',
    OCR_REQUIRED: 'Run OCR for this page, then re-run extraction.',
    TEXT_UNRELIABLE: 'Inspect OCR quality and retry with raster OCR before trusting the page.',
    SPATIAL_WORDS_INSUFFICIENT: 'The parser did not receive enough positioned words; inspect text/OCR acquisition.',
    SCHEDULE_ROWS_ZERO: 'Calibrate the outgoing-circuit table or its way column, then re-run extraction.',
    WAY_ROLE_MISSING: 'Calibrate the way or circuit-number column.',
    RATING_ROLE_MISSING: 'Calibrate the outgoing protective-device rating column.',
    CIRCUIT_ROLE_MISSING: 'Calibrate the circuit reference or load-description column.',
    BOARD_REFERENCE_UNRESOLVED: 'Calibrate the board-reference header field.',
    GRID_REJECTED: 'Review the rejected grid reasons and calibrate the affected table roles.',
    OUTPUT_ROWS_UNASSIGNED: 'Resolve or calibrate the board reference so extracted rows can be assigned.',
    OUTPUT_ROWS_REQUIRE_REVIEW: 'Review incomplete or conflicting row fields before approval.',
    SCHEMATIC_TOPOLOGY_UNRESOLVED: 'Review unresolved schematic nodes and feeder paths.',
    PAGE_OK: 'No page-level extraction blocker was detected.',
  });

  function diagnosticCode(value) {
    const code = String(value || '').trim();
    return /^[A-Za-z0-9_.:+-]{1,96}$/.test(code) ? code : null;
  }

  function diagnosticCodes(values) {
    return [...new Set((values || []).map(diagnosticCode).filter(Boolean))];
  }

  function diagnosticNumber(value, digits = 4) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
  }

  function diagnosticCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  }

  function diagnosticAttempt(attempt = {}) {
    const output = {
      strategy: diagnosticCode(attempt.strategy) || 'unknown',
      matched: Boolean(attempt.matched),
      rows: diagnosticCount(attempt.rows),
    };
    const numberFields = ['sourcePage', 'confidence', 'completeness', 'spatialWords', 'wayAnchors',
      'distinctWays', 'populatedRows', 'elapsedMs'];
    numberFields.forEach((field) => {
      const value = diagnosticNumber(attempt[field]);
      if (value != null) output[field] = value;
    });
    const codeFields = ['outcome', 'reason', 'schemaSource', 'provider', 'modelClass'];
    codeFields.forEach((field) => {
      const value = diagnosticCode(attempt[field]);
      if (value) output[field] = value;
    });
    if (attempt.selected != null) output.selected = Boolean(attempt.selected);
    if (attempt.deferred != null) output.deferred = Boolean(attempt.deferred);
    if (attempt.timedOut != null) output.timedOut = Boolean(attempt.timedOut);
    return output;
  }

  function scheduleDiagnosticPage(pg = {}) {
    const type = String(pg.type || '').toLowerCase();
    return type !== 'sld' && type !== 'schematic' && (
      type.includes('schedule') || type === 'circuit-chart' || type === 'db'
      || Number(pg.scheduleScore || 0) >= 0.45 || Boolean(pg.calibrationForcedSchedule)
    );
  }

  function buildPageDiagnosticVerdict(pg = {}) {
    const schedule = scheduleDiagnosticPage(pg);
    const roles = new Set(diagnosticCodes(pg.spatialColumns));
    const reasons = [];
    const add = (code) => { if (!reasons.includes(code)) reasons.push(code); };
    const spatialWords = diagnosticCount(pg.inputStats?.spatialWords ?? pg.spatialWords);
    const hasInputEvidence = diagnosticCount(pg.textLines) > 0 || spatialWords > 0
      || diagnosticCount(pg.inputStats?.tableRows) > 0 || diagnosticCount(pg.inputStats?.vectorSegments) > 0;
    if (schedule && !hasInputEvidence) add('NO_READABLE_PAGE_INPUT');
    if (schedule && diagnosticCount(pg.textLines) > 0 && spatialWords === 0) add('POSITIONAL_TEXT_MISSING');
    if (pg.needsOcr && pg.source !== 'ocr') add('OCR_REQUIRED');
    if (pg.textQualityUnreliable) add('TEXT_UNRELIABLE');
    if (schedule && spatialWords > 0 && spatialWords < 8) add('SPATIAL_WORDS_INSUFFICIENT');
    if (schedule && diagnosticCount(pg.rowsParsed) === 0 && hasInputEvidence) add('SCHEDULE_ROWS_ZERO');
    if (schedule && !roles.has('way')) add('WAY_ROLE_MISSING');
    if (schedule && !roles.has('rating')) add('RATING_ROLE_MISSING');
    if (schedule && !roles.has('circuit_reference') && !roles.has('description')) add('CIRCUIT_ROLE_MISSING');
    if (schedule && pg.boardResolved === false) add('BOARD_REFERENCE_UNRESOLVED');
    if (schedule && (pg.spatialGridAccepted === false || (pg.spatialBlockingReasons || []).length)) add('GRID_REJECTED');
    if (diagnosticCount(pg.rowOutcome?.unassignedRows) > 0) add('OUTPUT_ROWS_UNASSIGNED');
    if (diagnosticCount(pg.rowOutcome?.reviewRows) > 0 || diagnosticCount(pg.rowOutcome?.invalidRows) > 0
      || diagnosticCount(pg.rowOutcome?.classConflictRows) > 0 || diagnosticCount(pg.rowOutcome?.phaseConflictRows) > 0) {
      add('OUTPUT_ROWS_REQUIRE_REVIEW');
    }
    if ((pg.schematicUnresolvedBoards || []).length || (pg.schematicAmbiguousBoards || []).length) {
      add('SCHEMATIC_TOPOLOGY_UNRESOLVED');
    }
    if (!reasons.length) add('PAGE_OK');
    const blocking = reasons.filter((code) => !['PAGE_OK', 'OUTPUT_ROWS_REQUIRE_REVIEW'].includes(code));
    const status = blocking.length ? 'blocked' : (reasons.includes('OUTPUT_ROWS_REQUIRE_REVIEW') ? 'review' : 'ok');
    return {
      status,
      scheduleCandidate: schedule,
      reasonCodes: reasons,
      recommendedActions: reasons.map((code) => DIAGNOSTIC_GUIDANCE[code]).filter(Boolean),
    };
  }

  function diagnosticPage(pg, fileTag) {
    const roles = diagnosticCodes(pg.spatialColumns);
    const requiredRoles = scheduleDiagnosticPage(pg) ? DIAGNOSTIC_SCHEDULE_ROLES.slice() : [];
    const missingRoles = [];
    if (requiredRoles.includes('way') && !roles.includes('way')) missingRoles.push('way');
    if (requiredRoles.includes('rating') && !roles.includes('rating')) missingRoles.push('rating');
    if (requiredRoles.includes('circuit_reference_or_description')
      && !roles.includes('circuit_reference') && !roles.includes('description')) missingRoles.push('circuit_reference_or_description');
    const result = {
      file: fileTag(pg.fileId),
      page: diagnosticCount(pg.page),
      classification: {
        type: diagnosticCode(pg.type),
        scheduleScore: diagnosticNumber(pg.scheduleScore),
        scheduleSignals: diagnosticCodes(pg.scheduleSignals),
      },
      input: {
        width: diagnosticNumber(pg.pageWidth ?? pg.inputStats?.width, 2),
        height: diagnosticNumber(pg.pageHeight ?? pg.inputStats?.height, 2),
        textLines: diagnosticCount(pg.textLines),
        positionedLines: diagnosticCount(pg.inputStats?.positionedLines),
        spatialWords: diagnosticCount(pg.inputStats?.spatialWords ?? pg.spatialWords),
        tableRows: diagnosticCount(pg.inputStats?.tableRows),
        tableCells: diagnosticCount(pg.inputStats?.tableCells),
        vectorSegments: diagnosticCount(pg.inputStats?.vectorSegments),
        source: diagnosticCode(pg.source),
      },
      textAcquisition: {
        needsOcr: Boolean(pg.needsOcr),
        unreliable: Boolean(pg.textQualityUnreliable),
        qualityScore: diagnosticNumber(pg.textQualityScore),
        embeddedLineCount: diagnosticCount(pg.textQualityStats?.embeddedLines),
        ocrLineCount: diagnosticCount(pg.textQualityStats?.ocrLines),
        ocrConfidence: diagnosticNumber(pg.textQualityStats?.ocrConfidence),
        recoveryAttempted: Boolean(pg.recoveryAttempted),
        recoveryOutcome: diagnosticCode(pg.recoveryOutcome),
      },
      boardDetection: {
        referencesDetected: diagnosticCount(pg.boardDetection?.referencesDetected),
        primaryReferences: diagnosticCount(pg.boardDetection?.primaryReferences),
        indexReferences: diagnosticCount(pg.boardDetection?.indexReferences),
        circuitReferences: diagnosticCount(pg.boardDetection?.circuitReferences),
        resolved: pg.boardResolved == null ? null : Boolean(pg.boardResolved),
        headerRoles: diagnosticCodes(pg.boardHeaderRoles),
      },
      calibration: {
        applicable: diagnosticCount(pg.calibration?.applicable),
        applied: diagnosticCount(pg.calibration?.applied),
        roles: diagnosticCodes(pg.calibration?.roles),
        forcedSchedule: Boolean(pg.calibrationForcedSchedule),
      },
      extractionAttempts: (pg.extractionAttempts || []).map(diagnosticAttempt),
      spatial: {
        matched: Boolean(pg.spatialMatched),
        confidence: diagnosticNumber(pg.spatialConfidence),
        dialect: diagnosticCode(pg.spatialDialect),
        roles,
        requiredRoles,
        missingRoles,
        schemaSourcePage: diagnosticCount(pg.spatialSchemaSourcePage) || null,
        gridAccepted: pg.spatialGridAccepted == null ? null : Boolean(pg.spatialGridAccepted),
        blockingReasons: diagnosticCodes(pg.spatialBlockingReasons),
        reviewReasons: diagnosticCodes(pg.spatialReviewReasons),
        warnings: diagnosticCodes(pg.spatialWarnings),
        wayAnchors: diagnosticCount(pg.spatialGridStats?.wayAnchors),
        distinctWays: diagnosticCount(pg.spatialGridStats?.distinctWays),
        populatedRows: diagnosticCount(pg.spatialGridStats?.populatedRows),
        observedRows: diagnosticCount(pg.spatialTableStats?.observedRowCount),
        inferredRows: diagnosticCount(pg.spatialTableStats?.inferredRowCount),
      },
      output: {
        rowsParsed: diagnosticCount(pg.rowsParsed),
        countableDeviceRows: diagnosticCount(pg.rowOutcome?.countableDeviceRows),
        spareRows: diagnosticCount(pg.rowOutcome?.spareRows),
        blankRows: diagnosticCount(pg.rowOutcome?.blankRows),
        incomerRows: diagnosticCount(pg.rowOutcome?.incomerRows),
        unassignedRows: diagnosticCount(pg.rowOutcome?.unassignedRows),
        reviewRows: diagnosticCount(pg.rowOutcome?.reviewRows),
        invalidRows: diagnosticCount(pg.rowOutcome?.invalidRows),
        classConflictRows: diagnosticCount(pg.rowOutcome?.classConflictRows),
        phaseConflictRows: diagnosticCount(pg.rowOutcome?.phaseConflictRows),
        feederRelationships: diagnosticCount(pg.rowOutcome?.feeders),
      },
      schematic: {
        topologyMethod: diagnosticCode(pg.schematicTopologyMethod),
        graphStats: pg.schematicGraphStats || null,
        vectorStats: pg.schematicVectorStats || null,
        unresolvedCount: (pg.schematicUnresolvedBoards || []).length,
        ambiguousCount: (pg.schematicAmbiguousBoards || []).length,
        warnings: diagnosticCodes(pg.schematicWarnings),
      },
    };
    result.verdict = buildPageDiagnosticVerdict({ ...pg, spatialColumns: roles });
    return result;
  }

  function diagnosticFailureSummary(pages) {
    const increment = (record, key, amount = 1) => { record[key] = (record[key] || 0) + amount; };
    const summary = {
      pageStatusCounts: {}, reasonCounts: {}, missingRoleCounts: {},
      strategyCounts: {}, pagesWithTextButNoRows: 0, pagesWithNoReadableInput: 0,
    };
    pages.forEach((page) => {
      increment(summary.pageStatusCounts, page.verdict.status);
      page.verdict.reasonCodes.forEach((code) => increment(summary.reasonCounts, code));
      page.spatial.missingRoles.forEach((role) => increment(summary.missingRoleCounts, role));
      page.extractionAttempts.forEach((attempt) => {
        if (!summary.strategyCounts[attempt.strategy]) summary.strategyCounts[attempt.strategy] = { attempted: 0, matched: 0, rows: 0 };
        summary.strategyCounts[attempt.strategy].attempted += 1;
        if (attempt.matched) summary.strategyCounts[attempt.strategy].matched += 1;
        summary.strategyCounts[attempt.strategy].rows += diagnosticCount(attempt.rows);
      });
      if (page.input.textLines > 0 && page.output.rowsParsed === 0 && page.verdict.scheduleCandidate) summary.pagesWithTextButNoRows += 1;
      if (!page.input.textLines && !page.input.spatialWords && !page.input.tableRows && !page.input.vectorSegments) summary.pagesWithNoReadableInput += 1;
    });
    return summary;
  }

  /* Private-safe diagnostic export: counters, page-level acquisition facts,
   * strategy outcomes and reason codes only. NEVER include document text,
   * board names, file names, extracted values, or customer content. */
  function buildDiagnosticExport({ health, coverage, files, pages, appVersion, run }) {
    const anon = new Map();
    const boardAnon = new Map();
    const fileTag = (id) => {
      if (!anon.has(id)) anon.set(id, `doc-${anon.size + 1}`);
      return anon.get(id);
    };
    const boardTag = (id) => {
      if (!boardAnon.has(id)) boardAnon.set(id, `board-${boardAnon.size + 1}`);
      return boardAnon.get(id);
    };
    const pageDetails = (pages || []).map((pg) => diagnosticPage(pg, fileTag));
    return {
      diagnosticVersion: 2,
      appVersion: appVersion || null,
      generatedAt: new Date().toISOString(),
      privacy: {
        contentIncluded: false,
        filenamesIncluded: false,
        boardReferencesIncluded: false,
        coordinatesIncluded: false,
        shareableWithSupport: true,
      },
      run: {
        analysisVersion: diagnosticCount(run?.analysisVersion) || null,
        calibrationRevision: diagnosticCount(run?.calibrationRevision),
        onlineRecovery: {
          eligiblePages: diagnosticCount(run?.aiRecovery?.eligible),
          selectedPages: diagnosticCount(run?.aiRecovery?.selected),
          deferredPages: diagnosticCount(run?.aiRecovery?.deferred),
          completedPages: diagnosticCount(run?.aiPages),
          errorPages: diagnosticCount(run?.aiErrors),
          timedOutPages: diagnosticCount(run?.aiTimedOut),
          maxPages: diagnosticCount(run?.aiRecovery?.maxPages),
          pageTimeoutMs: diagnosticCount(run?.aiRecovery?.pageTimeoutMs),
          totalBudgetMs: diagnosticCount(run?.aiRecovery?.totalBudgetMs),
          status: diagnosticCode(run?.aiRecovery?.status),
        },
        ocrRecoveryAttempts: (run?.recoveryLog || []).map((entry) => ({
          file: fileTag(entry.fileId),
          page: diagnosticCount(entry.page),
          reasons: diagnosticCodes(entry.reasons),
          outcome: diagnosticCode(entry.outcome),
        })),
      },
      health: health ? {
        state: health.state,
        counters: health.counters,
        reasons: (health.reasons || []).map((r) => ({
          code: r.code,
          count: r.count,
          refs: (r.refs || []).map((ref) => ({
            ...(ref && ref.fileId ? { file: fileTag(ref.fileId) } : {}),
            ...(ref && ref.page ? { page: ref.page } : {}),
            ...(ref && ref.board ? { board: boardTag(ref.board) } : {}),
            ...(ref && ref.expected != null ? { expected: ref.expected, captured: ref.captured } : {}),
            ...(ref && ref.count != null ? { affected: ref.count } : {}),
          })),
        })),
      } : null,
      coverageSummary: coverage ? coverage.summary : null,
      coverageByBoard: (coverage?.perBoard || []).map((board) => ({
        board: boardTag(board.norm),
        inScope: board.inScope !== false,
        expectedWays: board.expectedWays == null ? null : diagnosticCount(board.expectedWays),
        capturedWays: diagnosticCount(board.capturedWays),
        unaccountedWays: board.unaccountedWays == null ? null : diagnosticCount(board.unaccountedWays),
        rowsCaptured: diagnosticCount(board.rowsCaptured),
        incompleteProtectionRows: diagnosticCount(board.incompleteProtectionRows),
      })),
      files: (files || []).map((f) => ({
        file: fileTag(f.id),
        ext: f.ext || null,
        status: f.status || null,
        pages: (f.pages || []).length,
      })),
      failureSummary: diagnosticFailureSummary(pageDetails),
      pages: pageDetails,
      reasonGuidance: DIAGNOSTIC_GUIDANCE,
    };
  }

  global.EstimationExtractorCore = {
    expectedWaysFromText,
    extractBoardHeader,
    pageLooksTabular,
    buildCoverage,
    HEALTH_REASONS,
    scoreScheduleCandidate,
    selectAiRecoveryReason,
    planAiRecoveryJobs,
    buildDocumentExtractionScope,
    buildAnalysisHealth,
    buildPageDiagnosticVerdict,
    buildDiagnosticExport,
    THREE_TYPES,
    toThreeType,
    DEFAULT_PROTECTION_LEGEND,
    parseProtectionLegend,
    occupancyLabel,
    scheduleOccupancyLabel,
    reconcileRowOccupancy,
    explicitPhaseEvidence,
    reconcilePoleEvidence,
    hasFittedProtectionDevice,
    hasProtectionEvidence,
    protectionDeviceQuantity,
    isCountableProtectionDevice,
    isPopulatedProtectionRow,
    parseTrailingCable,
    normaliseBoardReference,
    canonicalBoardReference,
    extractBoardReferences,
    classifyPageText,
    parseBamScheduleLine,
    parseTbaProtectionLine,
    parseTbaSchedulePage,
    parseKnownScheduleLine,
    parseProtectionStandardSequence,
    parseProtectionTableLine,
    reconcileCombinedProtection,
    extractAssociatedEquipment,
    noteReferences,
    parseGoverningNotes,
    applyGoverningNotes,
    isSchematicTopologyEvidence,
    isTakeoffEvidenceRow,
    applyBoardScope,
    aggregateDevices,
    finalizeScheduleContext,
    normaliseAssistedDevice,
    assistedSeedFromText,
    matchAssistedRows,
    assessPageText,
    buildOcrCandidatePlan,
    scoreOcrCandidate,
    selectBestOcrCandidate,
    correctElectricalOcrText,
    extractTrippingCurve,
    extractBreakingCapacity,
    reconstructSpatialRows,
    stitchSchedulePages,
    deduplicateExtractionRows,
    ocrWordsToLines,
  };
})(globalThis);
