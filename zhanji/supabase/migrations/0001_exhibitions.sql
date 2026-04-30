-- Migration 0001 — exhibitions table (MVP minimum)
-- Run in Supabase Studio → SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists exhibitions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  museum      text,
  visit_date  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists exhibitions_user_id_idx on exhibitions(user_id);
create index if not exists exhibitions_visit_date_idx on exhibitions(visit_date desc);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists exhibitions_updated_at on exhibitions;
create trigger exhibitions_updated_at
  before update on exhibitions
  for each row execute function set_updated_at();

-- RLS disabled per PRD §3 (single-user self-use scenario).
-- New tables in Supabase have RLS off by default; explicit for clarity.
alter table exhibitions disable row level security;
