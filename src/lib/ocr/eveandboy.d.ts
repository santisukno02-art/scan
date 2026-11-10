export const EVEANDBOY_TEMPLATE: {
  name: string;
  table: { left: number; right: number; top: number; bottom: number };
  columns: Record<'sequence' | 'tfs' | 'source' | 'destination' | 'quantity', [number, number]>;
  dataTop: number;
  expectedTfsPattern: RegExp;
  expectedTfsLength: number;
  expectedBranchPattern: RegExp;
};
export function normalizeTfsCandidate(value: unknown): string;
export function validateEveandboyRow(row: {
  transfer_number: string; source_branch: string; destination_branch: string;
  expected_quantity: number | null; confidence: number; rowNumber: number;
  sequence_number?: number | null; sequenceNumber?: number | null; geometryValid: boolean; flags?: string[];
  userDecision?: 'UNDECIDED' | 'INCLUDE' | 'EXCLUDE';
}): {
  formatValid: boolean; rowMappingValid: boolean;
  lookalikes: Array<{ index: number; character: string; possibleLookalike: string }>;
  flags: string[]; reviewStatus: 'NORMAL' | 'NEEDS_REVIEW' | 'CROSSED_OUT' | 'HANDWRITING_DETECTED';
  userDecision: 'UNDECIDED' | 'INCLUDE' | 'EXCLUDE'; eligibleForConfirmation: boolean;
};
export function validateEveandboyTotals(rows: Array<{ expected_quantity: number | null }>, printedTotal: number | null): {
  rowTotal: number; printedTotal: number | null; matches: boolean; discrepancy: boolean;
};
export function detectHorizontalRules(gray: Uint8Array, width: number, height: number, options?: { x0?: number; x1?: number; threshold?: number; minCoverage?: number }): number[];
export function detectTableRows(gray: Uint8Array, width: number, height: number, expectedCount?: number): { boundaries: number[]; geometryValid: boolean; detectedRuleCount: number };
export function rowHasStrikeThrough(gray: Uint8Array, width: number, height: number, y0: number, y1: number): boolean;
export function rowHasMarginHandwriting(gray: Uint8Array, width: number, height: number, y0: number, y1: number): boolean;
