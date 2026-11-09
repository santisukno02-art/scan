# BOXCHECK post-deploy checks

These checks require the actual Supabase project and a phone with a camera. They were not run in the local workspace.

## Supabase checks

1. Apply `supabase/migrations/202611090001_boxcheck_hardening.sql` after the original migration and before deploying the new app code.
2. Run `supabase/verification/boxcheck-readiness.sql` in SQL Editor. Confirm PostgreSQL is version 13 or newer, the required functions are installed, `create_receiving_session` no longer uses `gen_random_bytes`, the private bucket exists, and RLS is enabled on the listed tables.
3. Confirm the intended Auth account exists in `public.user_access` and `enabled = true`.
4. In the app, create a temporary receiving session with one TFS and expected quantity 1. Scan that same TFS three times as three separate boxes. Expected: Actual 3, Missing 0, Over 2. Scan an unknown TFS; it should be listed as unexpected and not change the matched item total.
5. Use a second Auth account that is not in `user_access`. It must not open another user's session or document.
6. Open an uploaded image/PDF from the session page. Its link should be private and expire after five minutes.

## OCR checks

Use representative transfer documents from the actual operation, including at least two adjacent rows whose TFS values differ by one digit, a page with a small quantity, and a slightly skewed page. Confirm each OCR item shows the right page and row, inspect the raw text, correct wrong values, and verify a row with a missing value cannot be confirmed. The parser groups coordinate-positioned words on the same OCR line and uses the horizontal order of branch codes and count; it does not yet learn arbitrary column boundaries from every document's table headers. If the source form's columns or wrapping differ, verify each row and leave unclear values blank. Do not treat OCR confidence as proof of correctness.

## Mobile checks

On an iPhone Safari and Android Chrome over HTTPS, allow camera use, scan the same printed TFS from two separate boxes, then scan it repeatedly without removing it from the camera. Expected: the same continuously visible code counts once; after it leaves the view, the next box with the same TFS can be counted. Check the result list at 360, 375, 390, and 430 CSS pixels and confirm the main values do not require horizontal scrolling.
