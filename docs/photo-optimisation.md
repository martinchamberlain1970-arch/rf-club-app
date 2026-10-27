# Player photo optimisation

Player photos are converted server-side to WebP quality 85, bounded to 768 × 768 without enlargement or cropping. EXIF orientation is applied and metadata removed from the serving copy. Originals remain untouched. Inputs are capped at 10 MB / 40 megapixels; animations retain their frames (maximum 100); invalid images are rejected.

Each new upload gets a unique original name and a matching `.optimised-v1.webp` copy. Only the optimised URL is submitted through the existing club admin/owner approval workflow. Files use a one-year browser cache; changing the photo changes its URL. There is no Supabase paid image transformation dependency.

## Existing photos and rollback

Sign in as the owner at `/photo-optimisation`:
1. Prepare copies. This uploads derivatives without changing player references.
2. Inspect the original/optimised comparisons.
3. Activate reviewed copies. Exact URL comparisons update current player photos and pending photo requests only. Newer uploads and approval states are preserved.
4. Restore original photos if necessary. The reverse operation checks originals exist and swaps exact derivative URLs back. It does not delete either file.

Operations are sequential and safe to retry. A partial failure stops the batch and reports the error. The page reports any external/unrecognised photo references separately. Storage inventory is bounded to 1,000 objects and fails closed beyond this limit.

The endpoint authenticates the bearer token and checks the owner email or stored owner role; user-editable metadata cannot grant access. No migration key or secret is exposed to the browser.

Validation: `node --test tests/optimise-avatar.cjs`, TypeScript, targeted ESLint and production Next build. Public pages continue to use the same photo URLs stored in player records, with lazy image decoding/loading.
