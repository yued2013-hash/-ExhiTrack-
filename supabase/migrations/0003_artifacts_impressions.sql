-- Migration 0003 — artifacts + impressions cloud schema + storage buckets
-- Run in Supabase Studio → SQL Editor.

-- ============================================================
-- artifacts
-- ============================================================
create table if not exists artifacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exhibition_id   uuid not null references exhibitions(id) on delete cascade,
  photo_url       text,
  thumbnail_url   text,
  photo_taken_at  timestamptz not null,
  group_id        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_artifacts_user_id on artifacts(user_id);
create index if not exists idx_artifacts_exhibition_id on artifacts(exhibition_id);
create index if not exists idx_artifacts_group_id on artifacts(group_id);

drop trigger if exists artifacts_updated_at on artifacts;
create trigger artifacts_updated_at
  before update on artifacts
  for each row execute function set_updated_at();

alter table artifacts enable row level security;
drop policy if exists "artifacts_owner" on artifacts;
create policy "artifacts_owner"
  on artifacts for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- impressions
-- ============================================================
create table if not exists impressions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exhibition_id      uuid not null references exhibitions(id) on delete cascade,
  artifact_id        uuid references artifacts(id) on delete set null,
  voice_url          text,
  voice_duration_ms  integer not null default 0,
  raw_text           text,
  polished_text      text,
  recorded_at        timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_impressions_user_id on impressions(user_id);
create index if not exists idx_impressions_exhibition_id on impressions(exhibition_id);
create index if not exists idx_impressions_artifact_id on impressions(artifact_id);

drop trigger if exists impressions_updated_at on impressions;
create trigger impressions_updated_at
  before update on impressions
  for each row execute function set_updated_at();

alter table impressions enable row level security;
drop policy if exists "impressions_owner" on impressions;
create policy "impressions_owner"
  on impressions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Storage buckets — public so URLs work in <Image>; paths contain user_id
-- so any leaked URL exposes only that single user's media.
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('voices', 'voices', true)
  on conflict (id) do nothing;

-- Storage RLS — write/update/delete only for files in your own folder
drop policy if exists "media_owner_insert" on storage.objects;
create policy "media_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('photos', 'voices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media_owner_update" on storage.objects;
create policy "media_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('photos', 'voices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media_owner_delete" on storage.objects;
create policy "media_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('photos', 'voices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read"
  on storage.objects for select
  using (bucket_id in ('photos', 'voices'));
