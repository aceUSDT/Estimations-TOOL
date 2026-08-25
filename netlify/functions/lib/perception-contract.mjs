export const PERCEPTION_CONTRACT_VERSION = 1;

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();

function extractionPayload(output) {
  return output?.result && typeof output.result === 'object' ? output.result : output;
}

function validBox(value) {
  if (!Array.isArray(value) || value.length < 4) return false;
  const numbers = value.slice(0, 4).map(Number);
  return numbers.every(Number.isFinite) && numbers[2] >= 0 && numbers[3] >= 0;
}

function entityBox(entity) {
  return entity?.bbox || entity?.source_region || entity?.polygon || null;
}

function confidenceSummary(entities) {
  const values = entities.map((item) => Number(item?.confidence)).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!values.length) return { minimum: null, mean: null, maximum: null, measured: 0 };
  return {
    minimum: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximum: Math.max(...values),
    measured: values.length,
  };
}

export function buildPerceptionContract(output, context = {}) {
  const payload = extractionPayload(output) || {};
  const boards = list(payload.boards);
  const devices = list(payload.devices);
  const feeds = list(payload.feeds);
  const entities = [...boards, ...devices, ...feeds];
  const reasonCodes = [];

  const duplicateBoards = boards.map((board) => text(board.ref).toUpperCase()).filter(Boolean)
    .filter((ref, index, values) => values.indexOf(ref) !== index);
  if (duplicateBoards.length) reasonCodes.push('duplicate_board_reference');
  if (devices.some((device) => !text(device.board_ref))) reasonCodes.push('device_without_board_reference');
  if (devices.some((device) => !text(device.device_class))) reasonCodes.push('device_class_missing');
  if (devices.some((device) => !['spare', 'space'].includes(text(device.device_class).toLowerCase())
    && (device.rating_a == null || device.rating_a === ''))) reasonCodes.push('device_rating_missing');
  if (feeds.some((feed) => !text(feed.from_ref) || !text(feed.to_ref))) reasonCodes.push('feed_endpoint_missing');
  if (list(payload.flags).some((flag) => flag?.kind === 'possible_missing_rows')) reasonCodes.push('possible_missing_rows');
  if (list(payload.flags).some((flag) => flag?.kind === 'unreadable_region')) reasonCodes.push('unreadable_region');

  const withCoordinates = entities.filter((entity) => validBox(entityBox(entity))).length;
  const provider = text(output?.provider || payload.provider) || 'unreported';
  const model = text(output?.model || payload.model) || 'unreported';
  const contract = {
    version: PERCEPTION_CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    document: {
      filename: text(context.filename) || null,
      pageNumber: Number.isFinite(Number(context.pageNumber)) ? Number(context.pageNumber) : null,
    },
    provider: { name: provider, model },
    classification: payload.classification || null,
    counts: { boards: boards.length, devices: devices.length, feeds: feeds.length, flags: list(payload.flags).length },
    evidenceCoverage: {
      entities: entities.length,
      withCoordinates,
      ratio: entities.length ? withCoordinates / entities.length : 0,
      coordinateSpace: context.coordinateSpace || 'source-page',
    },
    confidence: confidenceSummary(entities),
    validation: {
      status: reasonCodes.length ? 'review_required' : 'valid',
      reasonCodes: [...new Set(reasonCodes)],
    },
  };
  return contract;
}

export function attachPerceptionContract(output, context = {}) {
  if (!output || typeof output !== 'object') return output;
  const contract = buildPerceptionContract(output, context);
  if (output.result && typeof output.result === 'object') {
    return { ...output, contract, result: { ...output.result, contract } };
  }
  return { ...output, contract };
}
