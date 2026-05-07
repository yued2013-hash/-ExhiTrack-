-- Migration 0004 — EXIF metadata for imported artifact photos.
-- Run in Supabase Studio → SQL Editor after 0003.

alter table artifacts
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists imported_from text;

create index if not exists idx_artifacts_photo_taken_at
  on artifacts(photo_taken_at);
