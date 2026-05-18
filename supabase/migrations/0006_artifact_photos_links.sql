-- Migration 0006 - formal artifact photo/material model.
-- Run in Supabase Studio SQL Editor after 0005.

create table if not exists artifact_photos (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exhibition_id        uuid not null references exhibitions(id) on delete cascade,
  photo_url            text,
  thumbnail_url        text,
  photo_taken_at       timestamptz not null,
  latitude             double precision,
  longitude            double precision,
  imported_from        text,
  raw_ocr_text         text,
  ocr_status           text not null default 'idle',
  ocr_error            text,
  ocr_updated_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_artifact_photos_user_id on artifact_photos(user_id);
create index if not exists idx_artifact_photos_exhibition_id on artifact_photos(exhibition_id);
create index if not exists idx_artifact_photos_photo_taken_at on artifact_photos(photo_taken_at);
create index if not exists idx_artifact_photos_ocr_status on artifact_photos(ocr_status);

drop trigger if exists artifact_photos_updated_at on artifact_photos;
create trigger artifact_photos_updated_at
  before update on artifact_photos
  for each row execute function set_updated_at();

alter table artifact_photos enable row level security;
drop policy if exists "artifact_photos_owner" on artifact_photos;
create policy "artifact_photos_owner"
  on artifact_photos for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists artifact_photo_links (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exhibition_id  uuid not null references exhibitions(id) on delete cascade,
  artifact_id    uuid not null references artifacts(id) on delete cascade,
  photo_id       uuid not null references artifact_photos(id) on delete cascade,
  role           text not null default 'primary',
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_artifact_photo_links_user_id on artifact_photo_links(user_id);
create index if not exists idx_artifact_photo_links_artifact_id on artifact_photo_links(artifact_id);
create index if not exists idx_artifact_photo_links_photo_id on artifact_photo_links(photo_id);
create index if not exists idx_artifact_photo_links_exhibition_id on artifact_photo_links(exhibition_id);
create unique index if not exists idx_artifact_photo_links_unique
  on artifact_photo_links(artifact_id, photo_id, role);

drop trigger if exists artifact_photo_links_updated_at on artifact_photo_links;
create trigger artifact_photo_links_updated_at
  before update on artifact_photo_links
  for each row execute function set_updated_at();

alter table artifact_photo_links enable row level security;
drop policy if exists "artifact_photo_links_owner" on artifact_photo_links;
create policy "artifact_photo_links_owner"
  on artifact_photo_links for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into artifact_photos (
  id, user_id, exhibition_id, photo_url, thumbnail_url,
  photo_taken_at, latitude, longitude, imported_from,
  raw_ocr_text, ocr_status, ocr_error, ocr_updated_at,
  created_at, updated_at
)
select
  id, user_id, exhibition_id, photo_url, thumbnail_url,
  photo_taken_at, latitude, longitude, imported_from,
  raw_ocr_text, extraction_status, extraction_error, extraction_updated_at,
  created_at, updated_at
from artifacts
on conflict (id) do nothing;

insert into artifact_photo_links (
  user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
  created_at, updated_at
)
select
  a.user_id, a.exhibition_id, a.id, a.id, 'primary', 0,
  a.created_at, a.updated_at
from artifacts a
where not exists (
  select 1
  from artifact_photo_links l
  where l.artifact_id = a.id
    and l.photo_id = a.id
    and l.role = 'primary'
);
