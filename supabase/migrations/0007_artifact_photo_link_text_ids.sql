-- Migration 0007 - align artifact_photo_links.id with local deterministic ids.
-- Local links use text ids such as `{artifact_id}:primary`; the cloud column
-- must accept those values for offline-created default links to sync.

alter table artifact_photo_links
  alter column id type text using id::text;
