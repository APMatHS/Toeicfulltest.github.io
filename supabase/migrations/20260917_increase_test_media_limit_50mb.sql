-- Applied to Supabase project ulnjhgrwqsxoidkzumwc on 2026-09-17.
-- Keep this migration in Git so the repository matches production configuration.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/png','image/jpeg','image/webp',
      'audio/mpeg','audio/mp4','audio/wav','audio/x-m4a','audio/aac','audio/ogg'
    ]::text[]
where id = 'test-media';
