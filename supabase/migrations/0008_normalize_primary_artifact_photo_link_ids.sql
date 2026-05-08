-- Migration 0008 - normalize backfilled primary link ids to match local SQLite.
-- Migration 0006 let Postgres generate ids for existing primary links. The
-- offline model uses deterministic `{artifact_id}:primary` ids for those same
-- rows, so normalize cloud rows before enabling link sync.

update artifact_photo_links
set id = artifact_id::text || ':primary'
where role = 'primary'
  and photo_id = artifact_id
  and id <> artifact_id::text || ':primary';
