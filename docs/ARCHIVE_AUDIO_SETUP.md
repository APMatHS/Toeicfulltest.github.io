# Archive.org audio setup

Listening Bank uploads MP3 through the Supabase Edge Function `archive-audio-upload`.
Archive.org credentials must never be committed to GitHub or exposed in browser JavaScript.

## Required Supabase secrets

Set these in **Supabase Dashboard → Edge Functions → Secrets**:

- `ARCHIVE_ACCESS_KEY`
- `ARCHIVE_SECRET_KEY`

Use the S3 keys from the Internet Archive account dedicated to TOEICFullTest.

## Deploy

Deploy `supabase/functions/archive-audio-upload/index.ts` to the same Supabase project used by the web app.

The function:
- requires an authenticated active `teacher` or `system_admin`;
- accepts MP3 only, maximum 50 MB;
- uploads the file to an opaque Internet Archive item;
- returns the public direct MP3 URL;
- records a non-secret audit event in `audit_logs`.

## Compatibility

- New Listening Bank MP3: Archive.org.
- Existing Listening Bank MP3: remains readable from Supabase Storage.
- Images and rich-text images: remain in Supabase Storage.
- Archive files are not automatically deleted when an item is edited or removed, to avoid breaking old tests.

## First verification

Before using in a real exam:
1. Upload one small MP3 from Listening Bank.
2. Close and reopen the bank item; verify preview playback.
3. Generate a test from the item and verify the existing master-audio packaging flow.
4. Test with a larger MP3 near the expected real size.
