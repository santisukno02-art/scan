import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHorizontalRules, detectTableRows, rowHasStrikeThrough, validateEveandboyRow, validateEveandboyTotals } from './eveandboy.mjs';

const sampleTfs = [
  'TFS260604861','TFS260604928','TFS260604948','TFS260604955','TFS260605152',
  'TFS260605176','TFS260605205','TFS260605220','TFS260605254','TFS260605295',
  'TFS260605310','TFS260605369','TFS260605384','TFS260605395','TFS260605437',
  'TFS260605486','TFS260605498','TFS260605634','TFS260605652','TFS260605654',
];

test('recognizes the supplied form TFS shape and flags the crossed row without excluding it', () => {
  const rows = sampleTfs.map((transfer_number, index) => ({
    transfer_number, source_branch: '84_KPP', destination_branch: '93_LCR',
    expected_quantity: 1, confidence: 92, rowNumber: index + 1,
    sequence_number: index + 1, geometryValid: true,
    flags: index === 14 ? ['CROSSED_OUT', 'HANDWRITING_DETECTED'] : [],
    userDecision: 'UNDECIDED',
  }));
  assert.equal(rows.length, 20);
  assert.equal(new Set(sampleTfs).size, 20);
  assert.equal(rows.filter(row => validateEveandboyRow(row).formatValid).length, 20);
  assert.equal(rows.filter(row => validateEveandboyRow(row).eligibleForConfirmation).length, 19);
  assert.deepEqual(validateEveandboyRow(rows[14]).flags, ['CROSSED_OUT', 'HANDWRITING_DETECTED']);
  assert.equal(validateEveandboyRow(rows[14]).userDecision, 'UNDECIDED');
  assert.deepEqual(validateEveandboyTotals(rows, 20), { rowTotal: 20, printedTotal: 20, matches: true, discrepancy: false });
});

test('does not repair lookalike TFS characters and blocks malformed quantity or row mapping', () => {
  const result = validateEveandboyRow({
    transfer_number: 'TFS26060486O', source_branch: '84_KPP', destination_branch: '93_LCR',
    expected_quantity: -1, confidence: 99, rowNumber: 3, sequence_number: 2, geometryValid: false,
  });
  assert.equal(result.formatValid, false);
  assert.equal(result.rowMappingValid, false);
  assert.ok(result.lookalikes.some(item => item.character === 'O' && item.possibleLookalike === '0'));
  assert.equal(result.eligibleForConfirmation, false);
});

test('finds only table-width rules, grouping thick lines', () => {
  const width = 30, height = 12, gray = new Uint8Array(width * height).fill(230);
  for (let x = 0; x < width; x += 1) { gray[4 * width + x] = 20; gray[5 * width + x] = 20; }
  for (let x = 2; x < 8; x += 1) gray[9 * width + x] = 10;
  assert.deepEqual(detectHorizontalRules(gray, width, height), [4.5]);
});

test('reports footer mismatch as a discrepancy', () => {
  assert.deepEqual(validateEveandboyTotals([{ expected_quantity: 1 }, { expected_quantity: 2 }], 20), {
    rowTotal: 3, printedTotal: 20, matches: false, discrepancy: true,
  });
});

test('interpolates one missing table rule but requires review; refuses to invent rows without rules', () => {
  const width = 1000, height = 2000, gray = new Uint8Array(width * height).fill(235);
  const x0 = Math.floor(width * 0.067), x1 = Math.ceil(width * 0.91);
  const top = height * 0.137, bottom = height * 0.48;
  for (let i = 0; i <= 20; i += 1) {
    if (i === 9) continue;
    const y = Math.round(top + (bottom - top) * i / 20);
    for (let x = x0; x < x1; x += 1) gray[y * width + x] = 25;
  }
  const result = detectTableRows(gray, width, height);
  assert.equal(result.boundaries.length, 21);
  assert.equal(result.geometryValid, false);
  assert.equal(result.detectedRuleCount, 20);
  assert.deepEqual(detectTableRows(new Uint8Array(width * height).fill(235), width, height).boundaries, []);
});

test('flags a long row-crossing pen line', () => {
  const width = 100, height = 20, gray = new Uint8Array(width * height).fill(230);
  gray.fill(15, 10 * width + 7, 10 * width + 93);
  assert.equal(rowHasStrikeThrough(gray, width, height, 5, 15), true);
});
