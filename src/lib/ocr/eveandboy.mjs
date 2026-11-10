/** EVEANDBOY transfer-note validation. Coordinates are ratios of the detected page. */
export const EVEANDBOY_TEMPLATE = Object.freeze({
  name: 'EVEANDBOY transfer note',
  // Calibrated from the supplied 05/11/2026 sample. These ratios are applied only
  // after page-boundary normalization; they are not raw camera pixel positions.
  table: { left: 0.067, right: 0.91, top: 0.112, bottom: 0.48 },
  columns: { sequence: [0.067, 0.128], tfs: [0.128, 0.518], source: [0.518, 0.642], destination: [0.642, 0.764], quantity: [0.764, 0.91] },
  dataTop: 0.137,
  expectedTfsPattern: /^TFS\d{9}$/,
  expectedTfsLength: 12,
  expectedBranchPattern: /^\d{2,3}_[A-Z0-9]{2,5}$/,
});

export function normalizeTfsCandidate(value) {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '');
}

export function validateEveandboyRow(row) {
  const tfs = normalizeTfsCandidate(row.transfer_number);
  const quantity = row.expected_quantity;
  const confusions = [...tfs].flatMap((char, index) => {
    // A raw letter in a numeric TFS position is an observed ambiguity. Do not
    // mark every legitimate digit as uncertain merely because a lookalike exists.
    const similar = index >= 3 ? ({ O: '0', I: '1', S: '5', B: '8' }[char]) : undefined;
    return similar ? [{ index, character: char, possibleLookalike: similar }] : [];
  });
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const formatValid = EVEANDBOY_TEMPLATE.expectedTfsPattern.test(tfs)
    && tfs.length === EVEANDBOY_TEMPLATE.expectedTfsLength
    && Number.isInteger(quantity) && quantity >= 0
    && EVEANDBOY_TEMPLATE.expectedBranchPattern.test(String(row.source_branch ?? '').trim().toUpperCase())
    && EVEANDBOY_TEMPLATE.expectedBranchPattern.test(String(row.destination_branch ?? '').trim().toUpperCase());
  const sequenceNumber = row.sequence_number ?? row.sequenceNumber;
  const rowMappingValid = sequenceNumber === row.rowNumber && row.geometryValid === true;
  const needsReview = !formatValid || !rowMappingValid || confusions.length > 0 || flags.length > 0 || row.confidence < 85;
  return {
    formatValid,
    rowMappingValid,
    lookalikes: confusions,
    flags,
    reviewStatus: needsReview ? 'NEEDS_REVIEW' : 'NORMAL',
    userDecision: row.userDecision ?? 'UNDECIDED',
    eligibleForConfirmation: formatValid && rowMappingValid && flags.length === 0 && confusions.length === 0 && row.confidence >= 85,
  };
}

export function validateEveandboyTotals(rows, printedTotal) {
  const rowTotal = rows.reduce((sum, row) => sum + (Number.isInteger(row.expected_quantity) && row.expected_quantity >= 0 ? row.expected_quantity : 0), 0);
  return {
    rowTotal,
    printedTotal: Number.isInteger(printedTotal) ? printedTotal : null,
    matches: Number.isInteger(printedTotal) && rowTotal === printedTotal,
    discrepancy: !Number.isInteger(printedTotal) || rowTotal !== printedTotal,
  };
}

/**
 * Find horizontal rule candidates in a binarized table crop. A rule must span
 * most of the table width, so text inside isolated cells cannot create rows.
 */
export function detectHorizontalRules(gray, width, height, { x0 = 0, x1 = width, threshold = 105, minCoverage = 0.62 } = {}) {
  if (!gray || gray.length < width * height || width <= 0 || height <= 0) return [];
  const left = Math.max(0, Math.floor(x0));
  const right = Math.min(width, Math.ceil(x1));
  const rules = [];
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = left; x < right; x += 1) if (gray[y * width + x] < threshold) dark += 1;
    if (dark / Math.max(1, right - left) >= minCoverage) rules.push(y);
  }
  const clusters = [];
  for (const y of rules) {
    const last = clusters.at(-1);
    if (!last || y - last.end > 2) clusters.push({ start: y, end: y, count: 1 });
    else { last.end = y; last.count += 1; }
  }
  return clusters.map(({ start, end }) => (start + end) / 2);
}

export function detectTableRows(gray, width, height, expectedCount = 20) {
  const t = EVEANDBOY_TEMPLATE;
  const rules = detectHorizontalRules(gray, width, height, {
    x0: width * t.table.left, x1: width * t.table.right,
    threshold: 110, minCoverage: 0.58,
  }).filter(y => y / height >= t.dataTop - 0.012 && y / height <= t.table.bottom + 0.002);
  // Infer only from actual rules. A missed rule may be interpolated from the
  // median spacing, but all resulting rows are marked for manual review.
  if (rules.length < 2 || rules.length > 61) return { boundaries: [], geometryValid: false, detectedRuleCount: rules.length };
  const gaps = rules.slice(1).map((line, index) => line - rules[index]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!medianGap || medianGap / height < 0.006 || medianGap / height > 0.04) return { boundaries: [], geometryValid: false, detectedRuleCount: rules.length };
  const boundaries = [rules[0]];
  let regular = true;
  for (const gap of gaps) {
    if (gap < medianGap * 0.55) { regular = false; continue; }
    const segments = Math.max(1, Math.round(gap / medianGap));
    if (segments > 3 || gap > medianGap * 3.5) return { boundaries: [], geometryValid: false, detectedRuleCount: rules.length };
    if (gap < medianGap * 0.7 || gap > medianGap * 1.35) regular = false;
    const from = boundaries[boundaries.length - 1];
    for (let part = 1; part <= segments; part += 1) boundaries.push(Math.round(from + gap * part / segments));
  }
  const rowCount = boundaries.length - 1;
  if (rowCount < 1 || rowCount > 60) return { boundaries: [], geometryValid: false, detectedRuleCount: rules.length };
  return { boundaries, geometryValid: regular, detectedRuleCount: rules.length };
}

export function rowHasStrikeThrough(gray, width, height, y0, y1) {
  if (!gray || y1 <= y0) return false;
  const mid = Math.floor((y0 + y1) / 2);
  const left = Math.round(width * EVEANDBOY_TEMPLATE.table.left);
  const right = Math.round(width * EVEANDBOY_TEMPLATE.table.right);
  let longest = 0;
  let run = 0;
  for (let x = left; x < right; x += 1) {
    if (gray[mid * width + x] < 75) { run += 1; longest = Math.max(longest, run); }
    else run = 0;
  }
  return longest / Math.max(1, right - left) > 0.62;
}

export function rowHasMarginHandwriting(gray, width, height, y0, y1) {
  const left = Math.round(width * 0.91);
  const right = Math.round(width * 0.975);
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(height, Math.ceil(y1));
  let dark = 0;
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    if (gray[y * width + x] < 105) dark += 1;
  }
  return dark > Math.max(24, (bottom - top) * 0.12);
}

export function getRowStatus(flags = []) {
  if (flags.includes('CROSSED_OUT')) return 'CROSSED_OUT';
  if (flags.includes('HANDWRITING_DETECTED')) return 'HANDWRITING_DETECTED';
  return flags.length ? 'NEEDS_REVIEW' : 'NORMAL';
}
