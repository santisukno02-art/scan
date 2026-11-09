# BOXCHECK system audit

## Scope and access limits

This audit is based on the checked-in source and SQL migration. No live Supabase connection, production credentials, example receiving documents, or mobile device is available here. Therefore PostgreSQL version, installed extension schema, live RLS behavior, real-document OCR quality, and camera hardware behavior cannot be confirmed from this workspace. Files under `sources/` are reference-only and were not read or changed.

## Findings before changes

| Area | Evidence in current source | Root cause / impact | Planned correction |
| --- | --- | --- | --- |
| Session code generation | `create_receiving_session` calls unqualified `gen_random_bytes(4)` with `search_path=public,pg_temp` | If `pgcrypto` is installed in `extensions`, PostgreSQL cannot resolve the function. The migration does not verify extension schema or server version. | Use PostgreSQL's `gen_random_uuid()` for a random suffix; add a forward-only migration with version and extension diagnostics. |
| User authorization | Middleware/API gate on `ALLOWED_USER_IDS`, while SQL RPC checks `user_access` | Two independent allowlists can disagree; changing one does not change the other. | Make the protected `user_access` table the authorization source via a narrowly scoped security-definer check. |
| OCR row association | `parseTransferRows` splits full-page text at each TFS and searches forward for branches/count | Text order is not table geometry; wrapped rows or neighboring entries can be joined. Raw OCR text and human corrections are not persisted separately. | Use word-level TSV coordinates, group words by their measured line/row position, extract only within the same row, flag incomplete rows, and retain raw row text/source coordinates for review. |
| Original documents | Images/PDF pages exist only in browser state; `receiving_documents` is not written and Storage has read-only policy | Originals are lost when the browser closes and cannot be audited later. | Add private Storage upload and document metadata policy/route; keep uploads associated with the confirmed session. |
| Repeated barcode reads | Scanner rejects a code while it equals `last.current`, and never clears that value | A second physical box with the same TFS cannot be scanned unless a different barcode is seen first. | Clear the frame lock only after consecutive decode-miss frames; each newly reacquired barcode gets a new request ID. Keep explicit retry ID after network failure. |
| Scan retry / authorization | RPC returns duplicate before locking and authorizing the requested session | A reused request ID can receive a duplicate response without proving access to the requested session. | Lock and authorize the session first, then resolve idempotency; record duplicate retry in audit log without incrementing totals. |
| Storage / database policies | receiving_documents has no insert grant/policy; storage has select only | Intended document upload cannot work under the current schema. | Add owner-scoped insert rules and authenticated route validation. |
| Local TypeScript scope | `tsconfig.json` included `**/*.ts`/`**/*.tsx` and excluded only `node_modules`; a previous extracted `boxcheck-ocr-ui-fix` copy was present in the project root | The build checked stale nested app files and failed on its missing scanner import. | Exclude the nested extracted copy and the read-only `sources/` reference folder from TypeScript input. |
| Local Next.js root detection | A parent-level `package-lock.json` exists outside the project | Next.js inferred the parent profile folder as workspace root and hit a Windows `readlink` permission error. | Set `outputFileTracingRoot` to the actual project working directory. |
| Mobile result tables | Session details and history use wide tables with a 620px minimum width | Important fields require horizontal scrolling on phones. | Add mobile card presentation for primary result lists; retain desktop tables. |
| Verification | No test runner/scripts or production test credentials are present | Database, camera, and real OCR claims cannot be proven from the source tree alone. | Add reproducible local checks for deterministic logic and run a production build; list external checks requiring the user’s Supabase project/device. |

## Data safety notes

- No destructive schema operation is planned. Changes are additive and applied through a new migration; the old migration is retained.
- Existing expected/actual/missing/over semantics remain: `max(expected - actual, 0)` and `max(actual - expected, 0)` per TFS.
- A distinct successful request continues to count even above expected quantity. An unexpected TFS is recorded but does not affect an expected item. A repeated request ID never increments counts.
- Browser OCR remains advisory. Rows lacking a TFS, both branches, and an integer count must remain visibly review-required and must not be silently populated with guessed values.

## Before-change plan

1. Add an additive migration for authorization consistency, secure reference generation, scan idempotency ordering, OCR provenance, and private document upload.
2. Rework OCR extraction around coordinate-bearing TSV lines and preserve raw text/provenance separately from reviewed values.
3. Store originals in the private receiving-documents bucket after explicit user confirmation; surface upload failures instead of navigating away.
4. Correct repeated-frame barcode locking and reuse request IDs only for explicit retry.
5. Improve mobile result views and states without removing existing workflows.
6. Run available deterministic tests and production build; package only changed source/migration/docs files, then state exactly which online checks remain.

## Unverified production checks

After deployment, run the diagnostic SQL in the new migration output / Supabase SQL editor to inspect `server_version_num`, `pgcrypto` schema, and function visibility. Then test an actual document set (including adjacent similar TFS values and skew), repeated same-TFS boxes, a true network retry, unexpected TFS, unauthorized account, Storage access from a second account, and mobile widths 360/375/390/430px. These checks require the actual Supabase project and physical device and cannot be reported as passed here.

## Local implementation outcome

- Added forward-only migration `202611090001_boxcheck_hardening.sql`; it checks PostgreSQL version and pgcrypto schema, changes session-code generation to UUID, unifies access checks through `user_access`, orders scan authorization/idempotency safely, preserves OCR provenance, and permits owner-scoped private document upload.
- Replaced text-order OCR parsing with coordinate-grouped TSV line extraction, bounded skew estimation/correction, grayscale/contrast/sharpness preprocessing, and explicit per-row confirmation. Incomplete rows remain empty and blocked.
- Original files are uploaded directly from the browser to the private Supabase Storage bucket; the Vercel API stores only validated metadata. Documents can be opened with five-minute signed URLs.
- Same-code barcode frames stay locked until eight decode-miss callbacks; explicit retry retains its request UUID. Server calculations stay in the Postgres RPC.
- Added a database-backed dashboard summary, history search/status/sort, mobile bottom navigation, and mobile card results.
- Local verification: seven deterministic Node tests pass, `tsc --noEmit` passes, and `next build` passes.
- Not verified here: SQL execution against the user's Supabase, real Thai transfer forms, real phone camera/barcode hardware, multi-account RLS/Storage denial, Vercel deployment, or visual checks at the requested viewport widths.
- OCR currently groups words by line geometry and reads ordered branch/count tokens within that line. It does not yet learn arbitrary table column boundaries from each form's header/grid lines; forms with different layouts need actual-document validation and manual review.
