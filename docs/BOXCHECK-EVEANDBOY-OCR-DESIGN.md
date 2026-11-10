# BOXCHECK EVEANDBOY OCR design

## Goal

Read the EVEANDBOY transfer sheet as a document with a page, table, rows, and cells. Never construct a receiving item by joining nearby text. The system must preserve source images/crops, show why each value passed or failed validation, and leave every uncertain or marked row for an explicit human decision.

## Existing state found

- The current receive page runs Tesseract.js on the full page and its TSV parser groups words into approximate text lines. It then finds a TFS token and infers two branch codes and a quantity from token order. It does not detect this document's page corners, table borders, columns, printed total, crossed-out rows, or handwriting.
- The existing review table can edit values and require a row confirmation, but it does not show row/TFS/quantity crops or highlight the selected row on the original page.
- The user has now supplied a phone photo of a 05/11/2026 EVEANDBOY transfer note. It shows document `CTRL26110500054`, 20 printed rows, 20 quantity marks of `1`, a crossed-out/annotated row 15, and printed footer total 20. The photo is used to calibrate normalized page ratios, column regions, and the observed `TFS` + 9 digits pattern. The original attachment remains outside the source tree.
- OCR execution against the photo is not yet acceptance evidence: this workstation cannot fetch Tesseract language data, so the implementation's cell recognition accuracy still needs to be measured in an online browser/deployment.

## Proposed flow

1. Preserve the uploaded original image/PDF. Render PDF pages without discarding the PDF itself.
2. Normalize orientation, illumination, contrast, and small skew; detect the page boundary and perspective-warp to a normalized page coordinate system.
3. Normalize the detected sheet to portrait A4 using page-edge points and a homography, then use ratios calibrated from the provided form. Confirm the `CTRL` document-number/date crop and table-rule geometry before treating mapping as reliable. Coordinates are normalized against the detected page; never apply fixed raw-photo pixels.
4. Produce row and cell polygons: sequence, TFS, source, destination, expected quantity, plus printed footer total. If a border is missing, use line/word layout evidence but lower the mapping validation and require human review.
5. OCR each cell crop separately. Use a configurable TFS rule obtained from confirmed samples. Keep recognized text unchanged; expose possible lookalike characters for review instead of silently changing them. Use a digits-only OCR configuration for quantity crops.
6. Detect visual evidence of strike-through/handwriting per row. Store flags independently so a row can be both crossed out and handwritten. Classification never decides whether to include it.
7. Validate row number/order, TFS syntax/duplicates, required branches, non-negative integer quantity, row sum vs printed footer, and cell-to-row geometry. Keep OCR confidence, format validation, row mapping validation, total validation, and human verification as separate fields.
8. Show a mobile-first review card with original page and row/TFS/quantity crops. Selecting a card highlights its polygon on the original page. User explicitly chooses include/exclude for flagged rows and confirms every row before the session is created.
9. Persist original file, crop object paths, raw cell OCR, reviewed values, flags, user decision, and validation results separately. Use private Storage and RLS. Do not create the receiving session until final confirmation.

## Status and decision model

- `row_flags`: zero or more of `CROSSED_OUT`, `HANDWRITING_DETECTED`.
- `review_status`: `NORMAL` only when all required checks pass with no visual warning; otherwise `NEEDS_REVIEW`.
- `user_decision`: `UNDECIDED`, `INCLUDE`, or `EXCLUDE`. A flagged row remains undecided until the user chooses.
- An excluded row is retained for audit and source navigation but is omitted from transfer items and totals.
- `NORMAL` is not equivalent to user verification; every included row still requires an explicit confirmation.
- If row count or total quantity differs from the printed sequence/footer, block final confirmation until the discrepancy is acknowledged and corrected or the source value is verified.

## Acceptance evidence

For each actual EVEANDBOY fixture, record ground truth and OCR result for row count, row number, TFS, source, destination, quantity, footer total, crossed-out/handwritten flags, and user decision. Report exact correct counts and discrepancies; do not claim 100% accuracy. Required cases include a skewed phone photo, uneven lighting/shadow, adjacent similar TFS values, a handwritten/crossed row, and a mismatch against footer total.

## Required calibration input

Calibration input received: one full-page phone photo, including the crossed-out row and footer total. Ground truth visible in that image: 20 rows; the 20 TFS values and branch pairs are legible; each quantity is 1; row 15 is crossed out and annotated, with no automatic cancellation decision; printed total 20. This is manual visual transcription of the supplied image, not a measured OCR accuracy result.

## Current implementation and limits

- New `src/lib/ocr/normalize-page.ts` detects bright page-edge runs and maps the page to portrait A4 by a projective transform. If the page boundary is uncertain, every extracted row stays in review.
- New `src/lib/ocr/eveandboy.mjs` stores the sample-derived normalized column ratios and checks row rules, TFS/branch/quantity formats, totals, lookalike letters, strike-throughs, and margin handwriting. Missing grid rules are interpolated only from the detected median row spacing and marked for review; without enough rules it returns no rows rather than inventing them.
- The receive page reads independent sequence, TFS, branch, quantity, header, and footer crops. It displays the corrected page with a selected-row highlight and the row/TFS/branch/quantity crops. Crossed or uncertain rows require an explicit include/exclude decision and row confirmation.
- Evidence and decisions are retained with the existing `receiving_documents.reviewed_items` JSON field; no database migration or Supabase changes are required.
- Tesseract accuracy, shading/perspective performance on diverse devices, handwriting classification precision, and the user's Vercel/Supabase storage permissions still require live acceptance checks. Do not claim 100% accuracy.
