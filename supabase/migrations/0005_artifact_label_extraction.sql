-- Migration 0005 - structured exhibit-label extraction fields.
-- Run in Supabase Studio SQL Editor after 0004.

alter table artifacts
  add column if not exists name text,
  add column if not exists dynasty text,
  add column if not exists category text,
  add column if not exists origin text,
  add column if not exists era text,
  add column if not exists label_description text,
  add column if not exists raw_ocr_text text,
  add column if not exists extraction_status text not null default 'idle',
  add column if not exists extraction_error text,
  add column if not exists extraction_updated_at timestamptz;

create index if not exists idx_artifacts_extraction_status
  on artifacts(extraction_status);
